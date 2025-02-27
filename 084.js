const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

class AuthenticationSystem {
    constructor(options = {}) {
        this.options = {
            dbPath: options.dbPath || 'users.json',
            saltRounds: options.saltRounds || 10,
            tokenExpiration: options.tokenExpiration || '24h',
            minPasswordLength: options.minPasswordLength || 8
        };

        this.users = new Map();
        this.sessions = new Map();
        this.loadUsers();
    }

    loadUsers() {
        try {
            if (fs.existsSync(this.options.dbPath)) {
                const data = fs.readFileSync(this.options.dbPath, 'utf8');
                const users = JSON.parse(data);
                this.users = new Map(Object.entries(users));
            }
        } catch (error) {
            console.error('Error loading users:', error);
            this.users = new Map();
        }
    }

    saveUsers() {
        try {
            const data = JSON.stringify(Object.fromEntries(this.users), null, 2);
            fs.writeFileSync(this.options.dbPath, data, 'utf8');
        } catch (error) {
            console.error('Error saving users:', error);
            throw new Error('Failed to save user data');
        }
    }

    generateSalt() {
        return crypto.randomBytes(16).toString('hex');
    }

    hashPassword(password, salt) {
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(
                password,
                salt,
                100000, // iterations
                64,     // key length
                'sha512',
                (err, derivedKey) => {
                    if (err) reject(err);
                    resolve(derivedKey.toString('hex'));
                }
            );
        });
    }

    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    validatePassword(password) {
        if (password.length < this.options.minPasswordLength) {
            throw new Error(`Password must be at least ${this.options.minPasswordLength} characters long`);
        }

        // Check for at least one uppercase letter
        if (!/[A-Z]/.test(password)) {
            throw new Error('Password must contain at least one uppercase letter');
        }

        // Check for at least one lowercase letter
        if (!/[a-z]/.test(password)) {
            throw new Error('Password must contain at least one lowercase letter');
        }

        // Check for at least one number
        if (!/\d/.test(password)) {
            throw new Error('Password must contain at least one number');
        }

        // Check for at least one special character
        if (!/[!@#$%^&*]/.test(password)) {
            throw new Error('Password must contain at least one special character');
        }

        return true;
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new Error('Invalid email format');
        }
        return true;
    }

    async register(email, password, additionalInfo = {}) {
        try {
            // Validate input
            this.validateEmail(email);
            this.validatePassword(password);

            // Check if user already exists
            if (this.users.has(email)) {
                throw new Error('User already exists');
            }

            // Generate salt and hash password
            const salt = this.generateSalt();
            const hashedPassword = await this.hashPassword(password, salt);

            // Create user object
            const user = {
                email,
                hashedPassword,
                salt,
                createdAt: new Date().toISOString(),
                ...additionalInfo
            };

            // Save user
            this.users.set(email, user);
            this.saveUsers();

            return { email, createdAt: user.createdAt };

        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    async login(email, password) {
        try {
            // Get user
            const user = this.users.get(email);
            if (!user) {
                throw new Error('User not found');
            }

            // Verify password
            const hashedPassword = await this.hashPassword(password, user.salt);
            if (hashedPassword !== user.hashedPassword) {
                throw new Error('Invalid password');
            }

            // Generate session token
            const token = this.generateToken();
            const session = {
                email,
                token,
                createdAt: new Date().toISOString(),
                expiresAt: this.calculateExpirationTime()
            };

            this.sessions.set(token, session);

            return {
                token,
                email,
                expiresAt: session.expiresAt
            };

        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    validateSession(token) {
        const session = this.sessions.get(token);
        if (!session) {
            return false;
        }

        // Check if session has expired
        if (new Date() > new Date(session.expiresAt)) {
            this.sessions.delete(token);
            return false;
        }

        return true;
    }

    logout(token) {
        this.sessions.delete(token);
    }

    calculateExpirationTime() {
        const duration = this.parseDuration(this.options.tokenExpiration);
        return new Date(Date.now() + duration).toISOString();
    }

    parseDuration(duration) {
        const unit = duration.slice(-1);
        const value = parseInt(duration.slice(0, -1));

        switch (unit) {
            case 'h': return value * 60 * 60 * 1000; // hours
            case 'd': return value * 24 * 60 * 60 * 1000; // days
            case 'm': return value * 60 * 1000; // minutes
            default: return 24 * 60 * 60 * 1000; // default 24 hours
        }
    }

    async changePassword(email, oldPassword, newPassword) {
        try {
            // Verify current password
            const user = this.users.get(email);
            if (!user) {
                throw new Error('User not found');
            }

            const hashedOldPassword = await this.hashPassword(oldPassword, user.salt);
            if (hashedOldPassword !== user.hashedPassword) {
                throw new Error('Invalid current password');
            }

            // Validate new password
            this.validatePassword(newPassword);

            // Update password
            const salt = this.generateSalt();
            const hashedPassword = await this.hashPassword(newPassword, salt);

            user.hashedPassword = hashedPassword;
            user.salt = salt;
            user.updatedAt = new Date().toISOString();

            this.users.set(email, user);
            this.saveUsers();

            // Invalidate all sessions for this user
            for (const [token, session] of this.sessions.entries()) {
                if (session.email === email) {
                    this.sessions.delete(token);
                }
            }

            return { success: true, message: 'Password updated successfully' };

        } catch (error) {
            console.error('Change password error:', error);
            throw error;
        }
    }

    getUserInfo(email) {
        const user = this.users.get(email);
        if (!user) {
            throw new Error('User not found');
        }

        // Return user info without sensitive data
        const { hashedPassword, salt, ...userInfo } = user;
        return userInfo;
    }
}

// Usage example:
async function example() {
    const auth = new AuthenticationSystem({
        dbPath: 'users.json',
        saltRounds: 10,
        tokenExpiration: '24h',
        minPasswordLength: 8
    });

    try {
        // Register a new user
        await auth.register('user@example.com', 'SecurePass123!', {
            name: 'John Doe',
            role: 'user'
        });

        // Login
        const session = await auth.login('user@example.com', 'SecurePass123!');
        console.log('Login successful:', session);

        // Validate session
        const isValid = auth.validateSession(session.token);
        console.log('Session valid:', isValid);

        // Change password
        await auth.changePassword('user@example.com', 'SecurePass123!', 'NewSecurePass456!');

        // Get user info
        const userInfo = auth.getUserInfo('user@example.com');
        console.log('User info:', userInfo);

        // Logout
        auth.logout(session.token);

    } catch (error) {
        console.error('Error:', error.message);
    }
}

example();