class NeuralNetworkInterface {
  constructor() {
    this.model = null;
    this.architecture = [];
    this.trainingData = null;
    this.trainingStatus = {
      isTraining: false,
      epoch: 0,
      loss: 0,
      accuracy: 0
    };
    
    this.init();
  }

  async init() {
    this.setupUI();
    this.initializeDragAndDrop();
    this.setupCharts();
    this.bindEvents();
  }

  setupUI() {
    this.elements = {
      architecturePanel: document.getElementById('architecture-panel'),
      layerToolbox: document.getElementById('layer-toolbox'),
      trainingPanel: document.getElementById('training-panel'),
      metricsPanel: document.getElementById('metrics-panel'),
      dataUpload: document.getElementById('data-upload'),
      trainButton: document.getElementById('train-button'),
      saveButton: document.getElementById('save-button'),
      loadButton: document.getElementById('load-button')
    };

    this.initializeLayerToolbox();
  }

  initializeLayerToolbox() {
    const layerTypes = [
      {
        type: 'dense',
        name: 'Dense Layer',
        icon: '🔲',
        params: ['units', 'activation']
      },
      {
        type: 'conv2d',
        name: 'Convolution 2D',
        icon: '🔳',
        params: ['filters', 'kernelSize', 'activation']
      },
      {
        type: 'maxPooling2d',
        name: 'Max Pooling 2D',
        icon: '⬇️',
        params: ['poolSize']
      },
      {
        type: 'dropout',
        name: 'Dropout',
        icon: '❌',
        params: ['rate']
      }
    ];

    this.elements.layerToolbox.innerHTML = layerTypes.map(layer => `
      <div class="layer-item" draggable="true" data-type="${layer.type}">
        <span class="layer-icon">${layer.icon}</span>
        <span class="layer-name">${layer.name}</span>
      </div>
    `).join('');
  }

  initializeDragAndDrop() {
    new Sortable(this.elements.architecturePanel, {
      group: {
        name: 'layers',
        pull: true,
        put: true
      },
      animation: 150,
      onAdd: (evt) => this.handleLayerAdd(evt),
      onUpdate: (evt) => this.handleLayerReorder(evt)
    });

    new Sortable(this.elements.layerToolbox, {
      group: {
        name: 'layers',
        pull: 'clone',
        put: false
      },
      sort: false
    });
  }

