/*
 * Spreed WebRTC.
 * Copyright (C) 2013-2014 struktur AG
 *
 * This file is part of Spreed WebRTC.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */
define(['underscore', 'modernizr', 'avltree', 'text!partials/buddy.html', 'text!partials/buddyactions.html', 'text!partials/buddyactionsforaudiomixer.html', 'rAF'], function(_, Modernizr, AvlTree, templateBuddy, templateBuddyActions, templateBuddyActionsForAudioMixer) {

	var BuddyTree = function() {

		this.data = {};
		this.tree = new AvlTree(function(a, b) {
			return a.sort.localeCompare(b.sort);
		});

	};

	BuddyTree.prototype.create = function(id, scope) {

		var display = scope.display || {};
		var sort = display.displayName ? display.displayName : "session " + scope.buddyIndexSortable + " " + id;
		var data = {
			id: id,
			sort: sort + "z" + id
		}
		return data;

	};

	BuddyTree.prototype.add = function(id, scope) {

		var data = this.create(id, scope);
		this._add(id, data);
		return this.position(id);

	};

	BuddyTree.prototype._add = function(id, data) {

		if (this.tree.add(data)) {
			this.data[id] = data;
		}

	};


	BuddyTree.prototype.remove = function(id) {

		if (this.data.hasOwnProperty(id)) {
			this.tree.remove(this.data[id]);
			delete this.data[id];
		}

	};

	/**
	 * Returns undefined when no change required. Position result otherwise.
	 */
	BuddyTree.prototype.update = function(id, scope) {

		var current = this.data[id];
		if (!current) {
			return this.add(id, scope);
		}
		var data = this.create(id, scope);
		if (data.sort !== current.sort) {
			this.tree.remove(current);
			this._add(id, data);
			return this.position(id);
		}

		return undefined;

	};

	/**
	 * Returns null when end position. Id of element to insert before otherwise.
	 */
	BuddyTree.prototype.position = function(id) {

		var result = null;
		this.tree.inOrderTraverse(function(c) {
			if (c.id !== id) {
				result = c.id;
				return true;
			}
		}, this.data[id]);
		return result;

	};

	BuddyTree.prototype.traverse = function(cb) {

		return this.tree.inOrderTraverse(cb);

	};

	BuddyTree.prototype.clear = function() {

		this.tree.clear();
		this.data = {};

	};

	// buddyList
	return ["$window", "$compile", "playSound", "buddyData", "buddySession", "fastScroll", "mediaStream", function($window, $compile, playSound, buddyData, buddySession, fastScroll, mediaStream) {

		var requestAnimationFrame = $window.requestAnimationFrame;

		var buddyTemplate = $compile(templateBuddy);
		var buddyActions = $compile(templateBuddyActions);
		var buddyActionsForAudioMixer = $compile(templateBuddyActionsForAudioMixer);

		//console.log("$buddylist $get");
		var doc = $window.document;
		var buddyCount = 0;

		var Buddylist = function($element, $scope, opts) {

			this.$scope = $scope;
			this.$element = $element.find(".buddycontainer > div");
			this.options = angular.extend({}, opts);
			this.$element.empty();
			this.actionElements = {};
			this.tree = new BuddyTree();
			this.queue = [];
			this.lefts = {};
			this.playSoundLeft = false;
			this.playSoundJoined = false;
			fastScroll.apply($element, this.$element);
			$element.on("mouseenter mouseleave", ".buddy", _.bind(function(event) {
				// Hover handler for on Buddy actions.
				var buddyElement = $(event.currentTarget);
				this.hover(buddyElement, event.type === "mouseenter" ? true : false, buddyElement.scope().session.Id);
			}, this));
			$element.on("click", ".buddy", _.bind(function(event) {
				var buddyElement = $(event.currentTarget);
				buddyElement.scope().doDefault();
			}, this));
			$element.on("click", ".fa.contact", _.bind(function(event) {
				event.stopPropagation();
				var buddyElement = $(event.currentTarget);
				buddyElement.scope().doDefaultContact();
			}, this));
			$element.attr("data-xthreshold", "10");
			$element.on("swipeleft", ".buddy", _.bind(function(event) {
				event.preventDefault();
				var buddyElement = $(event.currentTarget);
				this.hover(buddyElement, !buddyElement.hasClass("hovered"), buddyElement.scope().session.Id);
			}, this));

			$window.setInterval(_.bind(this.soundLoop, this), 500);
			var update = _.bind(function refreshBuddies() {
				this.refreshBuddies();
				requestAnimationFrame(update);
			}, this);
			requestAnimationFrame(update);

		};

		Buddylist.prototype.addBuddyElementToScope = function(scope, before, container) {

			if (!container) {
				container = this.$element[0];
			}
			buddyTemplate(scope, function($clonedElement, $scope) {
				//console.log("create", $scope.displayName, before)
				if (before) {
					// Insert directly before another node.
					var beforeScope = buddyData.get(before);
					if (beforeScope && beforeScope.element) {
						container.insertBefore($clonedElement[0], beforeScope.element[0]);
					} else {
						// Append to end assuming before element was removed. Can this happen?
						container.appendChild($clonedElement[0]);
					}
				} else {
					// Append to end.
					container.appendChild($clonedElement[0]);
				}
				$scope.element = $clonedElement;
			});

		};

		Buddylist.prototype.onBuddyScopeCreated = function(scope, data) {

			scope.element = null;
			scope.display = {};
			scope.session = buddySession.create(data);

			scope.doDefault = function() {
				var id = scope.session.Id;
				if (scope.status.isMixer) {
					return scope.doAudioConference(id);
				}
				return scope.doCall(id);
			};
			scope.doDefaultContact = function() {
				var id = scope.session.Id;
				return scope.doContact(id);
			};
			scope.$on("$destroy", function() {
				scope.element = null;
				scope.killed = true;
			});

		};

		Buddylist.prototype.onBuddySessionUserid = function(scope, sourceSession) {

			var userid = sourceSession.Userid;
			/*
			if (userid === scope.userid) {
				// The source session has our own userid, ignore it.

			}*/
			var targetScope = buddyData.get(userid);
			if (!targetScope) {
				// No scope for this userid yet - set us.
				buddyData.set(userid, scope);
				return;
			}
			if (targetScope === scope) {
				// No action.
				return;
			}
			// Merge sessions.
			targetScope.session.merge(sourceSession);
			// Cleanup old from tree and DOM.
			var id = sourceSession.Id;
			this.tree.remove(id);
			if (scope.element) {
				this.lefts[id] = scope.element;
				scope.element = null;
			}
			scope.$destroy();
			buddyData.set(id, targetScope);
			delete this.actionElements[id];

		};

		Buddylist.prototype.soundLoop = function() {

			if (this.playSoundLeft) {
				playSound.play("left");
				this.playSoundLeft = false;
			}
			if (this.playSoundJoined) {
				playSound.play("joined");
				this.playSoundJoined = false;
			}

		};

		Buddylist.prototype.refreshBuddies = function() {

			//console.log("processing", this.queue.length);
			var processed = 0;
			var entry;
			var scope;
			var id;
			var before;
			var action;
			var not_exists;

			// Cleanup lefts.
			var lefts = this.lefts;
			if (!_.isEmpty(lefts)) {
				_.each(lefts, function(element, k) {
					if (element) {
						element.remove();
					}
				});
				this.lefts = {};
			}

			var refresh = false;
			var queue = this.queue;

			if (queue.length) {

				//var $element = this.$element;
				var container = this.$element[0];

				while (true) {

					entry = queue.shift();
					if (!entry) {
						// Queue empty.
						break;
					}

					id = entry[1];
					scope = null;

					if (id) {
						scope = buddyData.lookup(id, false);
						if (!scope || scope.killed) {
							continue;
						}
					}

					action = entry[0];
					before = entry[2];

					not_exists = scope.element ? false : true;

					if (not_exists) {
						this.addBuddyElementToScope(scope, before, container);
					} else {
						if (typeof(before) === "undefined") {
							// No action when undefined.
						} else if (before) {
							// Move directly before another node.
							var beforeScope = buddyData.get(before);
							if (beforeScope && beforeScope.element) {
								container.insertBefore(scope.element[0], beforeScope.element[0]);
							} else {
								// Move to end, assuming before element was removed.
								container.appendChild(scope.element[0]);
							}
						} else {
							// Move to end.
							container.appendChild(scope.element[0]);
						}
					}

					processed++;
					refresh = true;
					if (processed > 10) {
						break;
					}

				}

			}

			scope = this.$scope;
			var apply = refresh;
			var loading = scope.loading;
			if (refresh) {
				if (!loading) {
					scope.loading = true;
				}
			} else {
				if (scope.loading) {
					scope.loading = false;
					apply = true;
				}
			}
			var empty = buddyCount === 0;
			if (empty != scope.empty) {
				scope.empty = empty;
				apply = true;
			}
			if (apply) {
				scope.$apply();
			}

		};

		Buddylist.prototype.updateBuddyPicture = function(status) {

			url = status.buddyPicture;
			if (!url) {
				return;
			}

			if (url.indexOf("img:") === 0) {
				status.buddyPicture = status.buddyPictureLocalUrl = mediaStream.url.buddy(url.substr(4));
			}

		};

		Buddylist.prototype.setDisplay = function(id, scope, data, queueName) {

			var status = data.Status;
			var display = scope.display;
			// Set display.name.
			display.displayName = status.displayName;
			// Set display.picture.
			display.buddyPicture = status.buddyPicture;
			this.updateBuddyPicture(display);
			// Set display subline.
			display.subLine = data.Ua;
			// Add to render queue when no element exists.
			if (!scope.element) {
				var before = this.tree.add(id, scope);
				this.queue.push([queueName, id, before]);
				this.playSoundJoined = true;
			}

		};

		Buddylist.prototype.updateDisplay = function(id, scope, data, queueName) {

			var status = data.Status;
			var display = scope.display;
			// Update display name.
			var displayName = display.displayName;
			if (status.displayName) {
				display.displayName = status.displayName;
			} else {
				display.displayName = null;
			}
			// Add to status queue if sorting has changed.
			if (displayName !== status.displayName) {
				var before = this.tree.update(id, scope);
				this.queue.push([queueName, id, before]);
			}
			// Update display subline.
			if (data.Ua) {
				display.subLine = data.Ua;
			}
			// Update display picture.
			display.buddyPicture = status.buddyPicture || null;
			this.updateBuddyPicture(display);

		};

		Buddylist.prototype.onStatus = function(data) {

			//console.log("onStatus", data);
			var id = data.Id;
			var scope = buddyData.get(id, this.$scope, _.bind(function(scope) {
				this.onBuddyScopeCreated(scope, data);
			}, this), data.Userid);
			// Update session.
			var sessionData = scope.session.update(id, data, _.bind(function(session) {
				//console.log("Session is now authenticated", session);
				this.onBuddySessionUserid(scope, session);
			}, this));
			if (sessionData) {
				// onStatus for main session.
				this.updateDisplay(id, scope, sessionData, "status");
			}
			scope.$apply();

		};

		Buddylist.prototype.onJoined = function(data) {

			//console.log("Joined", data);
			var id = data.Id;
			var scope = buddyData.get(id, this.$scope, _.bind(function(scope) {
				this.onBuddyScopeCreated(scope, data);
			}, this), data.Userid);
			// Update session.
			buddyCount++;
			var sessionData = scope.session.update(id, data);
			if (sessionData && sessionData.Status) {
				this.setDisplay(id, scope, sessionData, "joined");
			} else {
				scope.$apply();
			}

		};

		Buddylist.prototype.onContactAdded = function(contact) {

			console.log("onContactAdded", contact);
			var userid = contact.Userid;
			// TODO(longsleep): Traversing the whole tree is stupid. Implement key/value map for this.
			this.tree.traverse(function(record) {
				var scope = buddyData.lookup(record.id, true);
				var sessionUserid = scope.session.Userid;
				if (sessionUserid === userid) {
					scope.contact = contact;
				}
			});

		};

		Buddylist.prototype.onContactRemoved = function(data) {

			console.log("onContactRemoved", data);

		};

		Buddylist.prototype.onLeft = function(data) {

			//console.log("Left", data);
			var id = data.Id;
			var scope = buddyData.get(id);
			if (!scope) {
				//console.warn("Trying to remove buddy with no registered scope", session);
				return;
			}
			if (buddyCount > 0) {
				buddyCount--;
			}
			var session = scope.session;
			if (session.remove(id)) {
				// No session left. Cleanup.
				this.tree.remove(id);
				if (scope.element) {
					this.lefts[id] = scope.element;
					this.playSoundLeft = true;
				}
				buddyData.del(id);
				if (session.Userid) {
					buddyData.del(session.Userid);
				}
				delete this.actionElements[id];
			} else {
				// Update display stuff if session left.
				var sessionData = session.get();
				this.setDisplay(id, scope, sessionData, "status");
				scope.$apply();
			}

		};

		Buddylist.prototype.onClosed = function() {

			//console.log("Closed");
			this.$element.empty();
			buddyCount = 0;
			buddyData.clear();
			this.tree.clear();
			this.actionElements = {};
			this.queue = [];

		};

		Buddylist.prototype.hover = function(buddyElement, hover, id) {

			//console.log("hover handler", event, hover, id);
			var buddy = $(buddyElement);
			var actionElements = this.actionElements;
			var elem;
			if (!hover) {
				buddy.removeClass("hovered");
				setTimeout(_.bind(function() {
					if (!buddy.hasClass("hovered")) {
						elem = actionElements[id];
						if (elem) {
							delete actionElements[id];
							elem.remove();
							//console.log("cleaned up actions", id);
						}
					}
				}, this), 1000);
			} else {
				elem = actionElements[id];
				if (elem) {
					buddy.addClass("hovered");
				} else {
					var scope = buddyData.get(id);
					var template = buddyActions;
					if (scope.status.autoCalls && _.indexOf(scope.status.autoCalls, "conference") !== -1) {
						template = buddyActionsForAudioMixer;
					}
					//console.log("scope", scope, id);
					template(scope, _.bind(function(clonedElement, $scope) {
						actionElements[id] = clonedElement;
						buddy.append(clonedElement);
						_.defer(function() {
							buddy.addClass("hovered");
						});
					}, this));
					scope.$apply();
				}
			}

		};

		return {
			buddylist: function($element, $scope, opts) {
				return new Buddylist($element, $scope, opts);
			}
		}

	}];

});
