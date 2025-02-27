class ARGame {
  constructor() {
    this.gameState = new GameStateManager();
    this.assetManager = new AssetManager();
    this.sceneManager = new SceneManager();
    this.playerManager = new PlayerManager();
    this.physics = new PhysicsEngine();
    
    this.init();
  }

  async init() {
    await this.assetManager.loadAssets();
    this.setupScene();
    this.setupEventListeners();
    this.startGameLoop();
  }

  setupScene() {
    this.scene = document.createElement('a-scene');
    this.scene.setAttribute('arjs', 'trackingMethod: best;');
    this.scene.setAttribute('embedded', '');
    this.scene.setAttribute('vr-mode-ui', 'enabled: false');
    
    document.body.appendChild(this.scene);
    this.sceneManager.initialize(this.scene);
  }

  setupEventListeners() {
    window.addEventListener('markerFound', () => {
      this.gameState.setMarkerVisible(true);
      this.onMarkerFound();
    });

    window.addEventListener('markerLost', () => {
      this.gameState.setMarkerVisible(false);
      this.onMarkerLost();
    });

    document.addEventListener('click', (event) => {
      this.handleInteraction(event);
    });
  }

  startGameLoop() {
    this.gameLoop = setInterval(() => {
      this.update();
    }, 1000 / 60); // 60 FPS
  }
}

class GameStateManager {
  constructor() {
    this.state = {
      score: 0,
      level: 1,
      gameStarted: false,
      markerVisible: false,
      playerHealth: 100,
      collectibles: new Set(),
      enemies: new Map(),
      customizations: new Map()
    };

    this.listeners = new Map();
  }

  setState(key, value) {
    this.state[key] = value;
    this.notifyListeners(key, value);
  }

  getState(key) {
    return this.state[key];
  }

  addListener(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);
  }

  notifyListeners(key, value) {
    if (this.listeners.has(key)) {
      this.listeners.get(key).forEach(callback => callback(value));
    }
  }

  saveGame() {
    localStorage.setItem('arGameState', JSON.stringify(this.state));
  }

  loadGame() {
    const savedState = localStorage.getItem('arGameState');
    if (savedState) {
      this.state = { ...this.state, ...JSON.parse(savedState) };
    }
  }
}

class AssetManager {
  constructor() {
    this.assets = new Map();
    this.loadingPromises = [];
  }

  async loadAssets() {
    const assetList = [
      { id: 'player', type: 'model', url: 'models/player.gltf' },
      { id: 'enemy', type: 'model', url: 'models/enemy.gltf' },
      { id: 'collectible', type: 'model', url: 'models/collectible.gltf' },
      { id: 'environment', type: 'model', url: 'models/environment.gltf' }
    ];

    for (const asset of assetList) {
      this.loadingPromises.push(this.loadAsset(asset));
    }

    await Promise.all(this.loadingPromises);
  }

  async loadAsset(asset) {
    try {
      const response = await fetch(asset.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      this.assets.set(asset.id, {
        type: asset.type,
        url: url
      });
    } catch (error) {
      console.error(`Failed to load asset ${asset.id}:`, error);
    }
  }

  getAsset(id) {
    return this.assets.get(id);
  }
}

class SceneManager {
  constructor() {
    this.entities = new Map();
    this.customElements = new Map();
  }

  initialize(scene) {
    this.scene = scene;
    this.setupCamera();
    this.setupLighting();
    this.setupMarker();
  }

  setupCamera() {
    const camera = document.createElement('a-entity');
    camera.setAttribute('camera', '');
    camera.setAttribute('position', '0 1.6 0');
    this.scene.appendChild(camera);
  }

  setupLighting() {
    const light = document.createElement('a-light');
    light.setAttribute('type', 'ambient');
    light.setAttribute('color', '#FFF');
    light.setAttribute('intensity', '0.8');
    this.scene.appendChild(light);
  }

  setupMarker() {
    const marker = document.createElement('a-marker');
    marker.setAttribute('preset', 'custom');
    marker.setAttribute('type', 'pattern');
    marker.setAttribute('url', 'markers/game-marker.patt');
    this.scene.appendChild(marker);
    this.marker = marker;
  }

  createEntity(config) {
    const entity = document.createElement('a-entity');
    
    Object.entries(config.attributes).forEach(([key, value]) => {
      entity.setAttribute(key, value);
    });

    if (config.parent) {
      config.parent.appendChild(entity);
    } else {
      this.marker.appendChild(entity);
    }

    this.entities.set(config.id, entity);
    return entity;
  }

