class TelehealthPlatform {
  constructor() {
    this.mlModel = null;
    this.videoProcessor = null;
    this.consultations = new Map();
    this.symptoms = new Map();
    this.vitalSigns = new Map();
    
    this.init();
  }

  async init() {
    await this.loadModels();
    this.setupWebRTC();
    this.initializeUI();
    this.setupDatabase();
  }

  async loadModels() {
    try {
      // Load symptom analysis model
      this.mlModel = await tf.loadLayersModel('/models/diagnosis/model.json');
      
      // Load facial analysis model for vital signs
      this.faceModel = await blazeface.load();
      
      // Load pose detection model
      this.poseModel = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet
      );
    } catch (error) {
      console.error('Failed to load ML models:', error);
    }
  }

  setupWebRTC() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.setupMediaHandlers();
  }

  setupMediaHandlers() {
    this.peerConnection.ontrack = (event) => {
      const remoteVideo = document.getElementById('remote-video');
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }
    };

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = stream;
        stream.getTracks().forEach(track => 
          this.peerConnection.addTrack(track, stream)
        );
      })
      .catch(error => console.error('Media stream error:', error));
  }

  initializeUI() {
    this.elements = {
      symptomForm: document.getElementById('symptom-form'),
      vitalDisplay: document.getElementById('vital-signs'),
      diagnosisPanel: document.getElementById('diagnosis-panel'),
      consultationNotes: document.getElementById('consultation-notes'),
      videoContainer: document.getElementById('video-container')
    };

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.elements.symptomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.processSymptomForm(new FormData(e.target));
    });

    document.getElementById('start-consultation').addEventListener('click', () => {
      this.startConsultation();
    });

    document.getElementById('end-consultation').addEventListener('click', () => {
      this.endConsultation();
    });
  }

  setupDatabase() {
    this.db = new PouchDB('telehealth');
    PouchDB.sync('telehealth', 'http://localhost:5984/telehealth', {
      live: true,
      retry: true
    });
  }

  async startConsultation() {
    const consultationId = Date.now().toString();
    const consultation = {
      id: consultationId,
      startTime: new Date(),
      symptoms: [],
      vitalSigns: [],
      diagnosis: null,
      notes: []
    };

    this.consultations.set(consultationId, consultation);
    await this.startVideoAnalysis();
    this.updateUI('consultation-started');
  }

  async startVideoAnalysis() {
    const videoElement = document.getElementById('local-video');
    this.videoProcessor = new VideoProcessor(videoElement);
    
    // Start continuous vital sign monitoring
    this.vitalSignsInterval = setInterval(async () => {
      const vitalSigns = await this.analyzeVitalSigns();
      this.updateVitalSigns(vitalSigns);
    }, 1000);
  }

  async analyzeVitalSigns() {
    const frame = await this.videoProcessor.captureFrame();
    
    // Detect face
    const faces = await this.faceModel.estimateFaces(frame);
    if (faces.length === 0) return null;

    // Extract vital signs from facial features
    const vitalSigns = await this.extractVitalSigns(faces[0], frame);
    return vitalSigns;
  }

  async extractVitalSigns(face, frame) {
    // Calculate heart rate from facial color changes
    const heartRate = await this.calculateHeartRate(face, frame);
    
    // Estimate respiratory rate from chest movement
    const respiratoryRate = await this.estimateRespiratoryRate(frame);
    
    // Analyze skin color for basic health indicators
    const skinAnalysis = await this.analyzeSkinColor(face, frame);

    return {
      heartRate,
      respiratoryRate,
      skinColor: skinAnalysis,
      timestamp: new Date()
    };
  }

  async calculateHeartRate(face, frame) {
    const roi = this.extractFaceROI(face, frame);
    const greenChannel = this.extractGreenChannel(roi);
    
    // Apply signal processing to detect pulse
    const signal = await this.processSignal(greenChannel);
    return this.estimateHeartRate(signal);
  }

  async processSymptomForm(formData) {
    const symptoms = Array.from(formData.entries())
      .filter(([key, value]) => value === 'on')
      .map(([key]) => key);

    const currentConsultation = this.getCurrentConsultation();
    if (currentConsultation) {
      currentConsultation.symptoms = symptoms;
      await this.generatePreliminaryDiagnosis(symptoms);
    }
  }

  async generatePreliminaryDiagnosis(symptoms) {
    const symptomVector = this.symptomToVector(symptoms);
    const input = tf.tensor2d([symptomVector]);
    
    const prediction = this.mlModel.predict(input);
    const conditions = await this.interpretPrediction(prediction);
    
    this.updateDiagnosisPanel(conditions);
    await this.saveDiagnosis(conditions);
  }

  symptomToVector(symptoms) {
    // Convert symptoms to binary vector for ML model
    const symptomList = this.getSymptomList();
    return symptomList.map(s => symptoms.includes(s) ? 1 : 0);
  }

  async interpretPrediction(prediction) {
    const probabilities = await prediction.data();
    const conditions = this.getConditionList();
    
    return conditions
      .map((condition, index) => ({
        name: condition,
        probability: probabilities[index],
        severity: this.assessSeverity(condition, probabilities[index])
      }))
      .filter(c => c.probability > 0.2)
      .sort((a, b) => b.probability - a.probability);
  }

  assessSeverity(condition, probability) {
    const severityThresholds = {
      high: 0.8,
      medium: 0.5,
      low: 0.2
    };

    if (probability >= severityThresholds.high) return 'high';
    if (probability >= severityThresholds.medium) return 'medium';
    return 'low';
  }

  updateDiagnosisPanel(conditions) {
    this.elements.diagnosisPanel.innerHTML = `
      <h3>Preliminary Diagnosis</h3>
      ${conditions.map(condition => `
        <div class="condition ${condition.severity}">
          <span class="condition-name">${condition.name}</span>
          <span class="probability">${(condition.probability * 100).toFixed(1)}%</span>
          <span class="severity-badge">${condition.severity}</span>
        </div>
      `).join('')}
      <div class="disclaimer">
        This is an AI-assisted preliminary assessment. 
        Please consult with a healthcare professional for accurate diagnosis.
      </div>
    `;
  }

  updateVitalSigns(vitalSigns) {
    if (!vitalSigns) return;

    this.elements.vitalDisplay.innerHTML = `
      <div class="vital-sign">
        <span class="label">Heart Rate:</span>
        <span class="value">${vitalSigns.heartRate} BPM</span>
      </div>
      <div class="vital-sign">
        <span class="label">Respiratory Rate:</span>
        <span class="value">${vitalSigns.respiratoryRate} breaths/min</span>
      </div>
      <div class="vital-sign">
        <span class="label">Skin Color:</span>
        <span class="value">${vitalSigns.skinColor.description}</span>
      </div>
    `;

    this.checkVitalSignAlerts(vitalSigns);
  }

  checkVitalSignAlerts(vitalSigns) {
    const alerts = [];
    
    if (vitalSigns.heartRate > 100 || vitalSigns.heartRate < 60) {
      alerts.push({
        type: 'warning',
        message: 'Abnormal heart rate detected'
      });
    }

    if (vitalSigns.respiratoryRate > 20 || vitalSigns.respiratoryRate < 12) {
      alerts.push({
        type: 'warning',
        message: 'Abnormal respiratory rate detected'
      });
    }

    alerts.forEach(alert => this.showAlert(alert));
  }

  async saveDiagnosis(conditions) {
    const consultation = this.getCurrentConsultation();
    if (!consultation) return;

    consultation.diagnosis = {
      conditions,
      timestamp: new Date(),
      vitalSigns: Array.from(this.vitalSigns.values())
    };

    await this.db.put({
      _id: consultation.id,
      ...consultation
    });
  }

  async endConsultation() {
    const consultation = this.getCurrentConsultation();
    if (!consultation) return;

    consultation.endTime = new Date();
    clearInterval(this.vitalSignsInterval);
    
    await this.generateConsultationSummary(consultation);
    await this.saveConsultationRecord(consultation);
    
    this.consultations.delete(consultation.id);
    this.updateUI('consultation-ended');
  }

  async generateConsultationSummary(consultation) {
    const summary = {
      duration: (consultation.endTime - consultation.startTime) / 1000,
      symptoms: consultation.symptoms,
      diagnosis: consultation.diagnosis,
      vitalSignsTrend: this.analyzeVitalSignsTrend(consultation.vitalSigns),
      recommendations: await this.generateRecommendations(consultation)
    };

    return summary;
  }

  showAlert(alert) {
    const alertElement = document.createElement('div');
    alertElement.className = `alert alert-${alert.type}`;
    alertElement.textContent = alert.message;
    
    document.getElementById('alerts-container').appendChild(alertElement);
    setTimeout(() => alertElement.remove(), 5000);
  }
}

class VideoProcessor {
  constructor(videoElement) {
    this.video = videoElement;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
  }

  async captureFrame() {
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    
    this.context.drawImage(this.video, 0, 0);
    return tf.browser.fromPixels(this.canvas);
  }
}

// Initialize platform
const telehealthPlatform = new TelehealthPlatform();