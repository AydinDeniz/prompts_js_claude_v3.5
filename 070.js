class MultiplayerGame {
    constructor() {
        this.players = new Map();
        this.matches = new Map();
        this.leaderboard = [];
        this.socket = null;
        this.gameState = null;
        this.playerRank = 0;
    }

    async init() {
        await this.setupWebSocket();
        this.setupUI();
        this.initializeGameEngine();
        this.setupMatchmaking();
    }

    async setupWebSocket() {
        this.socket = new WebSocket('wss://your-game-server.com');
        
        this.socket.onopen = () => {
            console.log('Connected to game server');
            this.authenticate();
        };

        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleServerMessage(message);
        };

        this.socket.onclose = () => {
            console.log('Disconnected from server');
            this.handleDisconnect();
        };
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="game-container">
                <div class="game-header">
                    <div class="player-info">
                        <span class="player-name"></span>
                        <span class="player-rank"></span>
                    </div>
                    <div class="match-status"></div>
                </div>
                
                <div class="game-main">
                    <canvas id="game-canvas"></canvas>
                    
                    <div class="side-panel">
                        <div class="leaderboard">
                            <h3>Leaderboard</h3>
                            <div id="leaderboard-list"></div>
                        </div>
                        
                        <div class="chat-box">
                            <div id="chat-messages"></div>
                            <input type="text" id="chat-input" placeholder="Type message...">
                        </div>
                    </div>
                </div>
                
                <div class="game-controls">
                    <button id="find-match">Find Match</button>
                    <button id="leave-match" disabled>Leave Match</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        this.bindEvents();
    }

    initializeGameEngine() {
        const canvas = document.getElementById('game-canvas');
        const ctx = canvas.getContext('2d');
        
        this.gameState = {
            canvas,
            ctx,
            width: canvas.width,
            height: canvas.height,
            entities: new Map(),
            lastUpdate: performance.now()
        };

        this.startGameLoop();
    }

    startGameLoop() {
        const gameLoop = (timestamp) => {
            const deltaTime = timestamp - this.gameState.lastUpdate;
            
            this.update(deltaTime);
            this.render();
            
            this.gameState.lastUpdate = timestamp;
            requestAnimationFrame(gameLoop);
        };

        requestAnimationFrame(gameLoop);
    }

    update(deltaTime) {
        if (!this.gameState || !this.gameState.entities) return;

        this.gameState.entities.forEach(entity => {
            if (entity.update) {
                entity.update(deltaTime);
            }
        });

        this.checkCollisions();
        this.syncGameState();
    }

    render() {
        const { ctx, width, height } = this.gameState;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Render game entities
        this.gameState.entities.forEach(entity => {
            if (entity.render) {
                entity.render(ctx);
            }
        });
    }

    setupMatchmaking() {
        this.matchmakingQueue = [];
        this.playerSkillRating = 1000; // Initial ELO rating
    }

    findMatch() {
        const matchRequest = {
            type: 'matchmaking',
            action: 'find',
            playerRating: this.playerSkillRating
        };
        
        this.socket.send(JSON.stringify(matchRequest));
        this.updateMatchStatus('Searching for match...');
    }

    handleServerMessage(message) {
        switch (message.type) {
            case 'auth':
                this.handleAuth(message);
                break;
            case 'matchmaking':
                this.handleMatchmaking(message);
                break;
            case 'gameState':
                this.handleGameState(message);
                break;
            case 'leaderboard':
                this.updateLeaderboard(message.data);
                break;
            case 'chat':
                this.handleChat(message);
                break;
        }
    }

    handleAuth(message) {
        if (message.success) {
            this.playerId = message.playerId;
            this.playerName = message.playerName;
            this.playerSkillRating = message.skillRating;
            this.updatePlayerInfo();
        }
    }

    handleMatchmaking(message) {
        switch (message.status) {
            case 'matched':
                this.startMatch(message.matchData);
                break;
            case 'cancelled':
                this.updateMatchStatus('Match cancelled');
                break;
            case 'error':
                this.updateMatchStatus('Matchmaking error');
                break;
        }
    }

    startMatch(matchData) {
        this.currentMatch = {
            id: matchData.matchId,
            players: matchData.players,
            startTime: Date.now()
        };

        this.initializeGameState(matchData);
        this.updateMatchStatus('Match started');
        document.getElementById('leave-match').disabled = false;
    }

    initializeGameState(matchData) {
        this.gameState.entities.clear();
        
        matchData.players.forEach(player => {
            this.gameState.entities.set(player.id, this.createPlayerEntity(player));
        });
    }

    createPlayerEntity(playerData) {
        return {
            id: playerData.id,
            x: playerData.startX,
            y: playerData.startY,
            velocity: { x: 0, y: 0 },
            size: 30,
            color: playerData.color,
            
            update(deltaTime) {
                this.x += this.velocity.x * deltaTime;
                this.y += this.velocity.y * deltaTime;
            },
            
            render(ctx) {
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size/2, 0, Math.PI * 2);
                ctx.fill();
            }
        };
    }

    checkCollisions() {
        const entities = Array.from(this.gameState.entities.values());
        
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                if (this.detectCollision(entities[i], entities[j])) {
                    this.handleCollision(entities[i], entities[j]);
                }
            }
        }
    }

    detectCollision(entity1, entity2) {
        const dx = entity1.x - entity2.x;
        const dy = entity1.y - entity2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance < (entity1.size + entity2.size) / 2;
    }

    handleCollision(entity1, entity2) {
        // Implement collision response
        const dx = entity2.x - entity1.x;
        const dy = entity2.y - entity1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const nx = dx / distance;
        const ny = dy / distance;
        
        const relativeVelocityX = entity1.velocity.x - entity2.velocity.x;
        const relativeVelocityY = entity1.velocity.y - entity2.velocity.y;
        
        const speed = relativeVelocityX * nx + relativeVelocityY * ny;
        
        if (speed > 0) return;
        
        const impulse = -2 * speed;
        
        entity1.velocity.x -= impulse * nx;
        entity1.velocity.y -= impulse * ny;
        entity2.velocity.x += impulse * nx;
        entity2.velocity.y += impulse * ny;
    }

    syncGameState() {
        if (!this.currentMatch) return;

        const gameState = {
            type: 'gameState',
            matchId: this.currentMatch.id,
            entities: Array.from(this.gameState.entities.entries())
        };

        this.socket.send(JSON.stringify(gameState));
    }

    updateLeaderboard(leaderboardData) {
        const leaderboardList = document.getElementById('leaderboard-list');
        leaderboardList.innerHTML = leaderboardData
            .map((player, index) => `
                <div class="leaderboard-item ${player.id === this.playerId ? 'current-player' : ''}">
                    <span class="rank">#${index + 1}</span>
                    <span class="name">${player.name}</span>
                    <span class="score">${player.score}</span>
                </div>
            `).join('');
    }

    bindEvents() {
        document.getElementById('find-match').onclick = () => this.findMatch();
        document.getElementById('leave-match').onclick = () => this.leaveMatch();
        document.getElementById('chat-input').onkeypress = (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
                this.sendChatMessage(e.target.value.trim());
                e.target.value = '';
            }
        };

        // Game controls
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }
}

// Add styles
const styles = `
    .game-container {
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 20px;
        max-width: 1200px;
        margin: 0 auto;
    }
    .game-main {
        display: grid;
        grid-template-columns: 1fr 300px;
        gap: 20px;
    }
    #game-canvas {
        width: 100%;
        height: 600px;
        background: #000;
        border-radius: 8px;
    }
    .side-panel {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }
    .leaderboard {
        background: white;
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .chat-box {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: white;
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    #chat-messages {
        flex: 1;
        overflow-y: auto;
        margin-bottom: 10px;
    }
    .leaderboard-item {
        display: flex;
        justify-content: space-between;
        padding: 5px;
        border-bottom: 1px solid #eee;
    }
    .current-player {
        background: #e3f2fd;
        font-weight: bold;
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize
const game = new MultiplayerGame();
game.init();