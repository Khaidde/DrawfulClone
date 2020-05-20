const FPS = 30;
const BACKGROUND_COLOR = "#4b99b8";
const DEFAULT_FONT = "Tahoma";

const PRIMARY_COLORS = [
	"#ff6933",
	"#ffb400",
	"#32b4ff",
	"#0ac832",
	"#ff80ff",
	"#c73b32",
	"#995f3d",
	"#6a45ff"
];

const SECONDARY_COLORS = [
	"#b34a24",
	"#b37d00",
	"#2583b3",
	"#067a1b",
	"#b35bb3",
	"#7a2420",
	"#4d2f1f",
	"#4a30b3"
];

var canvas;
var canvasW;
var canvasH;
var ctx;

var isMouseDown = false;
var mouseX = -1;
var mouseY = -1;

var connectionError = "";
var socketID;
var colorPalleteIndex = Math.floor(Math.random() * 8); //TODO fix this

var currentScreen;

var timerTime;

var players = [];

//socket event handling (from server)
var socket = io();
socket.on("connectionError", function(error) {
	connectionError = error;
});
socket.on("socketID", function(socket) {
	socketID = socket;
});
socket.on("switchScreen", function(screen) {
	switch(screen) {
		case "TitleScreen":
			currentScreen = new TitleScreen();
			break;
		case "ProfileInfoScreen":
			currentScreen = new ProfileInfoScreen();
			break;
		case "MainScreen":
			currentScreen = new MainScreen();
			break;
	}
});
socket.on("playerList", function(playerList) {
	players = JSON.parse(playerList);
	var img;
	Object.keys(players).forEach(function (key) {
		var player = players[key];
		img = new Image();
		img.src = player.profilePic;
		players[key].profilePic = img;

		if (player.promptDrawing != undefined) {
			img = new Image();
			img.src = player.promptDrawing;
			players[key].promptDrawing = img;
		}
	});
});
socket.on("gameState", function(gameState) {
	currentScreen.setState(gameState);
});
socket.on("timer", function(time) {
	timerTime = time;
});

class Button {
	constructor(text, fontSize, textColor, width, height, buttonColor) {
		this.text = text;
		this.fontSize = fontSize;
		this.textColor = textColor;
		this.width = width;
		this.height = height;
		this.buttonColor = buttonColor;

		this.hovering = false;
		this.onButtonClick = function(screen) {}
	}
	onMouseDown(mouseX, mouseY) {
		if (this.hovering) {
			if (this.screen == undefined) {
				this.onButtonClick();
			} else {
				this.onButtonClick(this.screen);
			}
		}
	}
	onMouseMove(mouseX, mouseY) {
		if (this.x <= mouseX && mouseX < this.x + this.width && this.y <= mouseY && mouseY < this.y + this.height) {
			this.hovering = true;
		} else {
			this.hovering = false;
		}
	}
	static get OUTLINE_WIDTH() {return 3;}
	render(x, y) {
		this.x = x;
		this.y = y;

		if (this.hovering) {
			ctx.fillStyle = this.textColor;
			ctx.fillRect(this.x - Button.OUTLINE_WIDTH, this.y - Button.OUTLINE_WIDTH, this.width + Button.OUTLINE_WIDTH * 2, this.height + Button.OUTLINE_WIDTH * 2);
		}
		ctx.fillStyle = this.buttonColor;
		ctx.fillRect(this.x, this.y, this.width, this.height);

		ctx.font = this.fontSize + "px " + DEFAULT_FONT;
		ctx.fillStyle = this.textColor;
		ctx.fillText(this.text, this.x + this.width / 2 - ctx.measureText(this.text).width / 2, this.y + this.height / 2 + this.fontSize / 3);
	}
	sendButtonClickToServer(serverSendTag = "buttonInput") {
		socket.emit(serverSendTag);
	}
}

