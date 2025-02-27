class FitnessTracker {
  constructor() {
    this.DB_NAME = 'fitness_tracker';
    this.DB_VERSION = 1;
    this.API_URL = 'https://api.fitness-tracker.com';
    this.syncQueue = [];
    
    this.init();
  }

  async init() {
    await this.initializeDB();
    this.setupUI();
    this.initializeCharts();
    this.setupEventListeners();
    this.checkOnlineStatus();
    await this.loadData();
  }

  async initializeDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores
        const activities = db.createObjectStore('activities', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        activities.createIndex('date', 'date');
        activities.createIndex('type', 'type');

        const meals = db.createObjectStore('meals', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        meals.createIndex('date', 'date');

        const syncStore = db.createObjectStore('sync_queue', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
      };
    });
  }

  setupUI() {
    this.elements = {
      activityForm: document.getElementById('activity-form'),
      mealForm: document.getElementById('meal-form'),
      stepsChart: document.getElementById('steps-chart'),
      workoutChart: document.getElementById('workout-chart'),
      caloriesChart: document.getElementById('calories-chart'),
      dateSelector: document.getElementById('date-selector'),
      syncStatus: document.getElementById('sync-status')
    };
  }

  initializeCharts() {
    // Steps Chart
    this.stepsChart = new Chart(this.elements.stepsChart, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Daily Steps',
          data: [],
          borderColor: '#4CAF50',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });

    // Workout Chart
    this.workoutChart = new Chart(this.elements.workoutChart, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Workout Minutes',
          data: [],
          backgroundColor: '#2196F3'
        }]
      },
      options: {
        responsive: true
      }
    });

    // Calories Chart
    this.caloriesChart = new Chart(this.elements.caloriesChart, {
      type: 'doughnut',
      data: {
        labels: ['Consumed', 'Burned'],
        datasets: [{
          data: [0, 0],
          backgroundColor: ['#FF5722', '#8BC34A']
        }]
      },
      options: {
        responsive: true
      }
    });
  }

  setupEventListeners() {
    this.elements.activityForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.logActivity();
    });

    this.elements.mealForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.logMeal();
    });

    this.elements.dateSelector.addEventListener('change', () => {
      this.loadData();
    });

    window.addEventListener('online', () => {
      this.handleOnline();
    });

    window.addEventListener('offline', () => {
      this.handleOffline();
    });
  }

  async logActivity() {
    const formData = new FormData(this.elements.activityForm);
    const activity = {
      type: formData.get('activity-type'),
      duration: parseInt(formData.get('duration')),
      intensity: formData.get('intensity'),
      steps: parseInt(formData.get('steps') || 0),
      date: this.elements.dateSelector.value,
      timestamp: Date.now()
    };

    try {
      await this.saveActivity(activity);
      this.elements.activityForm.reset();
      await this.loadData();
      this.showNotification('Activity logged successfully', 'success');
    } catch (error) {
      this.showNotification('Failed to log activity', 'error');
    }
  }

  async logMeal() {
    const formData = new FormData(this.elements.mealForm);
    const meal = {
      name: formData.get('meal-name'),
      calories: parseInt(formData.get('calories')),
      type: formData.get('meal-type'),
      date: this.elements.dateSelector.value,
      timestamp: Date.now()
    };

    try {
      await this.saveMeal(meal);
      this.elements.mealForm.reset();
      await this.loadData();
      this.showNotification('Meal logged successfully', 'success');
    } catch (error) {
      this.showNotification('Failed to log meal', 'error');
    }
  }

  async saveActivity(activity) {
    await this.addToStore('activities', activity);
    await this.addToSyncQueue({
      type: 'activity',
      action: 'add',
      data: activity
    });
  }

  async saveMeal(meal) {
    await this.addToStore('meals', meal);
    await this.addToSyncQueue({
      type: 'meal',
      action: 'add',
      data: meal
    });
  }

  async addToStore(storeName, data) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async addToSyncQueue(item) {
    await this.addToStore('sync_queue', item);
    if (navigator.onLine) {
      this.syncData();
    }
  }

  async loadData() {
    const date = this.elements.dateSelector.value;
    const [activities, meals] = await Promise.all([
      this.getActivitiesByDate(date),
      this.getMealsByDate(date)
    ]);

    this.updateCharts(activities, meals);
  }

  async getActivitiesByDate(date) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('activities', 'readonly');
      const store = transaction.objectStore('activities');
      const index = store.index('date');
      const request = index.getAll(date);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getMealsByDate(date) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('meals', 'readonly');
      const store = transaction.objectStore('meals');
      const index = store.index('date');
      const request = index.getAll(date);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  updateCharts(activities, meals) {
    // Update Steps Chart
    const stepsByHour = this.aggregateStepsByHour(activities);
    this.stepsChart.data.labels = Object.keys(stepsByHour);
    this.stepsChart.data.datasets[0].data = Object.values(stepsByHour);
    this.stepsChart.update();

    // Update Workout Chart
    const workoutsByType = this.aggregateWorkoutsByType(activities);
    this.workoutChart.data.labels = Object.keys(workoutsByType);
    this.workoutChart.data.datasets[0].data = Object.values(workoutsByType);
    this.workoutChart.update();

    // Update Calories Chart
    const caloriesData = this.calculateCaloriesBalance(activities, meals);
    this.caloriesChart.data.datasets[0].data = [
      caloriesData.consumed,
      caloriesData.burned
    ];
    this.caloriesChart.update();
  }

  aggregateStepsByHour(activities) {
    const steps = {};
    activities.forEach(activity => {
      if (activity.steps) {
        const hour = new Date(activity.timestamp).getHours();
        steps[hour] = (steps[hour] || 0) + activity.steps;
      }
    });
    return steps;
  }

  aggregateWorkoutsByType(activities) {
    const workouts = {};
    activities.forEach(activity => {
      if (activity.type !== 'steps') {
        workouts[activity.type] = (workouts[activity.type] || 0) + activity.duration;
      }
    });
    return workouts;
  }

  calculateCaloriesBalance(activities, meals) {
    const consumed = meals.reduce((total, meal) => total + meal.calories, 0);
    const burned = activities.reduce((total, activity) => {
      return total + this.calculateCaloriesBurned(activity);
    }, 0);
    return { consumed, burned };
  }

  calculateCaloriesBurned(activity) {
    // Simple calorie calculation - replace with more accurate formula
    const intensityMultiplier = {
      low: 4,
      medium: 7,
      high: 10
    };
    return activity.duration * intensityMultiplier[activity.intensity];
  }

  async syncData() {
    if (!navigator.onLine) return;

    this.elements.syncStatus.textContent = 'Syncing...';
    
    try {
      const queue = await this.getSyncQueue();
      
      for (const item of queue) {
        await this.syncItem(item);
        await this.removeFromSyncQueue(item.id);
      }

      this.elements.syncStatus.textContent = 'All data synced';
      setTimeout(() => {
        this.elements.syncStatus.textContent = '';
      }, 3000);
    } catch (error) {
      this.elements.syncStatus.textContent = 'Sync failed';
      console.error('Sync error:', error);
    }
  }

  async syncItem(item) {
    const endpoint = `${this.API_URL}/${item.type}s`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(item.data)
    });

    if (!response.ok) {
      throw new Error(`Sync failed for item ${item.id}`);
    }
  }

  async getSyncQueue() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('sync_queue', 'readonly');
      const store = transaction.objectStore('sync_queue');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removeFromSyncQueue(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('sync_queue', 'readwrite');
      const store = transaction.objectStore('sync_queue');
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  checkOnlineStatus() {
    if (navigator.onLine) {
      this.handleOnline();
    } else {
      this.handleOffline();
    }
  }

  handleOnline() {
    this.elements.syncStatus.textContent = 'Online';
    this.syncData();
  }

  handleOffline() {
    this.elements.syncStatus.textContent = 'Offline - changes will sync when online';
  }

  showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
}

// Initialize the tracker
const tracker = new FitnessTracker();