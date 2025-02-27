class VRTourCreator {
  constructor() {
    this.API_URL = '/api/tours';
    this.currentTour = null;
    this.currentScene = null;
    this.scenes = new Map();
    this.hotspots = new Map();
    this.isEditing = false;
    
    this.init();
  }

  async init() {
    this.initializeThreeJS();
    this.initializeUI();
    this.setupEventListeners();
    this.setupVRControls();
    await this.loadTour();
  }

  initializeThreeJS() {
    // Set up Three.js scene
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75, 
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('vr-container').appendChild(this.renderer.domElement);

    // Add camera controls
    this.controls = new THREE.OrbitControls(
      this.camera,
      this.renderer.domElement
    );
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = -0.5;

    // VR setup
    this.renderer.xr.enabled = true;
    document.body.appendChild(
      VRButton.createButton(this.renderer)
    );
  }

  initializeUI() {
    this.elements = {
      sceneList: document.getElementById('scene-list'),
      hotspotPanel: document.getElementById('hotspot-panel'),
      uploadForm: document.getElementById('upload-form'),
      tourSettings: document.getElementById('tour-settings'),
      editControls: document.getElementById('edit-controls'),
      previewMode: document.getElementById('preview-mode')
    };

    // Initialize UI components
    this.initializeHotspotEditor();
    this.initializeSceneManager();
  }

  initializeHotspotEditor() {
    this.hotspotEditor = {
      raycaster: new THREE.Raycaster(),
      mouse: new THREE.Vector2(),
      selectedHotspot: null,
      isPlacing: false
    };
  }

  setupEventListeners() {
    // Scene navigation
    this.elements.sceneList.addEventListener('click', (e) => {
      if (e.target.dataset.sceneId) {
        this.switchScene(e.target.dataset.sceneId);
      }
    });

    // Hotspot placement
    this.renderer.domElement.addEventListener('click', (e) => {
      if (this.isEditing && this.hotspotEditor.isPlacing) {
        this.placeHotspot(e);
      }
    });

    // Mouse move for hotspot hover
    this.renderer.domElement.addEventListener('mousemove', (e) => {
      this.updateMousePosition(e);
    });

    // Window resize
    window.addEventListener('resize', () => {
      this.handleResize();
    });

    // Upload form
    this.elements.uploadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSceneUpload();
    });
  }

  setupVRControls() {
    // VR Controller setup
    this.controller1 = this.renderer.xr.getController(0);
    this.controller1.addEventListener('select', () => {
      this.handleVRSelect();
    });
    this.scene.add(this.controller1);

    // Controller helper
    const controllerModelFactory = new THREE.XRControllerModelFactory();
    this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
    this.controllerGrip1.add(
      controllerModelFactory.createControllerModel(this.controllerGrip1)
    );
    this.scene.add(this.controllerGrip1);
  }

  async loadTour() {
    const tourId = this.getTourIdFromUrl();
    if (tourId) {
      try {
        const response = await fetch(`${this.API_URL}/${tourId}`);
        this.currentTour = await response.json();
        await this.loadScenes();
      } catch (error) {
        this.showError('Failed to load tour');
      }
    }
  }

  async loadScenes() {
    for (const scene of this.currentTour.scenes) {
      await this.loadScene(scene);
    }
    
    if (this.currentTour.scenes.length > 0) {
      this.switchScene(this.currentTour.scenes[0].id);
    }
  }

  async loadScene(sceneData) {
    try {
      const textureLoader = new THREE.TextureLoader();
      const texture = await new Promise((resolve, reject) => {
        textureLoader.load(
          sceneData.imageUrl,
          resolve,
          undefined,
          reject
        );
      });

      const geometry = new THREE.SphereGeometry(500, 60, 40);
      geometry.scale(-1, 1, 1); // Invert the sphere

      const material = new THREE.MeshBasicMaterial({
        map: texture
      });

      const sphere = new THREE.Mesh(geometry, material);
      
      const scene = {
        id: sceneData.id,
        mesh: sphere,
        hotspots: new Map(),
        data: sceneData
      };

      this.scenes.set(sceneData.id, scene);
      await this.loadHotspots(scene);
      this.updateSceneList();
    } catch (error) {
      this.showError(`Failed to load scene: ${sceneData.name}`);
    }
  }

  async loadHotspots(scene) {
    for (const hotspotData of scene.data.hotspots) {
      this.createHotspot(scene, hotspotData);
    }
  }

  createHotspot(scene, hotspotData) {
    const geometry = new THREE.SphereGeometry(5, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      opacity: 0.7,
      transparent: true
    });

    const hotspot = new THREE.Mesh(geometry, material);
    hotspot.position.copy(hotspotData.position);
    hotspot.userData = {
      id: hotspotData.id,
      type: hotspotData.type,
      content: hotspotData.content,
      targetSceneId: hotspotData.targetSceneId
    };

    scene.hotspots.set(hotspotData.id, hotspot);
    scene.mesh.add(hotspot);
  }

  switchScene(sceneId) {
    if (this.currentScene) {
      this.scene.remove(this.currentScene.mesh);
    }

    const newScene = this.scenes.get(sceneId);
    if (newScene) {
      this.scene.add(newScene.mesh);
      this.currentScene = newScene;
      this.updateUI();
    }
  }

  async handleSceneUpload() {
    const formData = new FormData(this.elements.uploadForm);
    const file = formData.get('scene-image');
    
    if (!this.validateImage(file)) {
      return;
    }

    try {
      const imageUrl = await this.uploadImage(file);
      const sceneData = {
        name: formData.get('scene-name'),
        imageUrl,
        hotspots: []
      };

      const response = await fetch(`${this.API_URL}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sceneData)
      });

      const newScene = await response.json();
      await this.loadScene(newScene);
      this.showSuccess('Scene added successfully');
    } catch (error) {
      this.showError('Failed to upload scene');
    }
  }

  validateImage(file) {
    if (!file.type.startsWith('image/')) {
      this.showError('Please upload an image file');
      return false;
    }

    if (file.size > 20 * 1024 * 1024) { // 20MB limit
      this.showError('Image size should be less than 20MB');
      return false;
    }

    return true;
  }

  async uploadImage(file) {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`${this.API_URL}/upload`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Image upload failed');
    }

    const data = await response.json();
    return data.imageUrl;
  }

  placeHotspot(event) {
    this.hotspotEditor.raycaster.setFromCamera(
      this.hotspotEditor.mouse,
      this.camera
    );

    const intersects = this.hotspotEditor.raycaster.intersectObject(
      this.currentScene.mesh
    );

    if (intersects.length > 0) {
      const position = intersects[0].point;
      const hotspotData = {
        id: `hotspot-${Date.now()}`,
        position: position.clone(),
        type: this.hotspotEditor.currentType,
        content: '',
        targetSceneId: null
      };

      this.createHotspot(this.currentScene, hotspotData);
      this.openHotspotEditor(hotspotData.id);
    }
  }

  openHotspotEditor(hotspotId) {
    const hotspot = this.currentScene.hotspots.get(hotspotId);
    if (!hotspot) return;

    this.elements.hotspotPanel.innerHTML = `
      <div class="hotspot-editor">
        <h3>Edit Hotspot</h3>
        <select id="hotspot-type">
          <option value="info">Information</option>
          <option value="link">Scene Link</option>
        </select>
        <textarea id="hotspot-content">${hotspot.userData.content}</textarea>
        ${hotspot.userData.type === 'link' ? `
          <select id="target-scene">
            ${Array.from(this.scenes.values())
              .filter(scene => scene.id !== this.currentScene.id)
              .map(scene => `
                <option value="${scene.id}"
                  ${scene.id === hotspot.userData.targetSceneId ? 'selected' : ''}>
                  ${scene.data.name}
                </option>
              `).join('')}
          </select>
        ` : ''}
        <button onclick="vrTour.saveHotspot('${hotspotId}')">Save</button>
        <button onclick="vrTour.deleteHotspot('${hotspotId}')">Delete</button>
      </div>
    `;

    this.elements.hotspotPanel.style.display = 'block';
  }

  async saveHotspot(hotspotId) {
    const hotspot = this.currentScene.hotspots.get(hotspotId);
    if (!hotspot) return;

    const type = document.getElementById('hotspot-type').value;
    const content = document.getElementById('hotspot-content').value;
    const targetSceneId = type === 'link' ?
      document.getElementById('target-scene').value : null;

    hotspot.userData = {
      ...hotspot.userData,
      type,
      content,
      targetSceneId
    };

    try {
      await this.saveTourData();
      this.elements.hotspotPanel.style.display = 'none';
      this.showSuccess('Hotspot saved');
    } catch (error) {
      this.showError('Failed to save hotspot');
    }
  }

  async deleteHotspot(hotspotId) {
    const hotspot = this.currentScene.hotspots.get(hotspotId);
    if (!hotspot) return;

    this.currentScene.mesh.remove(hotspot);
    this.currentScene.hotspots.delete(hotspotId);

    try {
      await this.saveTourData();
      this.elements.hotspotPanel.style.display = 'none';
      this.showSuccess('Hotspot deleted');
    } catch (error) {
      this.showError('Failed to delete hotspot');
    }
  }

  async saveTourData() {
    const tourData = {
      ...this.currentTour,
      scenes: Array.from(this.scenes.values()).map(scene => ({
        ...scene.data,
        hotspots: Array.from(scene.hotspots.values()).map(hotspot => ({
          id: hotspot.userData.id,
          type: hotspot.userData.type,
          content: hotspot.userData.content,
          targetSceneId: hotspot.userData.targetSceneId,
          position: hotspot.position.toArray()
        }))
      }))
    };

    const response = await fetch(`${this.API_URL}/${this.currentTour.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tourData)
    });

    if (!response.ok) {
      throw new Error('Failed to save tour data');
    }
  }

  handleVRSelect() {
    if (!this.currentScene) return;

    const controller = this.controller1;
    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(controller.matrixWorld);

    const intersects = raycaster.intersectObjects(
      Array.from(this.currentScene.hotspots.values())
    );

    if (intersects.length > 0) {
      const hotspot = intersects[0].object;
      this.activateHotspot(hotspot);
    }
  }

  activateHotspot(hotspot) {
    if (hotspot.userData.type === 'link' && hotspot.userData.targetSceneId) {
      this.switchScene(hotspot.userData.targetSceneId);
    } else {
      this.showHotspotInfo(hotspot);
    }
  }

  showHotspotInfo(hotspot) {
    const infoPanel = document.createElement('div');
    infoPanel.className = 'hotspot-info';
    infoPanel.innerHTML = `
      <div class="info-content">
        ${hotspot.userData.content}
      </div>
      <button onclick="this.parentElement.remove()">Close</button>
    `;

    document.body.appendChild(infoPanel);
  }

  updateMousePosition(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.hotspotEditor.mouse.x = (
      (event.clientX - rect.left) / rect.width
    ) * 2 - 1;
    this.hotspotEditor.mouse.y = -(
      (event.clientY - rect.top) / rect.height
    ) * 2 + 1;
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  showError(message) {
    // Implement error notification
  }

  showSuccess(message) {
    // Implement success notification
  }

  getT