class DrawingCanvas {
	constructor(size, primaryColor, secondaryColor, eraserColor) {
		this.size = size;

		this.clickX = new Array();
		this.clickY = new Array();
		this.clickDrag = new Array();
		this.clickColor = new Array();
		this.isPainting = false;

		this.isActive = true;
		this.colorTools = [primaryColor, secondaryColor, eraserColor];
		this.penWidth = 10;

		this.currentToolIndex = 0;
		this.currentColor = this.colorTools[this.currentToolIndex];
	}
	onToolbarClick(mouseX, mouseY) {
		if (!this.isActive) return;
		if (mouseX < this.x + this.penWidth / 2 || mouseX >= this.x + this.size - this.penWidth / 2
			|| mouseY < this.y + this.size || mouseY >= this.y + this.size + DrawingCanvas.TOOL_BAR_HEIGHT) {
			return;
		}
		var index = Math.floor((mouseX - this.x) / DrawingCanvas.TOOL_BAR_HEIGHT);
		if (index >= 0 && index < this.colorTools.length) {
			this.currentToolIndex = index;
			this.currentColor = this.colorTools[index];
		} else {
			var submitX = this.x + this.size - DrawingCanvas.SUBMIT_BUTTON_WIDTH - (DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_ICON_SIZE) / 2;
			var submitY = this.y + this.size + (DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_ICON_SIZE) / 2;

			if (mouseX >= submitX && mouseX < submitX + DrawingCanvas.SUBMIT_BUTTON_WIDTH) {
				if (mouseY >= submitY && mouseY < submitY + DrawingCanvas.TOOL_ICON_SIZE) {
					this.sendImageToServer();
					this.isActive = false;
				}
			}
		}
	}
	addCanvasDrawClick(mouseX, mouseY, isDragging) {
		if (!this.isActive) return;
		if (mouseX < this.x + this.penWidth / 2 || mouseX >= this.x + this.size - this.penWidth / 2
			|| mouseY < this.y + this.penWidth / 2 || mouseY >= this.y + this.size - this.penWidth / 2) {
			this.isPainting = false;
			return;
		}
		if (this.isPainting || !isDragging) {
			this.clickX.push(mouseX - this.x);
			this.clickY.push(mouseY - this.y);
			this.clickDrag.push(isDragging);
			this.clickColor.push(this.currentColor);
		}
		if (!this.isPainting && !isDragging) {
			this.isPainting = true;
		}
	}
	static get CANVAS_COLOR() {return "#FFFFFF";}
	render(x, y) {
		this.x = x;
		this.y = y;
		if (!this.isActive) return;
		ctx.fillStyle = DrawingCanvas.CANVAS_COLOR;
		ctx.fillRect(this.x, this.y, this.size, this.size);
		this.renderCanvasDrawing();
		this.renderToolBar();
	}
	renderCanvasDrawing() {
		ctx.lineJoin = "round";
		ctx.lineWidth = this.penWidth;

		for (var i = 0; i < this.clickX.length; i++) {
			ctx.beginPath();
			if (this.clickDrag[i]) {
				ctx.moveTo(this.clickX[i - 1] + this.x, this.clickY[i - 1] + this.y);
			} else {
				ctx.moveTo(this.clickX[i] + this.x, this.clickY[i] + this.y);
			}
			ctx.lineTo(this.clickX[i] + this.x, this.clickY[i] + this.y);
			ctx.closePath();
			ctx.strokeStyle = this.clickColor[i];
			ctx.stroke();
		}
	}
	static get TOOL_BAR_COLOR() {return "#AAAAAA";}
	static get TOOL_BAR_HEIGHT() {return 50;};
	static get TOOL_ICON_SIZE() {return 30;};
	static get TOOL_OUTLINE_WIDTH() {return 3;};
	renderToolBar() {
		ctx.fillStyle = DrawingCanvas.TOOL_BAR_COLOR;
		ctx.fillRect(this.x, this.y + this.size, this.size, DrawingCanvas.TOOL_BAR_HEIGHT);
		this.renderTools();
	}
	renderTools() {
		for (var i = 0; i < this.colorTools.length; i++) {
			if (i == this.currentToolIndex) {
				ctx.fillStyle = "#000000";
				ctx.fillRect(this.x + (DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_ICON_SIZE) / 2 + i * DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_OUTLINE_WIDTH,
					this.y + this.size + (DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_ICON_SIZE) / 2 - DrawingCanvas.TOOL_OUTLINE_WIDTH,
					DrawingCanvas.TOOL_ICON_SIZE + DrawingCanvas.TOOL_OUTLINE_WIDTH * 2, DrawingCanvas.TOOL_ICON_SIZE + DrawingCanvas.TOOL_OUTLINE_WIDTH * 2);
			}
			ctx.fillStyle = this.colorTools[i];
			ctx.fillRect(this.x + (DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_ICON_SIZE) / 2 + i * DrawingCanvas.TOOL_BAR_HEIGHT,
				this.y + this.size + (DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_ICON_SIZE) / 2,
				DrawingCanvas.TOOL_ICON_SIZE, DrawingCanvas.TOOL_ICON_SIZE);
		}

		ctx.beginPath();
		var sx = this.x + (DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_ICON_SIZE) / 2 + 2 * DrawingCanvas.TOOL_BAR_HEIGHT;
		var sy = this.y + this.size + (DrawingCanvas.TOOL_BAR_HEIGHT - DrawingCanvas.TOOL_ICON_SIZE) / 2;
		ctx.moveTo(sx, sy);
		ctx.lineTo(sx + DrawingCanvas.TOOL_ICON_SIZE, sy + DrawingCanvas.TOOL_ICON_SIZE);
		ctx.closePath();
		ctx.lineWidth = DrawingCanvas.TOOL_OUTLINE_WIDTH;
		ctx.strokeStyle = "#FF0000";
		ctx.stroke();
	}
	static get WHITE_DIFF_THRESHOLD() {return 75;};
	createImageFromCanvas() {
		var canvasBuffer = document.createElement("canvas");
		var ctxBuffer = canvasBuffer.getContext("2d");

		canvasBuffer.width = this.size;
		canvasBuffer.height = this.size;

		ctxBuffer.drawImage(canvas, this.x, this.y, this.size, this.size, 0, 0, this.size, this.size);

		var imageData = ctxBuffer.getImageData(0, 0, this.size, this.size);
		var pixel = imageData.data;
		for (var i = 0; i < pixel.length; i += 4) {
			var rgDiff = Math.abs(pixel[i] - pixel[i+1]);
			var rbDiff = Math.abs(pixel[i] - pixel[i+2]);
			var bgDiff = Math.abs(pixel[i+1] - pixel[i+2]);
			if (rgDiff < DrawingCanvas.WHITE_DIFF_THRESHOLD && rbDiff < DrawingCanvas.WHITE_DIFF_THRESHOLD && bgDiff < DrawingCanvas.WHITE_DIFF_THRESHOLD) {
				pixel[i + 3] = 0;
			}
		}
		ctxBuffer.putImageData(imageData, 0, 0);

		return canvasBuffer.toDataURL();
	}
	sendImageToServer(serverSendTag = "imageInput") {
		socket.emit(serverSendTag, this.createImageFromCanvas());
	}
}

