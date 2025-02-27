class DashboardRouter {
    constructor(options = {}) {
        this.options = {
            defaultSection: options.defaultSection || 'home',
            container: options.container || '#dashboard-content',
            sections: options.sections || {},
            validateAccess: options.validateAccess || (() => true),
            onNavigate: options.onNavigate || null
        };

        this.currentSection = null;
        this.history = [];
    }

    init() {
        this.setupEventListeners();
        this.handleInitialRoute();
    }

    setupEventListeners() {
        // Handle browser back/forward buttons
        window.addEventListener('popstate', (event) => {
            this.navigateToState(event.state);
        });

        // Handle link clicks
        document.addEventListener('click', (event) => {
            const link = event.target.closest('[data-section]');
            if (link) {
                event.preventDefault();
                this.navigateToSection(link.dataset.section, link.dataset.params);
            }
        });
    }

    handleInitialRoute() {
        const params = new URLSearchParams(window.location.search);
        const section = params.get('section') || this.options.defaultSection;
        const additionalParams = Object.fromEntries(params.entries());
        delete additionalParams.section;

        this.navigateToSection(section, additionalParams, true);
    }

    async navigateToSection(section, params = {}, isInitial = false) {
        try {
            // Validate section
            if (!this.validateSection(section)) {
                throw new Error(`Invalid section: ${section}`);
            }

            // Check access permissions
            if (!await this.options.validateAccess(section, params)) {
                throw new Error('Access denied');
            }

            // Prepare URL and state
            const url = this.buildUrl(section, params);
            const state = { section, params };

            // Update history
            if (!isInitial) {
                window.history.pushState(state, '', url);
            }

            // Load and render section
            await this.renderSection(section, params);

            // Update current section and history
            this.currentSection = section;
            this.history.push({ section, params, timestamp: Date.now() });

            // Trigger navigation callback
            if (this.options.onNavigate) {
                this.options.onNavigate(section, params);
            }

        } catch (error) {
            this.handleNavigationError(error);
        }
    }

    validateSection(section) {
        return section in this.options.sections;
    }

    buildUrl(section, params = {}) {
        const urlParams = new URLSearchParams();
        urlParams.set('section', section);

        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                urlParams.set(key, value);
            }
        });

        return `${window.location.pathname}?${urlParams.toString()}`;
    }

    async renderSection(section, params) {
        const container = document.querySelector(this.options.container);
        if (!container) {
            throw new Error('Dashboard container not found');
        }

        // Show loading state
        this.showLoading(container);

        try {
            // Get section component
            const Component = this.options.sections[section];
            if (!Component) {
                throw new Error(`Section component not found: ${section}`);
            }

            // Clear current content
            container.innerHTML = '';

            // Render new content
            if (typeof Component === 'function') {
                // If Component is a class/function
                const instance = new Component(params);
                await instance.render(container);
            } else if (typeof Component === 'string') {
                // If Component is a template/HTML string
                container.innerHTML = Component;
            } else {
                throw new Error(`Invalid component type for section: ${section}`);
            }

            // Initialize any scripts or behaviors
            this.initializeSectionBehaviors(container);

        } catch (error) {
            this.handleRenderError(error, container);
        } finally {
            this.hideLoading(container);
        }
    }

    showLoading(container) {
        const loader = document.createElement('div');
        loader.className = 'dashboard-loader';
        loader.innerHTML = `
            <div class="loader-spinner"></div>
            <div class="loader-text">Loading...</div>
        `;
        container.appendChild(loader);

        // Add loader styles if not already present
        if (!document.getElementById('dashboard-loader-styles')) {
            const styles = `
                .dashboard-loader {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(255, 255, 255, 0.8);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }

                .loader-spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid #f3f3f3;
                    border-top: 3px solid #3498db;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }

                .loader-text {
                    margin-top: 10px;
                    color: #666;
                }

                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            const styleSheet = document.createElement('style');
            styleSheet.id = 'dashboard-loader-styles';
            styleSheet.textContent = styles;
            document.head.appendChild(styleSheet);
        }
    }

    hideLoading(container) {
        const loader = container.querySelector('.dashboard-loader');
        if (loader) {
            loader.remove();
        }
    }

    initializeSectionBehaviors(container) {
        // Initialize tooltips
        container.querySelectorAll('[data-tooltip]').forEach(element => {
            new Tooltip(element);
        });

        // Initialize form validations
        container.querySelectorAll('form').forEach(form => {
            form.addEventListener('submit', this.handleFormSubmit.bind(this));
        });

        // Initialize dynamic content
        this.initializeDynamicContent(container);
    }

    handleFormSubmit(event) {
        event.preventDefault();
        const form = event.target;
        const section = form.dataset.section;
        const formData = new FormData(form);
        const params = Object.fromEntries(formData.entries());

        this.navigateToSection(section, params);
    }

    initializeDynamicContent(container) {
        // Handle lazy loading
        const lazyElements = container.querySelectorAll('[data-lazy]');
        if (lazyElements.length > 0) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.loadLazyContent(entry.target);
                        observer.unobserve(entry.target);
                    }
                });
            });

            lazyElements.forEach(element => observer.observe(element));
        }
    }

    async loadLazyContent(element) {
        const url = element.dataset.lazy;
        try {
            const response = await fetch(url);
            const content = await response.text();
            element.innerHTML = content;
        } catch (error) {
            console.error('Failed to load lazy content:', error);
            element.innerHTML = 'Failed to load content';
        }
    }

    handleNavigationError(error) {
        console.error('Navigation error:', error);
        
        // Show error notification
        this.showNotification({
            type: 'error',
            message: error.message || 'Navigation failed',
            duration: 5000
        });

        // Redirect to default section if necessary
        if (this.currentSection !== this.options.defaultSection) {
            this.navigateToSection(this.options.defaultSection);
        }
    }

    handleRenderError(error, container) {
        console.error('Render error:', error);
        
        container.innerHTML = `
            <div class="error-container">
                <h3>Error Loading Section</h3>
                <p>${error.message}</p>
                <button onclick="window.location.reload()">Reload Page</button>
            </div>
        `;
    }

    showNotification({ type, message, duration = 3000 }) {
        const notification = document.createElement('div');
        notification.className = `dashboard-notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Add notification styles if not already present
        if (!document.getElementById('notification-styles')) {
            const styles = `
                .dashboard-notification {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 15px 25px;
                    border-radius: 4px;
                    color: white;
                    z-index: 1000;
                    animation: slideIn 0.3s ease-out;
                }

                .dashboard-notification.error {
                    background: #f44336;
                }

                .dashboard-notification.success {
                    background: #4CAF50;
                }

                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            const styleSheet = document.createElement('style');
            styleSheet.id = 'notification-styles';
            styleSheet.textContent = styles;
            document.head.appendChild(styleSheet);
        }

        setTimeout(() => {
            notification.remove();
        }, duration);
    }
}

// Usage example:
const router = new DashboardRouter({
    defaultSection: 'home',
    container: '#dashboard-content',
    sections: {
        home: class HomeSection {
            constructor(params) {
                this.params = params;
            }
            async render(container) {
                container.innerHTML = '<h1>Welcome to Dashboard</h1>';
            }
        },
        analytics: class AnalyticsSection {
            constructor(params) {
                this.params = params;
            }
            async render(container) {
                container.innerHTML = '<h1>Analytics Dashboard</h1>';
            }
        }
    },
    validateAccess: async (section, params) => {
        // Implement your access validation logic here
        return true;
    },
    onNavigate: (section, params) => {
        console.log(`Navigated to ${section}`, params);
    }
});

router.init();