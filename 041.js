class MentalHealthAssistant {
  constructor() {
    this.model = null;
    this.sentimentAnalyzer = null;
    this.conversationHistory = [];
    this.riskLevels = new Map();
    this.professionals = new Map();
    
    this.init();
  }

  async init() {
    await this.loadModels();
    this.setupDatabase();
    this.initializeUI();
    this.loadResources();
  }

  async loadModels() {
    try {
      // Load NLP model
      this.model = await use.load();
      
      // Load sentiment analyzer
      this.sentimentAnalyzer = await tf.loadLayersModel('/models/sentiment/model.json');
      
      // Load emergency detection model
      this.emergencyDetector = await tf.loadLayersModel('/models/emergency/model.json');
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  }

  setupDatabase() {
    this.db = new PouchDB('mental-health-assistant');
    
    // Sync with remote database
    PouchDB.sync('mental-health-assistant', 'http://localhost:5984/mental-health-assistant', {
      live: true,
      retry: true
    });
  }

  initializeUI() {
    this.elements = {
      chatContainer: document.getElementById('chat-container'),
      userInput: document.getElementById('user-input'),
      sendButton: document.getElementById('send-button'),
      moodTracker: document.getElementById('mood-tracker'),
      resourcesPanel: document.getElementById('resources-panel'),
      emergencyButton: document.getElementById('emergency-button')
    };

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.elements.sendButton.addEventListener('click', () => {
      this.handleUserInput();
    });

    this.elements.userInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleUserInput();
      }
    });

    this.elements.emergencyButton.addEventListener('click', () => {
      this.handleEmergency();
    });

    this.elements.moodTracker.addEventListener('change', (e) => {
      this.updateMoodTracking(e.target.value);
    });
  }

  async handleUserInput() {
    const input = this.elements.userInput.value.trim();
    if (!input) return;

    this.elements.userInput.value = '';
    this.addMessageToChat('user', input);

    const analysis = await this.analyzeInput(input);
    const response = await this.generateResponse(analysis);
    
    this.addMessageToChat('assistant', response);
    await this.updateRiskAssessment(analysis);
  }

  async analyzeInput(input) {
    // Encode input text
    const encodedText = await this.model.embed(input);
    
    // Analyze sentiment
    const sentiment = await this.analyzeSentiment(encodedText);
    
    // Detect emergency keywords
    const emergencyScore = await this.detectEmergency(encodedText);
    
    // Classify topic
    const topic = await this.classifyTopic(encodedText);

    return {
      text: input,
      sentiment,
      emergencyScore,
      topic,
      timestamp: new Date()
    };
  }

  async analyzeSentiment(encodedText) {
    const prediction = this.sentimentAnalyzer.predict(encodedText);
    const sentimentScore = await prediction.data();
    
    return {
      score: sentimentScore[0],
      label: this.getSentimentLabel(sentimentScore[0])
    };
  }

  getSentimentLabel(score) {
    if (score <= -0.5) return 'very_negative';
    if (score <= -0.1) return 'negative';
    if (score <= 0.1) return 'neutral';
    if (score <= 0.5) return 'positive';
    return 'very_positive';
  }

  async detectEmergency(encodedText) {
    const prediction = this.emergencyDetector.predict(encodedText);
    return (await prediction.data())[0];
  }

  async classifyTopic(encodedText) {
    const topics = [
      'anxiety',
      'depression',
      'stress',
      'relationships',
      'self_esteem',
      'grief',
      'trauma',
      'general'
    ];

    const predictions = await this.model.predict(encodedText).data();
    const topicIndex = predictions.indexOf(Math.max(...predictions));
    
    return topics[topicIndex];
  }

  async generateResponse(analysis) {
    if (analysis.emergencyScore > 0.8) {
      return this.generateEmergencyResponse();
    }

    const response = await this.getContextualResponse(analysis);
    return this.formatResponse(response, analysis);
  }

  async getContextualResponse(analysis) {
    const responses = await this.db.get('responses');
    const topicResponses = responses[analysis.topic] || responses.general;
    
    let selectedResponse;
    
    if (analysis.sentiment.score < -0.3) {
      selectedResponse = topicResponses.supportive;
    } else if (analysis.sentiment.score < 0) {
      selectedResponse = topicResponses.encouraging;
    } else {
      selectedResponse = topicResponses.reinforcing;
    }

    return this.personalizeResponse(selectedResponse, analysis);
  }

  personalizeResponse(response, analysis) {
    const userContext = this.getUserContext();
    const timeOfDay = this.getTimeOfDay();
    
    return response
      .replace('{name}', userContext.name)
      .replace('{time}', timeOfDay)
      .replace('{topic}', analysis.topic);
  }

  async updateRiskAssessment(analysis) {
    const riskFactors = {
      negativeSentiment: analysis.sentiment.score < -0.3 ? 1 : 0,
      emergencyKeywords: analysis.emergencyScore > 0.5 ? 1 : 0,
      rapidMoodSwings: this.detectMoodSwings() ? 1 : 0,
      consistentNegativity: this.checkConsistentNegativity() ? 1 : 0
    };

    const riskScore = Object.values(riskFactors).reduce((a, b) => a + b, 0);
    
    if (riskScore >= 3) {
      this.triggerHighRiskProtocol();
    } else if (riskScore >= 2) {
      this.suggestProfessionalHelp();
    }

    await this.saveRiskAssessment({
      timestamp: new Date(),
      score: riskScore,
      factors: riskFactors
    });
  }

  async triggerHighRiskProtocol() {
    const response = `I notice you're going through a difficult time. 
    I strongly recommend speaking with a mental health professional. 
    Would you like me to help you connect with someone now?`;
    
    this.addMessageToChat('assistant', response, 'high-risk');
    this.showEmergencyResources();
  }

  async suggestProfessionalHelp() {
    const professionals = await this.getNearbyProfessionals();
    const response = `It might be helpful to talk to a professional about what you're experiencing. 
    I can help you find someone in your area. Would you like to see some options?`;
    
    this.addMessageToChat('assistant', response, 'suggestion');
    this.showProfessionalsList(professionals);
  }

  async getNearbyProfessionals() {
    try {
      const location = await this.getUserLocation();
      const response = await fetch(`/api/professionals?lat=${location.lat}&lng=${location.lng}`);
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch professionals:', error);
      return [];
    }
  }

  addMessageToChat(sender, message, type = 'normal') {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender} ${type}`;
    
    messageElement.innerHTML = `
      <div class="message-content">${message}</div>
      ${sender === 'assistant' ? this.createResponseActions() : ''}
    `;

    this.elements.chatContainer.appendChild(messageElement);
    this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;
  }

  createResponseActions() {
    return `
      <div class="message-actions">
        <button onclick="assistant.handleHelpful(this)">Helpful</button>
        <button onclick="assistant.handleNotHelpful(this)">Not Helpful</button>
      </div>
    `;
  }

  async handleHelpful(button) {
    const messageElement = button.closest('.message');
    const messageContent = messageElement.querySelector('.message-content').textContent;
    
    await this.saveUserFeedback({
      message: messageContent,
      helpful: true,
      timestamp: new Date()
    });

    button.parentElement.innerHTML = '<span class="feedback-received">Thanks for your feedback!</span>';
  }

  async handleNotHelpful(button) {
    const messageElement = button.closest('.message');
    const messageContent = messageElement.querySelector('.message-content').textContent;
    
    await this.saveUserFeedback({
      message: messageContent,
      helpful: false,
      timestamp: new Date()
    });

    this.showFeedbackForm(messageElement);
  }

  showEmergencyResources() {
    const resources = document.createElement('div');
    resources.className = 'emergency-resources';
    resources.innerHTML = `
      <h3>Emergency Resources</h3>
      <p>If you're in immediate danger, please call emergency services:</p>
      <div class="emergency-contacts">
        <button onclick="assistant.callEmergency()">Call 911</button>
        <button onclick="assistant.callHotline()">Crisis Hotline</button>
      </div>
    `;

    this.elements.resourcesPanel.appendChild(resources);
  }

  async saveConversation() {
    try {
      await this.db.post({
        type: 'conversation',
        messages: this.conversationHistory,
        timestamp: new Date(),
        riskAssessments: Array.from(this.riskLevels.values())
      });
    } catch (error) {
      console.error('Failed to save conversation:', error);
    }
  }
}

// Initialize the assistant
const assistant = new MentalHealthAssistant();