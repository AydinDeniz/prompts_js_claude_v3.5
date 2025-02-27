class RecommendationSystem {
  constructor() {
    this.users = new Map();
    this.products = new Map();
    this.interactions = new Map();
    this.similarities = new Map();
    this.recommendations = new Map();
    
    this.init();
  }

  async init() {
    await this.loadData();
    this.calculateSimilarities();
    this.initializeUI();
    this.setupEventListeners();
  }

  async loadData() {
    // Load mock data
    this.users = new Map(mockUserData.map(user => [user.id, user]));
    this.products = new Map(mockProductData.map(product => [product.id, product]));
    this.interactions = new Map(mockInteractionData.map(interaction => [
      `${interaction.userId}-${interaction.productId}`,
      interaction
    ]));
  }

  initializeUI() {
    this.elements = {
      productList: document.getElementById('product-list'),
      recommendationPanel: document.getElementById('recommendations'),
      userProfile: document.getElementById('user-profile'),
      similarProducts: document.getElementById('similar-products')
    };
  }

  setupEventListeners() {
    document.addEventListener('product-view', (e) => {
      this.recordInteraction(e.detail.userId, e.detail.productId, 'view');
    });

    document.addEventListener('product-purchase', (e) => {
      this.recordInteraction(e.detail.userId, e.detail.productId, 'purchase');
    });
  }

  calculateSimilarities() {
    // Calculate user-user similarities
    for (const [userId1] of this.users) {
      for (const [userId2] of this.users) {
        if (userId1 !== userId2) {
          const similarity = this.calculateUserSimilarity(userId1, userId2);
          this.similarities.set(`user-${userId1}-${userId2}`, similarity);
        }
      }
    }

    // Calculate item-item similarities
    for (const [productId1] of this.products) {
      for (const [productId2] of this.products) {
        if (productId1 !== productId2) {
          const similarity = this.calculateProductSimilarity(productId1, productId2);
          this.similarities.set(`product-${productId1}-${productId2}`, similarity);
        }
      }
    }
  }

  calculateUserSimilarity(user1Id, user2Id) {
    const user1Interactions = this.getUserInteractions(user1Id);
    const user2Interactions = this.getUserInteractions(user2Id);
    
    const commonProducts = new Set([
      ...user1Interactions.keys()
    ].filter(x => user2Interactions.has(x)));

    if (commonProducts.size === 0) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const productId of commonProducts) {
      const rating1 = user1Interactions.get(productId).rating;
      const rating2 = user2Interactions.get(productId).rating;
      
      dotProduct += rating1 * rating2;
      norm1 += rating1 * rating1;
      norm2 += rating2 * rating2;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  calculateProductSimilarity(product1Id, product2Id) {
    const product1Users = this.getProductInteractions(product1Id);
    const product2Users = this.getProductInteractions(product2Id);
    
    const commonUsers = new Set([
      ...product1Users.keys()
    ].filter(x => product2Users.has(x)));

    if (commonUsers.size === 0) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const userId of commonUsers) {
      const rating1 = product1Users.get(userId).rating;
      const rating2 = product2Users.get(userId).rating;
      
      dotProduct += rating1 * rating2;
      norm1 += rating1 * rating1;
      norm2 += rating2 * rating2;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  getUserInteractions(userId) {
    const interactions = new Map();
    for (const [key, interaction] of this.interactions) {
      if (interaction.userId === userId) {
        interactions.set(interaction.productId, interaction);
      }
    }
    return interactions;
  }

  getProductInteractions(productId) {
    const interactions = new Map();
    for (const [key, interaction] of this.interactions) {
      if (interaction.productId === productId) {
        interactions.set(interaction.userId, interaction);
      }
    }
    return interactions;
  }

  generateRecommendations(userId) {
    const userInteractions = this.getUserInteractions(userId);
    const recommendations = new Map();

    // Collaborative Filtering
    const similarUsers = this.findSimilarUsers(userId);
    
    for (const [similarUserId, similarity] of similarUsers) {
      const similarUserInteractions = this.getUserInteractions(similarUserId);
      
      for (const [productId, interaction] of similarUserInteractions) {
        if (!userInteractions.has(productId)) {
          const score = (recommendations.get(productId)?.score || 0) + 
                       similarity * interaction.rating;
          recommendations.set(productId, {
            productId,
            score,
            type: 'collaborative'
          });
        }
      }
    }

    // Content-based Filtering
    const userPreferences = this.analyzeUserPreferences(userId);
    const contentBasedRecs = this.findSimilarProducts(userPreferences);
    
    for (const [productId, score] of contentBasedRecs) {
      if (!userInteractions.has(productId)) {
        const existingScore = recommendations.get(productId)?.score || 0;
        recommendations.set(productId, {
          productId,
          score: existingScore + score,
          type: 'content'
        });
      }
    }

    return Array.from(recommendations.values())
      .sort((a, b) => b.score - a.score);
  }

  findSimilarUsers(userId) {
    const similarities = new Map();
    
    for (const [otherId] of this.users) {
      if (otherId !== userId) {
        const similarity = this.similarities.get(`user-${userId}-${otherId}`);
        if (similarity > 0.1) { // Threshold for similarity
          similarities.set(otherId, similarity);
        }
      }
    }

    return new Map([...similarities.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)); // Top 10 similar users
  }

  analyzeUserPreferences(userId) {
    const preferences = {
      categories: new Map(),
      attributes: new Map(),
      priceRange: {
        min: Infinity,
        max: -Infinity,
        avg: 0
      }
    };

    const userInteractions = this.getUserInteractions(userId);
    let totalPrice = 0;
    let count = 0;

    for (const [productId, interaction] of userInteractions) {
      const product = this.products.get(productId);
      
      // Category preferences
      const categoryScore = preferences.categories.get(product.category) || 0;
      preferences.categories.set(
        product.category,
        categoryScore + interaction.rating
      );

      // Attribute preferences
      for (const attribute of product.attributes) {
        const attrScore = preferences.attributes.get(attribute) || 0;
        preferences.attributes.set(
          attribute,
          attrScore + interaction.rating
        );
      }

      // Price preferences
      preferences.priceRange.min = Math.min(
        preferences.priceRange.min,
        product.price
      );
      preferences.priceRange.max = Math.max(
        preferences.priceRange.max,
        product.price
      );
      totalPrice += product.price;
      count++;
    }

    preferences.priceRange.avg = totalPrice / count;
    return preferences;
  }

  findSimilarProducts(preferences) {
    const scores = new Map();

    for (const [productId, product] of this.products) {
      let score = 0;

      // Category matching
      const categoryScore = preferences.categories.get(product.category) || 0;
      score += categoryScore * 0.4; // Weight for category similarity

      // Attribute matching
      let attributeScore = 0;
      for (const attribute of product.attributes) {
        attributeScore += preferences.attributes.get(attribute) || 0;
      }
      score += (attributeScore / product.attributes.length) * 0.3;

      // Price matching
      const priceScore = 1 - Math.abs(
        product.price - preferences.priceRange.avg
      ) / preferences.priceRange.avg;
      score += priceScore * 0.3;

      scores.set(productId, score);
    }

    return scores;
  }

  recordInteraction(userId, productId, type) {
    const interaction = {
      userId,
      productId,
      type,
      timestamp: new Date(),
      rating: this.inferRating(type)
    };

    this.interactions.set(
      `${userId}-${productId}`,
      interaction
    );

    // Update similarities and recommendations
    this.updateSimilarities(userId, productId);
    this.updateRecommendations(userId);
  }

  inferRating(interactionType) {
    const ratings = {
      view: 1,
      wishlist: 2,
      cart: 3,
      purchase: 5
    };
    return ratings[interactionType] || 0;
  }

  updateSimilarities(userId, productId) {
    // Update user similarities
    for (const [otherId] of this.users) {
      if (otherId !== userId) {
        const similarity = this.calculateUserSimilarity(userId, otherId);
        this.similarities.set(`user-${userId}-${otherId}`, similarity);
        this.similarities.set(`user-${otherId}-${userId}`, similarity);
      }
    }

    // Update product similarities
    for (const [otherProductId] of this.products) {
      if (otherProductId !== productId) {
        const similarity = this.calculateProductSimilarity(
          productId,
          otherProductId
        );
        this.similarities.set(
          `product-${productId}-${otherProductId}`,
          similarity
        );
        this.similarities.set(
          `product-${otherProductId}-${productId}`,
          similarity
        );
      }
    }
  }

  updateRecommendations(userId) {
    const recommendations = this.generateRecommendations(userId);
    this.recommendations.set(userId, recommendations);
    this.updateUI(userId);
  }

  updateUI(userId) {
    const recommendations = this.recommendations.get(userId);
    if (!recommendations) return;

    this.elements.recommendationPanel.innerHTML = `
      <div class="recommendations-container">
        ${recommendations.slice(0, 5).map(rec => `
          <div class="recommendation-card" data-product-id="${rec.productId}">
            ${this.renderProductCard(this.products.get(rec.productId), rec)}
          </div>
        `).join('')}
      </div>
    `;
  }

  renderProductCard(product, recommendation) {
    return `
      <div class="product-card">
        <img src="${product.image}" alt="${product.name}">
        <h3>${product.name}</h3>
        <p class="price">${this.formatPrice(product.price)}</p>
        <div class="recommendation-score">
          Match Score: ${(recommendation.score * 100).toFixed(1)}%
        </div>
        <div class="recommendation-type">
          Based on: ${recommendation.type === 'collaborative' ? 
            'Similar Users' : 'Your Preferences'}
        </div>
      </div>
    `;
  }

  formatPrice(price) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(price);
  }
}

// Initialize recommendation system
const recommendationSystem = new RecommendationSystem();