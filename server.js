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

const DRAWING_TIME = 10;
const TITLE_TIME = 15;
var timerTime = 0;
var timer;

const port = process.env.PORT || 5000;

app.set('port', port);
app.use('/static', express.static(__dirname + '/static'));
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
		io.emit("gameState", "DrawingState");
		Object.keys(players).forEach(function (key) {
			players[key].hasBeenJudged = false;
			players[key].isDrawing = true;
			var prompts = promptFile.prompts;
			var randomIndex = Math.ceil(Math.random() * prompts.length);
			players[key].prompt = prompts[randomIndex];
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
	}
}

class ReceivePromptDrawingsState extends GameState {
	onImageReceive(socket, image) {
		var player = players[socket.id];
		player.isDrawing = false;
		player.promptDrawing = image;

		if (!Object.values(players).some(function (player) {
			return player.isDrawing;
		})) {
			ReceiveTitleSuggestionState.startTitleSuggestionPhase();
		}
		io.emit("playerList", JSON.stringify(players));
	}
}

class ReceiveTitleSuggestionState extends GameState {
	onTextReceive(socket, text) {
		player.isSuggestingTitle = false;
		player.titleSuggestion = text;

		if (!Object.values(players).some(function (player) {
			return player.isSuggestingTitle;
		})) {
			io.emit("gameState", "SuggestionState");
		}
		io.emit("playerList", JSON.stringify(players));
	}
	static startTitleSuggestionPhase() {
		clearInterval(timer);

		var currentPlayerKey = Object.keys(players).find(function (player) {
			return !player.hasBeenJudged;
		});
		if (currentPlayerKey == undefined) {
			//End the game TODO
			return;
		}
		var currentPlayer = players[currentPlayerKey];

		gameState = new ReceiveTitleSuggestionState();
		io.emit("gameState", "SuggestionState");
		Object.keys(players).forEach(function (key) {
			players[key].isSuggestingTitle = true;
		});
		currentPlayer.isSuggestingTitle = false;
		io.emit("playerList", JSON.stringify(players));
		timerTime = TITLE_TIME;
		io.emit("timer", timerTime);
		timer = setInterval(function() {
			if (timerTime > 0) {
				timerTime--;
				io.emit("timer", timerTime);
			} else {
				//Start title selection phase TODO
				clearInterval(timer);
			}
		}, 1000);
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
				gameState = new LobbyState();
				io.emit("switchScreen", "MainScreen");
				clearInterval(timer);
				delete players[socket.id];
				socket.broadcast.emit("playerList", JSON.stringify(players));
			} else if (!(gameState instanceof LobbyState || gameState instanceof ReceivePromptDrawingsState)) {
				var currentPlayerKey = Object.keys(players).find(function (player) {
					return !player.hasBeenJudged;
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