  setupCharts() {
    this.charts = {
      loss: new Chart(document.getElementById('loss-chart'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Loss',
            data: [],
            borderColor: 'rgb(255, 99, 132)',
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          animation: false
        }
      }),
      accuracy: new Chart(document.getElementById('accuracy-chart'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Accuracy',
            data: [],
            borderColor: 'rgb(54, 162, 235)',
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          animation: false
        }
      })
    };
  }

  bindEvents() {
    this.elements.trainButton.addEventListener('click', () => this.startTraining());
    this.elements.saveButton.addEventListener('click', () => this.saveModel());
    this.elements.loadButton.addEventListener('click', () => this.loadModel());
    this.elements.dataUpload.addEventListener('change', (e) => this.handleDataUpload(e));
  }

  async handleLayerAdd(evt) {
    const layerType = evt.item.dataset.type;
    const layerConfig = await this.showLayerConfigDialog(layerType);
    
    if (layerConfig) {
      this.architecture.push({
        type: layerType,
        config: layerConfig
      });
      this.updateArchitectureVisualization();
    } else {
      evt.item.remove();
    }
  }

  handleLayerReorder(evt) {
    const layers = Array.from(this.elements.architecturePanel.children);
    this.architecture = layers.map(layer => ({
      type: layer.dataset.type,
      config: JSON.parse(layer.dataset.config)
    }));
  }

  async showLayerConfigDialog(layerType) {
    const dialog = document.createElement('div');
    dialog.className = 'layer-config-dialog';
    
    const config = {};
    const params = this.getLayerParams(layerType);

    dialog.innerHTML = `
      <h3>Configure ${layerType} Layer</h3>
      ${params.map(param => `
        <div class="param-group">
          <label for="${param}">${param}:</label>
          <input type="text" id="${param}" name="${param}">
        </div>
      `).join('')}
      <div class="dialog-buttons">
        <button class="confirm">Confirm</button>
        <button class="cancel">Cancel</button>
      </div>
    `;

    return new Promise(resolve => {
      dialog.querySelector('.confirm').onclick = () => {
        params.forEach(param => {
          config[param] = dialog.querySelector(`#${param}`).value;
        });
        dialog.remove();
        resolve(config);
      };

      dialog.querySelector('.cancel').onclick = () => {
        dialog.remove();
        resolve(null);
      };

      document.body.appendChild(dialog);
    });
  }

  getLayerParams(layerType) {
    const paramMap = {
      dense: ['units', 'activation'],
      conv2d: ['filters', 'kernelSize', 'activation'],
      maxPooling2d: ['poolSize'],
      dropout: ['rate']
    };
    return paramMap[layerType] || [];
  }

  updateArchitectureVisualization() {
    const container = document.getElementById('architecture-visualization');
    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', 800)
      .attr('height', 400);

    const layers = this.architecture.map((layer, i) => ({
      ...layer,
      index: i,
      nodes: this.calculateLayerNodes(layer)
    }));

    this.drawLayers(svg, layers);
    this.drawConnections(svg, layers);
  }

  calculateLayerNodes(layer) {
    switch (layer.type) {
      case 'dense':
        return parseInt(layer.config.units);
      case 'conv2d':
        return parseInt(layer.config.filters);
      case 'maxPooling2d':
        return 5; // Visualization placeholder
      case 'dropout':
        return 5; // Visualization placeholder
      default:
        return 3;
    }
  }

  drawLayers(svg, layers) {
    const layerWidth = 100;
    const layerGap = 150;

    layers.forEach((layer, i) => {
      const g = svg.append('g')
        .attr('transform', `translate(${i * layerGap + 50}, 0)`);

      const nodes = d3.range(layer.nodes);
      const nodeRadius = 5;
      const nodeGap = 20;

      g.selectAll('circle')
        .data(nodes)
        .enter()
        .append('circle')
        .attr('cx', layerWidth / 2)
        .attr('cy', (d, i) => i * nodeGap + 100)
        .attr('r', nodeRadius)
        .attr('fill', this.getLayerColor(layer.type));

      g.append('text')
        .attr('x', layerWidth / 2)
        .attr('y', 80)
        .attr('text-anchor', 'middle')
        .text(layer.type);
    });
  }

  drawConnections(svg, layers) {
    for (let i = 0; i < layers.length - 1; i++) {
      const currentLayer = layers[i];
      const nextLayer = layers[i + 1];
      const layerGap = 150;
      
      for (let j = 0; j < currentLayer.nodes; j++) {
        for (let k = 0; k < nextLayer.nodes; k++) {
          svg.append('line')
            .attr('x1', i * layerGap + 50 + 100/2)
            .attr('y1', j * 20 + 100)
            .attr('x2', (i + 1) * layerGap + 50 + 100/2)
            .attr('y2', k * 20 + 100)
            .attr('stroke', '#ccc')
            .attr('stroke-width', 0.5);
        }
      }
    }
  }

  getLayerColor(layerType) {
    const colors = {
      dense: '#4CAF50',
      conv2d: '#2196F3',
      maxPooling2d: '#FFC107',
      dropout: '#F44336'
    };
    return colors[layerType] || '#999';
  }

  async handleDataUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      this.trainingData = await this.loadDataset(file);
      this.showNotification('Dataset loaded successfully');
    } catch (error) {
      this.showError('Failed to load dataset');
    }
  }

  async loadDataset(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          resolve({
            xs: tf.tensor(data.xs),
            ys: tf.tensor(data.ys)
          });
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsText(file);
    });
  }

  async buildModel() {
    const model = tf.sequential();

    for (const layer of this.architecture) {
      model.add(this.createLayer(layer));
    }

    return model;
  }

  createLayer(layerDef) {
    switch (layerDef.type) {
      case 'dense':
        return tf.layers.dense({
          units: parseInt(layerDef.config.units),
          activation: layerDef.config.activation
        });
      case 'conv2d':
        return tf.layers.conv2d({
          filters: parseInt(layerDef.config.filters),
          kernelSize: JSON.parse(layerDef.config.kernelSize),
          activation: layerDef.config.activation
        });
      case 'maxPooling2d':
        return tf.layers.maxPooling2d({
          poolSize: JSON.parse(layerDef.config.poolSize)
        });
      case 'dropout':
        return tf.layers.dropout({
          rate: parseFloat(layerDef.config.rate)
        });
      default:
        throw new Error(`Unknown layer type: ${layerDef.type}`);
    }
  }

  async startTraining() {
    if (!this.trainingData || this.trainingStatus.isTraining) return;

    try {
      this.model = await this.buildModel();
      
      this.model.compile({
        optimizer: 'adam',
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });

      this.trainingStatus.isTraining = true;
      this.updateUI();

      await this.model.fit(this.trainingData.xs, this.trainingData.ys, {
        epochs: 50,
        batchSize: 32,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            this.updateTrainingMetrics(epoch, logs);
          }
        }
      });

      this.trainingStatus.isTraining = false;
      this.updateUI();
      this.showNotification('Training completed');
    } catch (error) {
      this.showError('Training failed: ' + error.message);
      this.trainingStatus.isTraining = false;
      this.updateUI();
    }
  }

  updateTrainingMetrics(epoch, logs) {
    this.trainingStatus.epoch = epoch;
    this.trainingStatus.loss = logs.loss;
    this.trainingStatus.accuracy = logs.acc;

    this.charts.loss.data.labels.push(epoch);
    this.charts.loss.data.datasets[0].data.push(logs.loss);
    this.charts.loss.update();

    this.charts.accuracy.data.labels.push(epoch);
    this.charts.accuracy.data.datasets[0].data.push(logs.acc);
    this.charts.accuracy.update();

    this.updateUI();
  }

  async saveModel() {
    if (!this.model) return;

    try {
      await this.model.save('downloads://neural-network-model');
      this.showNotification('Model saved successfully');
    } catch (error) {
      this.showError('Failed to save model');
    }
  }

  async loadModel() {
    try {
      this.model = await tf.loadLayersModel('uploads://neural-network-model');
      this.architecture = this.model.layers.map(layer => ({
        type: layer.getClassName(),
        config: layer.getConfig()
      }));
      this.updateArchitectureVisualization();
      this.showNotification('Model loaded successfully');
    } catch (error) {
      this.showError('Failed to load model');
    }
  }

  updateUI() {
    this.elements.trainButton.disabled = this.trainingStatus.isTraining;
    this.elements.saveButton.disabled = !this.model;
    
    document.getElementById('training-status').innerHTML = `
      <div>Epoch: ${this.trainingStatus.epoch}</div>
      <div>Loss: ${this.trainingStatus.loss.toFixed(4)}</div>
      <div>Accuracy: ${(this.trainingStatus.accuracy * 100).toFixed(2)}%</div>
    `;
  }

  showNotification(message) {
    // Implementation of notification system
  }

  showError(message) {
    // Implementation of error display
  }
}

// Initialize the interface
const nnInterface = new NeuralNetworkInterface();