class TextInput {
	constructor(inputLabel, placeholderText, boxWidth, maxCharacterCount, highlightColor, fontSize = 30) {
		this.inputLabel = inputLabel;
		this.placeholderText = placeholderText;
		this.boxWidth = boxWidth;
		this.maxCharacterCount = maxCharacterCount;
		this.highlightColor = highlightColor;
		this.fontSize = fontSize;

		this.x = 0;
		this.y = 0;

		this.text = "";
		this.focused = false;
		this.textIndex = 0;

		this.onEnterKey = function() {};
	}
	onMouseDown(mouseX, mouseY) {
		if (this.x <= mouseX && mouseX < this.x + this.boxWidth
			&& this.y <= mouseY && mouseY < this.y + this.fontSize * TextInput.BOX_HEIGHT_COEFFICIENT) {
				this.focused = true;
				var cursorX = this.x + 2;
				//ctx.measureText(this.text.slice(0, this.textIndex)).width +
				var charWidth;
				var previousCharWidth = 0;
				for (var i = 0; i < this.text.length; i++) {
					charWidth = ctx.measureText(this.text.slice(i, i + 1)).width;
					if (cursorX - previousCharWidth / 2 <= mouseX && mouseX < cursorX + charWidth / 2) {
						this.textIndex = i;
						break;
					}
					cursorX += charWidth;
					previousCharWidth = charWidth;
					if (i + 1 == this.text.length) {
						this.textIndex = this.text.length;
					}
				}
		} else {
			this.focused = false;
		}
	}
	onKeyDown(keyevent) {
		if (this.focused) {
			if (keyevent.code == "Backspace" && this.text.length > 0) {
				this.text = this.text.slice(0, this.textIndex - 1) + this.text.slice(this.textIndex, this.text.length);
				this.textIndex--;
			}
			if (keyevent.code == "ArrowRight" && this.textIndex < this.text.length) {
				this.textIndex++;
			}
			if (keyevent.code == "ArrowLeft" && this.textIndex > 0) {
				this.textIndex--;
			}
			if (keyevent.code == "Enter") {
				this.onEnterKey();
			}
		}
	}
	onKeyPress(keyevent) {
		if (this.focused) {
			if (keyevent.key == "Enter") return;
			if (this.text.length < this.maxCharacterCount && ctx.measureText(this.text).width < this.boxWidth - TextInput.OUTLINE_WIDTH * 8) {
				this.text = this.text.slice(0, this.textIndex) + keyevent.key + this.text.slice(this.textIndex, this.text.length);
				this.textIndex++;
			}
		}
	}
	static get OUTLINE_WIDTH() {return 2;}
	static get BACKGROUND_COLOR() {return "#EEEEEE";}
	static get PLACEHOLDER_TEXT_COLOR() {return "#BBBBBB";}
	static get TEXT_COLOR() {return "#444444";}
	static get OUTLINE_COLOR() {return "#AAAAAA";}
	static get BOX_HEIGHT_COEFFICIENT() {return 3 / 2;}
	render(x, y) {
		this.x = x;
		this.y = y;
		if (this.focused) {
			ctx.fillStyle = this.highlightColor;
		} else {
			ctx.fillStyle = TextInput.OUTLINE_COLOR;
		}
		ctx.fillRect(this.x - TextInput.OUTLINE_WIDTH, this.y - TextInput.OUTLINE_WIDTH,
			this.boxWidth + TextInput.OUTLINE_WIDTH * 2, this.fontSize * TextInput.BOX_HEIGHT_COEFFICIENT + TextInput.OUTLINE_WIDTH * 2);
		ctx.fillStyle = TextInput.BACKGROUND_COLOR;
		ctx.fillRect(this.x, this.y,
			this.boxWidth, this.fontSize * 3 / 2);

		ctx.fillStyle = TextInput.TEXT_COLOR;
		ctx.font = this.fontSize + "px " + DEFAULT_FONT;
		ctx.fillText(this.inputLabel, this.x, this.y - TextInput.OUTLINE_WIDTH * 3);

		if (this.text == "" && !this.focused) {
			ctx.fillStyle = TextInput.PLACEHOLDER_TEXT_COLOR;
			ctx.fillText(this.placeholderText, this.x + TextInput.OUTLINE_WIDTH, this.y + this.fontSize * 8 / 7);
		} else {
			ctx.fillStyle = TextInput.TEXT_COLOR;
			ctx.fillText(this.text, this.x + TextInput.OUTLINE_WIDTH, this.y + this.fontSize * 8 / 7);

			if (this.focused) {
				var cursorX = this.x + ctx.measureText(this.text.slice(0, this.textIndex)).width + 2;
				ctx.fillRect(cursorX, this.y + TextInput.OUTLINE_WIDTH, 2, this.fontSize * TextInput.BOX_HEIGHT_COEFFICIENT - TextInput.OUTLINE_WIDTH * 2);
			}
		}
	}
	sendTextToServer(serverSendTag = "textInput") {
		socket.emit(serverSendTag, this.text);
	}
}

