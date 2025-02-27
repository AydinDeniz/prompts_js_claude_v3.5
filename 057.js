class FitnessTracker {
  constructor() {
    this.workouts = new Map();
    this.meals = new Map();
    this.goals = new Map();
    this.metrics = new Map();
    this.devices = new Map();
    
    this.init();
  }

  async init() {
    await this.initializeAPIs();
    this.setupDatabase();
    this.initializeUI();
    await this.loadUserData();
    this.startDeviceSync();
  }

  async initializeAPIs() {
    // Initialize fitness device APIs
    this.apis = {
      fitbit: new FitbitAPI({
        clientId: process.env.FITBIT_CLIENT_ID,
        clientSecret: process.env.FITBIT_CLIENT_SECRET
      }),
      
      garmin: new GarminAPI({
        apiKey: process.env.GARMIN_API_KEY
      }),
      
      myFitnessPal: new MyFitnessPalAPI({
        username: process.env.MFP_USERNAME,
        password: process.env.MFP_PASSWORD
      })
    };

    await Promise.all(Object.values(this.apis).map(api => api.initialize()));
  }

  setupDatabase() {
    this.db = new PouchDB('fitness_tracker');
    
    PouchDB.sync('fitness_tracker', 'http://localhost:5984/fitness_tracker', {
      live: true,
      retry: true
    });
  }

  initializeUI() {
    this.elements = {
      workoutLog: document.getElementById('workout-log'),
      mealLog: document.getElementById('meal-log'),
      metricsPanel: document.getElementById('metrics-panel'),
      goalsPanel: document.getElementById('goals-panel'),
      charts: document.getElementById('charts-container')
    };

    this.setupCharts();
    this.setupEventListeners();
  }

  setupCharts() {
    this.charts = {
      calories: new Chart(document.getElementById('calories-chart'), {
        type: 'line',
        options: {
          scales: { y: { beginAtZero: true } }
        }
      }),

      macros: new Chart(document.getElementById('macros-chart'), {
        type: 'doughnut',
        options: {
          plugins: { legend: { position: 'right' } }
        }
      }),

      workouts: new Chart(document.getElementById('workout-chart'), {
        type: 'bar',
        options: {
          scales: { y: { beginAtZero: true } }
        }
      })
    };
  }

  setupEventListeners() {
    document.getElementById('log-workout').addEventListener('submit', (e) => {
      e.preventDefault();
      this.logWorkout(new FormData(e.target));
    });

    document.getElementById('log-meal').addEventListener('submit', (e) => {
      e.preventDefault();
      this.logMeal(new FormData(e.target));
    });

    document.getElementById('set-goal').addEventListener('submit', (e) => {
      e.preventDefault();
      this.setGoal(new FormData(e.target));
    });
  }

  async loadUserData() {
    try {
      const [workouts, meals, goals] = await Promise.all([
        this.db.allDocs({ include_docs: true, startkey: 'workout:', endkey: 'workout:\ufff0' }),
        this.db.allDocs({ include_docs: true, startkey: 'meal:', endkey: 'meal:\ufff0' }),
        this.db.allDocs({ include_docs: true, startkey: 'goal:', endkey: 'goal:\ufff0' })
      ]);

      workouts.rows.forEach(row => this.workouts.set(row.id, row.doc));
      meals.rows.forEach(row => this.meals.set(row.id, row.doc));
      goals.rows.forEach(row => this.goals.set(row.id, row.doc));

      this.updateUI();
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  }

  async logWorkout(formData) {
    const workout = {
      id: `workout:${Date.now()}`,
      type: formData.get('type'),
      duration: parseInt(formData.get('duration')),
      intensity: formData.get('intensity'),
      caloriesBurned: this.calculateCaloriesBurned(
        formData.get('type'),
        parseInt(formData.get('duration')),
        formData.get('intensity')
      ),
      exercises: this.parseExercises(formData.get('exercises')),
      notes: formData.get('notes'),
      timestamp: new Date()
    };

    try {
      await this.db.put(workout);
      this.workouts.set(workout.id, workout);
      this.updateUI();
      this.checkGoals();
    } catch (error) {
      console.error('Failed to log workout:', error);
    }
  }

  async logMeal(formData) {
    const meal = {
      id: `meal:${Date.now()}`,
      type: formData.get('type'),
      foods: await this.parseFoods(formData.get('foods')),
      totalCalories: 0,
      macros: { protein: 0, carbs: 0, fat: 0 },
      timestamp: new Date()
    };

    // Calculate totals
    meal.foods.forEach(food => {
      meal.totalCalories += food.calories;
      meal.macros.protein += food.protein;
      meal.macros.carbs += food.carbs;
      meal.macros.fat += food.fat;
    });

    try {
      await this.db.put(meal);
      this.meals.set(meal.id, meal);
      this.updateUI();
      this.checkGoals();
    } catch (error) {
      console.error('Failed to log meal:', error);
    }
  }

  async parseFoods(foodsInput) {
    const foodNames = foodsInput.split(',').map(f => f.trim());
    const foods = await Promise.all(
      foodNames.map(name => this.apis.myFitnessPal.searchFood(name))
    );

    return foods.map(food => ({
      name: food.name,
      servingSize: food.servingSize,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat
    }));
  }

  calculateCaloriesBurned(type, duration, intensity) {
    const MET = {
      running: { low: 8, medium: 11.5, high: 14 },
      cycling: { low: 6, medium: 8, high: 10 },
      swimming: { low: 6, medium: 8.3, high: 10 },
      weightlifting: { low: 3, medium: 5, high: 6 }
    };

    const userWeight = 70; // kg (should be fetched from user profile)
    const met = MET[type][intensity];
    return Math.round((met * userWeight * (duration / 60)));
  }

  async setGoal(formData) {
    const goal = {
      id: `goal:${Date.now()}`,
      type: formData.get('type'),
      target: parseFloat(formData.get('target')),
      deadline: formData.get('deadline'),
      progress: 0,
      created: new Date()
    };

    try {
      await this.db.put(goal);
      this.goals.set(goal.id, goal);
      this.updateUI();
    } catch (error) {
      console.error('Failed to set goal:', error);
    }
  }

  checkGoals() {
    this.goals.forEach(goal => {
      const progress = this.calculateGoalProgress(goal);
      if (progress !== goal.progress) {
        this.updateGoalProgress(goal.id, progress);
      }
    });
  }

  calculateGoalProgress(goal) {
    switch (goal.type) {
      case 'weight':
        return this.calculateWeightProgress(goal);
      case 'calories':
        return this.calculateCalorieProgress(goal);
      case 'workouts':
        return this.calculateWorkoutProgress(goal);
      default:
        return 0;
    }
  }

  updateUI() {
    this.updateWorkoutLog();
    this.updateMealLog();
    this.updateMetrics();
    this.updateCharts();
    this.updateGoals();
  }

  updateWorkoutLog() {
    const workouts = Array.from(this.workouts.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    this.elements.workoutLog.innerHTML = workouts.map(workout => `
      <div class="workout-entry">
        <div class="workout-header">
          <h3>${workout.type}</h3>
          <span class="timestamp">${this.formatDate(workout.timestamp)}</span>
        </div>
        <div class="workout-details">
          <span class="duration">${workout.duration} minutes</span>
          <span class="intensity">${workout.intensity}</span>
          <span class="calories">${workout.caloriesBurned} calories</span>
        </div>
        <div class="exercises">
          ${workout.exercises.map(exercise => `
            <div class="exercise">
              <span>${exercise.name}</span>
              <span>${exercise.sets}x${exercise.reps}</span>
              <span>${exercise.weight}kg</span>
            </div>
          `).join('')}
        </div>
        <div class="notes">${workout.notes}</div>
      </div>
    `).join('');
  }

  updateMealLog() {
    const meals = Array.from(this.meals.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    this.elements.mealLog.innerHTML = meals.map(meal => `
      <div class="meal-entry">
        <div class="meal-header">
          <h3>${meal.type}</h3>
          <span class="timestamp">${this.formatDate(meal.timestamp)}</span>
        </div>
        <div class="meal-totals">
          <span class="calories">${meal.totalCalories} calories</span>
          <span class="protein">${meal.macros.protein}g protein</span>
          <span class="carbs">${meal.macros.carbs}g carbs</span>
          <span class="fat">${meal.macros.fat}g fat</span>
        </div>
        <div class="foods">
          ${meal.foods.map(food => `
            <div class="food-item">
              <span>${food.name}</span>
              <span>${food.servingSize}</span>
              <span>${food.calories} cal</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  updateCharts() {
    // Update calories chart
    const calorieData = this.getCalorieData();
    this.charts.calories.data = {
      labels: calorieData.labels,
      datasets: [
        {
          label: 'Calories In',
          data: calorieData.in,
          borderColor: 'rgb(75, 192, 192)'
        },
        {
          label: 'Calories Out',
          data: calorieData.out,
          borderColor: 'rgb(255, 99, 132)'
        }
      ]
    };
    this.charts.calories.update();

    // Update macros chart
    const macroData = this.calculateMacroAverages();
    this.charts.macros.data = {
      labels: ['Protein', 'Carbs', 'Fat'],
      datasets: [{
        data: [macroData.protein, macroData.carbs, macroData.fat],
        backgroundColor: [
          'rgb(255, 99, 132)',
          'rgb(54, 162, 235)',
          'rgb(255, 205, 86)'
        ]
      }]
    };
    this.charts.macros.update();

    // Update workout chart
    const workoutData = this.getWorkoutData();
    this.charts.workouts.data = {
      labels: workoutData.labels,
      datasets: [{
        label: 'Workout Duration',
        data: workoutData.durations,
        backgroundColor: 'rgb(75, 192, 192)'
      }]
    };
    this.charts.workouts.update();
  }

  startDeviceSync() {
    // Start periodic sync with fitness devices
    setInterval(() => {
      Object.values(this.apis).forEach(api => {
        api.sync().then(data => this.processDeviceData(data));
      });
    }, 300000); // Sync every 5 minutes
  }
