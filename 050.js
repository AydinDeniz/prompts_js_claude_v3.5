class TransportationScheduler {
  constructor() {
    this.routes = new Map();
    this.vehicles = new Map();
    this.stops = new Map();
    this.predictions = new Map();
    this.mlModel = null;
    this.trafficData = null;
    
    this.init();
  }

  async init() {
    await this.loadModels();
    this.setupDataSources();
    this.initializeDatabase();
    this.setupRealTimeTracking();
    this.initializeUI();
    this.startPredictionEngine();
  }

  async loadModels() {
    try {
      // Load delay prediction model
      this.mlModel = await tf.loadLayersModel('/models/transport/delay-predictor.json');
      
      // Load route optimization model
      this.routeOptimizer = await tf.loadLayersModel('/models/transport/route-optimizer.json');
      
      // Load traffic prediction model
      this.trafficPredictor = await tf.loadLayersModel('/models/transport/traffic-predictor.json');
    } catch (error) {
      console.error('Failed to load ML models:', error);
    }
  }

  setupDataSources() {
    // Initialize GTFS real-time feed
    this.gtfsRealtime = new GTFSRealtimeFeed({
      url: process.env.GTFS_REALTIME_URL,
      refreshInterval: 30000 // 30 seconds
    });

    // Initialize traffic data feed
    this.trafficFeed = new TrafficDataFeed({
      apiKey: process.env.TRAFFIC_API_KEY,
      region: 'metropolitan-area'
    });

    // Initialize weather data feed
    this.weatherFeed = new WeatherDataFeed({
      apiKey: process.env.WEATHER_API_KEY,
      updateInterval: 300000 // 5 minutes
    });
  }

  initializeDatabase() {
    this.db = new PouchDB('transportation_scheduler');
    
    PouchDB.sync('transportation_scheduler', 'http://localhost:5984/transportation_scheduler', {
      live: true,
      retry: true
    });
  }

  setupRealTimeTracking() {
    // WebSocket connection for real-time updates
    this.socket = new WebSocket('ws://localhost:8080/transport');
    
    this.socket.onmessage = (event) => {
      const update = JSON.parse(event.data);
      this.handleRealTimeUpdate(update);
    };

    // Setup MQTT for IoT device communication
    this.mqtt = mqtt.connect('mqtt://localhost:1883');
    this.setupMQTTSubscriptions();
  }

  initializeUI() {
    this.elements = {
      mapContainer: document.getElementById('transport-map'),
      routeList: document.getElementById('route-list'),
      predictionPanel: document.getElementById('prediction-panel'),
      searchForm: document.getElementById('route-search'),
      alertsPanel: document.getElementById('alerts-panel')
    };

    this.setupMap();
    this.setupEventListeners();
  }

  setupMap() {
    this.map = new TransportMap('transport-map', {
      center: [city.lat, city.lng],
      zoom: 12,
      layers: [
        'transport-routes',
        'stops',
        'vehicles',
        'traffic'
      ]
    });

    // Add route layers
    this.routes.forEach(route => {
      this.map.addRoute(route);
    });
  }

  setupEventListeners() {
    this.elements.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleRouteSearch(new FormData(e.target));
    });

    this.map.on('vehicleClick', (vehicle) => {
      this.showVehicleDetails(vehicle);
    });

    this.map.on('stopClick', (stop) => {
      this.showStopSchedule(stop);
    });
  }

  startPredictionEngine() {
    // Update predictions every minute
    setInterval(() => this.updatePredictions(), 60000);
    
    // Update traffic analysis every 5 minutes
    setInterval(() => this.updateTrafficAnalysis(), 300000);
    
    // Update route optimizations every 15 minutes
    setInterval(() => this.optimizeRoutes(), 900000);
  }

  async handleRouteSearch(formData) {
    const origin = formData.get('origin');
    const destination = formData.get('destination');
    const time = formData.get('time') || new Date();
    
    try {
      const routes = await this.findOptimalRoutes(origin, destination, time);
      this.displayRouteOptions(routes);
    } catch (error) {
      console.error('Route search failed:', error);
      this.showError('Failed to find routes');
    }
  }

  async findOptimalRoutes(origin, destination, time) {
    const originCoords = await this.geocodeLocation(origin);
    const destCoords = await this.geocodeLocation(destination);
    
    const routeOptions = await this.calculateRouteOptions(
      originCoords,
      destCoords,
      time
    );

    return this.optimizeRouteOptions(routeOptions);
  }

  async calculateRouteOptions(origin, destination, time) {
    const directRoutes = await this.findDirectRoutes(origin, destination);
    const transferRoutes = await this.findTransferRoutes(origin, destination);
    
    const allRoutes = [...directRoutes, ...transferRoutes];
    
    return Promise.all(allRoutes.map(async route => ({
      ...route,
      predictedDuration: await this.predictJourneyTime(route, time),
      reliability: await this.calculateRouteReliability(route),
      crowding: await this.predictCrowding(route, time)
    })));
  }

  async predictJourneyTime(route, time) {
    const features = await this.extractRouteFeatures(route, time);
    const tensor = tf.tensor2d([features]);
    
    const prediction = this.mlModel.predict(tensor);
    const duration = await prediction.data();
    
    tensor.dispose();
    return duration[0];
  }

  async extractRouteFeatures(route, time) {
    const [traffic, weather, historical] = await Promise.all([
      this.getTrafficConditions(route),
      this.getWeatherConditions(time),
      this.getHistoricalData(route, time)
    ]);

    return [
      ...this.normalizeRouteData(route),
      ...this.normalizeTrafficData(traffic),
      ...this.normalizeWeatherData(weather),
      ...this.normalizeHistoricalData(historical)
    ];
  }

  async handleRealTimeUpdate(update) {
    switch (update.type) {
      case 'vehicle_position':
        await this.updateVehiclePosition(update.data);
        break;
      case 'service_alert':
        await this.handleServiceAlert(update.data);
        break;
      case 'trip_update':
        await this.updateTripPredictions(update.data);
        break;
    }
  }

  async updateVehiclePosition(position) {
    const vehicle = this.vehicles.get(position.vehicleId);
    if (!vehicle) return;

    vehicle.position = position.coordinates;
    vehicle.timestamp = position.timestamp;
    vehicle.speed = position.speed;
    vehicle.bearing = position.bearing;

    this.map.updateVehicle(vehicle);
    await this.updatePredictionsForVehicle(vehicle);
  }

  async updatePredictionsForVehicle(vehicle) {
    const route = this.routes.get(vehicle.routeId);
    const remainingStops = this.getRemainingStops(vehicle, route);
    
    const predictions = await Promise.all(
      remainingStops.map(stop => 
        this.predictArrivalTime(vehicle, stop)
      )
    );

    this.updatePredictionDisplays(vehicle.routeId, predictions);
  }

  async predictArrivalTime(vehicle, stop) {
    const features = await this.extractPredictionFeatures(vehicle, stop);
    const tensor = tf.tensor2d([features]);
    
    const prediction = this.mlModel.predict(tensor);
    const delay = await prediction.data();
    
    tensor.dispose();
    
    return {
      stopId: stop.id,
      scheduledTime: this.getScheduledTime(vehicle, stop),
      predictedDelay: delay[0],
      confidence: this.calculatePredictionConfidence(features)
    };
  }

  updatePredictionDisplays(routeId, predictions) {
    const route = this.routes.get(routeId);
    if (!route) return;

    predictions.forEach(prediction => {
      const stopElement = document.querySelector(
        `.stop-prediction[data-stop-id="${prediction.stopId}"]`
      );
      
      if (stopElement) {
        stopElement.innerHTML = this.renderPrediction(prediction);
      }
    });
  }

  renderPrediction(prediction) {
    const delay = Math.round(prediction.predictedDelay / 60); // Convert to minutes
    const status = this.getPredictionStatus(delay);
    
    return `
      <div class="prediction ${status}">
        <div class="scheduled-time">
          ${this.formatTime(prediction.scheduledTime)}
        </div>
        <div class="delay-info">
          ${this.formatDelay(delay)}
        </div>
        <div class="confidence-indicator" 
             style="width: ${prediction.confidence * 100}%">
        </div>
      </div>
    `;
  }

  async optimizeRoutes() {
    const currentConditions = await this.getCurrentConditions();
    const activeRoutes = Array.from(this.routes.values())
      .filter(route => route.isActive);
    
    for (const route of activeRoutes) {
      const optimization = await this.optimizeRoute(route, currentConditions);
      await this.implementRouteOptimization(route, optimization);
    }
  }

  async optimizeRoute(route, conditions) {
    const features = this.prepareOptimizationFeatures(route, conditions);
    const tensor = tf.tensor2d([features]);
    
    const prediction = this.routeOptimizer.predict(tensor);
    const optimization = await prediction.data();
    
    tensor.dispose();
    
    return this.interpretOptimization(optimization, route);
  }

  renderRouteDetails(route) {
    return `
      <div class="route-details">
        <h3>${route.name}</h3>
        <div class="route-stats">
          <div class="stat">
            <label>Current Delay</label>
            <span>${this.formatDelay(route.currentDelay)}</span>
          </div>
          <div class="stat">
            <label>Reliability</label>
            <span>${(route.reliability * 100).toFixed(1)}%</span>
          </div>
          <div class="stat">
            <label>Crowding</label>
            <span>${this.formatCrowding(route.crowding)}</span>
          </div>
        </div>
        <div class="stops-list">
          ${route.stops.map(stop => this.renderStopPrediction(stop)).join('')}
        </div>
        <div class="route-alerts">
          ${this.renderRouteAlerts(route.alerts)}
        </div>
      </div>
    `;
  }

  renderStopPrediction(stop) {
    const prediction = this.predictions.get(stop.id);
    return `
      <div class="stop-prediction" data-stop-id="${stop.id}">
        <span class="stop-name">${stop.name}</span>
        <span class="prediction-time">
          ${this.formatPrediction(prediction)}
        </span>
      </div>
    `;
  }

  formatTime(time) {
    return new Date(time).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  formatDelay(minutes) {
    if (minutes <= 1) return 'On Time';
    return `${minutes} min delay`;
  }

  formatCrowding(level) {
    const levels = {
      1: 'Empty',
      2: 'Light',
      3: 'Moderate',
      4: 'Crowded',
      5: 'Very Crowded'
    };
    return levels[level] || 'Unknown';
  }
}

// Initialize scheduler
const transportScheduler = new TransportationScheduler();