class NewsAggregator {
  constructor() {
    this.API_KEY = 'your_news_api_key';
    this.API_BASE_URL = 'https://newsapi.org/v2';
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    this.MAX_HISTORY = 50;
    this.categories = [
      'technology', 'business', 'health', 
      'science', 'sports', 'entertainment'
    ];
    
    this.init();
  }

  async init() {
    this.initializeUI();
    this.loadUserPreferences();
    this.setupEventListeners();
    await this.loadNews();
    this.setupNotifications();
    this.startBreakingNewsCheck();
  }

  initializeUI() {
    this.elements = {
      preferencesForm: document.getElementById('preferences-form'),
      newsContainer: document.getElementById('news-container'),
      topicsContainer: document.getElementById('topics-container'),
      searchInput: document.getElementById('search-input'),
      notificationContainer: document.getElementById('notification-container'),
      readingList: document.getElementById('reading-list'),
      historyContainer: document.getElementById('history-container')
    };

    this.createTopicsUI();
  }

  createTopicsUI() {
    this.elements.topicsContainer.innerHTML = `
      <div class="topics-grid">
        ${this.categories.map(category => `
          <div class="topic-item">
            <input type="checkbox" 
                   id="${category}" 
                   name="topics" 
                   value="${category}">
            <label for="${category}">
              ${category.charAt(0).toUpperCase() + category.slice(1)}
            </label>
          </div>
        `).join('')}
      </div>
    `;
  }

