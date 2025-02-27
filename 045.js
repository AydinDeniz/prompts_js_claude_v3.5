class FinanceAssistant {
  constructor() {
    this.model = null;
    this.transactions = [];
    this.categories = new Map();
    this.budgets = new Map();
    this.goals = new Map();
    this.predictions = null;
    
    this.init();
  }

  async init() {
    await this.loadMLModel();
    this.setupDatabase();
    this.initializeUI();
    await this.loadUserData();
    this.startAnalysis();
  }

  async loadMLModel() {
    try {
      this.model = await tf.loadLayersModel('/models/finance/model.json');
      
      // Load category classifier
      this.categoryClassifier = await tf.loadLayersModel('/models/finance/category-classifier.json');
    } catch (error) {
      console.error('Failed to load ML models:', error);
    }
  }

  setupDatabase() {
    this.db = new PouchDB('finance_assistant');
    
    // Sync with remote database if available
    PouchDB.sync('finance_assistant', 'http://localhost:5984/finance_assistant', {
      live: true,
      retry: true
    });
  }

  initializeUI() {
    this.elements = {
      transactionForm: document.getElementById('transaction-form'),
      budgetPanel: document.getElementById('budget-panel'),
      goalsPanel: document.getElementById('goals-panel'),
      insightsPanel: document.getElementById('insights-panel'),
      forecastChart: document.getElementById('forecast-chart'),
      categoryChart: document.getElementById('category-chart'),
      trendChart: document.getElementById('trend-chart')
    };

    this.setupCharts();
    this.setupEventListeners();
  }

  setupCharts() {
    this.charts = {
      forecast: new Chart(this.elements.forecastChart, {
        type: 'line',
        options: {
          scales: {
            y: { beginAtZero: true }
          }
        }
      }),

      categories: new Chart(this.elements.categoryChart, {
        type: 'doughnut',
        options: {
          plugins: {
            legend: { position: 'right' }
          }
        }
      }),

      trends: new Chart(this.elements.trendChart, {
        type: 'bar',
        options: {
          scales: {
            y: { beginAtZero: true }
          }
        }
      })
    };
  }

  setupEventListeners() {
    this.elements.transactionForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addTransaction(new FormData(e.target));
    });

    document.getElementById('add-goal').addEventListener('click', () => {
      this.showGoalModal();
    });

    document.getElementById('adjust-budget').addEventListener('click', () => {
      this.showBudgetModal();
    });
  }

  async loadUserData() {
    try {
      // Load transactions
      const transactions = await this.db.allDocs({
        include_docs: true,
        attachments: true,
        startkey: 'transaction:',
        endkey: 'transaction:\uffff'
      });

      this.transactions = transactions.rows.map(row => row.doc);

      // Load budgets
      const budgets = await this.db.get('budgets');
      this.budgets = new Map(Object.entries(budgets));

      // Load goals
      const goals = await this.db.get('goals');
      this.goals = new Map(Object.entries(goals));

      this.updateUI();
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  }

  async addTransaction(formData) {
    const transaction = {
      _id: `transaction:${Date.now()}`,
      type: 'transaction',
      amount: parseFloat(formData.get('amount')),
      description: formData.get('description'),
      date: formData.get('date'),
      category: await this.predictCategory(formData.get('description')),
      timestamp: new Date().toISOString()
    };

    try {
      await this.db.put(transaction);
      this.transactions.push(transaction);
      this.updateAnalysis();
      this.updateUI();
    } catch (error) {
      console.error('Failed to save transaction:', error);
    }
  }

  async predictCategory(description) {
    const embedding = await this.getTextEmbedding(description);
    const prediction = this.categoryClassifier.predict(embedding);
    const categoryIndex = (await prediction.data())[0];
    return this.getCategoryById(categoryIndex);
  }

  async getTextEmbedding(text) {
    // Convert text to word embeddings
    const words = text.toLowerCase().split(' ');
    const embeddings = await Promise.all(
      words.map(word => this.wordToEmbedding(word))
    );
    
    // Average word embeddings
    return tf.tidy(() => {
      const tensorEmbeddings = embeddings.map(e => tf.tensor1d(e));
      return tf.stack(tensorEmbeddings).mean(0);
    });
  }

  async updateAnalysis() {
    // Update spending patterns
    const patterns = this.analyzeSpendingPatterns();
    
    // Generate predictions
    this.predictions = await this.generatePredictions();
    
    // Update recommendations
    const recommendations = this.generateRecommendations(patterns);
    
    this.updateInsightsPanel(patterns, recommendations);
    this.updateCharts();
  }

  analyzeSpendingPatterns() {
    const patterns = {
      byCategory: this.aggregateByCategory(),
      byMonth: this.aggregateByMonth(),
      trends: this.calculateTrends(),
      anomalies: this.detectAnomalies()
    };

    return patterns;
  }

  aggregateByCategory() {
    return this.transactions.reduce((acc, transaction) => {
      const category = transaction.category;
      acc[category] = (acc[category] || 0) + transaction.amount;
      return acc;
    }, {});
  }

  aggregateByMonth() {
    return this.transactions.reduce((acc, transaction) => {
      const month = transaction.date.substring(0, 7);
      acc[month] = (acc[month] || 0) + transaction.amount;
      return acc;
    }, {});
  }

  calculateTrends() {
    const monthlyData = this.aggregateByMonth();
    const months = Object.keys(monthlyData).sort();
    
    if (months.length < 2) return null;

    const values = months.map(month => monthlyData[month]);
    const trend = this.calculateLinearRegression(values);

    return {
      slope: trend.slope,
      direction: trend.slope > 0 ? 'increasing' : 'decreasing',
      percentage: this.calculatePercentageChange(values[0], values[values.length - 1])
    };
  }

  calculateLinearRegression(values) {
    const n = values.length;
    const x = Array.from({length: n}, (_, i) => i);
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, x, i) => acc + x * values[i], 0);
    const sumXX = x.reduce((acc, x) => acc + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }

  async generatePredictions() {
    const historicalData = this.prepareHistoricalData();
    const input = tf.tensor2d([historicalData]);
    
    const prediction = this.model.predict(input);
    const forecastData = await prediction.data();

    return {
      nextMonth: forecastData[0],
      threeMonths: forecastData.slice(0, 3),
      sixMonths: forecastData.slice(0, 6)
    };
  }

  prepareHistoricalData() {
    const months = Object.keys(this.aggregateByMonth()).sort();
    return months.slice(-12).map(month => {
      const transactions = this.transactions.filter(t => t.date.startsWith(month));
      return [
        this.sumTransactions(transactions),
        this.calculateAverageTransaction(transactions),
        this.countTransactions(transactions),
        this.calculateCategoryDistribution(transactions)
      ].flat();
    });
  }

  generateRecommendations(patterns) {
    const recommendations = [];

    // Budget recommendations
    this.analyzeBudgetCompliance(patterns).forEach(rec => 
      recommendations.push({
        type: 'budget',
        priority: rec.overspend ? 'high' : 'medium',
        message: rec.message,
        action: rec.action
      })
    );

    // Savings recommendations
    this.analyzeSavingsPotential(patterns).forEach(rec =>
      recommendations.push({
        type: 'savings',
        priority: 'medium',
        message: rec.message,
        action: rec.action
      })
    );

    // Spending pattern recommendations
    this.analyzeSpendingBehavior(patterns).forEach(rec =>
      recommendations.push({
        type: 'behavior',
        priority: rec.priority,
        message: rec.message,
        action: rec.action
      })
    );

    return recommendations;
  }

  updateInsightsPanel(patterns, recommendations) {
    this.elements.insightsPanel.innerHTML = `
      <div class="insights-section">
        <h3>Spending Insights</h3>
        ${this.renderSpendingInsights(patterns)}
      </div>
      <div class="recommendations-section">
        <h3>Recommendations</h3>
        ${this.renderRecommendations(recommendations)}
      </div>
      <div class="forecast-section">
        <h3>Financial Forecast</h3>
        ${this.renderForecast(this.predictions)}
      </div>
    `;
  }

  updateCharts() {
    // Update forecast chart
    this.charts.forecast.data = {
      labels: this.getNextMonths(6),
      datasets: [{
        label: 'Predicted Spending',
        data: this.predictions.sixMonths,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      }]
    };
    this.charts.forecast.update();

    // Update category distribution chart
    const categoryData = this.aggregateByCategory();
    this.charts.categories.data = {
      labels: Object.keys(categoryData),
      datasets: [{
        data: Object.values(categoryData),
        backgroundColor: this.generateColors(Object.keys(categoryData).length)
      }]
    };
    this.charts.categories.update();

    // Update trends chart
    const monthlyData = this.aggregateByMonth();
    this.charts.trends.data = {
      labels: Object.keys(monthlyData),
      datasets: [{
        label: 'Monthly Spending',
        data: Object.values(monthlyData),
        backgroundColor: 'rgb(54, 162, 235)'
      }]
    };
    this.charts.trends.update();
  }

  generateColors(count) {
    const colors = [
      '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
      '#FF9F40', '#FF6384', '#C9CBCF', '#4BC0C0', '#FF9F40'
    ];
    return Array(count).fill().map((_, i) => colors[i % colors.length]);
  }

  showGoalModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>Set Financial Goal</h2>
        <form id="goal-form">
          <input type="text" name="name" placeholder="Goal Name" required>
          <input type="number" name="amount" placeholder="Target Amount" required>
          <input type="date" name="targetDate" required>
          <button type="submit">Set Goal</button>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('goal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.addGoal(new FormData(e.target));
      modal.remove();
    });
  }

  async addGoal(formData) {
    const goal = {
      name: formData.get('name'),
      targetAmount: parseFloat(formData.get('amount')),
      targetDate: formData.get('targetDate'),
      currentAmount: 0,
      createdAt: new Date().toISOString()
    };

    this.goals.set(goal.name, goal);
    await this.saveGoals();
    this.updateUI();
  }

  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }
}

// Initialize finance assistant
const financeAssistant = new FinanceAssistant();