class IdleMonitor {
    constructor(options = {}) {
        this.warningTimeout = options.warningTimeout || 5 * 60 * 1000; // 5 minutes
        this.logoutTimeout = options.logoutTimeout || 1 * 60 * 1000;   // 1 minute after warning
        this.warningTimer = null;
        this.logoutTimer = null;
        this.isWarned = false;
        this.events = [
            'mousedown', 'mousemove', 'keydown',
            'scroll', 'touchstart', 'click', 'keypress'
        ];
    }

    init() {
        this.createWarningModal();
        this.bindEvents();
        this.startTimer();
    }

    createWarningModal() {
        const modal = document.createElement('div');
        modal.innerHTML = `
            <div id="idle-warning-modal" class="idle-modal">
                <div class="idle-modal-content">
                    <h2>Session Timeout Warning</h2>
                    <p>You have been inactive for a while.</p>
                    <p>You will be logged out in <span id="idle-countdown">60</span> seconds.</p>
                    <button id="idle-stay-active">Stay Active</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Add styles
        const styles = `
            .idle-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 1000;
                animation: fadeIn 0.3s ease-in-out;
            }
            
            .idle-modal-content {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: white;
                padding: 2rem;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                text-align: center;
                min-width: 300px;
            }
            
            .idle-modal h2 {
                margin-top: 0;
                color: #333;
            }
            
            #idle-stay-active {
                background-color: #4CAF50;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1rem;
                margin-top: 1rem;
                transition: background-color 0.3s;
            }
            
            #idle-stay-active:hover {
                background-color: #45a049;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        // Bind activity events
        this.events.forEach(event => {
            document.addEventListener(event, () => this.resetTimer(), { passive: true });
        });

        // Bind modal button
        document.getElementById('idle-stay-active').addEventListener('click', () => {
            this.hideWarningModal();
            this.resetTimer();
        });
    }

    startTimer() {
        this.warningTimer = setTimeout(() => {
            this.showWarningModal();
            this.startLogoutTimer();
        }, this.warningTimeout);
    }

    resetTimer() {
        clearTimeout(this.warningTimer);
        clearTimeout(this.logoutTimer);
        
        if (this.isWarned) {
            this.hideWarningModal();
        }
        
        this.startTimer();
    }

    showWarningModal() {
        this.isWarned = true;
        document.getElementById('idle-warning-modal').style.display = 'block';
        this.updateCountdown(Math.floor(this.logoutTimeout / 1000));
    }

    hideWarningModal() {
        this.isWarned = false;
        document.getElementById('idle-warning-modal').style.display = 'none';
    }

    startLogoutTimer() {
        let secondsLeft = Math.floor(this.logoutTimeout / 1000);
        
        this.logoutTimer = setInterval(() => {
            secondsLeft--;
            this.updateCountdown(secondsLeft);
            
            if (secondsLeft <= 0) {
                this.logout();
            }
        }, 1000);
    }

    updateCountdown(seconds) {
        document.getElementById('idle-countdown').textContent = seconds;
    }

    logout() {
        clearInterval(this.logoutTimer);
        this.hideWarningModal();
        
        // Perform logout actions
        this.saveSessionData()
            .then(() => {
                // Show logout notification
                this.showLogoutNotification();
                
                // Redirect to login page
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            })
            .catch(error => {
                console.error('Error during logout:', error);
                // Handle error case
            });
    }

    async saveSessionData() {
        // Save any necessary session data before logout
        try {
            const response = await fetch('/api/session/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lastActive: new Date().toISOString(),
                    logoutReason: 'idle_timeout'
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to save session data');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error saving session data:', error);
            throw error;
        }
    }

    showLogoutNotification() {
        const notification = document.createElement('div');
        notification.className = 'logout-notification';
        notification.textContent = 'You have been logged out due to inactivity.';
        
        const notificationStyles = `
            .logout-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background-color: #f44336;
                color: white;
                padding: 1rem;
                border-radius: 4px;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                animation: slideIn 0.3s ease-out;
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
        styleSheet.textContent = notificationStyles;
        document.head.appendChild(styleSheet);
        
        document.body.appendChild(notification);
    }
}

// Usage
const idleMonitor = new IdleMonitor({
    warningTimeout: 5 * 60 * 1000,  // 5 minutes
    logoutTimeout: 1 * 60 * 1000    // 1 minute after warning
});

idleMonitor.init();