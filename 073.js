class ConnectionManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.pendingData = new Map();
        this.syncInProgress = false;
    }

    init() {
        this.setupUI();
        this.bindEvents();
        this.loadCachedData();
        this.setupFormTracking();
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="connection-status" id="connection-status">
                <div class="status-icon"></div>
                <span class="status-text"></span>
            </div>
        `;
        document.body.appendChild(container);

        // Add styles
        const styles = `
            .connection-status {
                position: fixed;
                top: 20px;
                right: 20px;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 20px;
                border-radius: 8px;
                background: white;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                transition: all 0.3s ease;
                z-index: 1000;
                opacity: 0;
                transform: translateY(-20px);
            }

            .connection-status.show {
                opacity: 1;
                transform: translateY(0);
            }

            .connection-status.online {
                background: #4CAF50;
                color: white;
            }

            .connection-status.offline {
                background: #f44336;
                color: white;
            }

            .status-icon {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: currentColor;
            }

            .status-text {
                font-size: 14px;
                font-weight: 500;
            }

            .form-overlay {
                display: none;
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.1);
                z-index: 1;
            }

            .form-overlay.show {
                display: block;
            }

            .offline-badge {
                position: absolute;
                top: 10px;
                right: 10px;
                background: #f44336;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        window.addEventListener('online', () => this.handleConnectionChange(true));
        window.addEventListener('offline', () => this.handleConnectionChange(false));

        // Listen for beforeunload to save pending data
        window.addEventListener('beforeunload', () => {
            if (this.pendingData.size > 0) {
                this.savePendingData();
            }
        });
    }

    handleConnectionChange(isOnline) {
        this.isOnline = isOnline;
        this.updateStatusUI();
        
        if (isOnline) {
            this.syncPendingData();
        }
    }

    updateStatusUI() {
        const status = document.getElementById('connection-status');
        status.className = `connection-status show ${this.isOnline ? 'online' : 'offline'}`;
        status.querySelector('.status-text').textContent = 
            this.isOnline ? 'Connected' : 'Offline Mode';

        // Auto-hide after 3 seconds
        setTimeout(() => {
            status.classList.remove('show');
        }, 3000);

        // Update form overlays
        this.updateFormOverlays();
    }

    setupFormTracking() {
        document.querySelectorAll('form').forEach(form => {
            // Add offline overlay
            const overlay = document.createElement('div');
            overlay.className = 'form-overlay';
            form.style.position = 'relative';
            form.appendChild(overlay);

            // Add offline badge
            const badge = document.createElement('div');
            badge.className = 'offline-badge';
            badge.textContent = 'Offline';
            badge.style.display = 'none';
            form.appendChild(badge);

            // Track form inputs
            form.addEventListener('input', (e) => {
                if (!this.isOnline) {
                    this.cacheFormData(form);
                }
            });

            form.addEventListener('submit', async (e) => {
                if (!this.isOnline) {
                    e.preventDefault();
                    this.cacheFormData(form);
                    this.showOfflineNotification(form);
                }
            });
        });
    }

    updateFormOverlays() {
        document.querySelectorAll('form').forEach(form => {
            const overlay = form.querySelector('.form-overlay');
            const badge = form.querySelector('.offline-badge');
            
            if (this.isOnline) {
                overlay.classList.remove('show');
                badge.style.display = 'none';
            } else {
                badge.style.display = 'block';
            }
        });
    }

    cacheFormData(form) {
        const formData = new FormData(form);
        const data = {
            url: form.action,
            method: form.method,
            data: Object.fromEntries(formData),
            timestamp: Date.now()
        };

        this.pendingData.set(form.id || `form_${Date.now()}`, data);
        this.savePendingData();
    }

    savePendingData() {
        localStorage.setItem('pendingFormData', 
            JSON.stringify(Array.from(this.pendingData.entries())));
    }

    loadCachedData() {
        const cached = localStorage.getItem('pendingFormData');
        if (cached) {
            this.pendingData = new Map(JSON.parse(cached));
            this.restoreCachedForms();
        }
    }

    restoreCachedForms() {
        this.pendingData.forEach((data, formId) => {
            const form = document.getElementById(formId);
            if (form) {
                Object.entries(data.data).forEach(([name, value]) => {
                    const input = form.querySelector(`[name="${name}"]`);
                    if (input) {
                        input.value = value;
                    }
                });
            }
        });
    }

    async syncPendingData() {
        if (this.syncInProgress || !this.isOnline || this.pendingData.size === 0) return;

        this.syncInProgress = true;
        const total = this.pendingData.size;
        let completed = 0;

        try {
            for (const [formId, data] of this.pendingData) {
                try {
                    await this.submitForm(data);
                    this.pendingData.delete(formId);
                    completed++;
                    this.updateSyncProgress(completed, total);
                } catch (error) {
                    console.error(`Failed to sync form ${formId}:`, error);
                }
            }

            this.savePendingData();
            this.showSyncComplete();
        } finally {
            this.syncInProgress = false;
        }
    }

    async submitForm(formData) {
        const response = await fetch(formData.url, {
            method: formData.method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData.data)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response.json();
    }

    updateSyncProgress(completed, total) {
        const status = document.getElementById('connection-status');
        status.querySelector('.status-text').textContent = 
            `Syncing... ${completed}/${total}`;
        status.classList.add('show');
    }

    showSyncComplete() {
        const status = document.getElementById('connection-status');
        status.querySelector('.status-text').textContent = 'All data synced';
        status.classList.add('show');

        setTimeout(() => {
            status.classList.remove('show');
        }, 3000);
    }

    showOfflineNotification(form) {
        const notification = document.createElement('div');
        notification.className = 'offline-notification';
        notification.textContent = 'Form saved locally. Will sync when back online.';
        
        const notificationStyles = `
            .offline-notification {
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: #333;
                color: white;
                padding: 12px 24px;
                border-radius: 4px;
                animation: slideUp 0.3s ease-out;
            }

            @keyframes slideUp {
                from {
                    transform: translate(-50%, 100%);
                    opacity: 0;
                }
                to {
                    transform: translate(-50%, 0);
                    opacity: 1;
                }
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = notificationStyles;
        document.head.appendChild(styleSheet);

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Initialize
const connectionManager = new ConnectionManager();
connectionManager.init();