class ProfileUpdateController {
    constructor(options = {}) {
        this.options = {
            maxImageSize: options.maxImageSize || 5 * 1024 * 1024, // 5MB
            allowedImageTypes: options.allowedImageTypes || ['image/jpeg', 'image/png'],
            maxFieldLength: options.maxFieldLength || 255,
            requiredFields: options.requiredFields || ['email'],
            validationRules: options.validationRules || {},
            sanitizationRules: options.sanitizationRules || {},
            database: options.database, // Database connection
            logger: options.logger // Logging service
        };

        this.validators = this.setupValidators();
        this.sanitizers = this.setupSanitizers();
    }

    async handleProfileUpdate(req, res) {
        const session = req.session;
        const userId = session?.userId;

        try {
            // Verify authentication
            if (!userId) {
                throw new AuthError('Authentication required');
            }

            // Validate permissions
            await this.validatePermissions(userId, req.body);

            // Sanitize and validate input
            const sanitizedData = await this.processInput(req.body);

            // Update profile
            const updatedProfile = await this.updateProfile(userId, sanitizedData);

            // Log the update
            await this.logProfileUpdate(userId, sanitizedData);

            // Return success response
            return res.status(200).json({
                success: true,
                data: updatedProfile
            });

        } catch (error) {
            await this.handleError(error, req, res);
        }
    }

    setupValidators() {
        return {
            email: (value) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(value)) {
                    throw new ValidationError('Invalid email format');
                }
                return true;
            },

            phone: (value) => {
                const phoneRegex = /^\+?[\d\s-()]{8,}$/;
                if (!phoneRegex.test(value)) {
                    throw new ValidationError('Invalid phone number format');
                }
                return true;
            },

            name: (value) => {
                if (value.length < 2 || value.length > 50) {
                    throw new ValidationError('Name must be between 2 and 50 characters');
                }
                return true;
            },

            birthDate: (value) => {
                const date = new Date(value);
                const now = new Date();
                if (isNaN(date.getTime()) || date > now) {
                    throw new ValidationError('Invalid birth date');
                }
                return true;
            },

            url: (value) => {
                try {
                    new URL(value);
                    return true;
                } catch {
                    throw new ValidationError('Invalid URL format');
                }
            },

