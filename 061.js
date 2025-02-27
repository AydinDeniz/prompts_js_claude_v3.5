class ARShoppingExperience {
  constructor() {
    this.products = new Map();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.session = null;
    this.reticle = null;
    this.selectedProduct = null;
    this.placedObjects = new Map();
    
    this.init();
  }

  async init() {
    await this.checkXRSupport();
    this.setupThreeJS();
    this.initializeUI();
    await this.loadProducts();
    this.setupEventListeners();
  }

  async checkXRSupport() {
    if (!navigator.xr) {
      throw new Error('WebXR not supported');
    }

    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) {
        throw new Error('AR not supported');
      }
    } catch (error) {
      console.error('AR support check failed:', error);
      this.showARSupportError();
    }
  }

  setupThreeJS() {
    // Initialize Three.js scene
    this.scene = new THREE.Scene();

    // Setup camera
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20
    );

    // Setup renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.xr.enabled = true;

    // Add lighting
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    this.scene.add(light);

    // Create reticle for placement
    this.createReticle();
  }

  createReticle() {
    const geometry = new THREE.RingGeometry(0.15, 0.2, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      opacity: 0.5,
      transparent: true
    });
    this.reticle = new THREE.Mesh(geometry, material);
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  initializeUI() {
    this.elements = {
      productList: document.getElementById('product-list'),
      arView: document.getElementById('ar-view'),
      controls: document.getElementById('ar-controls'),
      productInfo: document.getElementById('product-info')
    };

    document.body.appendChild(this.renderer.domElement);
  }

  async loadProducts() {
    try {
      const response = await fetch('/api/products');
      const products = await response.json();
      
      products.forEach(product => {
        this.products.set(product.id, product);
      });

      await this.preloadModels();
      this.updateProductList();
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  }

  async preloadModels() {
    const loader = new THREE.GLTFLoader();
    
    for (const [id, product] of this.products) {
      try {
        const gltf = await loader.loadAsync(product.modelUrl);
        product.model = gltf.scene;
        this.setupModel(product.model);
      } catch (error) {
        console.error(`Failed to load model for product ${id}:`, error);
      }
    }
  }

  setupModel(model) {
    model.scale.set(1, 1, 1);
    model.position.set(0, 0, 0);
    model.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
  }

  setupEventListeners() {
    this.elements.productList.addEventListener('click', (e) => {
      if (e.target.dataset.productId) {
        this.selectProduct(e.target.dataset.productId);
      }
    });

    this.renderer.domElement.addEventListener('click', (e) => {
      this.handleCanvasClick(e);
    });

    window.addEventListener('resize', () => {
      this.onWindowResize();
    });

    document.getElementById('start-ar').addEventListener('click', () => {
      this.startARSession();
    });
  }

  async startARSession() {
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: this.elements.arView }
      });

      session.addEventListener('end', () => {
        this.onSessionEnd();
      });

      await this.renderer.xr.setSession(session);
      this.session = session;

      this.setupHitTesting();
      this.session.requestAnimationFrame((time, frame) => 
        this.onXRFrame(time, frame)
      );
    } catch (error) {
      console.error('Failed to start AR session:', error);
    }
  }

  setupHitTesting() {
    this.xrHitTestSource = null;

    this.session.requestReferenceSpace('viewer').then((referenceSpace) => {
      this.session.requestHitTestSource({
        space: referenceSpace
      }).then((source) => {
        this.xrHitTestSource = source;
      });
    });
  }

  onXRFrame(time, frame) {
    const session = frame.session;
    const referenceSpace = this.renderer.xr.getReferenceSpace();

    // Update reticle position
    if (this.xrHitTestSource) {
      const hitTestResults = frame.getHitTestResults(this.xrHitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);
        this.reticle.visible = true;
        this.reticle.position.set(
          pose.transform.position.x,
          pose.transform.position.y,
          pose.transform.position.z
        );
        this.reticle.updateMatrixWorld(true);
      } else {
        this.reticle.visible = false;
      }
    }

    // Render frame
    this.renderer.render(this.scene, this.camera);
    session.requestAnimationFrame((t, f) => this.onXRFrame(t, f));
  }

  selectProduct(productId) {
    const product = this.products.get(productId);
    if (!product) return;

    this.selectedProduct = product;
    this.updateProductInfo(product);
  }

  updateProductInfo(product) {
    this.elements.productInfo.innerHTML = `
      <div class="product-details">
        <h2>${product.name}</h2>
        <p>${product.description}</p>
        <div class="product-dimensions">
          <span>Width: ${product.dimensions.width}cm</span>
          <span>Height: ${product.dimensions.height}cm</span>
          <span>Depth: ${product.dimensions.depth}cm</span>
        </div>
        <div class="product-price">$${product.price}</div>
      </div>
    `;
  }

  async handleCanvasClick(event) {
    if (!this.session || !this.selectedProduct) return;

    if (this.reticle.visible) {
      const model = this.selectedProduct.model.clone();
      model.position.copy(this.reticle.position);
      this.scene.add(model);

      const placedObject = {
        id: `placed-${Date.now()}`,
        model,
        product: this.selectedProduct,
        position: model.position.clone()
      };

      this.placedObjects.set(placedObject.id, placedObject);
      this.createManipulationControls(placedObject);
    }
  }

  createManipulationControls(placedObject) {
    const controls = new THREE.TransformControls(
      this.camera,
      this.renderer.domElement
    );
    controls.attach(placedObject.model);
    this.scene.add(controls);

    controls.addEventListener('dragging-changed', (event) => {
      this.renderer.domElement.style.cursor = event.value ? 'grabbing' : 'grab';
    });

    placedObject.controls = controls;
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  onSessionEnd() {
    this.session = null;
    this.xrHitTestSource = null;
    this.reticle.visible = false;
  }

  updateProductList() {
    this.elements.productList.innerHTML = Array.from(this.products.values())
      .map(product => `
        <div class="product-card" data-product-id="${product.id}">
          <img src="${product.thumbnail}" alt="${product.name}">
          <h3>${product.name}</h3>
          <p>${product.price}</p>
          <button onclick="arShop.selectProduct('${product.id}')">
            View in AR
          </button>
        </div>
      `).join('');
  }

  showARSupportError() {
    const error = document.createElement('div');
    error.className = 'ar-support-error';
    error.innerHTML = `
      <h2>AR Not Supported</h2>
      <p>Your device does not support Augmented Reality features.</p>
      <p>Please try using a compatible device with AR support.</p>
    `;
    document.body.appendChild(error);
  }
}

// Initialize AR shopping experience
const arShop = new ARShoppingExperience();