class VertScrollArea {
	constructor (width, height, barColor, barBackgroundColor, maxHeight, renderFunction) {
		this.width = width;
		this.height = height;
		this.barColor = barColor;
		this.barBackgroundColor = barBackgroundColor;
		this.maxHeight = maxHeight;
		this.renderFunction = renderFunction;

		this.positionOffset = 0;
		this.orgPositionOffset = 0;
		this.srcY = 0;
		this.currentMouseY = 0;
		this.scrolling = false;
	}
	render(x, y) {
		this.x = x;
		this.y = y;

		if (this.maxHeight < this.height) this.maxHeight = this.height;
		this.scrollBarHeight = Math.ceil((this.height / this.maxHeight) * this.height);
		this.positionOffset = this.orgPositionOffset + (this.currentMouseY - this.srcY);
		if (this.positionOffset < 0) {
			this.positionOffset = 0;
			this.orgPositionOffset = 0;
			this.scrolling = false;
		} else if (this.positionOffset > this.height - this.scrollBarHeight) {
			this.positionOffset = this.height - this.scrollBarHeight;
			this.orgPositionOffset = this.positionOffset;
			this.scrolling = false;
		}

		ctx.fillStyle = this.barBackgroundColor;
		ctx.fillRect(this.x + this.width - VertScrollArea.SCROLL_BAR_WIDTH, this.y, VertScrollArea.SCROLL_BAR_WIDTH, this.height);
		ctx.fillStyle = this.barColor;
		ctx.fillRect(this.x + this.width - VertScrollArea.SCROLL_BAR_WIDTH, this.y + this.positionOffset, VertScrollArea.SCROLL_BAR_WIDTH, this.scrollBarHeight);

		this.renderFunction(this.positionOffset, screen);
	}
	onMouseDown(mouseX, mouseY) {
		if (this.x + this.width - VertScrollArea.SCROLL_BAR_WIDTH <= mouseX && mouseX < this.width
			&& this.y + this.positionOffset <= mouseY && mouseY < this.y + this.positionOffset + this.scrollBarHeight) {
			this.orgPositionOffset = this.positionOffset;
			this.srcY = mouseY;
			this.currentMouseY = mouseY;
			this.scrolling = true;
		}
	}
	static get SCROLL_BAR_WIDTH() {return 30;}
	onMouseMove(mouseX, mouseY) {
		if (this.scrolling) this.currentMouseY = mouseY;
	}
	onMouseUp(mouseX, mouseY) {
		this.scrolling = false;
	}
}

class Screen {
	render() {}
	onMouseDown(mouseX, mouseY) {}
	onMouseMove(mouseX, mouseY) {}
	onMouseUp(mouseX, mouseY) {}
	onKeyDown(keyevent) {}
	onKeyPress(keyevent) {}
	onKeyUp(keyevent) {}
}

class TitleScreen extends Screen {
	constructor() {
		super();
		this.playButton = new Button("Play", 30, "#EEEEEE", 500, 50, "#356f8c");
		this.playButton.screen = this;
		this.playButton.onButtonClick = function() {
			currentScreen = new ProfileInfoScreen();
		};
	}
	render() {
		var textBoxHeight = canvasH / 2;

		ctx.font = "50px " + DEFAULT_FONT;
		var text = "Scuffed Drawful";
		ctx.fillStyle = "#FFFFFF";
		ctx.fillText(text, canvasW / 2 - ctx.measureText(text).width / 2, textBoxHeight - 75);

		if (connectionError != "") {
			ctx.fillStyle = "#FF0000";
			ctx.fillText(connectionError, canvasW / 2 - ctx.measureText(connectionError).width / 2, textBoxHeight);
		} else {
			this.playButton.render(canvasW / 2 - this.playButton.width / 2, textBoxHeight + 75);
		}
	}
	onMouseDown(mouseX, mouseY) {
		if (connectionError == "") this.playButton.onMouseDown(mouseX, mouseY);
	}
	onMouseMove(mouseX, mouseY) {
		if (connectionError == "") this.playButton.onMouseMove(mouseX, mouseY);
	}
}

