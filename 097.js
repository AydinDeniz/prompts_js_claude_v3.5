const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const saml = require('saml2-js');
const OpenIDClient = require('openid-client');

class SSOService {
    constructor(options = {}) {
        this.options = {
            issuer: options.issuer || 'https://sso.example.com',
            sessionDuration: options.sessionDuration || 3600, // 1 hour
            sessionInactivityTimeout: options.sessionInactivityTimeout || 900, // 15 minutes
            allowedDomains: options.allowedDomains || [],
            providers: options.providers || new Map(),
            jwtSecret: options.jwtSecret,
            database: options.database,
            cache: options.cache,
            logger: options.logger
        };

        this.sessions = new Map();
        this.providerClients = new Map();
        this.init();
    }

    async init() {
        await this.initializeProviders();
        this.startSessionCleanup();
    }

    async initializeProviders() {
        for (const [providerId, config] of this.options.providers) {
            try {
                switch (config.type) {
                    case 'saml':
                        await this.initializeSAMLProvider(providerId, config);
                        break;
                    case 'oidc':
                        await this.initializeOIDCProvider(providerId, config);
                        break;
                    case 'oauth2':
                        await this.initializeOAuth2Provider(providerId, config);
                        break;
                    default:
                        throw new Error(`Unsupported provider type: ${config.type}`);
                }
            } catch (error) {
                this.handleError(`Provider initialization failed: ${providerId}`, error);
            }
        }
    }

    async initializeSAMLProvider(providerId, config) {
        const sp = new saml.ServiceProvider({
            entity_id: `${this.options.issuer}/saml/${providerId}`,
            private_key: config.privateKey,
            certificate: config.certificate,
            assert_endpoint: `${this.options.issuer}/saml/${providerId}/assert`,
            force_authn: true,
            auth_context: { comparison: 'exact', class_refs: ['urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport'] }
        });

        const idp = new saml.IdentityProvider({
            sso_login_url: config.loginUrl,
            sso_logout_url: config.logoutUrl,
            certificates: config.idpCertificates
        });

        this.providerClients.set(providerId, { sp, idp, config });
    }

    async initializeOIDCProvider(providerId, config) {
        const issuer = await OpenIDClient.Issuer.discover(config.discoveryUrl);
        const client = new issuer.Client({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uris: [`${this.options.issuer}/oidc/${providerId}/callback`],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic'
        });

        this.providerClients.set(providerId, { client, config });
    }

    async handleAuthRequest(providerId, req) {
        try {
            const provider = this.providerClients.get(providerId);
            if (!provider) {
                throw new Error('Provider not found');
            }

            const state = this.generateState();
            const nonce = this.generateNonce();

            // Store state and nonce
            await this.storeAuthState(state, {
                nonce,
                providerId,
                redirectUrl: req.query.redirect_uri
            });

            switch (provider.config.type) {
                case 'saml':
                    return this.createSAMLRequest(provider, state);
                case 'oidc':
                    return this.createOIDCRequest(provider, state, nonce);
                case 'oauth2':
                    return this.createOAuth2Request(provider, state);
            }
        } catch (error) {
            this.handleError('Auth request failed', error);
            throw error;
        }
    }

    async handleAuthResponse(providerId, req) {
        try {
            const provider = this.providerClients.get(providerId);
            if (!provider) {
                throw new Error('Provider not found');
            }

            // Verify state
            const state = await this.verifyAuthState(req.query.state);
            if (!state) {
                throw new Error('Invalid state');
            }

            let userInfo;
            switch (provider.config.type) {
                case 'saml':
                    userInfo = await this.handleSAMLResponse(provider, req);
                    break;
                case 'oidc':
                    userInfo = await this.handleOIDCResponse(provider, req, state.nonce);
                    break;
                case 'oauth2':
                    userInfo = await this.handleOAuth2Response(provider, req);
                    break;
            }

            // Map attributes
            const mappedUser = this.mapUserAttributes(userInfo, provider.config.attributeMapping);

            // Provision or update user
            const user = await this.provisionUser(mappedUser, providerId);

            // Create session
            const session = await this.createSession(user);

            // Create cross-domain tokens
            const tokens = await this.createCrossDomainTokens(session);

            return {
                session,
                tokens,
                redirectUrl: state.redirectUrl
            };

        } catch (error) {
            this.handleError('Auth response failed', error);
            throw error;
        }
    }

