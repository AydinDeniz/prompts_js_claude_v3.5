// Game Server (Node.js)
const WebSocket = require('ws');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

class GameServer {
  constructor(port) {
    this.port = port;
    this.games = new Map();
    this.players = new Map();
    this.matchmaking = [];
    
    this.init();
  }

  async init() {
    await this.connectDatabase();
    this.setupWebSocket();
    this.startGameLoop();
  }

  async connectDatabase() {
    await mongoose.connect('mongodb://localhost/multiplayer_game', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
  }

  setupWebSocket() {
    this.wss = new WebSocket.Server({ port: this.port });
    
    this.wss.on('connection', (ws) => {
      const playerId = uuidv4();
      this.handleNewConnection(ws, playerId);
      
      ws.on('message', (message) => {
        this.handleMessage(playerId, JSON.parse(message));
      });
      
      ws.on('close', () => {
        this.handleDisconnection(playerId);
      });
    });
  }

  handleNewConnection(ws, playerId) {
    this.players.set(playerId, {
      id: playerId,
      ws: ws,
      game: null,
      state: {
        x: 0,
        y: 0,
        score: 0
      }
    });
  }

  handleMessage(playerId, message) {
    const player = this.players.get(playerId);
    if (!player) return;

    switch (message.type) {
      case 'join_matchmaking':
        this.joinMatchmaking(playerId);
        break;
      case 'player_update':
        this.updatePlayerState(playerId, message.state);
        break;
      case 'game_action':
        this.handleGameAction(playerId, message.action);
        break;
    }
  }

  handleDisconnection(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    if (player.game) {
      this.endGame(player.game);
    }

    this.matchmaking = this.matchmaking.filter(id => id !== playerId);
    this.players.delete(playerId);
  }

  joinMatchmaking(playerId) {
    this.matchmaking.push(playerId);
    
    if (this.matchmaking.length >= 2) {
      const players = this.matchmaking.splice(0, 2);
      this.createGame(players);
    }
  }

  createGame(playerIds) {
    const gameId = uuidv4();
    const game = {
      id: gameId,
      players: playerIds,
      state: this.createInitialGameState(),
      startTime: Date.now()
    };

    this.games.set(gameId, game);
    
    playerIds.forEach(playerId => {
      const player = this.players.get(playerId);
      player.game = gameId;
      
      this.sendToPlayer(playerId, {
        type: 'game_start',
        gameId: gameId,
        players: playerIds,
        state: game.state
      });
    });
  }

  createInitialGameState() {
    return {
      objects: [],
      score: {},
      timeRemaining: 180 // 3 minutes
    };
  }

  updatePlayerState(playerId, state) {
    const player = this.players.get(playerId);
    if (!player || !player.game) return;

    player.state = { ...player.state, ...state };
    
    const game = this.games.get(player.game);
    this.broadcastGameState(game);
  }

  handleGameAction(playerId, action) {
    const player = this.players.get(playerId);
    if (!player || !player.game) return;

    const game = this.games.get(player.game);
    this.processGameAction(game, playerId, action);
    this.broadcastGameState(game);
  }

  processGameAction(game, playerId, action) {
    // Implement game-specific action handling
    switch (action.type) {
      case 'collect':
        this.handleCollectAction(game, playerId, action);
        break;
      case 'attack':
        this.handleAttackAction(game, playerId, action);
        break;
    }
  }

  broadcastGameState(game) {
    game.players.forEach(playerId => {
      this.sendToPlayer(playerId, {
        type: 'game_state',
        state: this.getGameStateForPlayer(game, playerId)
      });
    });
  }

  getGameStateForPlayer(game, playerId) {
    return {
      players: game.players.map(id => ({
        id: id,
        state: this.players.get(id).state
      })),
      objects: game.state.objects,
      score: game.state.score,
      timeRemaining: game.state.timeRemaining
    };
  }

  sendToPlayer(playerId, message) {
    const player = this.players.get(playerId);
    if (player && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  }

  startGameLoop() {
    setInterval(() => {
      this.update();
    }, 1000 / 60); // 60 FPS
  }

  update() {
    for (const [gameId, game] of this.games) {
      this.updateGame(game);
    }
  }

  updateGame(game) {
    // Update game physics and state
    this.updateGameObjects(game);
    this.checkCollisions(game);
    this.updateGameTime(game);
  }

  endGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    // Save game results
    this.saveGameResults(game);

    // Notify players
    game.players.forEach(playerId => {
      this.sendToPlayer(playerId, {
        type: 'game_end',
        results: this.getGameResults(game)
      });
      
      const player = this.players.get(playerId);
      if (player) player.game = null;
    });

    this.games.delete(gameId);
  }

  async saveGameResults(game) {
    try {
      await GameResult.create({
        gameId: game.id,
        players: game.players.map(playerId => ({
          id: playerId,
          score: game.state.score[playerId] || 0
        })),
        duration: Date.now() - game.startTime
      });
    } catch (error) {
      console.error('Failed to save game results:', error);
    }
  }
}

// Game Client (Browser)
class GameClient {
  constructor() {
    this.playerId = null;
    this.gameId = null;
    this.players = new Map();
    this.objects = [];
    
    this.init();
  }