class ProfileInfoScreen extends Screen {
	constructor() {
		super();
		//this.drawingCanvas = new DrawingCanvas(500, "#d94c4c", "#8c3131", DrawingCanvas.CANVAS_COLOR);
		this.drawingCanvas = new DrawingCanvas(500, PRIMARY_COLORS[colorPalleteIndex], SECONDARY_COLORS[colorPalleteIndex], DrawingCanvas.CANVAS_COLOR);
		this.textInput = new TextInput("Enter a Username: ", "Max character length of 10", 500, 10, "#30608c", 30);

		this.enterInfoButton = new Button("Submit", 30, "#FFFFFF", 100, 50, "#000000");
		this.enterInfoButton.screen = this;
		this.enterInfoButton.onButtonClick = function(screen) {
			if (screen.textInput.text != "" && screen.drawingCanvas.clickX.length > 0) {
				screen.textInput.sendTextToServer();
				screen.drawingCanvas.sendImageToServer();
			}
		};
	}
	render() {
		ctx.font = "30px " + DEFAULT_FONT;
		var text = "Draw a picture of youself:";
		ctx.fillStyle = "#444444";
		ctx.fillText(text, canvasW / 2 - ctx.measureText(text).width / 2, 40);

		this.drawingCanvas.render(canvasW / 2 - this.drawingCanvas.size / 2, 50);
		this.textInput.render(canvasW / 2 - this.textInput.boxWidth / 2, 650);
		this.enterInfoButton.render(canvasW / 2 - this.enterInfoButton.width / 2, 720)

		if (connectionError != "") {
			ctx.fillStyle = "#FF0000";
			ctx.fillText(connectionError, canvasW / 2 - ctx.measureText(connectionError).width / 2, 800);
		}
	}
	onMouseDown(mouseX, mouseY) {
		this.drawingCanvas.addCanvasDrawClick(mouseX, mouseY, false);
		this.drawingCanvas.onToolbarClick(mouseX, mouseY);
		this.textInput.onMouseDown(mouseX, mouseY);
		this.enterInfoButton.onMouseDown(mouseX, mouseY);
	}
	onMouseMove(mouseX, mouseY) {
		if (isMouseDown) {
			this.drawingCanvas.addCanvasDrawClick(mouseX, mouseY, true);
		}
		this.enterInfoButton.onMouseMove(mouseX, mouseY);
	}
	onKeyDown(keyevent) {
		this.textInput.onKeyDown(keyevent);
	}
	onKeyPress(keyevent) {
		this.textInput.onKeyPress(keyevent);
	}
}

class State {
	constructor() {}
	render() {}
	renderList(key, counter, offsetY) {}
	onMouseDown(mouseX, mouseY) {}
	onMouseMove(mouseX, mouseY) {}
	onMouseUp(mouseX, mouseY) {}
	onKeyDown(keyevent) {}
	onKeyPress(keyevent) {}
	onKeyUp(keyevent) {}
}

class WaitingState extends State{
	constructor() {
		super();
		this.readyButton = new Button("NOT READY", 30, "#FF0000", 170, 50, "#356f8c");
		this.readyButton.screen = this;
		this.readyButton.onButtonClick = function(state) {
			if (state.readyButton.text == "READY") {
				state.readyButton.text = "NOT READY"
				state.readyButton.textColor = "#FF0000";
				state.readyButton.sendButtonClickToServer();
			} else {
				state.readyButton.text = "READY";
				state.readyButton.textColor = "#00FF00";
				state.readyButton.sendButtonClickToServer();
			}
		};
	}
	render() {
		ctx.fillStyle = "#FFFFFF";
		ctx.fillText("Player List:", 5, 50);

		ctx.font = "50px " + DEFAULT_FONT;
		ctx.fillStyle = "#FFFFFF";
		var text = "Waiting for players...";
		var distFromScroll = (canvasW - currentScreen.scrollArea.width) / 2 - ctx.measureText(text).width / 2
		if (distFromScroll > 0) {
				ctx.fillText(text, currentScreen.scrollArea.width + distFromScroll, canvasH / 2);
		}
	}
	renderList(key, counter, offsetY) {
		if (key == socketID) {
			this.readyButton.render(115, 142 + counter * 120 - offsetY);
		} else {
			if (players[key].isReady) {
				ctx.fillStyle = "#00FF00";
				ctx.fillText("READY", 152, 165 + counter * 120 - offsetY);
			} else {
				ctx.fillStyle = "#FF0000";
				ctx.fillText("NOT READY", 123, 165 + counter * 120 - offsetY);
			}
		}
	}
	onMouseDown(mouseX, mouseY) {
		this.readyButton.onMouseDown(mouseX, mouseY);
	}
	onMouseMove(mouseX, mouseY) {
		this.readyButton.onMouseMove(mouseX, mouseY);
	}
}

