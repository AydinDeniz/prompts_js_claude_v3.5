const crypto = require('crypto');
const pbkdf2 = require('pbkdf2');
const { subtle } = require('crypto').webcrypto;

class SecurePasswordManager {
    constructor(options = {}) {
        this.options = {
            iterations: options.iterations || 600000,
            memLimit: options.memLimit || 1024 * 1024 * 64, // 64MB
            saltLength: options.saltLength || 32,
            keyLength: options.keyLength || 32,
            syncInterval: options.syncInterval || 5 * 60 * 1000, // 5 minutes
            database: options.database,
            breachAPI: options.breachAPI,
            notificationService: options.notificationService
        };

        this.vault = null;
        this.masterKey = null;
        this.syncTimer = null;
        this.pendingChanges = new Set();
    }

    async initialize(masterPassword) {
        try {
            // Generate salt and derive master key
            const salt = crypto.randomBytes(this.options.saltLength);
            this.masterKey = await this.deriveMasterKey(masterPassword, salt);

            // Initialize empty vault
            this.vault = {
                salt: salt.toString('hex'),
                entries: new Map(),
                shared: new Map(),
                metadata: {
                    version: 1,
                    lastSync: null,
                    deviceId: crypto.randomUUID()
                }
            };

            // Start sync timer
            this.startSyncTimer();

            return true;
        } catch (error) {
            console.error('Initialization failed:', error);
            throw error;
        }
    }

    async unlock(masterPassword) {
        try {
            // Load encrypted vault from storage
            const encryptedVault = await this.options.database.loadVault();
            if (!encryptedVault) {
                throw new Error('No vault found');
            }

            // Derive master key
            const salt = Buffer.from(encryptedVault.salt, 'hex');
            this.masterKey = await this.deriveMasterKey(masterPassword, salt);

            // Decrypt vault
            this.vault = await this.decryptVault(encryptedVault, this.masterKey);

            // Verify vault integrity
            if (!this.verifyVaultIntegrity()) {
                throw new Error('Vault integrity check failed');
            }

            // Start sync timer
            this.startSyncTimer();

            return true;
        } catch (error) {
            console.error('Unlock failed:', error);
            throw error;
        }
    }