  updateEntity(id, updates) {
    const entity = this.entities.get(id);
    if (entity) {
      Object.entries(updates).forEach(([key, value]) => {
        entity.setAttribute(key, value);
      });
    }
  }

  removeEntity(id) {
    const entity = this.entities.get(id);
    if (entity) {
      entity.parentNode.removeChild(entity);
      this.entities.delete(id);
    }
  }
}

class PlayerManager {
  constructor(gameState) {
    this.gameState = gameState;
    this.position = { x: 0, y: 0, z: 0 };
    this.inventory = new Map();
  }

  createPlayer(position) {
    return {
      id: 'player',
      attributes: {
        position: `${position.x} ${position.y} ${position.z}`,
        'gltf-model': '#player-model',
        animation: {
          property: 'position',
          dur: 1000,
          easing: 'easeInOutQuad'
        }
      }
    };
  }

  movePlayer(direction) {
    const speed = 0.1;
    const newPosition = { ...this.position };

    switch (direction) {
      case 'forward':
        newPosition.z -= speed;
        break;
      case 'backward':
        newPosition.z += speed;
        break;
      case 'left':
        newPosition.x -= speed;
        break;
      case 'right':
        newPosition.x += speed;
        break;
    }

    if (this.physics.checkCollision(newPosition)) {
      return;
    }

    this.position = newPosition;
    this.updatePlayerPosition();
  }

  updatePlayerPosition() {
    this.sceneManager.updateEntity('player', {
      position: `${this.position.x} ${this.position.y} ${this.position.z}`
    });
  }

  collectItem(item) {
    const count = this.inventory.get(item.type) || 0;
    this.inventory.set(item.type, count + 1);
    this.gameState.setState('score', this.gameState.getState('score') + item.points);
  }
}

class PhysicsEngine {
  constructor() {
    this.colliders = new Set();
  }

  addCollider(entity) {
    this.colliders.add({
      id: entity.id,
      bounds: this.calculateBounds(entity)
    });
  }

  removeCollider(entityId) {
    this.colliders.delete(entityId);
  }

  checkCollision(position) {
    for (const collider of this.colliders) {
      if (this.intersects(position, collider.bounds)) {
        return true;
      }
    }
    return false;
  }

  calculateBounds(entity) {
    const position = entity.getAttribute('position');
    const scale = entity.getAttribute('scale');
    
    return {
      min: {
        x: position.x - (scale.x / 2),
        y: position.y - (scale.y / 2),
        z: position.z - (scale.z / 2)
      },
      max: {
        x: position.x + (scale.x / 2),
        y: position.y + (scale.y / 2),
        z: position.z + (scale.z / 2)
      }
    };
  }

  intersects(position, bounds) {
    return position.x >= bounds.min.x && position.x <= bounds.max.x &&
           position.y >= bounds.min.y && position.y <= bounds.max.y &&
           position.z >= bounds.min.z && position.z <= bounds.max.z;
  }
}

class CustomizationManager {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.customizations = new Map();
  }

  addCustomization(type, config) {
    const customization = {
      id: Date.now().toString(),
      type,
      config
    };

    this.customizations.set(customization.id, customization);
    this.applyCustomization(customization);
    return customization.id;
  }

  applyCustomization(customization) {
    switch (customization.type) {
      case 'texture':
        this.applyTexture(customization.config);
        break;
      case 'model':
        this.addCustomModel(customization.config);
        break;
      case 'animation':
        this.addAnimation(customization.config);
        break;
    }
  }

  applyTexture(config) {
    const entity = this.sceneManager.entities.get(config.targetId);
    if (entity) {
      entity.setAttribute('material', {
        src: config.textureUrl,
        repeat: config.repeat || '1 1'
      });
    }
  }

  addCustomModel(config) {
    this.sceneManager.createEntity({
      id: config.id,
      attributes: {
        position: config.position,
        scale: config.scale,
        'gltf-model': config.modelUrl
      }
    });
  }

  addAnimation(config) {
    const entity = this.sceneManager.entities.get(config.targetId);
    if (entity) {
      entity.setAttribute('animation', {
        property: config.property,
        from: config.from,
        to: config.to,
        dur: config.duration,
        loop: config.loop
      });
    }
  }
}

// Initialize game
const arGame = new ARGame();