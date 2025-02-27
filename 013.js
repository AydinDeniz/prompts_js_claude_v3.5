class ProductPage {
  constructor() {
    this.API_BASE_URL = 'https://api.example.com/products';
    this.DB_NAME = 'ecommerce_cache';
    this.DB_VERSION = 1;
    this.productId = this.getProductIdFromUrl();
    
    this.initializeUI();
    this.initializeDB().then(() => {
      this.loadProductData();
    });
  }

  initializeUI() {
    this.elements = {
      productContainer: document.getElementById('product-details'),
      imageGallery: document.getElementById('image-gallery'),
      reviewsContainer: document.getElementById('reviews-container'),
      ratingFilter: document.getElementById('rating-filter'),
      addToCartBtn: document.getElementById('add-to-cart'),
      quantityInput: document.getElementById('quantity')
    };

    this.setupEventListeners();
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
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('reviews')) {
          db.createObjectStore('reviews', { keyPath: 'id' });
        }
      };
    });
  }

  setupEventListeners() {
    this.elements.ratingFilter.addEventListener('change', () => {
      this.filterReviews(this.elements.ratingFilter.value);
    });

    this.elements.addToCartBtn.addEventListener('click', () => {
      this.addToCart();
    });

    this.elements.imageGallery.addEventListener('click', (e) => {
      if (e.target.tagName === 'IMG') {
        this.showImageModal(e.target.src);
      }
    });
  }

  async loadProductData() {
    try {
      const product = await this.getProduct(this.productId);
      const reviews = await this.getReviews(this.productId);
      
      this.displayProduct(product);
      this.displayReviews(reviews);
    } catch (error) {
      this.showError('Failed to load product data');
    }
  }

  async getProduct(productId) {
    // Try to get from IndexedDB first
    const cachedProduct = await this.getFromCache('products', productId);
    if (cachedProduct) return cachedProduct;

    // If not in cache, fetch from API
    const response = await fetch(`${this.API_BASE_URL}/${productId}`);
    if (!response.ok) throw new Error('Product not found');
    
    const product = await response.json();
    await this.addToCache('products', product);
    return product;
  }

  async getReviews(productId) {
    const cachedReviews = await this.getFromCache('reviews', productId);
    if (cachedReviews) return cachedReviews;

    const response = await fetch(`${this.API_BASE_URL}/${productId}/reviews`);
    if (!response.ok) throw new Error('Failed to load reviews');
    
    const reviews = await response.json();
    await this.addToCache('reviews', { id: productId, data: reviews });
    return reviews;
  }

  async getFromCache(storeName, id) {
    return new Promise((resolve) => {
      const transaction = this.db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async addToCache(storeName, data) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  displayProduct(product) {
    this.elements.productContainer.innerHTML = `
      <h1>${product.name}</h1>
      <div class="product-info">
        <div class="price">$${product.price.toFixed(2)}</div>
        <div class="stock">${product.inStock ? 'In Stock' : 'Out of Stock'}</div>
        <div class="rating">
          ${this.generateStarRating(product.rating)}
          <span>(${product.ratingCount} reviews)</span>
        </div>
      </div>
      <div class="description">${product.description}</div>
    `;

    this.displayImageGallery(product.images);
  }

  displayImageGallery(images) {
    this.elements.imageGallery.innerHTML = images
      .map(image => `
        <div class="image-thumbnail">
          <img src="${image.thumbnail}" 
               data-full="${image.full}" 
               alt="${image.alt}">
        </div>
      `)
      .join('');
  }

  displayReviews(reviews) {
    this.reviews = reviews;
    this.filterReviews(this.elements.ratingFilter.value);
  }

  filterReviews(minRating) {
    const filteredReviews = this.reviews.filter(review => 
      review.rating >= parseInt(minRating)
    );

    this.elements.reviewsContainer.innerHTML = filteredReviews
      .map(review => `
        <div class="review">
          <div class="review-header">
            <span class="review-author">${review.author}</span>
            <span class="review-date">
              ${new Date(review.date).toLocaleDateString()}
            </span>
          </div>
          <div class="review-rating">
            ${this.generateStarRating(review.rating)}
          </div>
          <div class="review-content">${review.content}</div>
        </div>
      `)
      .join('');
  }

  generateStarRating(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - Math.ceil(rating);

    return `
      ${'★'.repeat(fullStars)}
      ${hasHalfStar ? '½' : ''}
      ${'☆'.repeat(emptyStars)}
    `;
  }

  showImageModal(imageSrc) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <span class="close">&times;</span>
        <img src="${imageSrc}" alt="Product image">
      </div>
    `;

    modal.querySelector('.close').onclick = () => modal.remove();
    document.body.appendChild(modal);
  }

  addToCart() {
    const quantity = parseInt(this.elements.quantityInput.value);
    if (isNaN(quantity) || quantity < 1) {
      this.showError('Please enter a valid quantity');
      return;
    }

    // Dispatch custom event for cart management
    const event = new CustomEvent('add-to-cart', {
      detail: {
        productId: this.productId,
        quantity: quantity
      }
    });
    document.dispatchEvent(event);

    this.showSuccess('Product added to cart');
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  getProductIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }
}

// HTML structure
`
<!DOCTYPE html>
<html>
<head>
    <title>Product Details</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="product-page">
        <div id="image-gallery" class="image-gallery"></div>
        
        <div id="product-details" class="product-details"></div>
        
        <div class="purchase-section">
            <input type="number" id="quantity" min="1" value="1">
            <button id="add-to-cart">Add to Cart</button>
        </div>

        <div class="reviews-section">
            <h2>Customer Reviews</h2>
            <select id="rating-filter">
                <option value="0">All Ratings</option>
                <option value="5">5 Stars</option>
                <option value="4">4+ Stars</option>
                <option value="3">3+ Stars</option>
                <option value="2">2+ Stars</option>
                <option value="1">1+ Star</option>
            </select>
            <div id="reviews-container"></div>
        </div>
    </div>
    <script src="product-page.js"></script>
</body>
</html>
`

// CSS styles
`
.product-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}

.image-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 10px;
    margin-bottom: 20px;
}

.image-thumbnail {
    cursor: pointer;
    transition: transform 0.2s;
}

.image-thumbnail:hover {
    transform: scale(1.05);
}

.image-thumbnail img {
    width: 100%;
    height: auto;
    border-radius: 4px;
}

.image-modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.8);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.modal-content {
    position: relative;
    max-width: 90%;
    max-height: 90%;
}

.modal-content img {
    max-width: 100%;
    max-height: 90vh;
}

.close {
    position: absolute;
    top: -30px;
    right: 0;
    color: white;
    font-size: 24px;
    cursor: pointer;
}

.product-details {
    margin-bottom: 30px;
}

.product-info {
    display: flex;
    gap: 20px;
    align-items: center;
    margin: 15px 0;
}

.price {
    font-size: 24px;
    font-weight: bold;
}

.stock {
    color: #4CAF50;
}

.purchase-section {
    margin: 20px 0;
    display: flex;
    gap: 10px;
}

.reviews-section {
    margin-top: 40px;
}

.review {
    border-bottom: 1px solid #eee;
    padding: 15px 0;
}

.review-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
}

.review-rating {
    color: #f8c51c;
    margin-bottom: 5px;
}

.notification {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 20px;
    border-radius: 4px;
    color: white;
    animation: slideIn 0.3s, slideOut 0.3s 2.7s;
}

.notification.success {
    background-color: #4CAF50;
}

.notification.error {
    background-color: #f44336;
}

@keyframes slideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
}

@keyframes slideOut {
    from { transform: translateX(0); }
    to { transform: translateX(100%); }
}
`

// Initialize the product page
const productPage = new ProductPage();