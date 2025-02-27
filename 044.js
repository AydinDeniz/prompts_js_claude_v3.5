class SecurityDashboard {
  constructor() {
    this.mlModel = null;
    this.threats = new Map();
    this.logs = [];
    this.alerts = [];
    this.activeConnections = new Map();
    this.anomalyDetector = null;
    
    this.init();
  }

  async init() {
    await this.loadModels();
    this.setupDataSources();
    this.initializeUI();
    this.startMonitoring();
  }

  async loadModels() {
    try {
      // Load threat detection model
      this.mlModel = await tf.loadLayersModel('/models/threat-detection/model.json');
      
      // Initialize anomaly detector
      this.anomalyDetector = new AnomalyDetector({
        sensitivity: 0.85,
        windowSize: 100
      });
    } catch (error) {
      console.error('Failed to load ML models:', error);
      this.showError('Model initialization failed');
    }
  }

  setupDataSources() {
    // Setup WebSocket for real-time log ingestion
    this.logSocket = new WebSocket('ws://localhost:8080/logs');
    this.logSocket.onmessage = (event) => this.processLog(JSON.parse(event.data));

    // Setup network traffic monitor
    this.trafficMonitor = new NetworkMonitor({
      interface: 'all',
      captureSize: 65535
    });

    // Initialize log aggregator
    this.logAggregator = new LogAggregator({
      sources: ['system', 'firewall', 'ids', 'auth'],
      batchSize: 1000
    });
  }

  initializeUI() {
    this.elements = {
      threatMap: document.getElementById('threat-map'),
      logViewer: document.getElementById('log-viewer'),
      alertPanel: document.getElementById('alert-panel'),
      metricsPanel: document.getElementById('metrics-panel'),
      connectionList: document.getElementById('active-connections')
    };

    this.charts = {
      trafficVolume: this.createTrafficChart(),
      threatDistribution: this.createThreatDistributionChart(),
      anomalyScore: this.createAnomalyChart()
    };

    this.setupEventListeners();
  }

  createTrafficChart() {
    return new Chart('traffic-chart', {
      type: 'line',
      options: {
        scales: {
          y: { beginAtZero: true },
          x: { type: 'time' }
        },
        animation: false
      }
    });
  }

  createThreatDistributionChart() {
    return new Chart('threat-distribution', {
      type: 'doughnut',
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right' }
        }
      }
    });
  }

  setupEventListeners() {
    document.getElementById('timeframe-selector').addEventListener('change', (e) => {
      this.updateTimeframe(e.target.value);
    });

    document.getElementById('threat-filter').addEventListener('change', (e) => {
      this.filterThreats(e.target.value);
    });
  }

  startMonitoring() {
    // Start continuous monitoring loops
    setInterval(() => this.updateMetrics(), 1000);
    setInterval(() => this.analyzePatterns(), 5000);
    setInterval(() => this.checkThresholds(), 1000);

    this.trafficMonitor.start();
    this.logAggregator.start();
  }

  async processLog(log) {
    this.logs.push(log);
    
    // Analyze log for threats
    const threatScore = await this.analyzeThreat(log);
    if (threatScore > 0.7) {
      this.createThreatAlert(log, threatScore);
    }

    // Update anomaly detection
    this.anomalyDetector.addDataPoint(this.extractFeatures(log));
    
    this.updateLogDisplay(log);
  }

  async analyzeThreat(log) {
    const features = this.extractFeatures(log);
    const tensor = tf.tensor2d([features]);
    
    const prediction = this.mlModel.predict(tensor);
    const score = await prediction.data();
    
    tensor.dispose();
    return score[0];
  }

  extractFeatures(log) {
    return [
      this.normalizeIP(log.sourceIP),
      this.normalizePort(log.sourcePort),
      this.normalizeIP(log.destIP),
      this.normalizePort(log.destPort),
      this.encodeProtocol(log.protocol),
      log.packetSize / 65535,
      this.calculateEntropy(log.payload),
      this.getHistoricalThreatScore(log.sourceIP)
    ];
  }

  createThreatAlert(log, score) {
    const alert = {
      id: Date.now(),
      timestamp: new Date(),
      type: this.classifyThreat(log),
      severity: this.calculateSeverity(score),
      source: log.sourceIP,
      destination: log.destIP,
      details: this.generateThreatDetails(log),
      recommendations: this.generateRecommendations(log)
    };

    this.alerts.push(alert);
    this.updateAlertPanel();
    this.notifyUser(alert);
  }

  classifyThreat(log) {
    const patterns = {
      bruteForce: /failed login|authentication failure/i,
      sqlInjection: /SELECT.*FROM|UNION.*SELECT/i,
      xss: /<script>|javascript:/i,
      ddos: /connection flood|rate limit exceeded/i
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(log.payload)) return type;
    }

    return 'unknown';
  }

  calculateSeverity(score) {
    if (score > 0.9) return 'critical';
    if (score > 0.7) return 'high';
    if (score > 0.5) return 'medium';
    return 'low';
  }

  generateThreatDetails(log) {
    return {
      timestamp: log.timestamp,
      protocol: log.protocol,
      sourcePort: log.sourcePort,
      destPort: log.destPort,
      payload: this.sanitizePayload(log.payload),
      signatures: this.matchSignatures(log),
      relatedEvents: this.findRelatedEvents(log)
    };
  }

  generateRecommendations(log) {
    const recommendations = [];
    const threatType = this.classifyThreat(log);

    switch (threatType) {
      case 'bruteForce':
        recommendations.push(
          'Implement IP-based rate limiting',
          'Enable two-factor authentication',
          'Review authentication logs'
        );
        break;
      case 'sqlInjection':
        recommendations.push(
          'Update WAF rules',
          'Review input validation',
          'Audit database access patterns'
        );
        break;
      case 'xss':
        recommendations.push(
          'Implement Content Security Policy',
          'Sanitize user inputs',
          'Update XSS filters'
        );
        break;
      case 'ddos':
        recommendations.push(
          'Enable DDoS protection',
          'Review traffic patterns',
          'Update firewall rules'
        );
        break;
    }

    return recommendations;
  }

  updateAlertPanel() {
    this.elements.alertPanel.innerHTML = this.alerts
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(alert => `
        <div class="alert-item ${alert.severity}">
          <div class="alert-header">
            <span class="alert-type">${alert.type}</span>
            <span class="alert-severity">${alert.severity}</span>
            <span class="alert-time">${this.formatTime(alert.timestamp)}</span>
          </div>
          <div class="alert-details">
            <p>Source: ${alert.source}</p>
            <p>Destination: ${alert.destination}</p>
            <div class="recommendations">
              ${alert.recommendations.map(rec => `
                <div class="recommendation">${rec}</div>
              `).join('')}
            </div>
          </div>
          <div class="alert-actions">
            <button onclick="dashboard.investigateAlert('${alert.id}')">
              Investigate
            </button>
            <button onclick="dashboard.dismissAlert('${alert.id}')">
              Dismiss
            </button>
          </div>
        </div>
      `).join('');
  }

  updateMetrics() {
    const metrics = this.calculateMetrics();
    
    this.charts.trafficVolume.data = {
      labels: metrics.timestamps,
      datasets: [{
        label: 'Traffic Volume',
        data: metrics.trafficVolume
      }]
    };
    this.charts.trafficVolume.update();

    this.charts.threatDistribution.data = {
      labels: Object.keys(metrics.threatTypes),
      datasets: [{
        data: Object.values(metrics.threatTypes)
      }]
    };
    this.charts.threatDistribution.update();
  }

  calculateMetrics() {
    const now = Date.now();
    const timeWindow = 3600000; // 1 hour

    const recentLogs = this.logs.filter(log => 
      (now - log.timestamp) < timeWindow
    );

    return {
      timestamps: recentLogs.map(log => log.timestamp),
      trafficVolume: this.aggregateTraffic(recentLogs),
      threatTypes: this.aggregateThreats(recentLogs),
      anomalyScore: this.anomalyDetector.getCurrentScore()
    };
  }

  investigateAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return;

    const investigation = {
      alert,
      relatedLogs: this.findRelatedLogs(alert),
      timeline: this.constructTimeline(alert),
      indicators: this.extractIndicators(alert)
    };

    this.showInvestigationPanel(investigation);
  }

  showInvestigationPanel(investigation) {
    const panel = document.createElement('div');
    panel.className = 'investigation-panel';
    panel.innerHTML = `
      <h2>Threat Investigation</h2>
      <div class="timeline">
        ${this.renderTimeline(investigation.timeline)}
      </div>
      <div class="indicators">
        ${this.renderIndicators(investigation.indicators)}
      </div>
      <div class="related-logs">
        ${this.renderRelatedLogs(investigation.relatedLogs)}
      </div>
      <div class="actions">
        ${this.renderActionButtons(investigation)}
      </div>
    `;

    document.body.appendChild(panel);
  }

  notifyUser(alert) {
    // Browser notification
    if (Notification.permission === 'granted') {
      new Notification('Security Alert', {
        body: `${alert.type} threat detected from ${alert.source}`,
        icon: '/icons/alert.png'
      });
    }

    // Sound alert for critical threats
    if (alert.severity === 'critical') {
      this.playAlertSound();
    }
  }
}

class AnomalyDetector {
  constructor(config) {
    this.sensitivity = config.sensitivity;
    this.windowSize = config.windowSize;
    this.dataPoints = [];
    this.threshold = null;
  }

  addDataPoint(features) {
    this.dataPoints.push(features);
    if (this.dataPoints.length > this.windowSize) {
      this.dataPoints.shift();
    }

    this.updateThreshold();
    return this.calculateAnomalyScore(features);
  }

  updateThreshold() {
    if (this.dataPoints.length < this.windowSize) return;

    const scores = this.dataPoints.map(point => 
      this.calculateDistance(point)
    );

    this.threshold = this.calculateThreshold(scores);
  }

  calculateAnomalyScore(features) {
    const distance = this.calculateDistance(features);
    return distance / (this.threshold || 1);
  }
}

// Initialize dashboard
const dashboard = new SecurityDashboard();