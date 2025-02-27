class RecipePlanner {
  constructor() {
    this.recipes = new Map();
    this.mealPlan = new Map();
    this.ingredients = new Set();
    this.favorites = new Set();
    this.api = new RecipeAPI();
    
    this.init();
  }

  async init() {
    this.initializeUI();
    await this.loadUserData();
    this.setupEventListeners();
    this.initializeCharts();
  }

  initializeUI() {
    this.elements = {
      ingredientInput: document.getElementById('ingredient-input'),
      recipeList: document.getElementById('recipe-list'),
      mealPlanContainer: document.getElementById('meal-plan'),
      nutritionPanel: document.getElementById('nutrition-panel'),
      searchButton: document.getElementById('search-recipes'),
      favoritesList: document.getElementById('favorites-list')
    };
  }

  setupEventListeners() {
    this.elements.ingredientInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') this.addIngredient(e.target.value);
    });

    this.elements.searchButton.addEventListener('click', () => {
      this.searchRecipes();
    });

    document.getElementById('save-meal-plan').addEventListener('click', () => {
      this.saveMealPlan();
    });
  }

  async loadUserData() {
    const stored = localStorage.getItem('recipePlanner');
    if (stored) {
      const data = JSON.parse(stored);
      this.favorites = new Set(data.favorites);
      this.mealPlan = new Map(data.mealPlan);
    }
  }

  async searchRecipes() {
    const ingredients = Array.from(this.ingredients);
    const results = await this.api.searchByIngredients(ingredients);
    this.displayRecipes(results);
  }

  displayRecipes(recipes) {
    this.elements.recipeList.innerHTML = recipes.map(recipe => `
      <div class="recipe-card" data-id="${recipe.id}">
        <img src="${recipe.image}" alt="${recipe.title}">
        <h3>${recipe.title}</h3>
        <div class="recipe-meta">
          <span>${recipe.readyInMinutes} mins</span>
          <span>${recipe.servings} servings</span>
        </div>
        <div class="recipe-actions">
          <button onclick="recipePlanner.viewRecipe('${recipe.id}')">View</button>
          <button onclick="recipePlanner.addToMealPlan('${recipe.id}')">Add to Plan</button>
          <button onclick="recipePlanner.toggleFavorite('${recipe.id}')">
            ${this.favorites.has(recipe.id) ? '❤️' : '🤍'}
          </button>
        </div>
      </div>
    `).join('');
  }

  async viewRecipe(id) {
    const recipe = await this.api.getRecipeDetails(id);
    this.showRecipeModal(recipe);
  }

  showRecipeModal(recipe) {
    const modal = document.createElement('div');
    modal.className = 'recipe-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>${recipe.title}</h2>
        <img src="${recipe.image}" alt="${recipe.title}">
        <div class="recipe-details">
          <div class="ingredients">
            <h3>Ingredients</h3>
            <ul>
              ${recipe.ingredients.map(ing => `
                <li>${ing.amount} ${ing.unit} ${ing.name}</li>
              `).join('')}
            </ul>
          </div>
          <div class="instructions">
            <h3>Instructions</h3>
            <ol>
              ${recipe.instructions.map(step => `
                <li>${step}</li>
              `).join('')}
            </ol>
          </div>
          <div class="nutrition">
            <h3>Nutrition Facts</h3>
            ${this.renderNutritionInfo(recipe.nutrition)}
          </div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()">Close</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  addToMealPlan(recipeId) {
    const modal = document.createElement('div');
    modal.className = 'meal-plan-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Add to Meal Plan</h3>
        <div class="day-selector">
          ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            .map(day => `
              <div class="day-option">
                <input type="radio" name="day" value="${day.toLowerCase()}">
                <label>${day}</label>
              </div>
            `).join('')}
        </div>
        <div class="meal-type">
          <select id="meal-type">
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
          </select>
        </div>
        <button onclick="recipePlanner.confirmAddToMealPlan('${recipeId}')">
          Add
        </button>
        <button onclick="this.parentElement.parentElement.remove()">
          Cancel
        </button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  async confirmAddToMealPlan(recipeId) {
    const day = document.querySelector('input[name="day"]:checked').value;
    const mealType = document.getElementById('meal-type').value;
    
    if (!this.mealPlan.has(day)) {
      this.mealPlan.set(day, new Map());
    }
    
    const dayPlan = this.mealPlan.get(day);
    dayPlan.set(mealType, recipeId);
    
    await this.updateMealPlanDisplay();
    document.querySelector('.meal-plan-modal').remove();
  }

  async updateMealPlanDisplay() {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const mealTypes = ['breakfast', 'lunch', 'dinner'];

    this.elements.mealPlanContainer.innerHTML = `
      <div class="meal-plan-grid">
        ${days.map(day => `
          <div class="day-column">
            <h3>${day.charAt(0).toUpperCase() + day.slice(1)}</h3>
            ${mealTypes.map(mealType => {
              const recipeId = this.mealPlan.get(day)?.get(mealType);
              const recipe = recipeId ? this.recipes.get(recipeId) : null;
              return `
                <div class="meal-slot ${mealType}" data-day="${day}" data-meal="${mealType}">
                  ${recipe ? `
                    <div class="planned-meal">
                      <img src="${recipe.image}" alt="${recipe.title}">
                      <span>${recipe.title}</span>
                      <button onclick="recipePlanner.removeMeal('${day}', '${mealType}')">
                        ✕
                      </button>
                    </div>
                  ` : `
                    <div class="empty-slot">
                      + Add ${mealType}
                    </div>
                  `}
                </div>
              `;
            }).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }

  removeMeal(day, mealType) {
    const dayPlan = this.mealPlan.get(day);
    if (dayPlan) {
      dayPlan.delete(mealType);
      this.updateMealPlanDisplay();
    }
  }

  renderNutritionInfo(nutrition) {
    return `
      <div class="nutrition-grid">
        <div class="nutrient">
          <span>Calories</span>
          <span>${nutrition.calories}</span>
        </div>
        <div class="nutrient">
          <span>Protein</span>
          <span>${nutrition.protein}g</span>
        </div>
        <div class="nutrient">
          <span>Carbs</span>
          <span>${nutrition.carbs}g</span>
        </div>
        <div class="nutrient">
          <span>Fat</span>
          <span>${nutrition.fat}g</span>
        </div>
      </div>
    `;
  }

  toggleFavorite(recipeId) {
    if (this.favorites.has(recipeId)) {
      this.favorites.delete(recipeId);
    } else {
      this.favorites.add(recipeId);
    }
    this.saveUserData();
    this.updateFavoritesList();
  }

  saveUserData() {
    const data = {
      favorites: Array.from(this.favorites),
      mealPlan: Array.from(this.mealPlan)
    };
    localStorage.setItem('recipePlanner', JSON.stringify(data));
  }

  generateGroceryList() {
    const ingredients = new Map();
    
    this.mealPlan.forEach(dayPlan => {
      dayPlan.forEach(async recipeId => {
        const recipe = await this.api.getRecipeDetails(recipeId);
        recipe.ingredients.forEach(ing => {
          if (ingredients.has(ing.name)) {
            const current = ingredients.get(ing.name);
            ingredients.set(ing.name, {
              amount: current.amount + ing.amount,
              unit: ing.unit
            });
          } else {
            ingredients.set(ing.name, {
              amount: ing.amount,
              unit: ing.unit
            });
          }
        });
      });
    });

    return ingredients;
  }

  displayGroceryList() {
    const ingredients = this.generateGroceryList();
    const modal = document.createElement('div');
    modal.className = 'grocery-list-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>Grocery List</h2>
        <ul class="grocery-list">
          ${Array.from(ingredients).map(([name, details]) => `
            <li>
              <span class="ingredient-name">${name}</span>
              <span class="ingredient-amount">
                ${details.amount} ${details.unit}
              </span>
            </li>
          `).join('')}
        </ul>
        <button onclick="this.parentElement.parentElement.remove()">Close</button>
        <button onclick="recipePlanner.exportGroceryList()">Export</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  exportGroceryList() {
    const ingredients = this.generateGroceryList();
    const csv = Array.from(ingredients)
      .map(([name, details]) => `${name},${details.amount},${details.unit}`)
      .join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grocery-list.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}

const recipePlanner = new RecipePlanner();