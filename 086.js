class SessionManager {
    constructor(options = {}) {
        this.options = {
            tokenName: options.tokenName || 'auth_token',
            refreshTokenName: options.refreshTokenName || 'refresh_token',
            tokenExpiry: options.tokenExpiry || 3600, // 1 hour
            refreshTokenExpiry: options.refreshTokenExpiry || 2592000, // 30 days
            secure: options.secure !== false,
            apiEndpoint: options.apiEndpoint || '/api/auth',
            storage: options.storage || 'local', // 'local' or 'session'
            autoRefresh: options.autoRefresh !== false,
            refreshThreshold: options.refreshThreshold || 300 // 5 minutes
        };

        this.storage = this.options.storage === 'local' ? localStorage : sessionStorage;
        this.refreshTimer = null;
        this.pendingRefresh = null;
    }

    async init() {
        try {
            // Check for existing session
            const session = this.getStoredSession();
            if (session) {
                // Validate and refresh if needed
                await this.validateSession(session);
            }

            // Setup event listeners
            this.setupEventListeners();

        } catch (error) {
            console.error('Session initialization error:', error);
            this.clearSession();
        }
    }

    setupEventListeners() {
        // Listen for storage events (cross-tab synchronization)
        window.addEventListener('storage', (event) => {
            if (event.key === this.options.tokenName || 
                event.key === this.options.refreshTokenName) {
                this.handleStorageChange(event);
            }
        });

        // Listen for online/offline events
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        // Listen for visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.handleVisibilityChange();
            }
        });
    }

    async createSession(credentials) {
        try {
            const response = await fetch(`${this.options.apiEndpoint}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(credentials)
            });

            if (!response.ok) {
                throw new Error('Authentication failed');
            }

            const { token, refreshToken, user } = await response.json();
            
            // Store session data
            this.storeSession({
                token,
                refreshToken,
                user,
                expiresAt: this.calculateExpiry(this.options.tokenExpiry),
                refreshExpiresAt: this.calculateExpiry(this.options.refreshTokenExpiry)
            });

            // Setup refresh timer
            this.setupRefreshTimer();

            return user;

        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    storeSession(session) {
        // Encrypt sensitive data before storing
        const encryptedSession = this.encryptSession(session);

        this.storage.setItem(this.options.tokenName, encryptedSession.token);
        this.storage.setItem(this.options.refreshTokenName, encryptedSession.refreshToken);
        this.storage.setItem('session_data', JSON.stringify({
            user: session.user,
            expiresAt: session.expiresAt,
            refreshExpiresAt: session.refreshExpiresAt
        }));

        // Dispatch session change event
        this.dispatchSessionEvent('sessionCreated', session);
    }

    getStoredSession() {
        try {
            const token = this.storage.getItem(this.options.tokenName);
            const refreshToken = this.storage.getItem(this.options.refreshTokenName);
            const sessionData = JSON.parse(this.storage.getItem('session_data') || '{}');

            if (!token || !refreshToken) {
                return null;
            }

            // Decrypt tokens
            const decryptedSession = this.decryptSession({ token, refreshToken });

            return {
                ...decryptedSession,
                ...sessionData
            };

        } catch (error) {
            console.error('Error reading session:', error);
            return null;
        }
    }

    async validateSession(session) {
        // Check if refresh token has expired
        if (new Date() >= new Date(session.refreshExpiresAt)) {
            throw new Error('Refresh token expired');
        }

        // Check if access token needs refresh
        if (this.shouldRefreshToken(session)) {
            await this.refreshSession(session);
        }

        return true;
    }

    shouldRefreshToken(session) {
        const now = new Date();
        const expiresAt = new Date(session.expiresAt);
        const threshold = this.options.refreshThreshold * 1000; // Convert to milliseconds

        return (expiresAt - now) <= threshold;
    }

    async refreshSession(session) {
        // Prevent multiple simultaneous refresh attempts
        if (this.pendingRefresh) {
            return this.pendingRefresh;
        }

        try {
            this.pendingRefresh = fetch(`${this.options.apiEndpoint}/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.refreshToken}`
                }
            });

            const response = await this.pendingRefresh;
            
            if (!response.ok) {
                throw new Error('Token refresh failed');
            }

            const { token, refreshToken } = await response.json();

            // Update session
            const updatedSession = {
                ...session,
                token,
                refreshToken,
                expiresAt: this.calculateExpiry(this.options.tokenExpiry),
                refreshExpiresAt: this.calculateExpiry(this.options.refreshTokenExpiry)
            };

            this.storeSession(updatedSession);
            this.setupRefreshTimer();

            return updatedSession;

        } catch (error) {
            console.error('Refresh error:', error);
            this.clearSession();
            throw error;
        } finally {
            this.pendingRefresh = null;
        }
    }

    setupRefreshTimer() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        const session = this.getStoredSession();
        if (!session) return;

        const now = new Date();
        const expiresAt = new Date(session.expiresAt);
        const timeUntilRefresh = Math.max(0, expiresAt - now - 
            (this.options.refreshThreshold * 1000));

        this.refreshTimer = setTimeout(() => {
            this.refreshSession(session).catch(console.error);
        }, timeUntilRefresh);
    }

    clearSession() {
        this.storage.removeItem(this.options.tokenName);
        this.storage.removeItem(this.options.refreshTokenName);
        this.storage.removeItem('session_data');

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        this.dispatchSessionEvent('sessionDestroyed');
    }

    async logout() {
        const session = this.getStoredSession();
        if (!session) return;

        try {
            await fetch(`${this.options.apiEndpoint}/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.token}`
                }
            });
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            this.clearSession();
        }
    }

    encryptSession(session) {
        // In a real implementation, use a proper encryption library
        // This is a simple example using base64 encoding
        return {
            token: btoa(session.token),
            refreshToken: btoa(session.refreshToken)
        };
    }

    decryptSession(session) {
        // Decrypt tokens
        return {
            token: atob(session.token),
            refreshToken: atob(session.refreshToken)
        };
    }

    calculateExpiry(seconds) {
        return new Date(Date.now() + (seconds * 1000)).toISOString();
    }

    handleStorageChange(event) {
        // Handle cross-tab session changes
        if (event.key === this.options.tokenName) {
            if (!event.newValue) {
                // Token was removed in another tab
                this.clearSession();
                this.dispatchSessionEvent('sessionTerminated');
            } else {
                // Token was updated in another tab
                this.setupRefreshTimer();
            }
        }
    }

    handleOnline() {
        // Validate session when coming back online
        const session = this.getStoredSession();
        if (session) {
            this.validateSession(session).catch(() => this.clearSession());
        }
    }

    handleOffline() {
        // Pause refresh timer when offline
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
    }

    handleVisibilityChange() {
        // Validate session when tab becomes visible
        const session = this.getStoredSession();
        if (session) {
            this.validateSession(session).catch(() => this.clearSession());
        }
    }

    dispatchSessionEvent(type, data = null) {
        const event = new CustomEvent('sessionChange', {
            detail: { type, data }
        });
        window.dispatchEvent(event);
    }

    // Utility methods for session state
    isAuthenticated() {
        const session = this.getStoredSession();
        return session !== null && new Date() < new Date(session.refreshExpiresAt);
    }

    getUser() {
        const session = this.getStoredSession();
        return session ? session.user : null;
    }

    getToken() {
        const session = this.getStoredSession();
        return session ? session.token : null;
    }

    async ensureAuthenticated() {
        const session = this.getStoredSession();
        if (!session) {
            throw new Error('No active session');
        }

        await this.validateSession(session);
        return session;
    }
}

// Usage example:
const sessionManager = new SessionManager({
    apiEndpoint: 'https://api.example.com/auth',
    tokenExpiry: 3600,
    refreshTokenExpiry: 2592000,
    secure: true,
    storage: 'local',
    autoRefresh: true
});

// Initialize session management
sessionManager.init();

// Listen for session changes
window.addEventListener('sessionChange', (event) => {
    const { type, data } = event.detail;
    switch (type) {
        case 'sessionCreated':
            console.log('New session created:', data);
            break;
        case 'sessionDestroyed':
            console.log('Session ended');
            break;
        case 'sessionTerminated':
            console.log('Session terminated in another tab');
            break;
    }
});

// Example login
async function login(username, password) {
    try {
        const user = await sessionManager.createSession({ username, password });
        console.log('Logged in as:', user);
    } catch (error) {
        console.error('Login failed:', error);
    }
}

// Example authenticated request
async function makeAuthenticatedRequest() {
    try {
        await sessionManager.ensureAuthenticated();
        const token = sessionManager.getToken();
        
        const response = await fetch('https://api.example.com/data', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        return response.json();
    } catch (error) {
        console.error('Request failed:', error);
        throw error;
    }
}