  setupEventListeners() {
    this.elements.preferencesForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.savePreferences();
    });

    this.elements.searchInput.addEventListener('input', 
      this.debounce(() => this.handleSearch(), 500)
    );

    document.addEventListener('scroll', 
      this.debounce(() => this.handleInfiniteScroll(), 200)
    );
  }

  loadUserPreferences() {
    const preferences = localStorage.getItem('newsPreferences');
    if (preferences) {
      const { topics, sources } = JSON.parse(preferences);
      
      // Set checkboxes
      topics.forEach(topic => {
        const checkbox = document.getElementById(topic);
        if (checkbox) checkbox.checked = true;
      });

      this.preferences = { topics, sources };
    } else {
      this.preferences = {
        topics: ['technology'], // Default topic
        sources: []
      };
    }
  }

  savePreferences() {
    const selectedTopics = Array.from(
      document.querySelectorAll('input[name="topics"]:checked')
    ).map(input => input.value);

    this.preferences.topics = selectedTopics;
    localStorage.setItem('newsPreferences', JSON.stringify(this.preferences));
    
    this.loadNews(true);
    this.showNotification('Preferences saved successfully');
  }

  async loadNews(refresh = false) {
    if (!this.preferences.topics.length) {
      this.showError('Please select at least one topic');
      return;
    }

    try {
      this.showLoader();
      const articles = await this.fetchNews(refresh);
      this.displayNews(articles);
    } catch (error) {
      this.showError('Failed to load news');
    } finally {
      this.hideLoader();
    }
  }

  async fetchNews(refresh = false) {
    const cacheKey = `news_cache_${this.preferences.topics.join('_')}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (!refresh && cachedData) {
      const { timestamp, articles } = JSON.parse(cachedData);
      if (Date.now() - timestamp < this.CACHE_DURATION) {
        return articles;
      }
    }

    const queries = this.preferences.topics.map(topic =>
      fetch(`${this.API_BASE_URL}/top-headlines?` + new URLSearchParams({
        category: topic,
        language: 'en',
        apiKey: this.API_KEY
      }))
    );

    const responses = await Promise.all(queries);
    const results = await Promise.all(responses.map(r => r.json()));
    
    const articles = this.processArticles(results);
    
    // Cache the results
    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      articles
    }));

    return articles;
  }

  processArticles(results) {
    const articles = results.flatMap(result => result.articles);
    
    // Remove duplicates and null values
    const uniqueArticles = Array.from(new Set(
      articles
        .filter(article => article && article.title && article.url)
        .map(article => JSON.stringify(article))
    )).map(str => JSON.parse(str));

    // Sort by date
    return uniqueArticles.sort((a, b) => 
      new Date(b.publishedAt) - new Date(a.publishedAt)
    );
  }

  displayNews(articles) {
    this.elements.newsContainer.innerHTML = articles.map(article => `
      <article class="news-card" data-url="${article.url}">
        ${article.urlToImage ? `
          <img src="${article.urlToImage}" 
               alt="${article.title}"
               onerror="this.style.display='none'">
        ` : ''}
        <div class="news-content">
          <h3>${article.title}</h3>
          <p>${article.description || ''}</p>
          <div class="news-meta">
            <span>${new Date(article.publishedAt).toLocaleDateString()}</span>
            <span>${article.source.name}</span>
          </div>
          <div class="news-actions">
            <button onclick="newsAggregator.saveToReadingList('${article.url}')">
              Save for later
            </button>
            <button onclick="newsAggregator.shareArticle('${article.url}')">
              Share
            </button>
          </div>
        </div>
      </article>
    `).join('');

    this.addArticleClickHandlers();
  }

  addArticleClickHandlers() {
    const articles = document.querySelectorAll('.news-card');
    articles.forEach(article => {
      article.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          this.openArticle(article.dataset.url);
        }
      });
    });
  }

  openArticle(url) {
    this.addToHistory({
      url,
      timestamp: Date.now()
    });
    window.open(url, '_blank');
  }

  addToHistory(article) {
    const history = JSON.parse(localStorage.getItem('newsHistory') || '[]');
    history.unshift(article);
    
    // Limit history size
    if (history.length > this.MAX_HISTORY) {
      history.pop();
    }

    localStorage.setItem('newsHistory', JSON.stringify(history));
    this.updateHistoryUI();
  }

  updateHistoryUI() {
    const history = JSON.parse(localStorage.getItem('newsHistory') || '[]');
    
    this.elements.historyContainer.innerHTML = history.map(item => `
      <div class="history-item">
        <a href="${item.url}" target="_blank">
          ${new URL(item.url).hostname}
        </a>
        <span>${new Date(item.timestamp).toLocaleDateString()}</span>
      </div>
    `).join('');
  }

  async handleSearch() {
    const query = this.elements.searchInput.value.trim();
    if (query.length < 3) return;

    try {
      const response = await fetch(`${this.API_BASE_URL}/everything?` + 
        new URLSearchParams({
          q: query,
          language: 'en',
          sortBy: 'relevancy',
          apiKey: this.API_KEY
        })
      );

      const data = await response.json();
      this.displayNews(data.articles);
    } catch (error) {
      this.showError('Search failed');
    }
  }

  handleInfiniteScroll() {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 1000) {
      this.loadMoreNews();
    }
  }

  async loadMoreNews() {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const articles = await this.fetchNews();
      this.appendNews(articles);
    } catch (error) {
      this.showError('Failed to load more news');
    } finally {
      this.isLoading = false;
    }
  }

  appendNews(articles) {
    const newArticles = document.createElement('div');
    newArticles.innerHTML = articles.map(/* same template as displayNews */).join('');
    this.elements.newsContainer.appendChild(newArticles);
    this.addArticleClickHandlers();
  }

  saveToReadingList(url) {
    const readingList = JSON.parse(localStorage.getItem('readingList') || '[]');
    if (!readingList.includes(url)) {
      readingList.push(url);
      localStorage.setItem('readingList', JSON.stringify(readingList));
      this.updateReadingListUI();
      this.showNotification('Article saved to reading list');
    }
  }

  updateReadingListUI() {
    const readingList = JSON.parse(localStorage.getItem('readingList') || '[]');
    
    this.elements.readingList.innerHTML = readingList.map(url => `
      <div class="reading-list-item">
        <a href="${url}" target="_blank">${new URL(url).hostname}</a>
        <button onclick="newsAggregator.removeFromReadingList('${url}')">
          Remove
        </button>
      </div>
    `).join('');
  }

  removeFromReadingList(url) {
    const readingList = JSON.parse(localStorage.getItem('readingList') || '[]');
    const index = readingList.indexOf(url);
    if (index > -1) {
      readingList.splice(index, 1);
      localStorage.setItem('readingList', JSON.stringify(readingList));
      this.updateReadingListUI();
      this.showNotification('Article removed from reading list');
    }
  }

  async shareArticle(url) {
    if (navigator.share) {
      try {
        await navigator.share({
          url: url
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      // Fallback
      navigator.clipboard.writeText(url);
      this.showNotification('Link copied to clipboard');
    }
  }

  setupNotifications() {
    if ('Notification' in window) {
      Notification.requestPermission();
    }
  }

  startBreakingNewsCheck() {
    setInterval(() => this.checkBreakingNews(), 5 * 60 * 1000); // Every 5 minutes
  }

  async checkBreakingNews() {
    if (!this.preferences.topics.length) return;

    try {
      const response = await fetch(`${this.API_BASE_URL}/top-headlines?` + 
        new URLSearchParams({
          category: this.preferences.topics[0],
          language: 'en',
          apiKey: this.API_KEY
        })
      );

      const data = await response.json();
      const latestNews = data.articles[0];

      if (this.isBreakingNews(latestNews)) {
        this.notifyBreakingNews(latestNews);
      }
    } catch (error) {
      console.error('Breaking news check failed:', error);
    }
  }

  isBreakingNews(article) {
    const lastChecked = localStorage.getItem('lastBreakingNews');
    if (!lastChecked) return true;

    const isNewer = new Date(article.publishedAt) > new Date(lastChecked);
    const hasBreakingKeywords = /breaking|urgent|alert/i.test(article.title);

    return isNewer && hasBreakingKeywords;
  }

  notifyBreakingNews(article) {
    localStorage.setItem('lastBreakingNews', article.publishedAt);

    if (Notification.permission === 'granted') {
      new Notification('Breaking News', {
        body: article.title,
        icon: '/path/to/news-icon.png'
      });
    }

    this.showBreakingNewsAlert(article);
  }

  showBreakingNewsAlert(article) {
    const alert = document.createElement('div');
    alert.className = 'breaking-news-alert';
    alert.innerHTML = `
      <strong>Breaking News:</strong>
      <p>${article.title}</p>
      <button onclick="this.parentElement.remove()">✕</button>
    `;

    this.elements.notificationContainer.appendChild(alert);
  }

  showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;

    this.elements.notificationContainer.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  showError(message) {
    this.showNotification(message);
  }

  showLoader() {
    const loader = document.createElement('div');
    loader.className = 'loader';
    this.elements.newsContainer.appendChild(loader);
  }

  hideLoader() {
    const loader = document.querySelector('.loader');
    if (loader) loader.remove();
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}

// Initialize the news aggregator
const newsAggregator = new NewsAggregator();