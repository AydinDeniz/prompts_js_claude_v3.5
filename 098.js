const crypto = require('crypto');
const { FPE } = require('format-preserving-encryption');
const stripe = require('stripe');
const paypal = require('@paypal/checkout-server-sdk');

class SecurePaymentProcessor {
    constructor(options = {}) {
        this.options = {
            providers: options.providers || new Map(),
            encryptionKey: options.encryptionKey,
            tokenizationKey: options.tokenizationKey,
            database: options.database,
            cache: options.cache,
            logger: options.logger,
            retryConfig: options.retryConfig || {
                maxAttempts: 3,
                backoffMultiplier: 2,
                initialDelay: 2000
            },
            fraudConfig: options.fraudConfig || {
                maxAttempts: 3,
                timeWindow: 3600, // 1 hour
                velocityThreshold: 10
            }
        };

        this.fpe = new FPE(this.options.encryptionKey);
        this.providers = new Map();
        this.init();
    }

    async init() {
        await this.initializeProviders();
        this.startMaintenanceTask();
    }

    async initializeProviders() {
        for (const [providerId, config] of this.options.providers) {
            try {
                switch (config.type) {
                    case 'stripe':
                        await this.initializeStripe(providerId, config);
                        break;
                    case 'paypal':
                        await this.initializePayPal(providerId, config);
                        break;
                    default:
                        throw new Error(`Unsupported provider: ${config.type}`);
                }
            } catch (error) {
                this.handleError(`Provider initialization failed: ${providerId}`, error);
            }
        }
    }

    async initializeStripe(providerId, config) {
        const stripeClient = new stripe(config.secretKey, {
            apiVersion: '2023-10-16'
        });

        this.providers.set(providerId, {
            client: stripeClient,
            config,
            type: 'stripe'
        });
    }

    async initializePayPal(providerId, config) {
        const environment = config.sandbox ?
            new paypal.core.SandboxEnvironment(
                config.clientId,
                config.clientSecret
            ) :
            new paypal.core.LiveEnvironment(
                config.clientId,
                config.clientSecret
            );

        const paypalClient = new paypal.core.PayPalHttpClient(environment);

        this.providers.set(providerId, {
            client: paypalClient,
            config,
            type: 'paypal'
        });
    }

    async tokenizeCard(cardData) {
        try {
            // Validate card data
            this.validateCardData(cardData);

            // Generate token
            const token = this.generateToken();

            // Encrypt sensitive data
            const encryptedData = this.encryptCardData(cardData);

            // Store tokenized card
            await this.storeCardToken(token, encryptedData);

            return {
                token,
                last4: cardData.number.slice(-4),
                expiryMonth: cardData.expiryMonth,
                expiryYear: cardData.expiryYear,
                brand: this.detectCardBrand(cardData.number)
            };

        } catch (error) {
            this.handleError('Card tokenization failed', error);
            throw error;
        }
    }

    async processPayment(paymentData) {
        try {
            // Validate payment data
            this.validatePaymentData(paymentData);

            // Check fraud indicators
            await this.checkFraud(paymentData);

            // Get provider
            const provider = this.providers.get(paymentData.providerId);
            if (!provider) {
                throw new Error('Invalid payment provider');
            }

            // Process payment with retry logic
            const result = await this.retryOperation(
                () => this.executePayment(provider, paymentData)
            );

            // Store transaction
            await this.storeTransaction(result);

            // Handle recurring billing if needed
            if (paymentData.recurring) {
                await this.setupRecurringBilling(provider, paymentData, result);
            }

            return result;

        } catch (error) {
            this.handleError('Payment processing failed', error);
            throw error;
        }
    }

    async executePayment(provider, paymentData) {
        switch (provider.type) {
            case 'stripe':
                return this.processStripePayment(provider, paymentData);
            case 'paypal':
                return this.processPayPalPayment(provider, paymentData);
            default:
                throw new Error(`Unsupported provider type: ${provider.type}`);
        }
    }