    async handleSAMLResponse(provider, req) {
        return new Promise((resolve, reject) => {
            provider.sp.post_assert(provider.idp, {
                request_body: req.body,
                allow_unencrypted_assertion: false
            }, (err, samlResponse) => {
                if (err) reject(err);
                else resolve(samlResponse.user);
            });
        });
    }

    async handleOIDCResponse(provider, req, nonce) {
        const tokenSet = await provider.client.callback(
            `${this.options.issuer}/oidc/${provider.config.id}/callback`,
            { code: req.query.code, state: req.query.state },
            { nonce }
        );

        return await provider.client.userinfo(tokenSet.access_token);
    }

    mapUserAttributes(userInfo, mapping) {
        const mapped = {};
        for (const [target, source] of Object.entries(mapping)) {
            if (typeof source === 'string') {
                mapped[target] = userInfo[source];
            } else if (typeof source === 'function') {
                mapped[target] = source(userInfo);
            }
        }
        return mapped;
    }

    async provisionUser(userData, providerId) {
        // Check if user exists
        let user = await this.options.database.findUser({
            providerId,
            providerUserId: userData.id
        });

        if (user) {
            // Update user data
            user = await this.options.database.updateUser(user.id, {
                ...userData,
                lastLogin: new Date()
            });
        } else {
            // Create new user
            user = await this.options.database.createUser({
                ...userData,
                providerId,
                providerUserId: userData.id,
                created: new Date(),
                lastLogin: new Date()
            });

            // Trigger just-in-time provisioning hooks
            await this.handleJITProvisioning(user);
        }

        return user;
    }

    async handleJITProvisioning(user) {
        const provider = this.providerClients.get(user.providerId);
        if (!provider.config.jitProvisioning) return;

        for (const hook of provider.config.jitProvisioning) {
            try {
                await hook(user);
            } catch (error) {
                this.handleError('JIT provisioning failed', error);
            }
        }
    }

    async createSession(user) {
        const sessionId = crypto.randomUUID();
        const session = {
            id: sessionId,
            userId: user.id,
            created: Date.now(),
            lastAccessed: Date.now(),
            expiresAt: Date.now() + (this.options.sessionDuration * 1000)
        };

        // Store session
        this.sessions.set(sessionId, session);
        await this.options.cache.set(`session:${sessionId}`, session);

        return session;
    }

    async createCrossDomainTokens(session) {
        const tokens = {};

        for (const domain of this.options.allowedDomains) {
            tokens[domain] = await this.createDomainToken(session, domain);
        }

        return tokens;
    }

    async createDomainToken(session, domain) {
        const token = jwt.sign({
            sid: session.id,
            uid: session.userId,
            domain
        }, this.options.jwtSecret, {
            expiresIn: this.options.sessionDuration,
            audience: domain,
            issuer: this.options.issuer
        });

        return token;
    }

    async validateSession(sessionId, domain) {
        // Check cache first
        let session = await this.options.cache.get(`session:${sessionId}`);
        if (!session) {
            session = this.sessions.get(sessionId);
            if (session) {
                await this.options.cache.set(`session:${sessionId}`, session);
            }
        }

        if (!session) {
            return null;
        }

        // Check expiration
        if (Date.now() > session.expiresAt) {
            await this.invalidateSession(sessionId);
            return null;
        }

        // Check inactivity
        if (Date.now() - session.lastAccessed > 
            this.options.sessionInactivityTimeout * 1000) {
            await this.invalidateSession(sessionId);
            return null;
        }

        // Update last accessed
        session.lastAccessed = Date.now();
        await this.options.cache.set(`session:${sessionId}`, session);

        return session;
    }