  async init() {
    this.setupPixiJS();
    this.setupWebSocket();
    this.setupInputHandlers();
    this.startGameLoop();
  }

  setupPixiJS() {
    this.app = new PIXI.Application({
      width: 800,
      height: 600,
      backgroundColor: 0x1099bb
    });
    document.body.appendChild(this.app.view);

    // Create game containers
    this.gameContainer = new PIXI.Container();
    this.uiContainer = new PIXI.Container();
    
    this.app.stage.addChild(this.gameContainer);
    this.app.stage.addChild(this.uiContainer);

    this.setupGameObjects();
  }

  setupGameObjects() {
    // Create player sprite
    this.playerSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    this.playerSprite.width = 32;
    this.playerSprite.height = 32;
    this.gameContainer.addChild(this.playerSprite);

    // Setup UI elements
    this.setupUI();
  }

  setupUI() {
    this.scoreText = new PIXI.Text('Score: 0', {
      fontFamily: 'Arial',
      fontSize: 24,
      fill: 0xffffff
    });
    this.scoreText.position.set(10, 10);
    this.uiContainer.addChild(this.scoreText);
  }

  setupWebSocket() {
    this.ws = new WebSocket('ws://localhost:8080');
    
    this.ws.onopen = () => {
      console.log('Connected to game server');
    };
    
    this.ws.onmessage = (event) => {
      this.handleServerMessage(JSON.parse(event.data));
    };
    
    this.ws.onclose = () => {
      console.log('Disconnected from game server');
    };
  }

  setupInputHandlers() {
    window.addEventListener('keydown', (e) => {
      this.handleInput(e.key, true);
    });

    window.addEventListener('keyup', (e) => {
      this.handleInput(e.key, false);
    });

    this.keys = new Set();
  }

  handleInput(key, isDown) {
    if (isDown) {
      this.keys.add(key);
    } else {
      this.keys.delete(key);
    }
  }

  handleServerMessage(message) {
    switch (message.type) {
      case 'game_start':
        this.handleGameStart(message);
        break;
      case 'game_state':
        this.handleGameState(message);
        break;
      case 'game_end':
        this.handleGameEnd(message);
        break;
    }
  }

  handleGameStart(message) {
    this.gameId = message.gameId;
    this.playerId = message.players[0];
    this.initializeGame(message.state);
  }

  handleGameState(message) {
    this.updateGameState(message.state);
  }

  handleGameEnd(message) {
    this.showGameResults(message.results);
    this.resetGame();
  }

  updateGameState(state) {
    // Update player positions
    state.players.forEach(player => {
      this.updatePlayerPosition(player);
    });

    // Update game objects
    this.updateGameObjects(state.objects);

    // Update UI
    this.updateUI(state);
  }

  updatePlayerPosition(player) {
    if (player.id === this.playerId) {
      this.playerSprite.position.set(player.state.x, player.state.y);
    } else {
      let otherSprite = this.players.get(player.id);
      if (!otherSprite) {
        otherSprite = this.createPlayerSprite();
        this.players.set(player.id, otherSprite);
      }
      otherSprite.position.set(player.state.x, player.state.y);
    }
  }

  createPlayerSprite() {
    const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    sprite.width = 32;
    sprite.height = 32;
    sprite.tint = Math.random() * 0xFFFFFF;
    this.gameContainer.addChild(sprite);
    return sprite;
  }

  startGameLoop() {
    this.app.ticker.add(() => {
      this.update();
    });
  }

  update() {
    if (!this.gameId) return;

    // Handle input
    this.handleMovement();

    // Send state to server
    this.sendPlayerState();
  }

  handleMovement() {
    const speed = 5;
    let dx = 0;
    let dy = 0;

    if (this.keys.has('ArrowLeft')) dx -= speed;
    if (this.keys.has('ArrowRight')) dx += speed;
    if (this.keys.has('ArrowUp')) dy -= speed;
    if (this.keys.has('ArrowDown')) dy += speed;

    if (dx !== 0 || dy !== 0) {
      this.playerSprite.x += dx;
      this.playerSprite.y += dy;
      this.sendPlayerState();
    }
  }

  sendPlayerState() {
    this.ws.send(JSON.stringify({
      type: 'player_update',
      state: {
        x: this.playerSprite.x,
        y: this.playerSprite.y
      }
    }));
  }

  resetGame() {
    this.gameId = null;
    this.players.clear();
    this.gameContainer.removeChildren();
    this.setupGameObjects();
  }
}

// Initialize client
const gameClient = new GameClient();

// Initialize server
const gameServer = new GameServer(8080);