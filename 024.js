class FinanceTracker {
  constructor() {
    this.API_URL = '/api/finance';
    this.PLAID_PUBLIC_KEY = 'your_plaid_public_key';
    this.categories = new Map();
    this.transactions = [];
    this.aiModel = null;
    
    this.init();
  }

  async init() {
    await this.initializeAI();
    this.initializePlaid();
    this.initializeUI();
    this.setupCharts();
    this.setupEventListeners();
    await this.loadUserData();
  }

  async initializeAI() {
    try {
      this.aiModel = await tf.loadLayersModel('/models/categorization/model.json');
      await this.loadCategories();
    } catch (error) {
      console.error('Failed to load AI model:', error);
    }
  }

  initializePlaid() {
    this.plaidHandler = Plaid.create({
      clientName: 'Finance Tracker',
      env: 'sandbox',
      product: ['transactions'],
      publicKey: this.PLAID_PUBLIC_KEY,
      onSuccess: (public_token) => this.handlePlaidSuccess(public_token),
      onExit: (err) => this.handlePlaidExit(err)
    });
  }

  initializeUI() {
    this.elements = {
      transactionList: document.getElementById('transaction-list'),
      categoryChart: document.getElementById('category-chart'),
      trendChart: document.getElementById('trend-chart'),
      budgetChart: document.getElementById('budget-chart'),
      linkButton: document.getElementById('link-account'),
      syncButton: document.getElementById('sync-transactions'),
      dateRange: document.getElementById('date-range'),
      categoryFilters: document.getElementById('category-filters')
    };
  }

  setupCharts() {
    // Category distribution chart
    this.categoryChart = new Chart(this.elements.categoryChart, {
      type: 'doughnut',
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right' }
        }
      }
    });

    // Spending trends chart
    this.trendChart = new Chart(this.elements.trendChart, {
      type: 'line',
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });

    // Budget tracking chart
    this.budgetChart = new Chart(this.elements.budgetChart, {
      type: 'bar',
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  setupEventListeners() {
    this.elements.linkButton.addEventListener('click', () => {
      this.plaidHandler.open();
    });

    this.elements.syncButton.addEventListener('click', () => {
      this.syncTransactions();
    });

    this.elements.dateRange.addEventListener('change', () => {
      this.updateCharts();
    });

    this.elements.categoryFilters.addEventListener('change', () => {
      this.filterTransactions();
    });
  }

  async loadUserData() {
    try {
      const [accounts, transactions] = await Promise.all([
        this.fetchAccounts(),
        this.fetchTransactions()
      ]);

      this.accounts = accounts;
      this.transactions = transactions;
      
      this.updateUI();
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  }

  async handlePlaidSuccess(public_token) {
    try {
      const response = await fetch(`${this.API_URL}/plaid/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token })
      });

      if (response.ok) {
        await this.syncTransactions();
      }
    } catch (error) {
      console.error('Plaid token exchange failed:', error);
    }
  }

  async syncTransactions() {
    try {
      const transactions = await this.fetchPlaidTransactions();
      const categorizedTransactions = await this.categorizeTransactions(transactions);
      await this.saveTransactions(categorizedTransactions);
      
      this.transactions = categorizedTransactions;
      this.updateUI();
    } catch (error) {
      console.error('Transaction sync failed:', error);
    }
  }

  async categorizeTransactions(transactions) {
    return Promise.all(transactions.map(async transaction => {
      const category = await this.predictCategory(transaction);
      return { ...transaction, predicted_category: category };
    }));
  }

  async predictCategory(transaction) {
    try {
      // Prepare transaction data for prediction
      const features = this.extractFeatures(transaction);
      const tensorFeatures = tf.tensor2d([features]);
      
      // Make prediction
      const prediction = this.aiModel.predict(tensorFeatures);
      const categoryIndex = prediction.argMax(1).dataSync()[0];
      
      tensorFeatures.dispose();
      prediction.dispose();

      return this.categories.get(categoryIndex);
    } catch (error) {
      console.error('Category prediction failed:', error);
      return 'Uncategorized';
    }
  }

  extractFeatures(transaction) {
    // Convert transaction data to numerical features
    const features = [
      transaction.amount,
      this.encodeMerchant(transaction.merchant_name),
      this.encodeTime(transaction.date),
      // Add more relevant features
    ];

    return features;
  }

  encodeMerchant(merchantName) {
    // Simple merchant encoding - implement more sophisticated logic
    const merchantWords = merchantName.toLowerCase().split(' ');
    return merchantWords.reduce((hash, word) => {
      return hash + word.split('').reduce((h, c) => {
        return ((h << 5) - h) + c.charCodeAt(0);
      }, 0);
    }, 0);
  }

  encodeTime(date) {
    const d = new Date(date);
    return (d.getHours() * 60 + d.getMinutes()) / (24 * 60);
  }

  updateUI() {
    this.updateTransactionList();
    this.updateCharts();
    this.updateInsights();
  }

  updateTransactionList() {
    this.elements.transactionList.innerHTML = this.transactions
      .map(transaction => `
        <div class="transaction-item">
          <div class="transaction-date">
            ${new Date(transaction.date).toLocaleDateString()}
          </div>
          <div class="transaction-merchant">
            ${transaction.merchant_name}
          </div>
          <div class="transaction-amount">
            ${this.formatCurrency(transaction.amount)}
          </div>
          <div class="transaction-category">
            ${transaction.predicted_category}
            <button onclick="financeTracker.editCategory('${transaction.id}')">
              Edit
            </button>
          </div>
        </div>
      `)
      .join('');
  }

  updateCharts() {
    this.updateCategoryChart();
    this.updateTrendChart();
    this.updateBudgetChart();
  }

  updateCategoryChart() {
    const categoryTotals = this.transactions.reduce((totals, t) => {
      totals[t.predicted_category] = (totals[t.predicted_category] || 0) + t.amount;
      return totals;
    }, {});

    this.categoryChart.data = {
      labels: Object.keys(categoryTotals),
      datasets: [{
        data: Object.values(categoryTotals),
        backgroundColor: this.generateColors(Object.keys(categoryTotals).length)
      }]
    };
    
    this.categoryChart.update();
  }

  updateTrendChart() {
    const dailyTotals = this.transactions.reduce((totals, t) => {
      const date = t.date.split('T')[0];
      totals[date] = (totals[date] || 0) + t.amount;
      return totals;
    }, {});

    this.trendChart.data = {
      labels: Object.keys(dailyTotals),
      datasets: [{
        label: 'Daily Spending',
        data: Object.values(dailyTotals),
        borderColor: '#4CAF50',
        tension: 0.1
      }]
    };
    
    this.trendChart.update();
  }

  updateBudgetChart() {
    const categoryBudgets = this.getBudgets();
    const categorySpending = this.transactions.reduce((totals, t) => {
      totals[t.predicted_category] = (totals[t.predicted_category] || 0) + t.amount;
      return totals;
    }, {});

    this.budgetChart.data = {
      labels: Object.keys(categoryBudgets),
      datasets: [{
        label: 'Budget',
        data: Object.values(categoryBudgets),
        backgroundColor: '#2196F3'
      }, {
        label: 'Actual',
        data: Object.keys(categoryBudgets).map(cat => categorySpending[cat] || 0),
        backgroundColor: '#F44336'
      }]
    };
    
    this.budgetChart.update();
  }

  updateInsights() {
    // Generate and display financial insights
    const insights = this.generateInsights();
    this.displayInsights(insights);
  }

  generateInsights() {
    const insights = [];
    
    // Unusual spending patterns
    const unusualTransactions = this.detectAnomalies();
    if (unusualTransactions.length > 0) {
      insights.push({
        type: 'warning',
        message: 'Unusual spending detected',
        details: unusualTransactions
      });
    }

    // Budget warnings
    const budgetWarnings = this.checkBudgets();
    if (budgetWarnings.length > 0) {
      insights.push({
        type: 'alert',
        message: 'Budget limits approaching',
        details: budgetWarnings
      });
    }

    // Saving opportunities
    const savingTips = this.findSavingOpportunities();
    if (savingTips.length > 0) {
      insights.push({
        type: 'tip',
        message: 'Saving opportunities found',
        details: savingTips
      });
    }

    return insights;
  }

  detectAnomalies() {
    // Implement anomaly detection logic
    return [];
  }

  checkBudgets() {
    // Implement budget checking logic
    return [];
  }

  findSavingOpportunities() {
    // Implement saving opportunities logic
    return [];
  }

  displayInsights(insights) {
    const insightsContainer = document.getElementById('insights');
    insightsContainer.innerHTML = insights
      .map(insight => `
        <div class="insight ${insight.type}">
          <h3>${insight.message}</h3>
          <ul>
            ${insight.details.map(detail => `<li>${detail}</li>`).join('')}
          </ul>
        </div>
      `)
      .join('');
  }

  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  generateColors(count) {
    const colors = [
      '#4CAF50', '#2196F3', '#F44336', '#FFC107', '#9C27B0',
      '#00BCD4', '#FF5722', '#795548', '#607D8B', '#E91E63'
    ];
    return Array(count).fill().map((_, i) => colors[i % colors.length]);
  }
}

// Initialize the finance tracker
const financeTracker = new FinanceTracker();