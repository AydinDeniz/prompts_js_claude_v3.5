class AutoSaveForm {
    constructor(options = {}) {
        this.saveInterval = options.saveInterval || 5000; // 5 seconds
        this.formSelector = options.formSelector || 'form';
        this.storageKey = options.storageKey || 'autoSaveData';
        this.timer = null;
        this.lastSave = null;
        this.hasChanges = false;
    }

    init() {
        this.setupUI();
        this.bindEvents();
        this.checkForSavedData();
    }

    setupUI() {
        // Add status indicator
        const statusDiv = document.createElement('div');
        statusDiv.innerHTML = `
            <div class="auto-save-status" id="autoSaveStatus">
                <span class="status-icon"></span>
                <span class="status-text"></span>
            </div>
        `;
        document.querySelector(this.formSelector).appendChild(statusDiv);

        // Add styles
        const styles = `
            .auto-save-status {
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 12px 20px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 14px;
                transition: all 0.3s ease;
                opacity: 0;
                transform: translateY(20px);
                z-index: 1000;
            }

            .auto-save-status.show {
                opacity: 1;
                transform: translateY(0);
            }

            .status-icon {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #ccc;
            }

            .status-icon.saving {
                background: #2196F3;
                animation: pulse 1s infinite;
            }

            .status-icon.saved {
                background: #4CAF50;
            }

            .status-icon.error {
                background: #f44336;
            }

            .restore-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 25px;
                background: #4CAF50;
                color: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                display: flex;
                align-items: center;
                gap: 15px;
                z-index: 1000;
                animation: slideIn 0.3s ease-out;
            }

            .restore-notification button {
                background: white;
                color: #4CAF50;
                border: none;
                padding: 5px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
            }

            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }

            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        const form = document.querySelector(this.formSelector);

        // Track form changes
        form.addEventListener('input', () => {
            this.hasChanges = true;
            this.updateStatus('typing');
        });

        // Start auto-save timer when user starts typing
        form.addEventListener('input', this.debounce(() => {
            this.startAutoSave();
        }, 500));

        // Save before user leaves page
        window.addEventListener('beforeunload', () => {
            if (this.hasChanges) {
                this.saveFormData();
            }
        });
    }

    startAutoSave() {
        if (!this.timer) {
            this.timer = setInterval(() => {
                if (this.hasChanges) {
                    this.saveFormData();
                }
            }, this.saveInterval);
        }
    }

    async saveFormData() {
        try {
            this.updateStatus('saving');
            const form = document.querySelector(this.formSelector);
            const formData = new FormData(form);
            const data = {
                timestamp: new Date().toISOString(),
                fields: Object.fromEntries(formData.entries())
            };

            localStorage.setItem(this.storageKey, JSON.stringify(data));
            this.lastSave = data.timestamp;
            this.hasChanges = false;
            
            this.updateStatus('saved');
        } catch (error) {
            console.error('Auto-save error:', error);
            this.updateStatus('error');
        }
    }

    checkForSavedData() {
        const savedData = localStorage.getItem(this.storageKey);
        if (savedData) {
            try {
                const data = JSON.parse(savedData);
                this.showRestorePrompt(data);
            } catch (error) {
                console.error('Error parsing saved data:', error);
            }
        }
    }

    showRestorePrompt(data) {
        const notification = document.createElement('div');
        notification.className = 'restore-notification';
        
        const savedDate = new Date(data.timestamp);
        const timeAgo = this.getTimeAgo(savedDate);
        
        notification.innerHTML = `
            <div>
                Found saved form data from ${timeAgo}
                <br>
                <small>Would you like to restore it?</small>
            </div>
            <div>
                <button id="restoreData">Restore</button>
                <button id="discardData">Discard</button>
            </div>
        `;

        document.body.appendChild(notification);

        document.getElementById('restoreData').onclick = () => {
            this.restoreFormData(data);
            notification.remove();
        };

        document.getElementById('discardData').onclick = () => {
            localStorage.removeItem(this.storageKey);
            notification.remove();
        };
    }

    restoreFormData(data) {
        const form = document.querySelector(this.formSelector);
        
        Object.entries(data.fields).forEach(([name, value]) => {
            const field = form.querySelector(`[name="${name}"]`);
            if (field) {
                if (field.type === 'checkbox') {
                    field.checked = value === 'on';
                } else if (field.type === 'radio') {
                    form.querySelector(`[name="${name}"][value="${value}"]`).checked = true;
                } else {
                    field.value = value;
                }
            }
        });

        this.showMessage('Form data restored successfully!', 'success');
    }

    updateStatus(status) {
        const statusElement = document.getElementById('autoSaveStatus');
        const iconElement = statusElement.querySelector('.status-icon');
        const textElement = statusElement.querySelector('.status-text');

        statusElement.classList.add('show');

        switch (status) {
            case 'typing':
                iconElement.className = 'status-icon';
                textElement.textContent = 'Changes not saved';
                break;
            case 'saving':
                iconElement.className = 'status-icon saving';
                textElement.textContent = 'Saving...';
                break;
            case 'saved':
                iconElement.className = 'status-icon saved';
                textElement.textContent = 'All changes saved';
                setTimeout(() => {
                    statusElement.classList.remove('show');
                }, 2000);
                break;
            case 'error':
                iconElement.className = 'status-icon error';
                textElement.textContent = 'Error saving changes';
                break;
        }
    }

    showMessage(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        let interval = Math.floor(seconds / 31536000);
        if (interval > 1) return `${interval} years ago`;
        
        interval = Math.floor(seconds / 2592000);
        if (interval > 1) return `${interval} months ago`;
        
        interval = Math.floor(seconds / 86400);
        if (interval > 1) return `${interval} days ago`;
        
        interval = Math.floor(seconds / 3600);
        if (interval > 1) return `${interval} hours ago`;
        
        interval = Math.floor(seconds / 60);
        if (interval > 1) return `${interval} minutes ago`;
        
        return 'just now';
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

// Initialize
const autoSave = new AutoSaveForm({
    saveInterval: 5000,
    formSelector: '#myForm',
    storageKey: 'myFormAutoSave'
});

autoSave.init();