    async deriveMasterKey(password, salt) {
        try {
            // Use Argon2id for key derivation
            const encoder = new TextEncoder();
            const passwordBuffer = encoder.encode(password);

            const key = await pbkdf2.pbkdf2Sync(
                passwordBuffer,
                salt,
                this.options.iterations,
                this.options.keyLength,
                'sha512'
            );

            return await subtle.importKey(
                'raw',
                key,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
        } catch (error) {
            console.error('Key derivation failed:', error);
            throw error;
        }
    }

    async addEntry(entry) {
        try {
            if (!this.masterKey) {
                throw new Error('Vault is locked');
            }

            // Validate entry
            this.validateEntry(entry);

            // Generate unique ID
            const id = crypto.randomUUID();

            // Encrypt sensitive fields
            const encryptedEntry = await this.encryptEntry(entry);

            // Add to vault
            this.vault.entries.set(id, {
                ...encryptedEntry,
                id,
                created: Date.now(),
                modified: Date.now()
            });

            // Mark for sync
            this.pendingChanges.add(id);

            // Check for breaches
            this.checkForBreaches(entry);

            return id;
        } catch (error) {
            console.error('Add entry failed:', error);
            throw error;
        }
    }

    async updateEntry(id, updates) {
        try {
            const entry = this.vault.entries.get(id);
            if (!entry) {
                throw new Error('Entry not found');
            }

            // Decrypt current entry
            const decryptedEntry = await this.decryptEntry(entry);

            // Apply updates
            const updatedEntry = {
                ...decryptedEntry,
                ...updates,
                modified: Date.now()
            };

            // Validate updated entry
            this.validateEntry(updatedEntry);

            // Encrypt updated entry
            const encryptedEntry = await this.encryptEntry(updatedEntry);

            // Update vault
            this.vault.entries.set(id, {
                ...entry,
                ...encryptedEntry,
                modified: Date.now()
            });

            // Mark for sync
            this.pendingChanges.add(id);

            // Check for breaches
            this.checkForBreaches(updatedEntry);

            return true;
        } catch (error) {
            console.error('Update entry failed:', error);
            throw error;
        }
    }

    async shareEntry(id, recipientPublicKey) {
        try {
            const entry = this.vault.entries.get(id);
            if (!entry) {
                throw new Error('Entry not found');
            }

            // Decrypt entry
            const decryptedEntry = await this.decryptEntry(entry);

            // Generate sharing key
            const sharingKey = await this.generateSharingKey();

            // Encrypt entry with sharing key
            const sharedEntry = await this.encryptEntryWithKey(
                decryptedEntry,
                sharingKey
            );

            // Encrypt sharing key with recipient's public key
            const encryptedSharingKey = await this.encryptSharingKey(
                sharingKey,
                recipientPublicKey
            );

            // Add to shared entries
            this.vault.shared.set(id, {
                entry: sharedEntry,
                recipients: new Map([[recipientPublicKey, encryptedSharingKey]]),
                modified: Date.now()
            });

            // Mark for sync
            this.pendingChanges.add(`shared:${id}`);

            return true;
        } catch (error) {
            console.error('Share entry failed:', error);
            throw error;
        }
    }

    async acceptSharedEntry(id, encryptedSharingKey) {
        try {
            // Decrypt sharing key with private key
            const sharingKey = await this.decryptSharingKey(encryptedSharingKey);

            // Get shared entry
            const sharedEntry = await this.options.database.getSharedEntry(id);
            if (!sharedEntry) {
                throw new Error('Shared entry not found');
            }

            // Decrypt entry with sharing key
            const decryptedEntry = await this.decryptEntryWithKey(
                sharedEntry.entry,
                sharingKey
            );

            // Add to vault
            this.vault.entries.set(id, {
                ...decryptedEntry,
                isShared: true,
                sharingKey
            });

            // Mark for sync
            this.pendingChanges.add(id);

            return true;
        } catch (error) {
            console.error('Accept shared entry failed:', error);
            throw error;
        }
    }

    async sync() {
        try {
            if (this.pendingChanges.size === 0) return;

            // Prepare changes
            const changes = Array.from(this.pendingChanges).map(id => {
                if (id.startsWith('shared:')) {
                    const entryId = id.split(':')[1];
                    return {
                        type: 'shared',
                        id: entryId,
                        data: this.vault.shared.get(entryId)
                    };
                } else {
                    return {
                        type: 'entry',
                        id,
                        data: this.vault.entries.get(id)
                    };
                }
            });

            // Send changes to server
            await this.options.database.syncChanges(changes);

            // Clear pending changes
            this.pendingChanges.clear();

            // Update last sync time
            this.vault.metadata.lastSync = Date.now();

        } catch (error) {
            console.error('Sync failed:', error);
            throw error;
        }
    }

    async checkForBreaches(entry) {
        try {
            // Hash password for breach check
            const passwordHash = crypto
                .createHash('sha1')
                .update(entry.password)
                .digest('hex')
                .toUpperCase();

            // Check breach database
            const breaches = await this.options.breachAPI.checkPassword(
                passwordHash.substring(0, 5)
            );

            if (breaches > 0) {
                // Notify user
                this.options.notificationService.send({
                    type: 'breach_alert',
                    message: `Password for ${entry.title} has been found in ${breaches} data breaches.`,
                    severity: 'high'
                });
            }
        } catch (error) {
            console.error('Breach check failed:', error);
        }
    }

    async encryptEntry(entry) {
        const iv = crypto.randomBytes(12);
        const encryptedFields = {};

        for (const [field, value] of Object.entries(entry)) {
            if (this.isSensitiveField(field)) {
                const encrypted = await this.encrypt(value, iv);
                encryptedFields[field] = {
                    iv: iv.toString('hex'),
                    data: encrypted
                };
            } else {
                encryptedFields[field] = value;
            }
        }

        return encryptedFields;
    }

    async decryptEntry(entry) {
        const decryptedFields = {};

        for (const [field, value] of Object.entries(entry)) {
            if (this.isSensitiveField(field)) {
                const iv = Buffer.from(value.iv, 'hex');
                decryptedFields[field] = await this.decrypt(value.data, iv);
            } else {
                decryptedFields[field] = value;
            }
        }

        return decryptedFields;
    }

    async encrypt(data, iv) {
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(data);

            const encrypted = await subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv
                },
                this.masterKey,
                dataBuffer
            );

