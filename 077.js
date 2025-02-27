class ThemeManager {
    constructor(options = {}) {
        this.darkClass = options.darkClass || 'dark-mode';
        this.storageKey = options.storageKey || 'theme-preference';
        this.transitionDuration = options.transitionDuration || 300;
        this.defaultTheme = options.defaultTheme || 'light';
    }

    init() {
        this.setupThemeColors();
        this.createToggle();
        this.loadSavedPreference();
        this.bindEvents();
    }

    setupThemeColors() {
        const styles = `
            :root {
                --bg-light: #ffffff;
                --text-light: #333333;
                --border-light: #e0e0e0;
                --accent-light: #2196F3;
                
                --bg-dark: #1a1a1a;
                --text-dark: #ffffff;
                --border-dark: #404040;
                --accent-dark: #64B5F6;
            }

            body {
                transition: background-color ${this.transitionDuration}ms ease,
                            color ${this.transitionDuration}ms ease;
                margin: 0;
                min-height: 100vh;
            }

            body:not(.${this.darkClass}) {
                background-color: var(--bg-light);
                color: var(--text-light);
            }

            body.${this.darkClass} {
                background-color: var(--bg-dark);
                color: var(--text-dark);
            }

            .theme-toggle {
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 12px;
                border-radius: 50%;
                border: none;
                background: var(--accent-light);
                color: white;
                cursor: pointer;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                transition: transform 0.2s ease, background-color ${this.transitionDuration}ms ease;
                z-index: 1000;
            }

            .${this.darkClass} .theme-toggle {
                background: var(--accent-dark);
            }

            .theme-toggle:hover {
                transform: scale(1.1);
            }

            .theme-toggle .icon {
                width: 24px;
                height: 24px;
                display: block;
                transition: transform 0.5s ease;
            }

            .theme-toggle .sun-icon,
            .theme-toggle .moon-icon {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                transition: opacity 0.3s ease, transform 0.5s ease;
            }

            .theme-toggle .sun-icon {
                opacity: 0;
            }

            .${this.darkClass} .theme-toggle .sun-icon {
                opacity: 1;
            }

            .${this.darkClass} .theme-toggle .moon-icon {
                opacity: 0;
            }

            .theme-transition * {
                transition: none !important;
            }

            /* Additional dark mode styles */
            .${this.darkClass} a {
                color: var(--accent-dark);
            }

            .${this.darkClass} input,
            .${this.darkClass} textarea,
            .${this.darkClass} select {
                background-color: var(--bg-dark);
                color: var(--text-dark);
                border-color: var(--border-dark);
            }

            .${this.darkClass} button {
                background-color: var(--accent-dark);
                color: var(--text-dark);
            }

            .theme-notification {
                position: fixed;
                bottom: 80px;
                right: 20px;
                padding: 12px 24px;
                border-radius: 8px;
                background: var(--accent-light);
                color: white;
                transform: translateY(100px);
                opacity: 0;
                transition: transform 0.3s ease, opacity 0.3s ease;
            }

            .theme-notification.show {
                transform: translateY(0);
                opacity: 1;
            }

            .${this.darkClass} .theme-notification {
                background: var(--accent-dark);
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    createToggle() {
        const toggle = document.createElement('button');
        toggle.className = 'theme-toggle';
        toggle.setAttribute('aria-label', 'Toggle dark mode');
        toggle.innerHTML = `
            <svg class="icon sun-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            <svg class="icon moon-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
        `;
        document.body.appendChild(toggle);
    }

    loadSavedPreference() {
        const savedTheme = localStorage.getItem(this.storageKey);
        
        // Check for system preference if no saved theme
        if (!savedTheme) {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.setTheme(prefersDark ? 'dark' : this.defaultTheme, false);
        } else {
            this.setTheme(savedTheme, false);
        }
    }

    bindEvents() {
        const toggle = document.querySelector('.theme-toggle');
        toggle.addEventListener('click', () => {
            const newTheme = document.body.classList.contains(this.darkClass) ? 'light' : 'dark';
            this.setTheme(newTheme, true);
        });

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addListener(e => {
            if (!localStorage.getItem(this.storageKey)) {
                this.setTheme(e.matches ? 'dark' : 'light', true);
            }
        });
    }

    setTheme(theme, showNotification = true) {
        // Prevent transition flicker
        document.body.classList.add('theme-transition');
        
        requestAnimationFrame(() => {
            document.body.classList.toggle(this.darkClass, theme === 'dark');
            
            requestAnimationFrame(() => {
                document.body.classList.remove('theme-transition');
            });
        });

        localStorage.setItem(this.storageKey, theme);

        if (showNotification) {
            this.showNotification(`${theme === 'dark' ? 'Dark' : 'Light'} mode activated`);
        }

        // Dispatch event for other scripts
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'theme-notification';
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Trigger reflow
        notification.offsetHeight;
        
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }
}

// Initialize
const themeManager = new ThemeManager({
    darkClass: 'dark-mode',
    storageKey: 'theme-preference',
    transitionDuration: 300,
    defaultTheme: 'light'
});

themeManager.init();