    async processStripePayment(provider, paymentData) {
        // Get card token
        const cardToken = await this.getCardToken(paymentData.cardToken);

        // Create payment intent
        const paymentIntent = await provider.client.paymentIntents.create({
            amount: Math.round(paymentData.amount * 100), // Convert to cents
            currency: paymentData.currency,
            payment_method_data: {
                type: 'card',
                card: {
                    number: this.decryptCardData(cardToken.number),
                    exp_month: cardToken.expiryMonth,
                    exp_year: cardToken.expiryYear,
                    cvc: this.decryptCardData(cardToken.cvv)
                }
            },
            confirm: true,
            capture_method: paymentData.capture ? 'automatic' : 'manual'
        });

        return {
            transactionId: paymentIntent.id,
            status: this.mapStripeStatus(paymentIntent.status),
            amount: paymentData.amount,
            currency: paymentData.currency,
            timestamp: new Date(),
            provider: 'stripe'
        };
    }

    async processPayPalPayment(provider, paymentData) {
        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer('return=representation');
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: paymentData.currency,
                    value: paymentData.amount.toString()
                }
            }]
        });

        const order = await provider.client.execute(request);

        return {
            transactionId: order.result.id,
            status: this.mapPayPalStatus(order.result.status),
            amount: paymentData.amount,
            currency: paymentData.currency,
            timestamp: new Date(),
            provider: 'paypal'
        };
    }

    async setupRecurringBilling(provider, paymentData, initialTransaction) {
        const subscription = {
            customerId: paymentData.customerId,
            planId: paymentData.planId,
            cardToken: paymentData.cardToken,
            interval: paymentData.recurring.interval,
            intervalCount: paymentData.recurring.intervalCount,
            startDate: new Date(),
            nextBillingDate: this.calculateNextBillingDate(paymentData.recurring),
            status: 'active',
            initialTransactionId: initialTransaction.transactionId
        };

        await this.storeSubscription(subscription);
    }

    async processRecurringPayment(subscription) {
        try {
            const paymentData = {
                providerId: subscription.providerId,
                cardToken: subscription.cardToken,
                amount: subscription.amount,
                currency: subscription.currency,
                customerId: subscription.customerId,
                capture: true
            };

            const result = await this.processPayment(paymentData);

            // Update subscription
            subscription.lastBillingDate = new Date();
            subscription.nextBillingDate = this.calculateNextBillingDate(subscription);
            subscription.lastTransactionId = result.transactionId;

            await this.updateSubscription(subscription);

            return result;

        } catch (error) {
            this.handleRecurringPaymentFailure(subscription, error);
            throw error;
        }
    }

    async checkFraud(paymentData) {
        // Check velocity
        const velocity = await this.checkVelocity(paymentData);
        if (velocity.exceeded) {
            throw new Error('Velocity check failed');
        }

        // Check card verification
        if (paymentData.cardToken) {
            const verification = await this.verifyCard(paymentData.cardToken);
            if (!verification.valid) {
                throw new Error('Card verification failed');
            }
        }

        // Check amount limits
        if (!this.checkAmountLimits(paymentData)) {
            throw new Error('Amount limit exceeded');
        }

        // Check high-risk indicators
        const riskScore = await this.calculateRiskScore(paymentData);
        if (riskScore > 80) {
            throw new Error('High risk transaction detected');
        }
    }

    async checkVelocity(paymentData) {
        const key = `velocity:${paymentData.customerId}`;
        const now = Date.now();
        const windowStart = now - (this.options.fraudConfig.timeWindow * 1000);

        // Get recent attempts
        const attempts = await this.options.cache.zrangebyscore(
            key,
            windowStart,
            now
        );

        // Check threshold
        if (attempts.length >= this.options.fraudConfig.velocityThreshold) {
            return { exceeded: true, count: attempts.length };
        }

        // Record attempt
        await this.options.cache.zadd(key, now, crypto.randomUUID());
        await this.options.cache.expire(
            key,
            this.options.fraudConfig.timeWindow
        );

        return { exceeded: false, count: attempts.length + 1 };
    }

    async calculateRiskScore(paymentData) {
        let score = 0;

        // Check transaction amount
        if (paymentData.amount > 1000) {
            score += 20;
        }

        // Check customer history
        const customerHistory = await this.getCustomerHistory(paymentData.customerId);
        if (!customerHistory.hasSuccessfulPayments) {
            score += 30;
        }

        // Check IP location
        if (paymentData.ipAddress) {
            const ipRisk = await this.checkIPRisk(paymentData.ipAddress);
            score += ipRisk.score;
        }

        // Check card country match
        if (paymentData.cardToken) {
            const cardInfo = await this.getCardToken(paymentData.cardToken);
            if (cardInfo.country !== paymentData.billingCountry) {
                score += 25;
            }
        }

        return score;
    }

    encryptCardData(cardData) {
        return {
            number: this.fpe.encrypt(cardData.number),
            cvv: this.encryptCVV(cardData.cvv),
            expiryMonth: cardData.expiryMonth,
            expiryYear: cardData.expiryYear
        };
    }

    encryptCVV(cvv) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
            'aes-256-gcm',
            this.options.encryptionKey,
            iv
        );

        const encrypted = Buffer.concat([
            cipher.update(cvv, 'utf8'),
            cipher.final()
        ]);

        const authTag = cipher.getAuthTag();

        return Buffer.concat([iv, authTag, encrypted]).toString('base64');
    }

    decryptCardData(encryptedData) {
        return this.fpe.decrypt(encryptedData);
    }

    decryptCVV(encryptedCvv) {
        const data = Buffer.from(encryptedCvv, 'base64');
        const iv = data.slice(0, 16);
        const authTag = data.slice(16, 32);
        const encrypted = data.slice(32);

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            this.options.encryptionKey,
            iv
        );

        decipher.setAuthTag(authTag);

        return Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]).toString('utf8');
    }

    generateToken() {
        return crypto
            .createHmac('sha256', this.options.tokenizationKey)
            .update(crypto.randomBytes(32))
            .digest('hex');
    }

    async retryOperation(operation) {
        let lastError;
        let delay = this.options.retryConfig.initialDelay;

        for (let attempt = 1; attempt <= this.options.retryConfig.maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                if (!this.isRetryableError(error) || 
                    attempt === this.options.retryConfig.maxAttempts) {
                    throw error;
                }

                await this.sleep(delay);
                delay *= this.options.retryConfig.backoffMultiplier;
            }
        }

        throw lastError;
    }

    isRetryableError(error) {
        const retryableErrors = [
            'network_error',
            'timeout',
            'rate_limit',
            'server_error'
        ];

        return retryableErrors.includes(error.code);
    }

    validateCardData(cardData) {
        if (!this.isValidCardNumber(cardData.number)) {
            throw new Error('Invalid card number');
        }

        if (!this.isValidExpiryDate(cardData.expiryMonth, cardData.expiryYear)) {
            throw new Error('Invalid expiry date');
        }

        if (!this.isValidCVV(cardData.cvv)) {
            throw new Error('Invalid CVV');
        }
    }

    isValidCardNumber(number) {
        // Luhn algorithm check
        let sum = 0;
        let isEven = false;

        for (let i = number.length - 1; i >= 0; i--) {
            let digit = parseInt(number.charAt(i), 10);

            if (isEven) {
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }

            sum += digit;
            isEven = !isEven;
        }

        return (sum % 10) === 0;
    }

    isValidExpiryDate(month, year) {
        const now = new Date();
        const expiry = new Date(year, month - 1);
        return expiry > now;
    }

    isValidCVV(cvv) {
        return /^\d{3,4}$/.test(cvv);
    }

    detectCardBrand(number) {
        const patterns = {
            visa: /^4/,
            mastercard: /^5[1-5]/,
            amex: /^3[47]/,
            discover: /^6(?:011|5)/
        };

        for (const [brand, pattern] of Object.entries(patterns)) {
            if (pattern.test(number)) {
                return brand;
            }
        }

        return 'unknown';
    }

    calculateNextBillingDate(recurring) {
        const date = new Date();
        switch (recurring.interval) {
            case 'day':
                date.setDate(date.getDate() + recurring.intervalCount);
                break;
            case 'week':
                date.setDate(date.getDate() + (7 * recurring.intervalCount));
                break;
            case 'month':
                date.setMonth(date.getMonth() + recurring.intervalCount);
                break;
            case 'year':
                date.setFullYear(date.getFullYear() + recurring.intervalCount);
                break;
        }
        return date