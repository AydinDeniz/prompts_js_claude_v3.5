class SelfLearningChatbot {
  constructor() {
    this.model = null;
    this.tokenizer = null;
    this.db = null;
    this.conversationHistory = [];
    this.learningRate = 0.001;
    this.maxTokens = 100;
    
    this.init();
  }

  async init() {
    await this.initializeModel();
    await this.connectDatabase();
    this.setupUI();
    await this.loadTrainingData();
  }

  async initializeModel() {
    try {
      // Load pre-trained model
      this.model = await tf.loadLayersModel('/models/chatbot/model.json');
      
      // Initialize tokenizer
      const response = await fetch('/models/chatbot/tokenizer.json');
      this.tokenizer = await response.json();
      
      // Warm up the model
      this.model.predict(tf.zeros([1, this.maxTokens]));
    } catch (error) {
      console.error('Model initialization failed:', error);
    }
  }

  async connectDatabase() {
    this.db = new PouchDB('chatbot');
    this.remoteDb = new PouchDB('http://localhost:5984/chatbot');
    
    // Set up sync
    PouchDB.sync(this.db, this.remoteDb, {
      live: true,
      retry: true
    }).on('error', console.error);
  }

  setupUI() {
    this.elements = {
      chatContainer: document.getElementById('chat-container'),
      messageInput: document.getElementById('message-input'),
      sendButton: document.getElementById('send-button'),
      feedbackButtons: document.getElementById('feedback-buttons')
    };

    this.elements.sendButton.addEventListener('click', () => {
      this.handleUserInput();
    });

    this.elements.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleUserInput();
      }
    });
  }

  async loadTrainingData() {
    try {
      const result = await this.db.allDocs({
        include_docs: true,
        attachments: true
      });

      this.conversationHistory = result.rows
        .map(row => row.doc)
        .filter(doc => doc.type === 'conversation');
    } catch (error) {
      console.error('Failed to load training data:', error);
    }
  }

  async handleUserInput() {
    const input = this.elements.messageInput.value.trim();
    if (!input) return;

    this.elements.messageInput.value = '';
    this.addMessageToChat('user', input);

    const response = await this.generateResponse(input);
    this.addMessageToChat('bot', response);

    await this.saveConversation(input, response);
  }

  async generateResponse(input) {
    const tokenizedInput = this.tokenizeText(input);
    const inputTensor = this.prepareTensor(tokenizedInput);
    
    const prediction = this.model.predict(inputTensor);
    const response = await this.decodeResponse(prediction);
    
    return response;
  }

  tokenizeText(text) {
    return text.toLowerCase()
      .split(' ')
      .map(word => this.tokenizer[word] || this.tokenizer['<unk>']);
  }

  prepareTensor(tokens) {
    // Pad or truncate to maxTokens
    const paddedTokens = tokens.length < this.maxTokens
      ? [...tokens, ...Array(this.maxTokens - tokens.length).fill(0)]
      : tokens.slice(0, this.maxTokens);

    return tf.tensor2d([paddedTokens], [1, this.maxTokens]);
  }

  async decodeResponse(prediction) {
    const probabilities = await prediction.data();
    const tokenIds = this.sampleFromDistribution(probabilities);
    
    return tokenIds
      .map(id => this.reverseTokenizer[id])
      .filter(word => word && word !== '<unk>' && word !== '<pad>')
      .join(' ');
  }

  sampleFromDistribution(probabilities) {
    const tokens = [];
    for (let i = 0; i < this.maxTokens; i++) {
      const idx = tf.multinomial(tf.tensor1d(probabilities), 1).dataSync()[0];
      tokens.push(idx);
      if (idx === this.tokenizer['<end>']) break;
    }
    return tokens;
  }

  addMessageToChat(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}`;
    messageElement.innerHTML = `
      <div class="message-content">${message}</div>
      ${sender === 'bot' ? this.createFeedbackButtons() : ''}
    `;

    this.elements.chatContainer.appendChild(messageElement);
    this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;
  }

  createFeedbackButtons() {
    return `
      <div class="feedback-buttons">
        <button onclick="chatbot.handleFeedback(this, true)">👍</button>
        <button onclick="chatbot.handleFeedback(this, false)">👎</button>
      </div>
    `;
  }

  async handleFeedback(button, isPositive) {
    const messageElement = button.closest('.message');
    const messageContent = messageElement.querySelector('.message-content').textContent;
    const feedbackButtons = messageElement.querySelector('.feedback-buttons');
    
    feedbackButtons.innerHTML = `Feedback recorded: ${isPositive ? '👍' : '👎'}`;
    
    await this.updateModelWithFeedback(messageContent, isPositive);
  }

  async updateModelWithFeedback(response, isPositive) {
    const conversation = this.conversationHistory[this.conversationHistory.length - 1];
    if (!conversation) return;

    conversation.feedback = isPositive;
    await this.db.put(conversation);

    if (!isPositive) {
      await this.trainOnNegativeFeedback(conversation);
    }
  }

  async trainOnNegativeFeedback(conversation) {
    const input = this.tokenizeText(conversation.input);
    const inputTensor = this.prepareTensor(input);
    
    // Get alternative responses from similar conversations
    const alternatives = await this.findAlternativeResponses(conversation.input);
    if (!alternatives.length) return;

    // Train model to prefer alternative responses
    const alternativeTokens = alternatives.map(alt => this.tokenizeText(alt));
    const targetTensor = tf.tensor2d(alternativeTokens);

    await this.model.fit(inputTensor, targetTensor, {
      epochs: 1,
      batchSize: 1,
      learningRate: this.learningRate
    });
  }

  async findAlternativeResponses(input) {
    const similar = await this.db.find({
      selector: {
        type: 'conversation',
        feedback: true,
        input: { $regex: new RegExp(input.split(' ').join('|'), 'i') }
      },
      limit: 5
    });

    return similar.docs.map(doc => doc.response);
  }

  async saveConversation(input, response) {
    const conversation = {
      _id: Date.now().toString(),
      type: 'conversation',
      timestamp: new Date().toISOString(),
      input,
      response,
      feedback: null
    };

    try {
      await this.db.put(conversation);
      this.conversationHistory.push(conversation);
    } catch (error) {
      console.error('Failed to save conversation:', error);
    }
  }

  async exportModel() {
    try {
      await this.model.save('downloads://chatbot-model');
      console.log('Model exported successfully');
    } catch (error) {
      console.error('Failed to export model:', error);
    }
  }

  async importModel(modelFile) {
    try {
      this.model = await tf.loadLayersModel(tf.io.browserFiles([modelFile]));
      console.log('Model imported successfully');
    } catch (error) {
      console.error('Failed to import model:', error);
    }
  }
}

// Initialize chatbot
const chatbot = new SelfLearningChatbot();