class DrawingState extends State{
	constructor() {
		super();
		this.drawingCanvas = new DrawingCanvas(500, PRIMARY_COLORS[colorPalleteIndex], SECONDARY_COLORS[colorPalleteIndex], DrawingCanvas.CANVAS_COLOR);

		this.submitDrawingButton = new Button("Submit", 30, "#FFFFFF", 100, 50, "#000000");
		this.submitDrawingButton.screen = this;
		this.submitDrawingButton.onButtonClick = function(screen) {
			if (screen.drawingCanvas.clickX.length > 0) {
				screen.drawingCanvas.sendImageToServer();
			}
		};
	}
	render() {
		ctx.fillStyle = "#000000";
		ctx.fillText("Time Left: " + timerTime, 5, 50);

		if (!players[socketID].isDrawing) {
			ctx.font = "30px " + DEFAULT_FONT;
			ctx.fillStyle = "#FFFFFF";
			var text = "Drawing Submitted...";
			var distFromScroll = (canvasW - currentScreen.scrollArea.width) / 2 - ctx.measureText(text).width / 2
			if (distFromScroll > 0) {
				ctx.fillText(text, currentScreen.scrollArea.width + distFromScroll, canvasH / 2);
			}
		} else {
			var distFromScroll = (canvasW - currentScreen.scrollArea.width) / 2 - this.drawingCanvas.size / 2;
			var x;
			if (distFromScroll > 0) {
				x = currentScreen.scrollArea.width + distFromScroll;
			} else {
				x = currentScreen.scrollArea.width;
			}

			ctx.font = "30px " + DEFAULT_FONT;
			ctx.fillText("Please Draw: \"" + players[socketID].prompt + "\"", x, 90);

			this.drawingCanvas.render(x, 100);

			console.log();
			this.submitDrawingButton.render(x + this.drawingCanvas.size / 2 - this.submitDrawingButton.width / 2, this.drawingCanvas.y + 570);

			if (timerTime == 0) {
				this.drawingCanvas.sendImageToServer();
				players[socketID].isDrawing = false;
			}
		}
	}
	renderList(key, counter, offsetY) {
		if (players[key].isDrawing) {
			ctx.fillStyle = "#FFFFFF";
			ctx.fillText("Drawing...", 123, 165 + counter * 120 - offsetY);
		}
	}
	onMouseDown(mouseX, mouseY) {
		this.drawingCanvas.addCanvasDrawClick(mouseX, mouseY, false);
		this.drawingCanvas.onToolbarClick(mouseX, mouseY);
		this.submitDrawingButton.onMouseDown(mouseX, mouseY);
	}
	onMouseMove(mouseX, mouseY) {
		if (isMouseDown) {
			this.drawingCanvas.addCanvasDrawClick(mouseX, mouseY, true);
		}
		this.submitDrawingButton.onMouseMove(mouseX, mouseY);
	}
}

class SuggestionState extends State {
	constructor() {
		super();
		this.textInput = new TextInput("", "Enter a Title", 500, 25, "#30608c", 30);

		this.enterTitleButton = new Button("Submit", 30, "#FFFFFF", 100, 50, "#000000");
		this.enterTitleButton.screen = this;
		this.enterTitleButton.onButtonClick = function(screen) {
			if (screen.textInput.text != "") {
				screen.textInput.sendTextToServer();
			}
		}
	}
	render() {
		this.showcasingPlayerKey = Object.keys(players).find(function (player) {
			return !player.hasBeenJudged;
		});
		var showcasingPlayer = players[this.showcasingPlayerKey];

		ctx.fillStyle = "#000000";
		ctx.fillText("Time Left: " + timerTime, 5, 50);

		var text = "What is it?";
		var distFromScroll = (canvasW - currentScreen.scrollArea.width) / 2 - this.textInput.boxWidth / 2;
		var x;
		if (distFromScroll > 0) {
			x = currentScreen.scrollArea.width + distFromScroll;
		} else {
			x = currentScreen.scrollArea.width;
		}
		var imgSize = 500;
		if (this.showcasingPlayerKey == socketID) {
			ctx.font = "30px " + DEFAULT_FONT;
			var waitText = "Waiting for other players...";
			ctx.fillText(waitText, x + imgSize / 2 - ctx.measureText(waitText).width / 2, 70);
			ctx.drawImage(showcasingPlayer.promptDrawing, x, 120, imgSize, imgSize);
		} else {
			if (players[socketID].isSuggestingTitle) {
				ctx.font = "50px " + DEFAULT_FONT;
				ctx.fillText(text, x, 70);
				this.textInput.render(x, 100);
				this.enterTitleButton.render(x + imgSize / 2 - this.enterTitleButton.width / 2, 160);
				ctx.drawImage(showcasingPlayer.promptDrawing, x, 220, imgSize, imgSize);
			} else {
				ctx.font = "30px " + DEFAULT_FONT;
				ctx.fillStyle = "#FFFFFF";
				text = "Title Submitted...";
				distFromScroll = (canvasW - currentScreen.scrollArea.width) / 2 - ctx.measureText(text).width / 2
				if (distFromScroll > 0) {
					ctx.fillText(text, currentScreen.scrollArea.width + distFromScroll, canvasH / 2);
				}
			}
		}

		if (timerTime == 0) {
			this.textInput.sendTextToServer();
			players[socketID].isWriting = false;
		}
	}
	renderList(key, counter, offsetY) {
		if (players[key].isSuggestingTitle) {
			ctx.fillStyle = "#FFFFFF";
			ctx.fillText("Writing...", 123, 165 + counter * 120 - offsetY);
		}
	}
	onMouseDown(mouseX, mouseY) {
		if (!players[socketID].isSuggestingTitle) return
		if (this.showcasingPlayerKey != socketID) {
			this.textInput.onMouseDown(mouseX, mouseY);
		}
		this.enterTitleButton.onMouseDown(mouseX, mouseY);
	}
	onMouseMove(mouseX, mouseY) {
		if (!players[socketID].isSuggestingTitle) return
		this.enterTitleButton.onMouseMove(mouseX, mouseY);
	}
	onKeyDown(keyevent) {
		if (!players[socketID].isSuggestingTitle) return
		if (this.showcasingPlayerKey != socketID) {
			this.textInput.onKeyDown(keyevent);
		}
	}
	onKeyPress(keyevent) {
		if (!players[socketID].isSuggestingTitle) return
		if (this.showcasingPlayerKey != socketID) {
			this.textInput.onKeyPress(keyevent);
		}
	}
}

