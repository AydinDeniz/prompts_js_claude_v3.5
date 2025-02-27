// Health Advisor Application

class HealthAdvisor {
  constructor() {
    this.model = null;
    this.userData = null;
    this.recommendations = null;
    this.metrics = {};
    
    this.init();
  }

  async init() {
    await this.loadMLModel();
    this.initializeUI();
    this.setupEventListeners();
    await this.loadUserData();
  }

  async loadMLModel() {
    try {
      this.model = await tf.loadLayersModel('/models/health-advisor/model.json');
    } catch (error) {
      console.error('Failed to load ML model:', error);
    }
  }

  initializeUI() {
    this.elements = {
      profileForm: document.getElementById('profile-form'),
      metricsContainer: document.getElementById('metrics-container'),
      recommendationsPanel: document.getElementById('recommendations-panel'),
      dietPlan: document.getElementById('diet-plan'),
      exercisePlan: document.getElementById('exercise-plan'),
      progressCharts: document.getElementById('progress-charts')
    };

    this.initializeCharts();
  }

  initializeCharts() {
    // Weight Progress Chart
    this.weightChart = new Chart(
      document.getElementById('weight-chart'), {
      type: 'line',
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: false
          }
        }
      }
    });

    // Activity Progress Chart
    this.activityChart = new Chart(
      document.getElementById('activity-chart'), {
      type: 'bar',
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });

    // Nutrition Balance Chart
    this.nutritionChart = new Chart(
      document.getElementById('nutrition-chart'), {
      type: 'radar',
      options: {
        responsive: true,
        elements: {
          line: {
            borderWidth: 3
          }
        }
      }
    });
  }

  setupEventListeners() {
    this.elements.profileForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.updateUserProfile();
    });

    // Track metric updates
    document.getElementById('log-weight').addEventListener('submit', (e) => {
      e.preventDefault();
      this.logMetric('weight', e.target.weight.value);
    });

    document.getElementById('log-activity').addEventListener('submit', (e) => {
      e.preventDefault();
      this.logActivity(e.target);
    });

    document.getElementById('log-meal').addEventListener('submit', (e) => {
      e.preventDefault();
      this.logMeal(e.target);
    });
  }

  async loadUserData() {
    try {
      const response = await fetch('/api/user/profile');
      this.userData = await response.json();
      this.updateUI();
      await this.generateRecommendations();
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  }

  async updateUserProfile() {
    const formData = new FormData(this.elements.profileForm);
    const profileData = {
      age: parseInt(formData.get('age')),
      weight: parseFloat(formData.get('weight')),
      height: parseFloat(formData.get('height')),
      activityLevel: formData.get('activity-level'),
      goals: formData.get('goals'),
      dietaryRestrictions: formData.getAll('dietary-restrictions'),
      healthConditions: formData.getAll('health-conditions')
    };

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData)
      });

      this.userData = await response.json();
      await this.generateRecommendations();
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  }

  async generateRecommendations() {
    if (!this.model || !this.userData) return;

    try {
      // Prepare user data for model
      const userFeatures = this.prepareUserFeatures();
      const predictions = await this.model.predict(userFeatures);
      
      this.recommendations = this.processModelPredictions(predictions);
      this.updateRecommendationsUI();
    } catch (error) {
      console.error('Failed to generate recommendations:', error);
    }
  }

  prepareUserFeatures() {
    // Convert user data to tensor
    const features = [
      this.userData.age / 100, // Normalize age
      this.userData.weight / 200, // Normalize weight
      this.userData.height / 200, // Normalize height
      this.activityLevelToNumber(this.userData.activityLevel),
      ...this.encodeGoals(this.userData.goals),
      ...this.encodeDietaryRestrictions(this.userData.dietaryRestrictions),
      ...this.encodeHealthConditions(this.userData.healthConditions)
    ];

    return tf.tensor2d([features]);
  }

  processModelPredictions(predictions) {
    const [dietPredictions, exercisePredictions] = predictions;

    return {
      diet: {
        calories: Math.round(dietPredictions.dataSync()[0] * 2500),
        macros: {
          protein: Math.round(dietPredictions.dataSync()[1] * 100),
          carbs: Math.round(dietPredictions.dataSync()[2] * 100),
          fats: Math.round(dietPredictions.dataSync()[3] * 100)
        },
        mealPlan: this.generateMealPlan(dietPredictions)
      },
      exercise: {
        weeklyMinutes: Math.round(exercisePredictions.dataSync()[0] * 300),
        recommendedActivities: this.getRecommendedActivities(exercisePredictions),
        intensity: this.calculateIntensity(exercisePredictions)
      }
    };
  }

  generateMealPlan(predictions) {
    const mealPlan = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snacks: []
    };

    // Generate meal suggestions based on predictions and dietary restrictions
    const calories = predictions.dataSync()[0] * 2500;
    const restrictions = this.userData.dietaryRestrictions;

    // Get suitable meals from database
    this.getMealSuggestions(calories / 3, restrictions)
      .then(meals => {
        mealPlan.breakfast = meals.breakfast;
        mealPlan.lunch = meals.lunch;
        mealPlan.dinner = meals.dinner;
        mealPlan.snacks = meals.snacks;
        this.updateMealPlanUI(mealPlan);
      });

    return mealPlan;
  }

  async getMealSuggestions(targetCalories, restrictions) {
    try {
      const response = await fetch('/api/meals/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCalories, restrictions })
      });
      
      return response.json();
    } catch (error) {
      console.error('Failed to get meal suggestions:', error);
      return null;
    }
  }

  getRecommendedActivities(predictions) {
    const activityScores = predictions.dataSync().slice(1, -1);
    const activities = [
      'walking',
      'running',
      'cycling',
      'swimming',
      'strength_training',
      'yoga'
    ];

    return activities
      .map((activity, index) => ({
        name: activity,
        score: activityScores[index]
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(activity => activity.name);
  }

  calculateIntensity(predictions) {
    const intensityScore = predictions.dataSync()[predictions.size - 1];
    if (intensityScore < 0.33) return 'low';
    if (intensityScore < 0.66) return 'moderate';
    return 'high';
  }

  async logMetric(type, value) {
    try {
      const metric = {
        type,
        value: parseFloat(value),
        timestamp: new Date().toISOString()
      };

      await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metric)
      });

      this.updateMetricsUI();
    } catch (error) {
      console.error('Failed to log metric:', error);
    }
  }

  async logActivity(form) {
    const activity = {
      type: form.activityType.value,
      duration: parseInt(form.duration.value),
      intensity: form.intensity.value,
      caloriesBurned: this.calculateCaloriesBurned(
        form.activityType.value,
        form.duration.value,
        form.intensity.value
      ),
      timestamp: new Date().toISOString()
    };

    try {
      await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activity)
      });

      this.updateActivityChart();
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  async logMeal(form) {
    const meal = {
      name: form.mealName.value,
      type: form.mealType.value,
      foods: this.parseFoodItems(form.foodItems.value),
      timestamp: new Date().toISOString()
    };

    try {
      await fetch('/api/meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meal)
      });

      this.updateNutritionChart();
    } catch (error) {
      console.error('Failed to log meal:', error);
    }
  }

  updateUI() {
    this.updateMetricsUI();
    this.updateChartsUI();
    this.updateRecommendationsUI();
  }

  updateMetricsUI() {
    // Update metrics display
    this.elements.metricsContainer.innerHTML = `
      <div class="metric">
        <h3>Current Weight</h3>
        <p>${this.userData.weight} kg</p>
      </div>
      <div class="metric">
        <h3>BMI</h3>
        <p>${this.calculateBMI()}</p>
      </div>
      <div class="metric">
        <h3>Daily Calories</h3>
        <p>${this.recommendations?.diet.calories || 0} kcal</p>
      </div>
    `;
  }

  updateChartsUI() {
    this.updateWeightChart();
    this.updateActivityChart();
    this.updateNutritionChart();
  }

  updateRecommendationsUI() {
    if (!this.recommendations) return;

    // Update diet recommendations
    this.elements.dietPlan.innerHTML = `
      <h3>Recommended Diet Plan</h3>
      <div class="macros">
        <div>Protein: ${this.recommendations.diet.macros.protein}g</div>
        <div>Carbs: ${this.recommendations.diet.macros.carbs}g</div>
        <div>Fats: ${this.recommendations.diet.macros.fats}g</div>
      </div>
      <div class="meal-plan">
        ${this.renderMealPlan(this.recommendations.diet.mealPlan)}
      </div>
    `;

    // Update exercise recommendations
    this.elements.exercisePlan.innerHTML = `
      <h3>Exercise Recommendations</h3>
      <p>Weekly Target: ${this.recommendations.exercise.weeklyMinutes} minutes</p>
      <p>Intensity: ${this.recommendations.exercise.intensity}</p>
      <div class="recommended-activities">
        ${this.recommendations.exercise.recommendedActivities
          .map(activity => `<div class="activity">${activity}</div>`)
          .join('')}
      </div>
    `;
  }

  renderMealPlan(mealPlan) {
    return Object.entries(mealPlan)
      .map(([meal, foods]) => `
        <div class="meal">
          <h4>${meal}</h4>
          <ul>
            ${foods.map(food => `
              <li>${food.name} - ${food.calories} kcal</li>
            `).join('')}
          </ul>
        </div>
      `)
      .join('');
  }

  calculateBMI() {
    const heightInMeters = this.userData.height / 100;
    return (this.userData.weight / (heightInMeters * heightInMeters)).toFixed(1);
  }

  calculateCaloriesBurned(activity, duration, intensity) {
    const MET = {
      walking: { low: 2.5, moderate: 3.5, high: 4.5 },
      running: { low: 6, moderate: 8, high: 10 },
      cycling: { low: 4, moderate: 6, high: 8 },
      swimming: { low: 5, moderate: 7, high: 9 }
    };

    const met = MET[activity]?.[intensity] || 3;
    return Math.round((met * this.userData.weight * duration) / 60);
  }
}

// Initialize health advisor
const healthAdvisor = new HealthAdvisor();