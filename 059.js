class LanguageLearningPlatform {
  constructor() {
    this.lessons = new Map();
    this.flashcards = new Map();
    this.quizzes = new Map();
    this.userProgress = new Map();
    this.currentLanguage = null;
    this.speechSynthesis = window.speechSynthesis;
    this.recognition = new webkitSpeechRecognition();
    
    this.init();
  }

  async init() {
    await this.initializeAPIs();
    this.setupDatabase();
    this.initializeUI();
    await this.loadUserData();
    this.setupSpeechRecognition();
  }

  async initializeAPIs() {
    // Initialize translation API
    this.translator = new TranslationAPI({
      apiKey: process.env.TRANSLATION_API_KEY
    });

    // Initialize pronunciation API
    this.pronunciationAPI = new PronunciationAPI({
      apiKey: process.env.PRONUNCIATION_API_KEY
    });

    // Initialize dictionary API
    this.dictionaryAPI = new DictionaryAPI({
      apiKey: process.env.DICTIONARY_API_KEY
    });
  }

  setupDatabase() {
    this.db = new PouchDB('language_learning');
    
    PouchDB.sync('language_learning', 'http://localhost:5984/language_learning', {
      live: true,
      retry: true
    });
  }

  initializeUI() {
    this.elements = {
      lessonContainer: document.getElementById('lesson-container'),
      flashcardDeck: document.getElementById('flashcard-deck'),
      quizPanel: document.getElementById('quiz-panel'),
      progressChart: document.getElementById('progress-chart'),
      pronunciationTool: document.getElementById('pronunciation-tool'),
      vocabularyList: document.getElementById('vocabulary-list')
    };

    this.setupEventListeners();
    this.initializeCharts();
  }

  setupEventListeners() {
    document.getElementById('language-selector').addEventListener('change', (e) => {
      this.switchLanguage(e.target.value);
    });

    document.getElementById('start-lesson').addEventListener('click', () => {
      this.startLesson();
    });

    document.getElementById('practice-pronunciation').addEventListener('click', () => {
      this.startPronunciationPractice();
    });
  }

  initializeCharts() {
    this.charts = {
      progress: new Chart(document.getElementById('progress-chart'), {
        type: 'line',
        options: {
          scales: { y: { beginAtZero: true } }
        }
      }),

      vocabulary: new Chart(document.getElementById('vocabulary-chart'), {
        type: 'bar',
        options: {
          scales: { y: { beginAtZero: true } }
        }
      }),

      accuracy: new Chart(document.getElementById('accuracy-chart'), {
        type: 'doughnut',
        options: {
          plugins: { legend: { position: 'right' } }
        }
      })
    };
  }

  async loadUserData() {
    try {
      const [progress, vocabulary] = await Promise.all([
        this.db.get('userProgress'),
        this.db.get('vocabulary')
      ]);

      this.userProgress = new Map(Object.entries(progress));
      this.vocabulary = new Map(Object.entries(vocabulary));
      
      this.updateUI();
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  }

  setupSpeechRecognition() {
    this.recognition.continuous = false;
    this.recognition.interimResults = false;

    this.recognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript;
      this.evaluatePronunciation(spokenText);
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
    };
  }

  async switchLanguage(languageCode) {
    this.currentLanguage = languageCode;
    await this.loadLanguageResources(languageCode);
    this.updateUI();
  }

  async loadLanguageResources(languageCode) {
    try {
      const [lessons, flashcards, quizzes] = await Promise.all([
        this.loadLessons(languageCode),
        this.loadFlashcards(languageCode),
        this.loadQuizzes(languageCode)
      ]);

      this.lessons = new Map(lessons.map(lesson => [lesson.id, lesson]));
      this.flashcards = new Map(flashcards.map(card => [card.id, card]));
      this.quizzes = new Map(quizzes.map(quiz => [quiz.id, quiz]));
    } catch (error) {
      console.error('Failed to load language resources:', error);
    }
  }

  async startLesson() {
    const lesson = this.getCurrentLesson();
    if (!lesson) return;

    this.elements.lessonContainer.innerHTML = `
      <div class="lesson">
        <h2>${lesson.title}</h2>
        <div class="lesson-content">
          ${this.renderLessonContent(lesson)}
        </div>
        <div class="lesson-exercises">
          ${this.renderExercises(lesson.exercises)}
        </div>
        <div class="lesson-controls">
          <button onclick="languagePlatform.checkExercises()">
            Check Answers
          </button>
          <button onclick="languagePlatform.nextLesson()">
            Next Lesson
          </button>
        </div>
      </div>
    `;
  }

  renderLessonContent(lesson) {
    return `
      <div class="content-section">
        <div class="vocabulary">
          ${lesson.vocabulary.map(word => `
            <div class="vocabulary-item">
              <span class="word">${word.term}</span>
              <span class="translation">${word.translation}</span>
              <button onclick="languagePlatform.pronounceWord('${word.term}')">
                🔊
              </button>
            </div>
          `).join('')}
        </div>
        <div class="grammar">
          <h3>Grammar Points</h3>
          ${lesson.grammarPoints.map(point => `
            <div class="grammar-point">
              <h4>${point.title}</h4>
              <p>${point.explanation}</p>
              <div class="examples">
                ${point.examples.map(example => `
                  <div class="example">
                    <span class="original">${example.original}</span>
                    <span class="translation">${example.translation}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  async pronounceWord(word) {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = this.currentLanguage;
    this.speechSynthesis.speak(utterance);
  }

  startPronunciationPractice() {
    const word = this.getRandomVocabularyWord();
    
    this.elements.pronunciationTool.innerHTML = `
      <div class="pronunciation-practice">
        <h3>Pronounce the word:</h3>
        <div class="word-display">${word.term}</div>
        <div class="controls">
          <button onclick="languagePlatform.pronounceWord('${word.term}')">
            Hear Pronunciation
          </button>
          <button onclick="languagePlatform.startRecording()">
            Start Recording
          </button>
        </div>
        <div class="feedback"></div>
      </div>
    `;
  }

  startRecording() {
    this.recognition.start();
  }

  async evaluatePronunciation(spokenText) {
    try {
      const score = await this.pronunciationAPI.evaluate(
        spokenText,
        this.currentWord.term,
        this.currentLanguage
      );

      this.showPronunciationFeedback(score);
      this.updatePronunciationProgress(score);
    } catch (error) {
      console.error('Pronunciation evaluation failed:', error);
    }
  }

  showPronunciationFeedback(score) {
    const feedback = document.querySelector('.feedback');
    feedback.innerHTML = `
      <div class="score">Score: ${score}%</div>
      <div class="feedback-text">
        ${this.getPronunciationFeedback(score)}
      </div>
    `;
  }

  getPronunciationFeedback(score) {
    if (score >= 90) return 'Excellent pronunciation!';
    if (score >= 70) return 'Good pronunciation. Keep practicing!';
    return 'Try again. Focus on the correct sounds.';
  }

  startFlashcards() {
    const deck = Array.from(this.flashcards.values())
      .filter(card => this.isCardDueForReview(card));

    this.elements.flashcardDeck.innerHTML = `
      <div class="flashcard-container">
        ${deck.map(card => this.renderFlashcard(card)).join('')}
      </div>
    `;

    this.initializeFlashcardControls();
  }

  renderFlashcard(card) {
    return `
      <div class="flashcard" data-card-id="${card.id}">
        <div class="card-front">${card.front}</div>
        <div class="card-back">${card.back}</div>
        <div class="card-controls">
          <button onclick="languagePlatform.flipCard('${card.id}')">
            Flip
          </button>
          <div class="confidence-buttons">
            <button onclick="languagePlatform.rateCard('${card.id}', 1)">
              Hard
            </button>
            <button onclick="languagePlatform.rateCard('${card.id}', 2)">
              Medium
            </button>
            <button onclick="languagePlatform.rateCard('${card.id}', 3)">
              Easy
            </button>
          </div>
        </div>
      </div>
    `;
  }

  flipCard(cardId) {
    const card = document.querySelector(`.flashcard[data-card-id="${cardId}"]`);
    card.classList.toggle('flipped');
  }

  async rateCard(cardId, rating) {
    const card = this.flashcards.get(cardId);
    if (!card) return;

    // Update card spacing using spaced repetition algorithm
    card.nextReview = this.calculateNextReview(rating);
    card.easeFactor = this.updateEaseFactor(card.easeFactor, rating);

    await this.updateCardInDatabase(card);
    this.moveToNextCard();
  }

  calculateNextReview(rating) {
    // Implement spaced repetition algorithm (e.g., SuperMemo 2)
    const intervals = [1, 3, 7, 14, 30, 90];
    const now = new Date();
    return new Date(now.setDate(now.getDate() + intervals[rating - 1]));
  }

  startQuiz() {
    const quiz = this.getCurrentQuiz();
    if (!quiz) return;

    this.elements.quizPanel.innerHTML = `
      <div class="quiz">
        <h2>${quiz.title}</h2>
        ${quiz.questions.map((question, index) => `
          <div class="question">
            <p>${question.text}</p>
            <div class="options">
              ${question.options.map(option => `
                <label>
                  <input type="radio" 
                         name="q${index}" 
                         value="${option}">
                  ${option}
                </label>
              `).join('')}
            </div>
          </div>
        `).join('')}
        <button onclick="languagePlatform.submitQuiz()">
          Submit Quiz
        </button>
      </div>
    `;
  }

  async submitQuiz() {
    const answers = this.collectQuizAnswers();
    const score = this.calculateQuizScore(answers);
    
    await this.updateQuizProgress(score);
    this.showQuizResults(score);
  }

  updateUI() {
    this.updateProgressChart();
    this.updateVocabularyList();
    this.updateLessonStatus();
  }

  updateProgressChart() {
    const progressData = this.calculateProgressData();
    
    this.charts.progress.data = {
      labels: progressData.labels,
      datasets: [{
        label: 'Learning Progress',
        data: progressData.values,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      }]
    };
    this.charts.progress.update();
  }
}

// Initialize platform
const languagePlatform = new LanguageLearningPlatform();