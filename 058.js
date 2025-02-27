class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.score = 0;
    this.level = 1;
    this.lives = 3;
    this.entities = new Map();
    this.isRunning = false;
    this.lastTime = 0;
    
    this.init();
  }

  init() {
    this.setupCanvas();
    this.loadAssets();
    this.setupControls();
    this.setupGameState();
    this.initializeUI();
  }

  setupCanvas() {
    // Make canvas responsive
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Enable retina display support
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.ctx.scale(dpr, dpr);
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  async loadAssets() {
    this.assets = new Map();
    const assetList = [
      { id: 'player', src: 'assets/player.png' },
      { id: 'enemy', src: 'assets/enemy.png' },
      { id: 'background', src: 'assets/background.png' },
      { id: 'powerup', src: 'assets/powerup.png' }
    ];

    try {
      await Promise.all(assetList.map(asset => 
        this.loadImage(asset.id, asset.src)
      ));
    } catch (error) {
      console.error('Failed to load assets:', error);
    }
  }

  loadImage(id, src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.assets.set(id, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }

  setupControls() {
    // Keyboard controls
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.key));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));

    // Touch controls
    this.touchControls = new TouchControls(this.canvas);
    
    // Gamepad support
    this.gamepad = new GamepadControls();
  }

  setupGameState() {
    this.player = new Player({
      x: this.canvas.width / 2,
      y: this.canvas.height - 100,
      width: 50,
      height: 50,
      speed: 5,
      sprite: this.assets.get('player')
    });

    this.entities.set('player', this.player);
    this.spawnEnemies();
  }

  spawnEnemies() {
    const enemyCount = 5 + this.level * 2;
    
    for (let i = 0; i < enemyCount; i++) {
      const enemy = new Enemy({
        x: Math.random() * (this.canvas.width - 50),
        y: -100 - (Math.random() * 500),
        width: 40,
        height: 40,
        speed: 2 + (this.level * 0.5),
        sprite: this.assets.get('enemy')
      });
      
      this.entities.set(`enemy-${i}`, enemy);
    }
  }

  start() {
    if (!this.isRunning) {
      this.isRunning = true;
      this.lastTime = performance.now();
      requestAnimationFrame((time) => this.gameLoop(time));
    }
  }

  pause() {
    this.isRunning = false;
  }

  gameLoop(currentTime) {
    if (!this.isRunning) return;

    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    this.update(deltaTime);
    this.render();

    requestAnimationFrame((time) => this.gameLoop(time));
  }

  update(deltaTime) {
    this.handleInput();
    this.updateEntities(deltaTime);
    this.checkCollisions();
    this.checkGameState();
  }

  handleInput() {
    // Keyboard input
    if (this.keys.has('ArrowLeft')) this.player.moveLeft();
    if (this.keys.has('ArrowRight')) this.player.moveRight();
    if (this.keys.has(' ')) this.player.shoot();

    // Touch input
    const touch = this.touchControls.getInput();
    if (touch.left) this.player.moveLeft();
    if (touch.right) this.player.moveRight();
    if (touch.tap) this.player.shoot();

    // Gamepad input
    const gamepad = this.gamepad.getInput();
    if (gamepad.left) this.player.moveLeft();
    if (gamepad.right) this.player.moveRight();
    if (gamepad.buttons[0]) this.player.shoot();
  }

  updateEntities(deltaTime) {
    this.entities.forEach(entity => {
      entity.update(deltaTime);
      
      // Remove entities that are out of bounds
      if (entity.isOutOfBounds(this.canvas.width, this.canvas.height)) {
        this.entities.delete(entity.id);
      }
    });
  }

  checkCollisions() {
    const player = this.entities.get('player');
    const playerBounds = player.getBounds();

    this.entities.forEach(entity => {
      if (entity instanceof Enemy) {
        const enemyBounds = entity.getBounds();
        
        if (this.checkCollision(playerBounds, enemyBounds)) {
          this.handleCollision(player, entity);
        }

        // Check bullet collisions
        player.bullets.forEach(bullet => {
          const bulletBounds = bullet.getBounds();
          if (this.checkCollision(bulletBounds, enemyBounds)) {
            this.handleBulletHit(bullet, entity);
          }
        });
      }
    });
  }

  checkCollision(bounds1, bounds2) {
    return bounds1.x < bounds2.x + bounds2.width &&
           bounds1.x + bounds1.width > bounds2.x &&
           bounds1.y < bounds2.y + bounds2.height &&
           bounds1.y + bounds1.height > bounds2.y;
  }

  handleCollision(player, enemy) {
    this.lives--;
    this.entities.delete(enemy.id);
    
    if (this.lives <= 0) {
      this.gameOver();
    } else {
      this.player.reset();
    }
  }

  handleBulletHit(bullet, enemy) {
    this.score += 100;
    this.player.bullets.delete(bullet.id);
    this.entities.delete(enemy.id);
    
    this.createExplosion(enemy.x, enemy.y);
    
    if (this.checkLevelComplete()) {
      this.nextLevel();
    }
  }

  createExplosion(x, y) {
    const explosion = new Explosion({
      x,
      y,
      width: 60,
      height: 60
    });
    
    this.entities.set(`explosion-${Date.now()}`, explosion);
  }

  checkLevelComplete() {
    return Array.from(this.entities.values())
      .filter(entity => entity instanceof Enemy).length === 0;
  }

  nextLevel() {
    this.level++;
    this.spawnEnemies();
    this.player.powerUp();
  }

  gameOver() {
    this.isRunning = false;
    this.showGameOver();
  }

  render() {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw background
    this.drawBackground();

    // Draw entities
    this.entities.forEach(entity => entity.render(this.ctx));

    // Draw UI
    this.drawUI();
  }

  drawBackground() {
    const background = this.assets.get('background');
    this.ctx.drawImage(
      background,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
  }

  drawUI() {
    // Draw score
    this.ctx.font = '24px Arial';
    this.ctx.fillStyle = 'white';
    this.ctx.fillText(`Score: ${this.score}`, 20, 40);

    // Draw lives
    this.ctx.fillText(`Lives: ${this.lives}`, 20, 70);

    // Draw level
    this.ctx.fillText(`Level: ${this.level}`, 20, 100);
  }

  showGameOver() {
    const modal = document.createElement('div');
    modal.className = 'game-over-modal';
    modal.innerHTML = `
      <h2>Game Over</h2>
      <p>Score: ${this.score}</p>
      <p>Level: ${this.level}</p>
      <button onclick="game.restart()">Play Again</button>
    `;
    document.body.appendChild(modal);
  }

  restart() {
    document.querySelector('.game-over-modal')?.remove();
    this.score = 0;
    this.level = 1;
    this.lives = 3;
    this.entities.clear();
    this.setupGameState();
    this.start();
  }
}

class Entity {
  constructor({ x, y, width, height, speed = 0, sprite = null }) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.speed = speed;
    this.sprite = sprite;
    this.id = `entity-${Date.now()}-${Math.random()}`;
  }

  update(deltaTime) {
    // Base update logic
  }

  render(ctx) {
    if (this.sprite) {
      ctx.drawImage(this.sprite, this.x, this.y, this.width, this.height);
    } else {
      ctx.fillStyle = 'red';
      ctx.fillRect(this.x, this.y, this.width, this.height);
    }
  }

  getBounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height
    };
  }

  isOutOfBounds(canvasWidth, canvasHeight) {
    return this.x < -this.width ||
           this.x > canvasWidth ||
           this.y < -this.height ||
           this.y > canvasHeight;
  }
}

class Player extends Entity {
  constructor(config) {
    super(config);
    this.bullets = new Set();
    this.lastShot = 0;
    this.shootDelay = 250; // milliseconds
  }

  moveLeft() {