            return Buffer.from(encrypted).toString('base64');
        } catch (error) {
            console.error('Encryption failed:', error);
            throw error;
        }
    }

    async decrypt(data, iv) {
        try {
            const dataBuffer = Buffer.from(data, 'base64');

            const decrypted = await subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv
                },
                this.masterKey,
                dataBuffer
            );

            return new TextDecoder().decode(decrypted);
        } catch (error) {
            console.error('Decryption failed:', error);
            throw error;
        }
    }

    validateEntry(entry) {
        // Required fields
        const requiredFields = ['title', 'username', 'password'];
        for (const field of requiredFields) {
            if (!entry[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        // Password strength
        if (!this.isStrongPassword(entry.password)) {
            throw new Error('Password does not meet strength requirements');
        }

        return true;
    }

    isStrongPassword(password) {
        const minLength = 12;
        const hasUppercase = /[A-Z]/.test(password);
        const hasLowercase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChars = /[!@#$%^&*]/.test(password);

        return (
            password.length >= minLength &&
            hasUppercase &&
            hasLowercase &&
            hasNumbers &&
            hasSpecialChars
        );
    }

    isSensitiveField(field) {
        return ['password', 'notes', 'securityQuestions'].includes(field);
    }

    startSyncTimer() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }

        this.syncTimer = setInterval(
            () => this.sync(),
            this.options.syncInterval
        );
    }

    verifyVaultIntegrity() {
        // Implement integrity checks
        // For example, verify HMAC of vault contents
        return true;
    }

    lock() {
        this.masterKey = null;
        this.vault = null;
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }
    }
}

// Browser Extension Interface
class PasswordManagerExtension {
    constructor(passwordManager) {
        this.passwordManager = passwordManager;
        this.activeTab = null;
    }

    async initialize() {
        // Set up message listeners
        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                this.handleMessage(request, sender, sendResponse);
            }
        );

        // Watch for tab changes
        chrome.tabs.onActivated.addListener(
            (activeInfo) => this.handleTabChange(activeInfo)
        );
    }

    async handleMessage(request, sender, sendResponse) {
        switch (request.type) {
            case 'getCredentials':
                const credentials = await this.getCredentialsForUrl(request.url);
                sendResponse({ credentials });
                break;
            case 'saveCredentials':
                await this.saveCredentials(request.credentials);
                sendResponse({ success: true });
                break;
            case 'fillCredentials':
                await this.fillCredentials(request.credentials);
                sendResponse({ success: true });
                break;
        }
    }

    async getCredentialsForUrl(url) {
        const domain = new URL(url).hostname;
        const entries = Array.from(this.passwordManager.vault.entries.values());
        
        return entries.filter(entry => 
            entry.domain === domain
        );
    }

    async fillCredentials(credentials) {
        chrome.tabs.sendMessage(this.activeTab.id, {
            type: 'fillCredentials',
            credentials
        });
    }
}

// Usage example:
const passwordManager = new SecurePasswordManager({
    database: cloudDatabase,
    breachAPI: haveIBeenPwnedAPI,
    notificationService: notificationSystem
});

// Initialize with master password
await passwordManager.initialize('master-password');

// Add new entry
const entryId = await passwordManager.addEntry({
    title: 'Example Account',
    username: 'user@example.com',
    password: 'SecureP@ssw0rd123',
    url: 'https://example.com',
    notes: 'Some secure notes'
});

// Share entry with another user
await passwordManager.shareEntry(entryId, recipientPublicKey);

// Initialize browser extension
const extension = new PasswordManagerExtension(passwordManager);
await extension.initialize();