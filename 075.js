class InfiniteScroll {
    constructor(options = {}) {
        this.container = options.container || document.querySelector('#content');
        this.loadingDistance = options.loadingDistance || 100;
        this.pageSize = options.pageSize || 20;
        this.currentPage = 1;
        this.loading = false;
        this.hasMore = true;
        this.apiEndpoint = options.apiEndpoint || '/api/items';
    }

    init() {
        this.setupUI();
        this.bindEvents();
        this.loadInitialContent();
    }

    setupUI() {
        this.container.innerHTML = `
            <div class="infinite-scroll-content"></div>
            <div class="loading-indicator">
                <div class="spinner"></div>
                <span>Loading more items...</span>
            </div>
        `;

        // Add styles
        const styles = `
            .infinite-scroll-content {
                min-height: 100px;
            }

            .loading-indicator {
                display: none;
                align-items: center;
                justify-content: center;
                padding: 20px;
                text-align: center;
                color: #666;
            }

            .loading-indicator.visible {
                display: flex;
                gap: 10px;
            }

            .spinner {
                width: 20px;
                height: 20px;
                border: 2px solid #f3f3f3;
                border-top: 2px solid #3498db;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            .item-card {
                background: white;
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 15px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                animation: fadeIn 0.3s ease-out;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .error-message {
                background: #ffebee;
                color: #c62828;
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
                text-align: center;
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        // Debounced scroll handler
        window.addEventListener('scroll', this.debounce(() => {
            this.handleScroll();
        }, 150));

        // Handle resize events
        window.addEventListener('resize', this.debounce(() => {
            this.handleScroll();
        }, 150));
    }

    async loadInitialContent() {
        try {
            await this.loadMoreContent();
        } catch (error) {
            this.showError('Failed to load initial content');
        }
    }

    handleScroll() {
        if (this.loading || !this.hasMore) return;

        const scrollPosition = window.innerHeight + window.scrollY;
        const contentHeight = this.container.offsetHeight;

        if (contentHeight - scrollPosition < this.loadingDistance) {
            this.loadMoreContent();
        }
    }

    async loadMoreContent() {
        try {
            this.loading = true;
            this.showLoading();

            const items = await this.fetchItems();
            
            if (items.length === 0) {
                this.hasMore = false;
                this.showEndMessage();
                return;
            }

            this.renderItems(items);
            this.currentPage++;
            
        } catch (error) {
            this.showError('Error loading content');
            console.error('Failed to load content:', error);
        } finally {
            this.loading = false;
            this.hideLoading();
        }
    }

    async fetchItems() {
        const response = await fetch(`${this.apiEndpoint}?page=${this.currentPage}&size=${this.pageSize}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.items || [];
    }

    renderItems(items) {
        const content = this.container.querySelector('.infinite-scroll-content');
        
        const fragment = document.createDocumentFragment();
        
        items.forEach(item => {
            const itemElement = this.createItemElement(item);
            fragment.appendChild(itemElement);
        });

        content.appendChild(fragment);
    }

    createItemElement(item) {
        const element = document.createElement('div');
        element.className = 'item-card';
        
        // Customize this based on your item structure
        element.innerHTML = `
            <h3>${item.title}</h3>
            <p>${item.description}</p>
            ${item.image ? `<img src="${item.image}" alt="${item.title}">` : ''}
            <div class="item-meta">
                <span>${item.date}</span>
                <span>${item.category}</span>
            </div>
        `;

        return element;
    }

    showLoading() {
        const loader = this.container.querySelector('.loading-indicator');
        loader.classList.add('visible');
    }

    hideLoading() {
        const loader = this.container.querySelector('.loading-indicator');
        loader.classList.remove('visible');
    }

    showEndMessage() {
        const endMessage = document.createElement('div');
        endMessage.className = 'end-message';
        endMessage.textContent = 'No more items to load';
        endMessage.style.textAlign = 'center';
        endMessage.style.padding = '20px';
        endMessage.style.color = '#666';
        
        this.container.appendChild(endMessage);
    }

    showError(message) {
        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.textContent = message;
        
        const content = this.container.querySelector('.infinite-scroll-content');
        content.appendChild(errorElement);

        // Remove error after 5 seconds
        setTimeout(() => {
            errorElement.remove();
        }, 5000);
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

    // Helper method to check if element is in viewport
    isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }
}

// Initialize
const infiniteScroll = new InfiniteScroll({
    container: document.querySelector('#content'),
    loadingDistance: 200,
    pageSize: 20,
    apiEndpoint: 'https://api.example.com/items'
});

infiniteScroll.init();