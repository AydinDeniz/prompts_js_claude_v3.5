class ExpenseTracker {
  constructor() {
    this.transactions = [];
    this.categories = new Map();
    this.budgets = new Map();
    this.charts = null;
    
    this.init();
  }

  init() {
    this.loadStoredData();
    this.initializeUI();
    this.setupEventListeners();
    this.setupCharts();
    this.updateDashboard();
  }

  loadStoredData() {
    // Load transactions from localStorage
    const storedTransactions = localStorage.getItem('transactions');
    if (storedTransactions) {
      this.transactions = JSON.parse(storedTransactions);
    }

    // Load categories
    const storedCategories = localStorage.getItem('categories');
    if (storedCategories) {
      this.categories = new Map(JSON.parse(storedCategories));
    } else {
      // Set default categories
      this.setupDefaultCategories();
    }

    // Load budgets
    const storedBudgets = localStorage.getItem('budgets');
    if (storedBudgets) {
      this.budgets = new Map(JSON.parse(storedBudgets));
    }
  }

  setupDefaultCategories() {
    const defaults = [
      { id: 'food', name: 'Food & Dining', color: '#FF6384' },
      { id: 'transport', name: 'Transportation', color: '#36A2EB' },
      { id: 'utilities', name: 'Utilities', color: '#FFCE56' },
      { id: 'entertainment', name: 'Entertainment', color: '#4BC0C0' },
      { id: 'shopping', name: 'Shopping', color: '#9966FF' },
      { id: 'health', name: 'Healthcare', color: '#FF9F40' }
    ];

    defaults.forEach(category => {
      this.categories.set(category.id, category);
    });
  }

  initializeUI() {
    this.elements = {
      transactionForm: document.getElementById('transaction-form'),
      transactionList: document.getElementById('transaction-list'),
      categorySelect: document.getElementById('category-select'),
      budgetPanel: document.getElementById('budget-panel'),
      summaryPanel: document.getElementById('summary-panel'),
      chartContainer: document.getElementById('chart-container'),
      dateRangeSelector: document.getElementById('date-range')
    };

    this.populateCategorySelect();
  }

  setupEventListeners() {
    this.elements.transactionForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addTransaction(new FormData(e.target));
    });

    this.elements.dateRangeSelector.addEventListener('change', () => {
      this.updateDashboard();
    });

    document.getElementById('add-category').addEventListener('click', () => {
      this.showCategoryModal();
    });

    document.getElementById('set-budget').addEventListener('click', () => {
      this.showBudgetModal();
    });
  }

  setupCharts() {
    this.charts = {
      categoryDistribution: new Chart(
        document.getElementById('category-chart'), {
          type: 'doughnut',
          options: {
            responsive: true,
            plugins: {
              legend: { position: 'right' }
            }
          }
        }
      ),

      monthlyTrend: new Chart(
        document.getElementById('trend-chart'), {
          type: 'line',
          options: {
            scales: {
              y: { beginAtZero: true }
            }
          }
        }
      ),

      budgetComparison: new Chart(
        document.getElementById('budget-chart'), {
          type: 'bar',
          options: {
            scales: {
              y: { beginAtZero: true }
            }
          }
        }
      )
    };
  }

  addTransaction(formData) {
    const transaction = {
      id: Date.now().toString(),
      date: formData.get('date'),
      amount: parseFloat(formData.get('amount')),
      category: formData.get('category'),
      description: formData.get('description'),
      type: formData.get('type')
    };

    this.transactions.push(transaction);
    this.saveTransactions();
    this.updateDashboard();
    this.elements.transactionForm.reset();
  }

  saveTransactions() {
    localStorage.setItem('transactions', JSON.stringify(this.transactions));
  }

  updateDashboard() {
    this.updateTransactionList();
    this.updateSummary();
    this.updateCharts();
    this.checkBudgetAlerts();
  }

  updateTransactionList() {
    const dateRange = this.getSelectedDateRange();
    const filteredTransactions = this.filterTransactionsByDate(dateRange);

    this.elements.transactionList.innerHTML = filteredTransactions
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(transaction => this.createTransactionElement(transaction))
      .join('');
  }

  createTransactionElement(transaction) {
    const category = this.categories.get(transaction.category);
    return `
      <div class="transaction-item ${transaction.type}" data-id="${transaction.id}">
        <div class="transaction-date">${this.formatDate(transaction.date)}</div>
        <div class="transaction-category" style="color: ${category.color}">
          ${category.name}
        </div>
        <div class="transaction-description">${transaction.description}</div>
        <div class="transaction-amount">
          ${this.formatCurrency(transaction.amount)}
        </div>
        <div class="transaction-actions">
          <button onclick="expenseTracker.editTransaction('${transaction.id}')">
            Edit
          </button>
          <button onclick="expenseTracker.deleteTransaction('${transaction.id}')">
            Delete
          </button>
        </div>
      </div>
    `;
  }

  updateSummary() {
    const dateRange = this.getSelectedDateRange();
    const transactions = this.filterTransactionsByDate(dateRange);
    
    const summary = {
      totalExpenses: this.calculateTotal(transactions, 'expense'),
      totalIncome: this.calculateTotal(transactions, 'income'),
      categoryTotals: this.calculateCategoryTotals(transactions),
      balance: this.calculateBalance(transactions)
    };

    this.elements.summaryPanel.innerHTML = `
      <div class="summary-item">
        <h3>Total Income</h3>
        <span class="income">${this.formatCurrency(summary.totalIncome)}</span>
      </div>
      <div class="summary-item">
        <h3>Total Expenses</h3>
        <span class="expense">${this.formatCurrency(summary.totalExpenses)}</span>
      </div>
      <div class="summary-item">
        <h3>Balance</h3>
        <span class="${summary.balance >= 0 ? 'positive' : 'negative'}">
          ${this.formatCurrency(summary.balance)}
        </span>
      </div>
    `;
  }

  updateCharts() {
    const dateRange = this.getSelectedDateRange();
    const transactions = this.filterTransactionsByDate(dateRange);

    // Update category distribution chart
    const categoryData = this.calculateCategoryTotals(transactions);
    this.charts.categoryDistribution.data = {
      labels: Array.from(this.categories.values()).map(c => c.name),
      datasets: [{
        data: Array.from(this.categories.keys()).map(id => categoryData[id] || 0),
        backgroundColor: Array.from(this.categories.values()).map(c => c.color)
      }]
    };
    this.charts.categoryDistribution.update();

    // Update monthly trend chart
    const monthlyData = this.calculateMonthlyTotals(transactions);
    this.charts.monthlyTrend.data = {
      labels: Object.keys(monthlyData),
      datasets: [{
        label: 'Monthly Expenses',
        data: Object.values(monthlyData),
        borderColor: '#36A2EB',
        tension: 0.1
      }]
    };
    this.charts.monthlyTrend.update();

    // Update budget comparison chart
    const budgetComparison = this.compareBudgetToActual(categoryData);
    this.charts.budgetComparison.data = {
      labels: Array.from(this.categories.values()).map(c => c.name),
      datasets: [{
        label: 'Budget',
        data: budgetComparison.map(c => c.budget),
        backgroundColor: '#36A2EB'
      }, {
        label: 'Actual',
        data: budgetComparison.map(c => c.actual),
        backgroundColor: '#FF6384'
      }]
    };
    this.charts.budgetComparison.update();
  }

  calculateTotal(transactions, type) {
    return transactions
      .filter(t => t.type === type)
      .reduce((sum, t) => sum + t.amount, 0);
  }

  calculateCategoryTotals(transactions) {
    return transactions
      .filter(t => t.type === 'expense')
      .reduce((totals, t) => {
        totals[t.category] = (totals[t.category] || 0) + t.amount;
        return totals;
      }, {});
  }

  calculateBalance(transactions) {
    return this.calculateTotal(transactions, 'income') - 
           this.calculateTotal(transactions, 'expense');
  }

  calculateMonthlyTotals(transactions) {
    return transactions
      .filter(t => t.type === 'expense')
      .reduce((months, t) => {
        const month = t.date.substring(0, 7);
        months[month] = (months[month] || 0) + t.amount;
        return months;
      }, {});
  }

  compareBudgetToActual(categoryTotals) {
    return Array.from(this.categories.keys()).map(categoryId => ({
      category: categoryId,
      budget: this.budgets.get(categoryId) || 0,
      actual: categoryTotals[categoryId] || 0
    }));
  }

  checkBudgetAlerts() {
    const categoryTotals = this.calculateCategoryTotals(this.transactions);
    
    Array.from(this.budgets.entries()).forEach(([categoryId, budget]) => {
      const actual = categoryTotals[categoryId] || 0;
      if (actual > budget) {
        this.showBudgetAlert(categoryId, actual, budget);
      }
    });
  }

  showBudgetAlert(categoryId, actual, budget) {
    const category = this.categories.get(categoryId);
    const alert = document.createElement('div');
    alert.className = 'budget-alert';
    alert.innerHTML = `
      Budget exceeded for ${category.name}!
      Spent: ${this.formatCurrency(actual)}
      Budget: ${this.formatCurrency(budget)}
    `;
    
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 5000);
  }

  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  getSelectedDateRange() {
    const range = this.elements.dateRangeSelector.value;
    const end = new Date();
    const start = new Date();

    switch (range) {
      case 'week':
        start.setDate(end.getDate() - 7);
        break;
      case 'month':
        start.setMonth(end.getMonth() - 1);
        break;
      case 'year':
        start.setFullYear(end.getFullYear() - 1);
        break;
      default:
        start.setFullYear(0); // All time
    }

    return { start, end };
  }

  filterTransactionsByDate(dateRange) {
    return this.transactions.filter(transaction => {
      const date = new Date(transaction.date);
      return date >= dateRange.start && date <= dateRange.end;
    });
  }
}

// Initialize tracker
const expenseTracker = new ExpenseTracker();