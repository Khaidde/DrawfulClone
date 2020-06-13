var express = require('express');
var http = require('http');
var path = require('path');
var socketIO = require('socket.io');
var fs = require("fs");

var app = express();
var server = http.Server(app);
var io = socketIO(server);

const FPS = 60;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 3;

const DRAWING_TIME = 100;
const TITLE_TIME = 80;
const CHOOSE_TITLE_TIME = 20;
const SCOREBOARD_DISPLAY_TIME = 5;

const GUESSED_CORRECTLY_SCORE = 1000;
const TRICKED_OTHER_PLAYER_SCORE = 500;

var timerTime = 0;
var timer;
var showcasingPlayer;

const port = process.env.PORT || 5000;

app.set('port', port);
app.use('/static', express.static(__dirname + '/static'));
app.use('/images', express.static(__dirname + '/images'));
app.get('/', function(request, response) {
  response.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(port, function() {
  console.log('Starting server on port ' + port);
});

var promptFile = JSON.parse(fs.readFileSync("data/prompts.json"));

class GameState {
	onTextReceive(socket, text) {}
	onImageReceive(socket, image) {}
	onButtonClickReceive(socket) {}
}

class LobbyState extends GameState {
	onTextReceive(socket, name) {
		if (totalPlayers >= MAX_PLAYERS) {
			socket.emit("connectionError", "Server is full...");
			return;
		}
		players[socket.id] = {
			username: name,
			score: 0,
			isReady: false
		}
	}
	onImageReceive(socket, image) {
		if (totalPlayers >= MAX_PLAYERS) {
			socket.emit("connectionError", "Server is full...");
			return;
		}
		var player = players[socket.id];
		player.profilePic = image;

		totalPlayers++;

		io.emit("playerList", JSON.stringify(players));
		socket.emit("switchScreen", "MainScreen");
		socket.emit("socketID", socket.id);
	}
	onButtonClickReceive(socket) {
		players[socket.id].isReady = !players[socket.id].isReady;
		if (!Object.values(players).some(function (player) {
			return !player.isReady;
		}) && totalPlayers >= MIN_PLAYERS) {
			LobbyState.startRound();
		} else {
			io.emit("playerList", JSON.stringify(players));
		}
	}
	static startRound() {
		gameState = new ReceivePromptDrawingsState();
		var usedPrompts = [];
		Object.keys(players).forEach(function (key) {
			players[key].hasBeenJudged = false;
			players[key].isDrawing = true;
			var prompts = promptFile.prompts;
			var prompt;
			var matchingPrompt = true;
			while (matchingPrompt) {
				var randomIndex = Math.ceil(Math.random() * prompts.length);
				prompt = prompts[randomIndex];
				matchingPrompt = Object.values(usedPrompts).some(function(usedPrompt) {
					return prompt == usedPrompt;
				});
			}
			players[key].prompt = prompt;
			usedPrompts.push(players[key].prompt);
		});
		io.emit("playerList", JSON.stringify(players));
		timerTime = DRAWING_TIME;
		io.emit("timer", timerTime);
		timer = setInterval(function() {
			if (timerTime > 0) {
				timerTime--;
				io.emit("timer", timerTime);
			} else {
			 	ReceiveTitleSuggestionState.startTitleSuggestionPhase();
			}
		}, 1000);
		io.emit("gameState", "DrawingState");
	}
}

class ReceivePromptDrawingsState extends GameState {
	onImageReceive(socket, image) {
		var player = players[socket.id];
		player.isDrawing = false;
		player.promptDrawing = image;
		io.emit("playerList", JSON.stringify(players));

		if (!Object.values(players).some(function (player) {
			return player.isDrawing;
		})) {
			ReceiveTitleSuggestionState.startTitleSuggestionPhase();
		}
	}
}

class ReceiveTitleSuggestionState extends GameState {
	onTextReceive(socket, text) {
		var player = players[socket.id];

		var showcasingPlayerKey = Object.keys(players).find(function (key) {
			return !players[key].hasBeenJudged;
		});
		var duplicateTitleSuggestion = Object.keys(players).find(function (player) {
			if (players[player].titleSuggestion != undefined && players[player].titleSuggestion == text) {
				return true;
			}
			return players[showcasingPlayerKey].prompt == text;
		});
		if (duplicateTitleSuggestion != undefined) {
			socket.emit("duplicateTitle");
			return;
		}

		player.isSuggestingTitle = false;
		player.titleSuggestion = text;
		io.emit("playerList", JSON.stringify(players));

		if (!Object.values(players).some(function (player) {
			return player.isSuggestingTitle;
		})) {
			ChooseTitleState.startChooseTitlePhase();
		}
	}
	static startTitleSuggestionPhase() {
		clearInterval(timer);

		var showcasingPlayerKey = Object.keys(players).find(function (key) {
			return !players[key].hasBeenJudged;
		});
		if (showcasingPlayerKey == undefined) {
			Object.keys(players).forEach(function (key) {
				players[key].isReady = false;
				players[key].score = 0;
			});
			gameState = new LobbyState();
			io.emit("switchScreen", "MainScreen");
			io.emit("playerList", JSON.stringify(players));
			return;
		}
		showcasingPlayer = players[showcasingPlayerKey];

		gameState = new ReceiveTitleSuggestionState();
		Object.keys(players).forEach(function (key) {
			players[key].isSuggestingTitle = true;
			players[key].titleSuggestion = undefined;
			players[key].titleSelection = undefined;
		});
		showcasingPlayer.isSuggestingTitle = false;
		io.emit("playerList", JSON.stringify(players));
		timerTime = TITLE_TIME;
		io.emit("timer", timerTime);
		timer = setInterval(function() {
			if (timerTime > 0) {
				timerTime--;
				io.emit("timer", timerTime);
			} else {
				ChooseTitleState.startChooseTitlePhase();
			}
		}, 1000);
		io.emit("gameState", "SuggestionState");
	}
}

class ChooseTitleState extends GameState {
	onTextReceive(socket, text) {
		var player = players[socket.id];
		player.isChoosingTitle = false;
		player.titleSelection = text;

		Object.values(players).forEach(function(playerT) {
			if (playerT.username == showcasingPlayer.username) {
				if (showcasingPlayer.prompt == player.titleSelection) {
					showcasingPlayer.score += GUESSED_CORRECTLY_SCORE;
					player.score += GUESSED_CORRECTLY_SCORE;

					if (showcasingPlayer.resultMapping == undefined) {
						showcasingPlayer.resultMapping = [];
					}
					showcasingPlayer.resultMapping.push(player.username);
				}
			} else {
				if (playerT.titleSuggestion == player.titleSelection) {
					playerT.score += TRICKED_OTHER_PLAYER_SCORE;

					if (playerT.resultMapping == undefined) {
						playerT.resultMapping = [];
					}
					playerT.resultMapping.push(player.username);
				}
			}
		});
		io.emit("playerList", JSON.stringify(players));

		if (!Object.values(players).some(function (player) {
			return player.isChoosingTitle;
		})) {
			ResultDisplayState.startResultDisplayPhase();
		}
	}
	static startChooseTitlePhase() {
		clearInterval(timer);

		gameState = new ChooseTitleState();
		Object.keys(players).forEach(function (key) {
			players[key].isChoosingTitle = true;
		});
		showcasingPlayer.isChoosingTitle = false;
		io.emit("playerList", JSON.stringify(players));
		timerTime = CHOOSE_TITLE_TIME;
		io.emit("timer", timerTime);
		timer = setInterval(function() {
			if (timerTime > 0) {
				timerTime--;
				io.emit("timer", timerTime);
			} else {
				ResultDisplayState.startResultDisplayPhase();
			}
		}, 1000);
		io.emit("gameState", "ChooseTitleState");
	}
	hashUsername(name) {
		var hash = 67;
		for (var i = 0; i < name.length; i ++) {
			hash = (hash * name[i].charCodeAt(0)) % 255;
		}
		return hash;
	}
}

var resultDisplayingPlayer;
class ResultDisplayState extends GameState {
	static startResultDisplayPhase() {
		clearInterval(timer);

		gameState = new ResultDisplayState();
		Object.keys(players).forEach(function (key) {
			if (players[key].resultMapping == undefined) {
				players[key].isDisplayingResults = false;
			} else {
				if (players[key].username == showcasingPlayer.username) {
					players[key].isDisplayingResults = false;
				} else {
					players[key].isDisplayingResults = true;
				}
			}
		});
		io.emit("playerList", JSON.stringify(players));

		resultDisplayingPlayer = Object.values(players).find((player) => {return player.isDisplayingResults;});
		if (resultDisplayingPlayer == undefined) {
			resultDisplayingPlayer = showcasingPlayer;
		}
		timerTime = resultDisplayingPlayer.resultMapping.length + 2;
		io.emit("timer", timerTime);
		timer = setInterval(function() {
			ResultDisplayState.evaluateResults();
		}, 1000);

		io.emit("gameState", "ResultState");
	}
	static evaluateResults() {
		if (timerTime > 0) {
			timerTime--;
		} else {
			if (resultDisplayingPlayer != undefined && resultDisplayingPlayer.username == showcasingPlayer.username) {
				Object.values(players).forEach(function (player) {
					player.resultMapping = undefined;
				});
				var showcasingPlayerKey = Object.keys(players).find(function (key) {
					return !players[key].hasBeenJudged;
				});
				players[showcasingPlayerKey].hasBeenJudged = true;
				io.emit("playerList", JSON.stringify(players));
				ScoreboardState.startScoreboardPhase();
			} else {
				resultDisplayingPlayer.isDisplayingResults = false;
				io.emit("playerList", JSON.stringify(players));
				resultDisplayingPlayer = Object.values(players).find((player) => {return player.isDisplayingResults;});
				if(resultDisplayingPlayer == undefined) {
					resultDisplayingPlayer = showcasingPlayer;
					if (showcasingPlayer.resultMapping == undefined) {
						timerTime = 2;
						io.emit("timer", timerTime);
						return;
					}
				}
				timerTime = resultDisplayingPlayer.resultMapping.length + 2;
			}
		}
		io.emit("timer", timerTime);
	}
}

class ScoreboardState extends GameState {
	static startScoreboardPhase() {
		clearInterval(timer);

		gameState = new ScoreboardState();
		timerTime = SCOREBOARD_DISPLAY_TIME;
		io.emit("timer", timerTime);
		timer = setInterval(function() {
			if (timerTime > 0) {
				timerTime--;
				io.emit("timer", timerTime);
			} else {
				ReceiveTitleSuggestionState.startTitleSuggestionPhase();
			}
		}, 1000);
		io.emit("gameState", "ScoreboardState");
	}
}

var players = {};
var totalPlayers = 0;
var gameState = new LobbyState();

//socket event handling
io.on('connection', function(socket) {
	if (totalPlayers >= MAX_PLAYERS) {
		socket.emit("connectionError", "Server is full...");
	}
	if (!(gameState instanceof LobbyState)) {
		socket.emit("connectionError", "Game already started...");
	}
	socket.on("textInput", function(text) {
		gameState.onTextReceive(socket, text);
	});

	socket.on("imageInput", function(image) {
		gameState.onImageReceive(socket, image);
	});

	socket.on("buttonInput", function() {
		gameState.onButtonClickReceive(socket);
	});

	socket.on('disconnect', function() {
		if (players[socket.id] != undefined) {
			totalPlayers--;
			if (totalPlayers < MIN_PLAYERS) {
				Object.keys(players).forEach(function (key) {
					players[key].isReady = false;
				});
				if (!(gameState instanceof LobbyState)) {
					gameState = new LobbyState();
					io.emit("switchScreen", "MainScreen");
				}
				clearInterval(timer);
				delete players[socket.id];
				socket.broadcast.emit("playerList", JSON.stringify(players));
			} else if (!(gameState instanceof LobbyState) && !(gameState instanceof ReceivePromptDrawingsState)) {
				var currentPlayerKey = Object.keys(players).find(function (key) {
					return !players[key].hasBeenJudged;
				});
				delete players[socket.id];
				socket.broadcast.emit("playerList", JSON.stringify(players));
				if (currentPlayerKey == socket.id) {
					ReceiveTitleSuggestionState.startTitleSuggestionPhase();
				}
			} else {
				delete players[socket.id];
				socket.broadcast.emit("playerList", JSON.stringify(players));
			}
		}
  	});
});

/*
const readline = require("readline");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
rl.on("close", function() {
    console.log("\nBYE BYE !!!");
    process.exit(0);
});
var stdin = process.openStdin();
var lastPrompt = "";
stdin.addListener("data", function(d) {
	 if (lastPrompt != "") {
		 var character = d.toString().trim();
		 if (character == "y") {
			 promptFile.prompts.push(lastPrompt);
			 promptFile.prompts.sort(function(a, b) {
				 if(a < b) { return -1; }
				 if(a > b) { return 1; }
				 console.log("THIS PHRASE ALREADY EXISTS")
				 return 0;
			 })
			 fs.writeFile("data/prompts.json", JSON.stringify(promptFile, null, 3), function(err){});
			 console.log(lastPrompt + " has been added!");
		 }
	 }
	 lastPrompt = generateTestPrompt();
	 console.log(lastPrompt);
 });

var promptFile = JSON.parse(fs.readFileSync("data/prompts.json"));
var nouns = JSON.parse(fs.readFileSync("data/nouns.json")).nouns;
var adjectives = JSON.parse(fs.readFileSync("data/adjs.json")).adjs;
promptFile.prompts.sort(function(a, b) {
   if(a < b) { return -1; }
   if(a > b) { return 1; }
   console.log("THIS PHRASE ALREADY EXISTS: " + a);
   return 0;
})
fs.writeFile("data/prompts.json", JSON.stringify(promptFile, null, 3), function(err){});

function generateTestPrompt() {
	var nounI = Math.floor(Math.random() * nouns.length);
	var adjI = Math.floor(Math.random() * adjectives.length);
	return adjectives[adjI] + " " + nouns[nounI];
}*/
