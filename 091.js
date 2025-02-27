const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');

class OAuth2Server {
    constructor(options = {}) {
        this.options = {
            issuer: options.issuer || 'oauth2-server',
            accessTokenExpiry: options.accessTokenExpiry || '1h',
            refreshTokenExpiry: options.refreshTokenExpiry || '30d',
            keyRotationInterval: options.keyRotationInterval || 24 * 60 * 60 * 1000, // 24 hours
            rateLimit: options.rateLimit || {
                window: 15 * 60 * 1000, // 15 minutes
                maxAttempts: 100
            },
            database: options.database,
            cache: options.cache,
            logger: options.logger
        };

        this.signingKeys = new Map();
        this.rateLimiters = new Map();
        this.init();
    }

    async init() {
        await this.initializeKeys();
        this.startKeyRotation();
        await this.loadPersistedData();
    }

    async initializeKeys() {
        // Generate initial key pair
        const keyPair = await this.generateKeyPair();
        const keyId = this.generateKeyId();
        
        this.signingKeys.set(keyId, {
            private: keyPair.privateKey,
            public: keyPair.publicKey,
            createdAt: Date.now()
        });
    }

    async generateKeyPair() {
        return promisify(crypto.generateKeyPair)('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });
    }

    generateKeyId() {
        return crypto.randomBytes(16).toString('hex');
    }

    startKeyRotation() {
        setInterval(async () => {
            try {
                await this.rotateKeys();
            } catch (error) {
                this.options.logger.error('Key rotation failed:', error);
            }
        }, this.options.keyRotationInterval);
    }

    async rotateKeys() {
        const newKeyPair = await this.generateKeyPair();
        const newKeyId = this.generateKeyId();

        // Store new key pair
        this.signingKeys.set(newKeyId, {
            private: newKeyPair.privateKey,
            public: newKeyPair.publicKey,
            createdAt: Date.now()
        });

        // Remove old keys (keep last 2 for validation)
        const keyIds = Array.from(this.signingKeys.keys());
        if (keyIds.length > 2) {
            const oldestKeyId = keyIds[0];
            this.signingKeys.delete(oldestKeyId);
        }

        // Persist keys
        await this.persistKeys();

        this.options.logger.info('Key rotation completed');
    }

    async persistKeys() {
        const keysData = Array.from(this.signingKeys.entries()).map(([id, key]) => ({
            id,
            public: key.public,
            private: key.private,
            createdAt: key.createdAt
        }));

        await this.options.database.storeKeys(keysData);
    }

    async loadPersistedData() {
        // Load persisted keys
        const keys = await this.options.database.getKeys();
        keys.forEach(key => {
            this.signingKeys.set(key.id, {
                private: key.private,
                public: key.public,
                createdAt: key.createdAt
            });
        });
    }

    async handleAuthorizationRequest(req) {
        try {
            // Rate limit check
            await this.checkRateLimit(req);

            const grantType = req.body.grant_type;
            let token;

            switch (grantType) {
                case 'authorization_code':
                    token = await this.handleAuthorizationCode(req);
                    break;
                case 'client_credentials':
                    token = await this.handleClientCredentials(req);
                    break;
                case 'refresh_token':
                    token = await this.handleRefreshToken(req);
                    break;
                default:
                    throw new Error('Unsupported grant type');
            }

            await this.auditLog('token_issued', {
                grantType,
                clientId: req.body.client_id,
                userId: token.userId,
                ip: req.ip
            });

            return token;

        } catch (error) {
            await this.auditLog('authentication_failed', {
                error: error.message,
                clientId: req.body.client_id,
                ip: req.ip
            });
            throw error;
        }
    }

    async handleAuthorizationCode(req) {
        const { code, code_verifier, client_id, redirect_uri } = req.body;

        // Validate authorization code
        const storedCode = await this.options.cache.get(`auth_code:${code}`);
        if (!storedCode) {
            throw new Error('Invalid authorization code');
        }

        // Verify PKCE
        const codeChallenge = crypto
            .createHash('sha256')
            .update(code_verifier)
            .digest('base64url');

        if (codeChallenge !== storedCode.code_challenge) {
            throw new Error('Invalid code verifier');
        }

        // Verify client and redirect URI
        if (client_id !== storedCode.client_id || 
            redirect_uri !== storedCode.redirect_uri) {
            throw new Error('Client verification failed');
        }

        // Delete used code
        await this.options.cache.del(`auth_code:${code}`);

        // Generate tokens
        return this.generateTokens(storedCode.user, storedCode.scope);
    }

    async handleClientCredentials(req) {
        const { client_id, client_secret, scope } = req.body;

        // Validate client credentials
        const client = await this.validateClientCredentials(client_id, client_secret);
        if (!client) {
            throw new Error('Invalid client credentials');
        }

        // Validate requested scope
        const validScope = this.validateScope(scope, client.allowedScopes);
        if (!validScope) {
            throw new Error('Invalid scope requested');
        }

        // Generate tokens
        return this.generateTokens(null, scope, client);
    }

    async handleRefreshToken(req) {
        const { refresh_token, client_id, client_secret } = req.body;

        // Validate refresh token
        const storedToken = await this.verifyToken(refresh_token, 'refresh');
        if (!storedToken) {
            throw new Error('Invalid refresh token');
        }

        // Validate client
        const client = await this.validateClientCredentials(client_id, client_secret);
        if (!client || client.id !== storedToken.clientId) {
            throw new Error('Invalid client credentials');
        }

        // Invalidate used refresh token
        await this.invalidateToken(refresh_token);

        // Generate new tokens
        return this.generateTokens(
            storedToken.user,
            storedToken.scope,
            client,
            true // is refresh
        );
    }

    async generateTokens(user, scope, client, isRefresh = false) {
        const currentKey = this.getCurrentSigningKey();

        // Generate access token
        const accessToken = await this.signToken({
            type: 'access',
            user: user?.id,
            client: client?.id,
            scope,
            roles: user?.roles || [],
            jti: crypto.randomBytes(16).toString('hex')
        }, currentKey);

        // Generate refresh token if needed
        let refreshToken = null;
        if (!isRefresh) {
            refreshToken = await this.signToken({
                type: 'refresh',
                user: user?.id,
                client: client?.id,
                scope,
                jti: crypto.randomBytes(16).toString('hex')
            }, currentKey);
        }

        // Store tokens
        await this.storeToken(accessToken);
        if (refreshToken) {
            await this.storeToken(refreshToken);
        }

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'Bearer',
            expires_in: this.getExpirySeconds(this.options.accessTokenExpiry)
        };
    }

