// VR Tour Creator - Main Application
class VRTourCreator {
  constructor() {
    this.scenes = new Map();
    this.currentScene = null;
    this.init();
  }

  async init() {
    this.setupThreeJS();
    this.setupUI();
    this.bindEvents();
    this.startRenderLoop();
  }

  setupThreeJS() {
    // Initialize Three.js components
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 1100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('vr-container').appendChild(this.renderer.domElement);

    // VR setup
    this.renderer.xr.enabled = true;
    document.body.appendChild(VRButton.createButton(this.renderer));

    // Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;
  }

  setupUI() {
    this.ui = {
      sceneUpload: document.getElementById('scene-upload'),
      sceneList: document.getElementById('scene-list'),
      hotspotTools: document.getElementById('hotspot-tools'),
      saveButton: document.getElementById('save-tour')
    };
  }

  bindEvents() {
    // Scene upload
    this.ui.sceneUpload.addEventListener('change', (e) => this.handleSceneUpload(e));
    
    // Hotspot creation
    this.renderer.domElement.addEventListener('click', (e) => this.handleHotspotPlacement(e));
    
    // Save tour
    this.ui.saveButton.addEventListener('click', () => this.saveTour());
    
    // Window resize
    window.addEventListener('resize', () => this.handleResize());
  }

  async handleSceneUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const imageUrl = await this.uploadImage(file);
      await this.createScene(imageUrl);
    } catch (error) {
      console.error('Scene upload failed:', error);
    }
  }

  async uploadImage(file) {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    return data.imageUrl;
  }

  async createScene(imageUrl) {
    const textureLoader = new THREE.TextureLoader();
    const texture = await new Promise((resolve, reject) => {
      textureLoader.load(imageUrl, resolve, undefined, reject);
    });

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const sphere = new THREE.Mesh(geometry, material);

    const sceneId = Date.now().toString();
    const sceneData = {
      id: sceneId,
      mesh: sphere,
      imageUrl,
      hotspots: new Map()
    };

    this.scenes.set(sceneId, sceneData);
    this.switchScene(sceneId);
    this.updateSceneList();
  }

  switchScene(sceneId) {
    if (this.currentScene) {
      this.scene.remove(this.scenes.get(this.currentScene).mesh);
    }

    const newScene = this.scenes.get(sceneId);
    if (newScene) {
      this.scene.add(newScene.mesh);
      this.currentScene = sceneId;
    }
  }

  handleHotspotPlacement(event) {
    if (!this.currentScene) return;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, this.camera);

    const currentSceneData = this.scenes.get(this.currentScene);
    const intersects = raycaster.intersectObject(currentSceneData.mesh);

    if (intersects.length > 0) {
      this.createHotspot(intersects[0].point);
    }
  }

  createHotspot(position) {
    const geometry = new THREE.SphereGeometry(5, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      opacity: 0.7,
      transparent: true
    });

    const hotspot = new THREE.Mesh(geometry, material);
    hotspot.position.copy(position);

    const hotspotId = Date.now().toString();
    const hotspotData = {
      id: hotspotId,
      position: position.toArray(),
      title: 'New Hotspot',
      description: 'Click to edit'
    };

    const currentScene = this.scenes.get(this.currentScene);
    currentScene.hotspots.set(hotspotId, hotspotData);
    currentScene.mesh.add(hotspot);
    
    this.openHotspotEditor(hotspotId);
  }

  openHotspotEditor(hotspotId) {
    const currentScene = this.scenes.get(this.currentScene);
    const hotspot = currentScene.hotspots.get(hotspotId);

    const editor = document.createElement('div');
    editor.className = 'hotspot-editor';
    editor.innerHTML = `
      <input type="text" value="${hotspot.title}" id="hotspot-title">
      <textarea id="hotspot-description">${hotspot.description}</textarea>
      <select id="hotspot-target">
        <option value="">Select target scene</option>
        ${Array.from(this.scenes.keys())
          .filter(id => id !== this.currentScene)
          .map(id => `<option value="${id}">Scene ${id}</option>`)
          .join('')}
      </select>
      <button onclick="vrTour.saveHotspot('${hotspotId}')">Save</button>
      <button onclick="vrTour.deleteHotspot('${hotspotId}')">Delete</button>
    `;

    document.body.appendChild(editor);
  }

  async saveTour() {
    const tourData = {
      scenes: Array.from(this.scenes.entries()).map(([id, scene]) => ({
        id,
        imageUrl: scene.imageUrl,
        hotspots: Array.from(scene.hotspots.values())
      }))
    };

    try {
      const response = await fetch('/api/tours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tourData)
      });

      const result = await response.json();
      console.log('Tour saved:', result);
    } catch (error) {
      console.error('Failed to save tour:', error);
    }
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateSceneList() {
    this.ui.sceneList.innerHTML = Array.from(this.scenes.keys())
      .map(id => `
        <div class="scene-item" onclick="vrTour.switchScene('${id}')">
          Scene ${id}
        </div>
      `).join('');
  }

  startRenderLoop() {
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }
}

// Backend Express.js server setup
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const app = express();

mongoose.connect('mongodb://localhost/vrtours', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const TourSchema = new mongoose.Schema({
  scenes: [{
    id: String,
    imageUrl: String,
    hotspots: [{
      id: String,
      position: [Number],
      title: String,
      description: String,
      targetSceneId: String
    }]
  }]
});

const Tour = mongoose.model('Tour', TourSchema);

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

app.post('/api/upload', upload.single('image'), (req, res) => {
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

app.post('/api/tours', async (req, res) => {
  try {
    const tour = new Tour(req.body);
    await tour.save();
    res.json(tour);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save tour' });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));

// Initialize the application
const vrTour = new VRTourCreator();