!function(r, $, _) {
  'use strict';

  var models = r.robin.models;
  var views = r.robin.views;

  var RobinChat = Backbone.View.extend({
    SYSTEM_USER_NAME: '[robin]',
    MAX_USERS_TO_DISPLAY: 200,

    lastMessageText: null,

    websocketEvents: {
      'connecting': function() {
        this.addSystemAction('connecting');
      },

      'connected': function() {
        this.addSystemAction('connected!');
      },

      'disconnected': function() {
        this.addSystemAction('disconnected :(');
      },

      'reconnecting': function(delay) {
        this.addSystemAction('reconnecting in ' + Math.floor(delay / 1000) + ' seconds...');
      },

      'message:chat': function(message) {
        if (message.body.indexOf('/me ') === 0) {
          this.addUserAction(message.from, message.body.slice(4));
        } else {
          this.addUserMessage(message.from, message.body);
        }
      },

      'message:system_broadcast': function(message) {
        this.addSystemMessage(message.body);
      },

      'message:vote': function(message) {
        this.updateUserVote(message.from, message.vote);
      },

      'message:join': function(message) {
        this._ensureUser(message.user, { present: true });
      },

      'message:part': function(message) {
        this._ensureUser(message.user, { present: false });
      },

      'message:please_vote': function(message) {
        this.addSystemAction('polls are closing soon, please vote');
      },

      'message:merge': function(message) {
        this.room.set({ winning_vote: 'INCREASE' });
      },

      'message:users_abandoned': function(message) {
        if (!message.users || !message.users.length) { return; }
        var currentUserName = this.currentUser.get('name');

        if (message.users.indexOf(this.currentUser.get('name')) >= 0) {
          this.addSystemAction('abandoning...');
          $.refresh();
          return;
        }

        var abandoned = 0;
        message.users.forEach(function(userName) {
          this.roomParticipants.remove(userName);
          abandoned += 1;
        }, this);
        this.addSystemAction(abandoned + ' users abandoned');
      },

      'message:abandon': function(message) {
        this.room.set({ winning_vote: 'ABANDON' });
      },

      'message:continue': function(message) {
        this.room.set({ winning_vote: 'CONTINUE' });
        this.addSystemMessage('continue the discussion at /r/' + message.body);
      },

      'message:no_match': function(message) {
        this.addSystemAction('no compatible room found for matching, we will count votes and check again for a match in 1 minute.');
      },

      'message:updated_name': function(message) {
        this.room.set({
          room_name: message.room_name,
        })
      },
    },

    roomEvents: {
      'success:vote': function(room, data) {
        this.currentUser.set(data);
      },

      'request:message': function() {
        this.chatInput.clear();
      },

      'invalid:message error:message': function(room, errors) {
        try {
          this.addSystemMessage(errors[0].message);
        } catch (err) {
          this.addSystemMessage('could not send your message');
        }
        // drop their message into the chat so it's not lost
        this.addSystemMessage(this.lastMessageText);
        this.lastMessageText = null;
      },

      'success:message': function() {
        this.lastMessageText = null;
      },

      'change:room_name': function(model, value) {
        this.addSystemAction('found a match');
        this.$el.find('.robin-chat--room-name').text(value);
      },

      'change:winning_vote': function(room, vote) {
        if (room.isComplete()) {
          this.voteWidget.hide();
        }

        if (vote === 'ABANDON') {
          this.addSystemAction('room has been abandoned');
          this.transitionRefresh();
        } else if (vote === 'CONTINUE') {
          this.addSystemAction('room has been continued');
          this.quitWidget.show();
        } else if (vote === 'INCREASE') {
          this.addSystemAction('room has been increased');
          this.addSystemAction('merging with other room...');
          this.transitionRefresh();
        }
      },

      'success:leave_room': function() {
        $.refresh();
      },
    },

    roomParticipantsEvents: {
      add: function(user, userList) {
        this.userListWidget.addUser(user);
      },

      remove: function(user, userList) {
        this.userListWidget.removeUser(user);
      },
    },

    roomMessagesEvents: {
      add: function(message, messageList) {
        this.chatWindow.addMessage(message);
      },
    },

    chatInputEvents: {
      'chat': function(messageText) {
        this.chatWindow.scrollToRecent();
      },

      'chat:message': function(messageText) {
        if (this.lastMessageText) { return; }

        this.lastMessageText = messageText;
        this.room.postMessage(messageText);
      },

      'chat:command': function(command, args) {
        if (typeof this.chatCommands[command] !== 'function') {
          args = [command]
          command = 'unknown';
        } else {
          this.chatInput.clear();
        }

        this.chatCommands[command].apply(this, args);
      },
    },

    voteWidgetEvents: {
      'vote': function(vote) {
        if (this.room.isComplete()) {
          this.addSystemMessage('voting is complete');
        } else {
          this.room.postVote(vote.toUpperCase());
        }
      },
    },

    quitWidgetEvents: {
      'quit': function() {
        this.addSystemMessage('leaving room...');
        this.room.postLeaveRoom();
      },
    },

    chatCommands: {
      'unknown': function(command) {
        this.addSystemMessage('"/' + command + '" is not a command');
      },

      'help': function() {
        this.addSystemMessage('Welcome to Robin.');
        this.addSystemMessage('Be sure to use the buttons in the sidebar to vote on the future of the room before the polls are closed.');
        this.addSystemMessage('Non-votes and abstentions will be counted as votes to abandon.');
        this.addSystemMessage('We do hope you enjoy the discussion.');
      },

      'commands': function() {
        this.addSystemMessage('/vote abandon - vote to abandon');
        this.addSystemMessage('/vote stay - vote to stay');
        this.addSystemMessage('/vote grow - vote to grow');
        this.addSystemMessage('/whois <user_in_room> - provide information about <user_in_room>');
      },

      'vote': function(voteLabel) {
        if (this.room.isComplete()) {
          this.addSystemMessage('voting is complete');
          return;
        }

        var voteLabels = r.robin.VOTE_TYPES.map(function(vote) {
          return this.getLabelFromVote(vote);
        }, this);
        
        if (!voteLabel) {
          this.addSystemMessage('use: /vote [' + voteLabels.join(',') + ']');
          return;
        }

        var voteLabelUpper = voteLabel.toUpperCase();

        if (voteLabels.indexOf(voteLabelUpper) < 0) {
          // support passing in the actual vote values
          voteLabelUpper = this.getLabelFromVote(voteLabelUpper);
        }

        var vote = this.getVoteFromLabel(voteLabelUpper);

        if (r.robin.VOTE_TYPES.indexOf(vote) < 0) {
          this.addSystemMessage('that is not a valid vote type');
        } else if (vote === this.currentUser.get('vote')) {
          this.addSystemMessage('that is already your vote');
        } else {
          this.room.postVote(vote);
          this.voteWidget.setActiveVote(vote);
        }
      },

      'me': function(/* args */) {
        var messageText = [].slice.call(arguments).join(' ');

        if (messageText.length > 0) {
          this.room.postMessage('/me ' + messageText);
        } else {
          this.addSystemMessage('use: /me your message here');
        }
      },

      'whois': function(userName) {
        var user = this.roomParticipants.get(userName);

        if (!user) {
          this.addSystemMessage('There is no user by that name in the room');
        } else if (user === this.currentUser) {
          this.addSystemMessage('That is you');
        } else {
          var presence = user.get('present') ? 'present' : 'away';

          if (user.hasVoted()) {
            this.addSystemMessage('%(userName)s is %(presence)s and has voted to %(vote)s'.format({
              userName: userName,
              presence: presence,
              vote: user.get('vote'),
            }));
          } else {
            this.addSystemMessage('%(userName)s is %(presence)s and has not voted'.format({
              userName: userName,
              presence: presence,
            }));
          }
        }
      },

      'leave_room': function() {
        this.room.postLeaveRoom();
      },

      'remind': function(time /* ,args */) {
        time = parseInt(time, 10);
        var timerMessage = [].slice.call(arguments, 1).join(' ');

        if (_.isNaN(time) || timerMessage.length === 0) {
          this.addSystemMessage('use: /remind <seconds> <message>');
          return;
        }

        var userName = this.currentUser.get('name');
        var messageText = userName + ': ' + timerMessage;

        setTimeout(function() {
          this.addSystemMessage(messageText.slice(0, models.RobinMessage.MAX_LENGTH));
        }.bind(this), time * 1000);

        this.addSystemAction('set timer for ' + time + ' seconds from now');
      },

      'clear': function() {
        this.chatWindow.startJuicyPoppin();
      },

      'count': function() {
        this.addSystemMessage('There are ' + this.roomParticipants.length + ' participants in the room.');
      },

      'tally': function() {
        var votes = {
          ABANDON: 0,
          CONTINUE: 0,
          INCREASE: 0,
          NOVOTE: 0,
        };

        this.roomParticipants.forEach(function(user) {
          var vote = user.get('vote');
          votes[vote] += 1;
        });

        this.addSystemMessage('Total votes : %(total)s'.format({
          total: votes.ABANDON + votes.CONTINUE + votes.INCREASE,
        }));
        this.addSystemMessage('%(action)s : %(num)s'.format({
          num: votes.ABANDON,
          action: this.getLabelFromVote('ABANDON'),
        }));
        this.addSystemMessage('%(action)s : %(num)s'.format({
          num: votes.CONTINUE,
          action: this.getLabelFromVote('CONTINUE')
        }));
        this.addSystemMessage('%(action)s : %(num)s'.format({
          num: votes.INCREASE,
          action: this.getLabelFromVote('INCREASE')
        }));
      },
    },

    initialize: function(options) {
      this.websocketEvents = this._autobind(this.websocketEvents);
      this.chatCommands = this._autobind(this.chatCommands);

      // initialize some models for managing state
      this.room = new models.RobinRoom({
        room_id: this.options.room_id,
        room_name: this.options.room_name,
        winning_vote: this.options.is_continued ? 'CONTINUE' : undefined,
      });

      var currentUser;
      var participants = [];

      if (options.participants) {
        options.participants.forEach(function(user) {
          var isCurrentUser = (user.name === options.logged_in_username);
          var modelAttributes = _.clone(user);

          if (isCurrentUser) {
            modelAttributes.userClass = 'self';
            modelAttributes.present = true;
          }

          var userModel = new models.RobinUser(modelAttributes);
          
          if (isCurrentUser) {
            currentUser = userModel;
          }

          participants.push(userModel)
        });
      }

      if (!currentUser) {
        currentUser = new models.RobinUser({
          name: this.options.logged_in_username,
          userClass: 'self',
          present: true,
        });
      }

      this.currentUser = currentUser;
      this.roomParticipants = new models.RobinRoomParticipants(participants);
      this.roomMessages = new models.RobinRoomMessages();

      // initialize some child views 
      this.chatInput = new views.RobinChatInput({
        el: this.$el.find('#robinChatInput')[0],
        collection: this.roomParticipants,
      });

      this.chatWindow = new views.RobinChatWindow({
        el: this.$el.find('#robinChatWindow')[0],
      });
      
      this.voteWidget = new views.RobinVoteWidget({
        el: this.$el.find('#robinVoteWidget')[0],
        isHidden: this.room.isComplete(),
      });

      this.quitWidget = new views.RobinQuitWidget({
        el: this.$el.find('#robinQuitWidget')[0],
        isHidden: !this.room.isComplete(),
      });

      this.userListWidget = new views.RobinUserListWidget({
        el: this.$el.find('#robinUserList')[0],
        participants: participants,
        maxDisplayLength: this.MAX_USERS_TO_DISPLAY,
      });

      // set the button state in the voting widget
      if (this.currentUser.hasVoted()) {
        this.voteWidget.setActiveVote(this.currentUser.get('vote'));
      }

      // notifications
      if ('Notification' in window) {
        this.desktopNotifier = new r.robin.notifications.DesktopNotifier({
          model: this.roomMessages,
        });
        this.desktopNotifier.render();
        $('#robinDesktopNotifier')
          .removeAttr('hidden')
          .find('label')
          .prepend(this.desktopNotifier.$el);
      }

      // favicon
      this.faviconUpdater = new r.robin.favicon.UnreadUpdateCounter({
        model: this.roomMessages,
      });

      // vote label mapping
      this._voteToLabel = {};
      this._labelToVote = {};
      this.voteWidget.$el.find('.' + this.voteWidget.VOTE_BUTTON_CLASS).toArray().forEach(function(el) {
        var $el = $(el);
        var vote = $el.val().toUpperCase();
        var label = $el.find('.' + this.voteWidget.VOTE_LABEL_CLASS).text().toUpperCase();
        this._voteToLabel[vote] = label;
        this._labelToVote[label] = vote;
      }, this);

      // wire up events
      this._listenToEvents(this.room, this.roomEvents);
      this._listenToEvents(this.roomParticipants, this.roomParticipantsEvents);
      this._listenToEvents(this.roomMessages, this.roomMessagesEvents);
      this._listenToEvents(this.chatInput, this.chatInputEvents);
      this._listenToEvents(this.voteWidget, this.voteWidgetEvents);
      this._listenToEvents(this.quitWidget, this.quitWidgetEvents);

      // Welcome message
      this.addSystemMessage('Welcome to robin.  Please type /help or /commands for more information.');

      if (participants.length === 1) {
        this.addSystemMessage('Please wait to be matched.');
        this.listenToOnce(this.roomParticipants, 'add', function(user, userList) {
          this.addUserAction(user.get('name'), 'joined the room');
        });
      }

      // display the reap time
      if (!this.options.is_continued) {
        var timeUntilReap = this.options.reap_time - Date.now();
        var approxMinutes = Math.floor(timeUntilReap / (1000 * 60));

        if (approxMinutes > 1) {
          this.addSystemMessage('Voting will end in approximately ' + approxMinutes + ' minutes');
        } else {
          this.addSystemMessage('Voting will end soon');
        }
      }

      // initialize websockets. should be last!
      this.websocket = new r.WebSocket(options.websocket_url);
      this.websocket.on(this.websocketEvents);
      this.websocket.start();
    },

    transitionRefresh: function() {
      var timeoutMult = 1;
      if (this.roomParticipants.length > 1000) {
        timeoutMult = 3;
      } else if (this.roomParticipants.length > 100) {
        timeoutMult = 2;
      }
      var timeout = 1000 + (Math.floor(Math.random() * 4000) * timeoutMult);
      this.chatWindow.startJuicyPoppin();
      setTimeout(function() {
        $.refresh();
      }, timeout);
    },

    getLabelFromVote: function(vote) {
      return this._voteToLabel[vote];
    },

    getVoteFromLabel: function(label) {
      return this._labelToVote[label];
    },

    _listenToEvents: function(other, eventMap) {
      for (var key in eventMap) {
        this.listenTo(other, key, eventMap[key]);
      }
    },

    _autobind: function(hash) {
      var bound = {}
      for (var key in hash) {
        bound[key] = hash[key].bind(this);
      }
      return bound;
    },

    _ensureUser: function(userName, setAttrs) {
      var user = this.roomParticipants.get(userName);

      if (!user) {
        user = new models.RobinUser(_.defaults({
          name: userName,
        }, setAttrs));
        this.roomParticipants.add(user);
      } else if (setAttrs) {
        user.set(setAttrs);
      }

      return user;
    },

    addUserMessage: function(userName, messageText) {
      var user = this._ensureUser(userName, { present: true });
      
      var message = new models.RobinMessage({
        author: userName,
        message: messageText,
        userClass: user.get('userClass'),
        flairClass: user.flairClass,
      });

      this.roomMessages.add(message);
    },

    addUserAction: function(userName, actionText) {
      var user = this._ensureUser(userName, { present: true });

      var message = new models.RobinMessage({
        author: userName,
        message: actionText,
        messageClass: 'action',
        userClass: user.get('userClass'),
        flairClass: user.flairClass,
      });

      this.roomMessages.add(message);
    },

    addSystemMessage: function(messageText) {
      var message = new models.RobinMessage({
        author: this.SYSTEM_USER_NAME,
        message: messageText,
        userClass: 'system',
      });

      this.roomMessages.add(message);
    },

    addSystemAction: function (actionText) {
      var message = new models.RobinMessage({
        author: this.SYSTEM_USER_NAME,
        message: actionText,
        messageClass: 'action',
        userClass: 'system',
      });

      this.roomMessages.add(message);
    },

    updateUserVote: function(userName, vote) {
      var setAttrs = {
        vote: vote,
        present: true,
      };
      var user = this._ensureUser(userName, setAttrs);
      var voteLabel = this.getLabelFromVote(vote) || vote;

      this.addUserAction(userName, 'voted to ' + voteLabel);
    },
  });

  $(function() {
    new RobinChat({
      el: document.getElementById('robinChat'),
      is_continued: r.config.robin_room_is_continued,
      room_name: r.config.robin_room_name,
      room_id: r.config.robin_room_id,
      websocket_url: r.config.robin_websocket_url,
      participants: r.config.robin_user_list,
      reap_time: parseInt(r.config.robin_room_reap_time, 10),
      logged_in_username: r.config.logged,
    });
  });
}(r, jQuery, _);