            password: (value) => {
                const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
                if (!passwordRegex.test(value)) {
                    throw new ValidationError(
                        'Password must contain at least 8 characters, ' +
                        'including uppercase, lowercase, number and special character'
                    );
                }
                return true;
            }
        };
    }

    setupSanitizers() {
        return {
            email: (value) => value.toLowerCase().trim(),

            phone: (value) => value.replace(/\s+/g, '').replace(/[()-]/g, ''),

            name: (value) => {
                return value
                    .trim()
                    .replace(/\s+/g, ' ')
                    .replace(/[<>]/g, '');
            },

            text: (value) => {
                return value
                    .trim()
                    .replace(/[<>]/g, '')
                    .substring(0, this.options.maxFieldLength);
            },

            html: (value) => {
                // Use a proper HTML sanitizer library in production
                return require('sanitize-html')(value, {
                    allowedTags: ['b', 'i', 'em', 'strong', 'a'],
                    allowedAttributes: {
                        'a': ['href']
                    }
                });
            }
        };
    }

    async validatePermissions(userId, data) {
        // Get user's current profile
        const currentProfile = await this.options.database.getUserProfile(userId);
        
        // Check if user exists
        if (!currentProfile) {
            throw new NotFoundError('User profile not found');
        }

        // Check if user is trying to modify restricted fields
        const restrictedFields = ['role', 'permissions', 'status'];
        for (const field of restrictedFields) {
            if (data[field] !== undefined && data[field] !== currentProfile[field]) {
                throw new ForbiddenError('Cannot modify restricted fields');
            }
        }

        // Check if email change requires verification
        if (data.email && data.email !== currentProfile.email) {
            await this.handleEmailChange(userId, data.email, currentProfile.email);
        }

        return true;
    }

    async processInput(data) {
        const sanitized = {};
        const errors = [];

        for (const [field, value] of Object.entries(data)) {
            try {
                // Skip null or undefined values
                if (value == null) continue;

                // Validate required fields
                if (this.options.requiredFields.includes(field) && !value) {
                    throw new ValidationError(`${field} is required`);
                }

                // Apply field-specific validation
                if (this.validators[field]) {
                    await this.validators[field](value);
                }

                // Apply field-specific sanitization
                const sanitizer = this.sanitizers[field] || this.sanitizers.text;
                sanitized[field] = sanitizer(value);

                // Validate field length
                if (typeof sanitized[field] === 'string' && 
                    sanitized[field].length > this.options.maxFieldLength) {
                    throw new ValidationError(`${field} exceeds maximum length`);
                }

            } catch (error) {
                errors.push({ field, message: error.message });
            }
        }

        if (errors.length > 0) {
            throw new ValidationError('Validation failed', errors);
        }

        return sanitized;
    }

    async updateProfile(userId, data) {
        try {
            // Start transaction
            const transaction = await this.options.database.beginTransaction();

            try {
                // Update profile
                const updatedProfile = await this.options.database.updateProfile(
                    userId,
                    data,
                    { transaction }
                );

                // Handle profile image if present
                if (data.profileImage) {
                    await this.handleProfileImage(userId, data.profileImage, transaction);
                }

                // Commit transaction
                await transaction.commit();

                return updatedProfile;

            } catch (error) {
                // Rollback transaction on error
                await transaction.rollback();
                throw error;
            }

        } catch (error) {
            throw new DatabaseError('Failed to update profile', error);
        }
    }

    async handleProfileImage(userId, imageData, transaction) {
        // Validate image
        if (!this.options.allowedImageTypes.includes(imageData.type)) {
            throw new ValidationError('Invalid image type');
        }

        if (imageData.size > this.options.maxImageSize) {
            throw new ValidationError('Image size exceeds limit');
        }

        // Process and store image
        try {
            const processedImage = await this.processImage(imageData);
            await this.options.database.updateProfileImage(
                userId,
                processedImage,
                { transaction }
            );
        } catch (error) {
            throw new ProcessingError('Failed to process profile image', error);
        }
    }

    async handleEmailChange(userId, newEmail, currentEmail) {
        // Check if new email is already in use
        const existingUser = await this.options.database.getUserByEmail(newEmail);
        if (existingUser && existingUser.id !== userId) {
            throw new ValidationError('Email already in use');
        }

        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // Store pending email change
        await this.options.database.storePendingEmailChange(userId, {
            newEmail,
            verificationToken,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        });

        // Send verification email
        await this.sendEmailVerification(newEmail, verificationToken);
    }

    async logProfileUpdate(userId, changes) {
        try {
            await this.options.logger.info('profile_update', {
                userId,
                timestamp: new Date(),
                changes: this.sanitizeLogData(changes),
                ip: req.ip
            });
        } catch (error) {
            // Log errors shouldn't affect the response
            console.error('Failed to log profile update:', error);
        }
    }

    sanitizeLogData(data) {
        // Remove sensitive information from logs
        const sensitiveFields = ['password', 'token', 'secret'];
        const sanitized = { ...data };

        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    async handleError(error, req, res) {
        // Log error
        await this.options.logger.error('profile_update_error', {
            userId: req.session?.userId,
            error: error.message,
            stack: error.stack,
            timestamp: new Date()
        });

        // Send appropriate response
        if (error instanceof ValidationError) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: error.details
            });
        }

        if (error instanceof AuthError) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (error instanceof ForbiddenError) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        // Default error response
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// Custom error classes
class ValidationError extends Error {
    constructor(message, details = []) {
        super(message);
        this.name = 'ValidationError';
        this.details = details;
    }
}

class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
    }
}

class ForbiddenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ForbiddenError';
    }
}

class DatabaseError extends Error {
    constructor(message, originalError) {
        super(message);
        this.name = 'DatabaseError';
        this.originalError = originalError;
    }
}

// Usage example:
const profileController = new ProfileUpdateController({
    database: dbConnection,
    logger: loggingService,
    validationRules: {
        // Custom validation rules
    },
    sanitizationRules: {
        // Custom sanitization rules
    }
});

// Express route handler
app.post('/api/profile/update', async (req, res) => {
    await profileController.handleProfileUpdate(req, res);
});