class ChooseTitleState extends State {
	constructor() {
		super();
		this.listOfTitles = [];

		var self = this;
		var counter = 0;
		Object.values(players).forEach(function (player) {
			if (player.username == players[socketID].username) return;
			if (player.titleSuggestion == undefined)  {
				self.listOfTitles[counter] = player.prompt;
			} else {
				self.listOfTitles[counter] = player.titleSuggestion;
			}
			counter++;
		});

		this.listOfTitles.sort(function (playerA, playerB) {
			var hashA = self.hashUsername(playerA);
			var hashB = self.hashUsername(playerB);

			if (hashA < hashB) {
				return -1;
			} else if (hashA > hashB) {
				return 1;
			}
			return 1;
		});

		this.titleButtons = [];
		Object.values(this.listOfTitles).forEach(function (title) {
			self.titleButtons[title] = new Button(title, 30, "#FFFFFF", 500, 50, "#000000");
			self.titleButtons[title].screen = self;
			self.titleButtons[title].onButtonClick = function(screen) {
				socket.emit("textInput", title);
			}
		});
	}
	hashUsername(name) {
		var hash = 67;
		for (var i = 0; i < name.length; i ++) {
			hash = (hash * name[i].charCodeAt(0)) % 127;
		}
		return hash;
	}
	render() {
		this.showcasingPlayerKey = Object.keys(players).find(function (player) {
			return !player.hasBeenJudged;
		});
		var showcasingPlayer = players[this.showcasingPlayerKey];

		ctx.fillStyle = "#000000";
		ctx.fillText("Time Left: " + timerTime, 5, 50);

		var distFromScroll = (canvasW - currentScreen.scrollArea.width) / 2 - 500 / 2;
		var x;
		if (distFromScroll > 0) {
			x = currentScreen.scrollArea.width + distFromScroll;
		} else {
			x = currentScreen.scrollArea.width;
		}
		if (this.showcasingPlayerKey == socketID) {
			ctx.font = "30px " + DEFAULT_FONT;
			var waitText = "Waiting for title selection...";
			ctx.fillText(waitText, x + 500 / 2 - ctx.measureText(waitText).width / 2, 70);

			var counter = 0;
			Object.values(this.listOfTitles).forEach(function (title) {
				ctx.fillText(title, x + 500 / 2 - ctx.measureText(title).width / 2, 110 + 40 * counter);
				counter++;
			});
		} else {
			if (players[socketID].isChoosingTitle) {
				var counter = 0;
				Object.values(this.titleButtons).forEach(function (button) {
					button.render(x, 90 + (button.height + 10) * counter);
					counter++;
				});

				var text = "Select the correct title";
				ctx.fillStyle = "#000000";
				ctx.fillText(text, x + 500 / 2 - ctx.measureText(text).width / 2, 50);
			} else {
				ctx.font = "30px " + DEFAULT_FONT;
				ctx.fillStyle = "#FFFFFF";
				var text = "Selected Title Submitted...";
				distFromScroll = (canvasW - currentScreen.scrollArea.width) / 2 - ctx.measureText(text).width / 2
				if (distFromScroll > 0) {
					ctx.fillText(text, currentScreen.scrollArea.width + distFromScroll, canvasH / 2);
				}
			}
		}

		if (timerTime == 0) {
			var randomIndex = Math.ceil(Math.random() * this.listOfTitles.length);
			socket.emit("textInput", this.listOfTitles[randomIndex]);
			players[socketID].isChoosingTitle = false;
		}
	}
	renderList(key, counter, offsetY) {
		if (players[key].isChoosingTitle) {
			ctx.fillStyle = "#FFFFFF";
			ctx.fillText("Selecting...", 123, 165 + counter * 120 - offsetY);
		}
	}
	onMouseDown(mouseX, mouseY) {
		if (!players[socketID].isChoosingTitle) return;
		Object.values(this.titleButtons).forEach(function (button) {
			button.onMouseDown(mouseX, mouseY);
		});
	}
	onMouseMove(mouseX, mouseY) {
		if (!players[socketID].isChoosingTitle) return;
		Object.values(this.titleButtons).forEach(function (button) {
			button.onMouseMove(mouseX, mouseY);
		});
	}
}

