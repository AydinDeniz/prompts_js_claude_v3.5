const { 
    base64URLToBuffer,
    bufferToBase64URL,
    generateRandomBuffer 
} = require('./utils/encoding');

class WebAuthnManager {
    constructor(options = {}) {
        this.options = {
            rpName: options.rpName || 'Authentication System',
            rpID: options.rpID || window.location.hostname,
            origin: options.origin || window.location.origin,
            timeout: options.timeout || 60000,
            userVerification: options.userVerification || 'preferred',
            attestation: options.attestation || 'direct',
            authenticatorAttachment: options.authenticatorAttachment || null,
            recoveryMethods: options.recoveryMethods || ['email', 'backup-codes'],
            database: options.database,
            logger: options.logger
        };

        this.challengeCache = new Map();
    }

    async registerUser(user) {
        try {
            // Generate challenge
            const challenge = generateRandomBuffer(32);
            
            // Store challenge
            await this.storeChallenge(user.id, challenge);

            // Create credential creation options
            const publicKeyCredentialCreationOptions = {
                challenge,
                rp: {
                    name: this.options.rpName,
                    id: this.options.rpID
                },
                user: {
                    id: base64URLToBuffer(user.id),
                    name: user.email,
                    displayName: user.name
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 }, // ES256
                    { type: 'public-key', alg: -257 } // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: this.options.authenticatorAttachment,
                    userVerification: this.options.userVerification,
                    requireResidentKey: false
                },
                timeout: this.options.timeout,
                attestation: this.options.attestation
            };

            // Create credentials
            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            });

            // Verify attestation
            const verifiedAttestion = await this.verifyAttestation(credential);

            // Store credential
            await this.storeCredential(user.id, verifiedAttestion);

            // Generate recovery methods
            await this.setupRecoveryMethods(user);

            return verifiedAttestion;

        } catch (error) {
            this.handleError('Registration failed', error);
            throw error;
        }
    }

    async authenticate(userId) {
        try {
            // Get user's credentials
            const userCredentials = await this.getUserCredentials(userId);
            if (!userCredentials.length) {
                throw new Error('No credentials found for user');
            }

            // Generate challenge
            const challenge = generateRandomBuffer(32);
            await this.storeChallenge(userId, challenge);

            // Create assertion options
            const publicKeyCredentialRequestOptions = {
                challenge,
                rpId: this.options.rpID,
                allowCredentials: userCredentials.map(cred => ({
                    type: 'public-key',
                    id: base64URLToBuffer(cred.credentialId),
                    transports: cred.transports || ['internal']
                })),
                userVerification: this.options.userVerification,
                timeout: this.options.timeout
            };

            // Get assertion
            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions
            });

            // Verify assertion
            const verifiedAssertion = await this.verifyAssertion(assertion, userId);

            // Update credential metadata
            await this.updateCredentialMetadata(userId, assertion.id);

            return verifiedAssertion;

        } catch (error) {
            this.handleError('Authentication failed', error);
            throw error;
        }
    }

    async verifyAttestation(credential) {
        const attestationObject = credential.response.attestationObject;
        const clientDataJSON = credential.response.clientDataJSON;
        const rawId = credential.rawId;

        // Parse attestation object
        const attestation = CBOR.decode(attestationObject);

        // Verify attestation format
        if (!this.isSupportedFormat(attestation.fmt)) {
            throw new Error('Unsupported attestation format');
        }

        // Parse client data
        const clientData = JSON.parse(
            new TextDecoder('utf-8').decode(clientDataJSON)
        );

        // Verify challenge
        const expectedChallenge = await this.getStoredChallenge(clientData.challenge);
        if (!expectedChallenge) {
            throw new Error('Invalid challenge');
        }

        // Verify origin
        if (clientData.origin !== this.options.origin) {
            throw new Error('Invalid origin');
        }

        // Verify attestation statement
        await this.verifyAttestationStatement(attestation);

        return {
            credentialId: bufferToBase64URL(rawId),
            publicKey: attestation.authData.credentialPublicKey,
            signCount: attestation.authData.signCount,
            attestationFormat: attestation.fmt,
            attestationType: this.getAttestationType(attestation),
            userVerified: attestation.authData.flags.userVerified,
            createdAt: new Date(),
            lastUsed: new Date()
        };
    }

    async verifyAssertion(assertion, userId) {
        const authenticatorData = assertion.response.authenticatorData;
        const clientDataJSON = assertion.response.clientDataJSON;
        const signature = assertion.response.signature;
        const userHandle = assertion.response.userHandle;

        // Parse client data
        const clientData = JSON.parse(
            new TextDecoder('utf-8').decode(clientDataJSON)
        );

        // Verify challenge
        const expectedChallenge = await this.getStoredChallenge(clientData.challenge);
        if (!expectedChallenge) {
            throw new Error('Invalid challenge');
        }

        // Verify origin
        if (clientData.origin !== this.options.origin) {
            throw new Error('Invalid origin');
        }

        // Verify user handle
        if (userHandle && bufferToBase64URL(userHandle) !== userId) {
            throw new Error('Invalid user handle');
        }

        // Get stored credential
        const credential = await this.getCredential(
            userId,
            bufferToBase64URL(assertion.rawId)
        );

        if (!credential) {
            throw new Error('Credential not found');
        }

        // Verify signature
        const isValid = await this.verifySignature(
            signature,
            authenticatorData,
            clientDataJSON,
            credential.publicKey
        );

        if (!isValid) {
            throw new Error('Invalid signature');
        }

        // Verify sign count
        const newSignCount = authenticatorData.signCount;
        if (newSignCount <= credential.signCount) {
            this.handlePotentialCloning(credential);
        }

        return {
            verified: true,
            credentialId: credential.credentialId,
            userVerified: authenticatorData.flags.userVerified,
            signCount: newSignCount
        };
    }

    async setupRecoveryMethods(user) {
        const recoveryMethods = [];

        for (const method of this.options.recoveryMethods) {
            switch (method) {
                case 'email':
                    recoveryMethods.push(
                        await this.setupEmailRecovery(user)
                    );
                    break;
                case 'backup-codes':
                    recoveryMethods.push(
                        await this.generateBackupCodes(user)
                    );
                    break;
            }
        }

        await this.storeRecoveryMethods(user.id, recoveryMethods);
        return recoveryMethods;
    }

    async setupEmailRecovery(user) {
        const secret = generateRandomBuffer(32);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30); // 30 days validity

        return {
            type: 'email',
            email: user.email,
            secret: bufferToBase64URL(secret),
            expiresAt
        };
    }

    async generateBackupCodes(user) {
        const codes = [];
        for (let i = 0; i < 10; i++) {
            codes.push(generateRandomBuffer(6).toString('hex'));
        }

        return {
            type: 'backup-codes',
            codes: codes.map(code => ({
                code,
                used: false
            }))
        };
    }

    async recoverAccess(userId, method, data) {
        try {
            const recoveryMethods = await this.getRecoveryMethods(userId);
            const recoveryMethod = recoveryMethods.find(m => m.type === method);

            if (!recoveryMethod) {
                throw new Error('Recovery method not found');
            }

            switch (method) {
                case 'email':
                    return await this.handleEmailRecovery(userId, recoveryMethod, data);
                case 'backup-codes':
                    return await this.handleBackupCodeRecovery(userId, recoveryMethod, data);
                default:
                    throw new Error('Unsupported recovery method');
            }
        } catch (error) {
            this.handleError('Recovery failed', error);
            throw error;
        }
    }