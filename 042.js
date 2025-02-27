class AgricultureMonitoringSystem {
  constructor() {
    this.sensors = new Map();
    this.zones = new Map();
    this.predictions = new Map();
    this.irrigationSystem = null;
    this.weatherData = null;
    this.mlModel = null;
    
    this.init();
  }

  async init() {
    await this.initializeIoT();
    await this.loadMLModel();
    this.setupDatabase();
    this.initializeUI();
    this.startMonitoring();
  }

  async initializeIoT() {
    // Initialize IoT hub connection
    this.iotHub = new IoTHubClient(process.env.IOT_CONNECTION_STRING);
    
    // Setup MQTT client for sensor communication
    this.mqtt = await mqtt.connectAsync('mqtt://localhost:1883');
    this.setupSensorSubscriptions();
  }

  async loadMLModel() {
    try {
      this.mlModel = await tf.loadLayersModel('/models/agriculture/model.json');
    } catch (error) {
      console.error('Failed to load ML model:', error);
    }
  }

  setupSensorSubscriptions() {
    const sensorTypes = ['moisture', 'temperature', 'humidity', 'light', 'pH'];
    
    sensorTypes.forEach(type => {
      this.mqtt.subscribe(`sensors/${type}/+`, (err) => {
        if (!err) {
          console.log(`Subscribed to ${type} sensors`);
        }
      });
    });

    this.mqtt.on('message', (topic, message) => {
      this.handleSensorData(topic, JSON.parse(message.toString()));
    });
  }

  setupDatabase() {
    this.db = new MongoDB('agriculture_monitoring');
    this.initializeCollections();
  }

  async initializeCollections() {
    await this.db.createCollection('sensor_data');
    await this.db.createCollection('predictions');
    await this.db.createCollection('irrigation_logs');
    await this.db.createCollection('crop_health');
  }

  initializeUI() {
    this.dashboard = new Dashboard({
      sensorCharts: this.initializeCharts(),
      zoneMap: this.initializeZoneMap(),
      alertPanel: this.initializeAlertPanel(),
      controlPanel: this.initializeControlPanel()
    });
  }

  initializeCharts() {
    return {
      moisture: new Chart('moisture-chart', {
        type: 'line',
        options: {
          scales: { y: { min: 0, max: 100 } },
          animation: false
        }
      }),
      temperature: new Chart('temperature-chart', {
        type: 'line',
        options: {
          scales: { y: { min: 0, max: 50 } },
          animation: false
        }
      }),
      health: new Chart('health-chart', {
        type: 'radar',
        options: {
          scales: { r: { min: 0, max: 1 } },
          animation: false
        }
      })
    };
  }

  initializeZoneMap() {
    return new MapVisualizer('zone-map', {
      width: 800,
      height: 600,
      zones: Array.from(this.zones.values())
    });
  }

  startMonitoring() {
    // Start continuous monitoring
    setInterval(() => this.updateSensorReadings(), 5000);
    setInterval(() => this.updatePredictions(), 300000);
    setInterval(() => this.checkIrrigationNeeds(), 60000);
    
    // Start weather monitoring
    this.startWeatherMonitoring();
  }

  async handleSensorData(topic, data) {
    const [, type, sensorId] = topic.split('/');
    const sensor = this.sensors.get(sensorId);
    
    if (sensor) {
      sensor.lastReading = {
        value: data.value,
        timestamp: new Date(),
        battery: data.battery
      };

      await this.saveSensorData(sensorId, type, data);
      this.updateDashboard(sensorId, type, data);
      this.checkThresholds(sensorId, type, data);
    }
  }

  async saveSensorData(sensorId, type, data) {
    await this.db.collection('sensor_data').insertOne({
      sensorId,
      type,
      value: data.value,
      timestamp: new Date(),
      zoneId: this.sensors.get(sensorId).zoneId
    });
  }

  async updatePredictions() {
    for (const zone of this.zones.values()) {
      const predictions = await this.generatePredictions(zone);
      this.predictions.set(zone.id, predictions);
      this.updateZonePredictions(zone.id, predictions);
    }
  }

  async generatePredictions(zone) {
    const historicalData = await this.getHistoricalData(zone.id);
    const weatherForecast = await this.getWeatherForecast(zone.location);
    
    const input = tf.tensor2d([
      ...this.preprocessHistoricalData(historicalData),
      ...this.preprocessWeatherData(weatherForecast)
    ]);

    const prediction = this.mlModel.predict(input);
    return {
      irrigation: await this.calculateIrrigationNeeds(prediction, zone),
      harvest: await this.predictHarvestTiming(prediction, zone),
      risks: await this.assessRisks(prediction, zone)
    };
  }

  async calculateIrrigationNeeds(prediction, zone) {
    const moisturePrediction = prediction.slice([0, 0], [1, 1]);
    const evapotranspiration = await this.calculateEvapotranspiration(zone);
    
    return {
      schedule: this.optimizeIrrigationSchedule(moisturePrediction, evapotranspiration),
      amount: this.calculateWaterAmount(moisturePrediction, zone.area)
    };
  }

  optimizeIrrigationSchedule(moisturePrediction, evapotranspiration) {
    const schedule = [];
    let currentMoisture = moisturePrediction.dataSync()[0];
    
    for (let hour = 0; hour < 24; hour++) {
      const moistureLoss = evapotranspiration[hour] || 0;
      currentMoisture -= moistureLoss;
      
      if (currentMoisture < zone.moistureThreshold) {
        schedule.push({
          time: hour,
          duration: this.calculateIrrigationDuration(
            zone.moistureThreshold - currentMoisture,
            zone.irrigationRate
          )
        });
        currentMoisture = zone.moistureThreshold;
      }
    }

    return schedule;
  }

  async checkIrrigationNeeds() {
    for (const [zoneId, predictions] of this.predictions) {
      const zone = this.zones.get(zoneId);
      const currentMoisture = this.getCurrentMoisture(zoneId);
      
      if (currentMoisture < zone.moistureThreshold) {
        const schedule = predictions.irrigation.schedule;
        const currentHour = new Date().getHours();
        
        const irrigation = schedule.find(s => s.time === currentHour);
        if (irrigation) {
          await this.startIrrigation(zoneId, irrigation.duration);
        }
      }
    }
  }

  async startIrrigation(zoneId, duration) {
    const zone = this.zones.get(zoneId);
    
    try {
      await this.irrigationSystem.startZone(zoneId, duration);
      
      await this.db.collection('irrigation_logs').insertOne({
        zoneId,
        startTime: new Date(),
        duration,
        waterAmount: duration * zone.irrigationRate
      });

      this.dashboard.showAlert({
        type: 'info',
        message: `Starting irrigation in Zone ${zoneId} for ${duration} minutes`
      });
    } catch (error) {
      console.error(`Irrigation failed for zone ${zoneId}:`, error);
      this.dashboard.showAlert({
        type: 'error',
        message: `Irrigation failed in Zone ${zoneId}`
      });
    }
  }

  async assessCropHealth(zoneId) {
    const zone = this.zones.get(zoneId);
    const sensorData = await this.getLatestSensorData(zoneId);
    
    const healthMetrics = {
      moisture: this.calculateMoistureHealth(sensorData.moisture),
      nutrient: this.calculateNutrientHealth(sensorData.pH),
      growth: await this.analyzeGrowthRate(zoneId),
      stress: await this.detectPlantStress(sensorData)
    };

    await this.db.collection('crop_health').insertOne({
      zoneId,
      timestamp: new Date(),
      metrics: healthMetrics,
      overall: this.calculateOverallHealth(healthMetrics)
    });

    this.updateHealthVisualization(zoneId, healthMetrics);
  }

  updateHealthVisualization(zoneId, metrics) {
    const healthChart = this.dashboard.charts.health;
    
    healthChart.data = {
      labels: Object.keys(metrics),
      datasets: [{
        label: `Zone ${zoneId} Health`,
        data: Object.values(metrics),
        fill: true,
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderColor: 'rgb(54, 162, 235)',
        pointBackgroundColor: 'rgb(54, 162, 235)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgb(54, 162, 235)'
      }]
    };
    
    healthChart.update();
  }

  async detectAnomalies(sensorData) {
    const anomalies = [];
    
    // Check for sudden changes
    const recentReadings = sensorData.slice(-6);
    const avgReading = recentReadings.reduce((a, b) => a + b.value, 0) / recentReadings.length;
    const stdDev = this.calculateStandardDeviation(recentReadings.map(r => r.value));
    
    const latestReading = recentReadings[recentReadings.length - 1];
    if (Math.abs(latestReading.value - avgReading) > stdDev * 2) {
      anomalies.push({
        type: 'sudden_change',
        value: latestReading.value,
        expected: avgReading,
        timestamp: latestReading.timestamp
      });
    }

    return anomalies;
  }

  generateReport(zoneId) {
    return {
      zone: this.zones.get(zoneId),
      currentReadings: this.getCurrentReadings(zoneId),
      predictions: this.predictions.get(zoneId),
      health: this.getLatestHealth(zoneId),
      recommendations: this.generateRecommendations(zoneId)
    };
  }
}

// Initialize system
const agriSystem = new AgricultureMonitoringSystem();