class ResultState extends State {
	constructor() {
		super();
		Object.values(players).forEach(function (player) {
			console.log(player.username + "::" + player.score);
		});
	}
	render() {
		ctx.fillStyle = "#FF0000";
		ctx.fillText("WIP, This screen is not done...", 100, 100);
	}
	renderList(key, counter, offsetY) {

	}
}

class MainScreen extends Screen {
	constructor() {
		super();
		this.currentState = new WaitingState();

		this.scrollArea = new VertScrollArea(330, canvasH, "#555555", "#333333", canvasH, function(offsetY, screen) {
			var counter = 0;
			var maxHeight = canvasH;
			var self = this;
			const NAME_TEXT_X_OFFSET = 123;
			Object.keys(players).forEach(function (key) {
				var text = players[key].username;
				if (key == socketID) {
					text = text.concat(" (you)");
				}
				if (ctx.measureText(text).width + NAME_TEXT_X_OFFSET > self.width - VertScrollArea.SCROLL_BAR_WIDTH) {
					self.width = NAME_TEXT_X_OFFSET + ctx.measureText(text).width + VertScrollArea.SCROLL_BAR_WIDTH;
				}
				ctx.fillStyle = "#FFFFFF";
				ctx.fillText(text, NAME_TEXT_X_OFFSET, 130 + counter * 120 - offsetY);
				ctx.drawImage(players[key].profilePic, 5, 100 + counter * 120 - offsetY, 100, 100);

				currentScreen.currentState.renderList(key, counter, offsetY);

				counter++;
				maxHeight = 100 + counter * 120;
			});
			this.height = canvasH;
			this.maxHeight = maxHeight;
		});
	}
	setState(gameState) {
		switch(gameState) {
			case "WaitingState":
				this.currentState = new WaitingState();
				break;
			case "DrawingState":
				this.currentState = new DrawingState();
				break;
			case "SuggestionState":
				this.currentState = new SuggestionState();
				break;
			case "ChooseTitleState":
				this.currentState = new ChooseTitleState();
				break;
			case "ResultState":
				this.currentState = new ResultState();
				break;
		}
	}
	render() {
		ctx.font = "30px " + DEFAULT_FONT;
		this.scrollArea.render(0, 0);

		ctx.fillStyle = "#356f8c";
		ctx.fillRect(0, 0, this.scrollArea.width - VertScrollArea.SCROLL_BAR_WIDTH, 80);

		this.currentState.render();
	}
	onMouseDown(mouseX, mouseY) {
		this.currentState.onMouseDown(mouseX, mouseY);
		this.scrollArea.onMouseDown(mouseX, mouseY);
	}
	onMouseMove(mouseX, mouseY) {
		this.currentState.onMouseMove(mouseX, mouseY);
		this.scrollArea.onMouseMove(mouseX, mouseY);
	}
	onMouseUp(mouseX, mouseY) {
		this.scrollArea.onMouseUp(mouseX, mouseY);
	}
	onKeyDown(keyevent) {
		this.currentState.onKeyDown(keyevent);
	}
	onKeyPress(keyevent) {
		this.currentState.onKeyPress(keyevent);
	}
}

function init() {
	currentScreen = new TitleScreen();
}

function update() {
	adjustSize();
}

function render() {
	clearCanvas();
	currentScreen.render();
}

function clearCanvas() {
  ctx.globalAlpha = 1;
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, canvasW, canvasH);
}

function adjustSize() {
	canvasW = window.innerWidth ||
   	document.documentElement.clientWidth ||
    	document.body.clientWidth;
  	canvasH = window.innerHeight ||
    	document.documentElement.clientHeight ||
    	document.body.clientHeight;
	if (canvas.width != canvasW) {
	   canvas.width = canvasW;
	}
	if (canvas.height != canvasH) {
		canvas.height = canvasH;
	}
}

window.onload =
	function Game() {
		document.body.style.marginTop = 0;
    	document.body.style.marginLeft = 0;
    	document.body.style.marginBottom = 0;
    	document.body.style.marginUp = 0;

		this.canvas = document.getElementById('canvas');
    	this.ctx = this.canvas.getContext("2d");
		adjustSize();
		init();
		var playLoop = setInterval(function() {
    		update();
    		render();
  		}, 1000 / FPS);
  	}

document.onmousedown =
	function mousedown(e) {
    	e = e || window.event;
    	isMouseDown = true;
		currentScreen.onMouseDown(e.pageX, e.pageY);
  	}
document.onmousemove =
	function mousemove(e) {
		e = e || window.event;
		mouseX = e.pageX;
		mouseY = e.pageY;
		currentScreen.onMouseMove(e.pageX, e.pageY);
	}
document.onmouseup =
  	function mouseup(e) {
    	e = e || window.event;
    	isMouseDown = false;
		currentScreen.onMouseUp(e.pageX, e.pageY);
	}
document.onkeydown =
	function keydown(e) {
		e = e || window.event;
		currentScreen.onKeyDown(e);
	}
document.onkeypress =
	function keypress(e) {
		e = e || window.event;
		currentScreen.onKeyPress(e);
	}
