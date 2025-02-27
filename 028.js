// AR Shopping Application

// Main AR Application Class
class ARShoppingExperience {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.session = null;
    this.reticle = null;
    this.products = new Map();
    this.selectedProduct = null;
    this.placedObjects = [];
    
    this.init();
  }

  async init() {
    await this.checkXRSupport();
    this.initializeThreeJS();
    this.setupScene();
    this.setupLights();
    this.setupEventListeners();
    await this.loadProducts();
  }

  async checkXRSupport() {
    if (!navigator.xr) {
      throw new Error('WebXR not supported');
    }

    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) {
      throw new Error('Immersive AR not supported');
    }
  }

  initializeThreeJS() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;

    document.body.appendChild(this.renderer.domElement);
  }

  setupScene() {
    // Create reticle for placement
    const geometry = new THREE.RingGeometry(0.15, 0.2, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide
    });
    this.reticle = new THREE.Mesh(geometry, material);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // Setup hit testing
    this.setupHitTesting();
  }

  setupLights() {
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    this.scene.add(light);
  }

  setupEventListeners() {
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // AR session buttons
    document.getElementById('start-ar').addEventListener('click', () => {
      this.startARSession();
    });

    document.getElementById('place-object').addEventListener('click', () => {
      if (this.selectedProduct) {
        this.placeObject();
      }
    });

    // Product selection
    document.getElementById('product-list').addEventListener('click', (event) => {
      if (event.target.dataset.productId) {
        this.selectProduct(event.target.dataset.productId);
      }
    });
  }

  async loadProducts() {
    try {
      const response = await fetch('/api/products');
      const products = await response.json();
      
      products.forEach(product => {
        this.products.set(product.id, product);
        this.loadProductModel(product);
      });

      this.updateProductList();
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  }

  async loadProductModel(product) {
    const loader = new THREE.GLTFLoader();
    try {
      const gltf = await loader.loadAsync(product.modelUrl);
      product.model = gltf.scene;
      product.model.scale.set(product.scale, product.scale, product.scale);
    } catch (error) {
      console.error(`Failed to load model for ${product.name}:`, error);
    }
  }

  async startARSession() {
    try {
      this.session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.getElementById('ar-overlay') }
      });

      this.session.addEventListener('end', () => {
        this.endARSession();
      });

      await this.renderer.xr.setSession(this.session);
      this.renderer.setAnimationLoop(this.render.bind(this));
    } catch (error) {
      console.error('Failed to start AR session:', error);
    }
  }

  setupHitTesting() {
    this.session.requestReferenceSpace('viewer').then((referenceSpace) => {
      this.session.requestHitTestSource({
        space: referenceSpace
      }).then((source) => {
        this.hitTestSource = source;
      });
    });
  }

  render(timestamp, frame) {
    if (!frame) return;

    const referenceSpace = this.renderer.xr.getReferenceSpace();
    const hitTestResults = frame.getHitTestResults(this.hitTestSource);

    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(referenceSpace);

      this.reticle.visible = true;
      this.reticle.matrix.fromArray(pose.transform.matrix);
    } else {
      this.reticle.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
  }

  placeObject() {
    if (!this.reticle.visible || !this.selectedProduct) return;

    const product = this.products.get(this.selectedProduct);
    const model = product.model.clone();
    
    model.position.setFromMatrixPosition(this.reticle.matrix);
    model.quaternion.setFromRotationMatrix(this.reticle.matrix);
    
    this.scene.add(model);
    this.placedObjects.push({
      id: this.selectedProduct,
      model: model
    });

    this.addInteractionHelper(model);
  }

  addInteractionHelper(model) {
    const helper = new THREE.BoxHelper(model, 0xffff00);
    helper.visible = false;
    this.scene.add(helper);

    model.userData.helper = helper;
    model.userData.selected = false;

    model.addEventListener('select', () => {
      model.userData.selected = !model.userData.selected;
      helper.visible = model.userData.selected;
      
      if (model.userData.selected) {
        this.showObjectControls(model);
      } else {
        this.hideObjectControls();
      }
    });
  }

  showObjectControls(model) {
    const controls = document.getElementById('object-controls');
    controls.style.display = 'block';

    document.getElementById('rotate-left').onclick = () => {
      model.rotation.y -= Math.PI / 4;
    };

    document.getElementById('rotate-right').onclick = () => {
      model.rotation.y += Math.PI / 4;
    };

    document.getElementById('move-closer').onclick = () => {
      model.position.z -= 0.1;
    };

    document.getElementById('move-farther').onclick = () => {
      model.position.z += 0.1;
    };

    document.getElementById('remove-object').onclick = () => {
      this.removeObject(model);
    };
  }

  removeObject(model) {
    this.scene.remove(model);
    this.scene.remove(model.userData.helper);
    this.placedObjects = this.placedObjects.filter(obj => obj.model !== model);
    this.hideObjectControls();
  }

  hideObjectControls() {
    document.getElementById('object-controls').style.display = 'none';
  }

  selectProduct(productId) {
    this.selectedProduct = productId;
    this.updateProductInfo();
  }

  updateProductInfo() {
    const product = this.products.get(this.selectedProduct);
    const infoPanel = document.getElementById('product-info');
    
    infoPanel.innerHTML = `
      <h2>${product.name}</h2>
      <p>${product.description}</p>
      <p class="price">$${product.price}</p>
      <button onclick="arExperience.addToCart('${product.id}')">
        Add to Cart
      </button>
    `;
  }

  async addToCart(productId) {
    try {
      const response = await fetch('/api/cart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          productId,
          quantity: 1
        })
      });

      if (response.ok) {
        this.showNotification('Product added to cart');
      }
    } catch (error) {
      console.error('Failed to add to cart:', error);
    }
  }

  takeSnapshot() {
    const canvas = this.renderer.domElement;
    const dataUrl = canvas.toDataURL('image/png');
    
    const link = document.createElement('a');
    link.download = 'ar-preview.png';
    link.href = dataUrl;
    link.click();
  }

  endARSession() {
    if (this.session) {
      this.session.end();
      this.session = null;
    }
    this.renderer.setAnimationLoop(null);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }
}

// Backend (Express.js)
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');

const app = express();

// MongoDB Schema
const ProductSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  modelUrl: String,
  thumbnailUrl: String,
  scale: Number,
  category: String,
  dimensions: {
    width: Number,
    height: Number,
    depth: Number
  }
});

const Product = mongoose.model('Product', ProductSchema);

// File upload configuration
const storage = multer.diskStorage({
  destination: 'uploads/models',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// API Routes
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/products', upload.fields([
  { name: 'model', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), async (req, res) => {
  try {
    const product = new Product({
      ...req.body,
      modelUrl: `/models/${req.files.model[0].filename}`,
      thumbnailUrl: `/images/${req.files.thumbnail[0].filename}`
    });
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Initialize AR experience
const arExperience = new ARShoppingExperience();