    async signToken(payload, key) {
        return jwt.sign(
            {
                ...payload,
                iss: this.options.issuer,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 
                     this.getExpirySeconds(
                         payload.type === 'refresh' ? 
                         this.options.refreshTokenExpiry : 
                         this.options.accessTokenExpiry
                     )
            },
            key.private,
            { algorithm: 'RS256', keyid: key.id }
        );
    }

    async verifyToken(token, type = 'access') {
        try {
            // Get token header
            const decoded = jwt.decode(token, { complete: true });
            if (!decoded) {
                throw new Error('Invalid token format');
            }

            // Get signing key
            const key = this.signingKeys.get(decoded.header.kid);
            if (!key) {
                throw new Error('Invalid signing key');
            }

            // Verify token
            const payload = jwt.verify(token, key.public, {
                algorithms: ['RS256'],
                issuer: this.options.issuer
            });

            // Verify token type
            if (payload.type !== type) {
                throw new Error('Invalid token type');
            }

            // Check if token is blacklisted
            const isBlacklisted = await this.options.cache.get(`blacklist:${payload.jti}`);
            if (isBlacklisted) {
                throw new Error('Token has been revoked');
            }

            return payload;

        } catch (error) {
            this.options.logger.error('Token verification failed:', error);
            return null;
        }
    }

    async storeToken(token) {
        const decoded = jwt.decode(token);
        await this.options.cache.set(
            `token:${decoded.jti}`,
            token,
            this.getExpirySeconds(
                decoded.type === 'refresh' ? 
                this.options.refreshTokenExpiry : 
                this.options.accessTokenExpiry
            )
        );
    }

    async invalidateToken(token) {
        const decoded = jwt.decode(token);
        if (decoded) {
            // Add to blacklist
            await this.options.cache.set(
                `blacklist:${decoded.jti}`,
                true,
                this.getExpirySeconds(
                    decoded.type === 'refresh' ? 
                    this.options.refreshTokenExpiry : 
                    this.options.accessTokenExpiry
                )
            );
        }
    }

    async checkRateLimit(req) {
        const key = `ratelimit:${req.ip}`;
        const current = await this.options.cache.incr(key);

        if (current === 1) {
            await this.options.cache.expire(
                key,
                Math.floor(this.options.rateLimit.window / 1000)
            );
        }

        if (current > this.options.rateLimit.maxAttempts) {
            throw new Error('Rate limit exceeded');
        }
    }

    async auditLog(event, data) {
        await this.options.logger.audit(event, {
            ...data,
            timestamp: new Date(),
            server: this.options.issuer
        });
    }

    getCurrentSigningKey() {
        const keys = Array.from(this.signingKeys.entries());
        return {
            id: keys[keys.length - 1][0],
            ...keys[keys.length - 1][1]
        };
    }

    getExpirySeconds(duration) {
        const units = {
            s: 1,
            m: 60,
            h: 3600,
            d: 86400
        };

        const match = duration.match(/^(\d+)([smhd])$/);
        if (!match) return 3600; // default 1 hour

        const [, value, unit] = match;
        return parseInt(value) * units[unit];
    }

    validateScope(requestedScope, allowedScopes) {
        const requested = new Set(requestedScope.split(' '));
        const allowed = new Set(allowedScopes);

        for (const scope of requested) {
            if (!allowed.has(scope)) {
                return false;
            }
        }

        return true;
    }

    async validateClientCredentials(clientId, clientSecret) {
        const client = await this.options.database.getClient(clientId);
        if (!client) return null;

        const hash = crypto
            .createHash('sha256')
            .update(clientSecret)
            .digest('hex');

        return hash === client.secretHash ? client : null;
    }
}

// Usage example:
const oauth2Server = new OAuth2Server({
    issuer: 'https://auth.example.com',
    database: dbConnection,
    cache: redisClient,
    logger: loggingService,
    accessTokenExpiry: '1h',
    refreshTokenExpiry: '30d',
    keyRotationInterval: 24 * 60 * 60 * 1000,
    rateLimit: {
        window: 15 * 60 * 1000,
        maxAttempts: 100
    }
});

// Express middleware
app.post('/oauth/token', async (req, res) => {
    try {
        const token = await oauth2Server.handleAuthorizationRequest(req);
        res.json(token);
    } catch (error) {
        res.status(400).json({
            error: 'invalid_request',
            error_description: error.message
        });
    }
});