const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const PDFLib = require('pdf-lib');
const { createCanvas } = require('canvas');

class SecureDocumentManager {
    constructor(options = {}) {
        this.options = {
            storageDir: options.storageDir || './storage',
            tempDir: options.tempDir || './temp',
            keyRotationInterval: options.keyRotationInterval || 24 * 60 * 60 * 1000, // 24 hours
            watermarkSettings: options.watermarkSettings || {
                opacity: 0.3,
                rotation: -45,
                fontSize: 24
            },
            database: options.database,
            cache: options.cache,
            logger: options.logger,
            maxViewDuration: options.maxViewDuration || 3600, // 1 hour
            allowedFormats: options.allowedFormats || ['pdf', 'docx', 'xlsx'],
            maxFileSize: options.maxFileSize || 100 * 1024 * 1024 // 100MB
        };

        this.documents = new Map();
        this.sessions = new Map();
        this.encryptionKeys = new Map();
        this.init();
    }

    async init() {
        await this.ensureDirectories();
        await this.loadExistingDocuments();
        this.startKeyRotation();
    }

    async ensureDirectories() {
        for (const dir of [this.options.storageDir, this.options.tempDir]) {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    async uploadDocument(file, metadata, owner) {
        try {
            // Validate file
            await this.validateFile(file);

            // Generate document ID
            const documentId = this.generateDocumentId();

            // Generate encryption key
            const key = await this.generateEncryptionKey();

            // Process and encrypt document
            const encryptedPath = await this.processAndEncryptDocument(
                file,
                key,
                metadata
            );

            // Create document record
            const document = {
                id: documentId,
                name: file.name,
                size: file.size,
                mimeType: file.type,
                keyId: await this.storeEncryptionKey(key),
                path: encryptedPath,
                metadata,
                owner,
                permissions: new Map(),
                watermark: true,
                created: new Date(),
                modified: new Date()
            };

            // Store document
            await this.storeDocument(document);

            // Create audit log
            await this.createAuditLog({
                action: 'upload',
                documentId,
                userId: owner,
                timestamp: new Date()
            });

            return documentId;

        } catch (error) {
            this.handleError('Document upload failed', error);
            throw error;
        }
    }

    async grantAccess(documentId, userId, permissions) {
        try {
            const document = await this.getDocument(documentId);
            if (!document) {
                throw new Error('Document not found');
            }

            // Validate permissions
            this.validatePermissions(permissions);

            // Store permissions
            document.permissions.set(userId, {
                ...permissions,
                granted: new Date(),
                grantedBy: document.owner
            });

            // Update document
            await this.updateDocument(document);

            // Create audit log
            await this.createAuditLog({
                action: 'grant_access',
                documentId,
                userId,
                permissions,
                timestamp: new Date()
            });

        } catch (error) {
            this.handleError('Access grant failed', error);
            throw error;
        }
    }

    async viewDocument(documentId, userId) {
        try {
            // Verify access
            const permissions = await this.verifyAccess(documentId, userId);
            if (!permissions.view) {
                throw new Error('Access denied');
            }

            // Create viewing session
            const sessionId = await this.createViewingSession(documentId, userId);

            // Get document
            const document = await this.getDocument(documentId);

            // Decrypt document
            const decryptedPath = await this.decryptDocument(
                document.path,
                await this.getEncryptionKey(document.keyId)
            );

            // Apply watermark if required
            const watermarkedPath = permissions.watermark ?
                await this.applyWatermark(decryptedPath, userId) :
                decryptedPath;

            // Create audit log
            await this.createAuditLog({
                action: 'view',
                documentId,
                userId,
                sessionId,
                timestamp: new Date()
            });

            return {
                sessionId,
                path: watermarkedPath,
                expiresAt: Date.now() + this.options.maxViewDuration * 1000
            };

        } catch (error) {
            this.handleError('Document view failed', error);
            throw error;
        }
    }

    async processAndEncryptDocument(file, key, metadata) {
        const tempPath = path.join(this.options.tempDir, crypto.randomUUID());
        
        try {
            // Write file to temp location
            await fs.writeFile(tempPath, file.buffer);

            // Process document based on type
            switch (file.type) {
                case 'application/pdf':
                    await this.processPDF(tempPath, metadata);
                    break;
                case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                    await this.processDocx(tempPath, metadata);
                    break;
                // Add other format processors
            }

            // Encrypt document
            const encryptedPath = path.join(
                this.options.storageDir,
                crypto.randomUUID()
            );

            await this.encryptFile(tempPath, encryptedPath, key);

            return encryptedPath;

        } finally {
            // Cleanup temp file
            await fs.unlink(tempPath).catch(() => {});
        }
    }

    async processPDF(filePath, metadata) {
        const pdfDoc = await PDFLib.PDFDocument.load(
            await fs.readFile(filePath)
        );

        // Add metadata
        pdfDoc.setTitle(metadata.title);
        pdfDoc.setAuthor(metadata.author);
        pdfDoc.setSubject(metadata.subject);

        // Add security features
        pdfDoc.encrypt({
            printing: 'lowResolution',
            modifying: false,
            copying: false,
            annotating: false,
            fillingForms: false,
            contentAccessibility: true,
            documentAssembly: false
        });

        // Save changes
        await fs.writeFile(filePath, await pdfDoc.save());
    }

    async applyWatermark(filePath, userId) {
        const watermarkedPath = path.join(
            this.options.tempDir,
            crypto.randomUUID()
        );

        const pdfDoc = await PDFLib.PDFDocument.load(
            await fs.readFile(filePath)
        );

        // Create watermark
        const watermark = await this.createWatermark(
            userId,
            pdfDoc.getPage(0).getSize()
        );

        // Apply to all pages
        for (const page of pdfDoc.getPages()) {
            await this.applyWatermarkToPage(page, watermark);
        }

        // Save watermarked document
        await fs.writeFile(watermarkedPath, await pdfDoc.save());

        return watermarkedPath;
    }

    async createWatermark(userId, pageSize) {
        const canvas = createCanvas(pageSize.width, pageSize.height);
        const ctx = canvas.getContext('2d');

        // Set watermark style
        ctx.globalAlpha = this.options.watermarkSettings.opacity;
        ctx.font = `${this.options.watermarkSettings.fontSize}px Arial`;
        ctx.fillStyle = 'gray';

        // Create watermark text
        const text = `Confidential - ${userId} - ${new Date().toISOString()}`;

        // Rotate and position watermark
        ctx.translate(pageSize.width / 2, pageSize.height / 2);
        ctx.rotate(this.options.watermarkSettings.rotation * Math.PI / 180);
        ctx.fillText(text, -ctx.measureText(text).width / 2, 0);

        return canvas.toBuffer();
    }

    async applyWatermarkToPage(page, watermark) {
        const { width, height } = page.getSize();
        const watermarkImage = await page.doc.embedPng(watermark);

        page.drawImage(watermarkImage, {
            x: 0,
            y: 0,
            width,
            height,
            opacity: this.options.watermarkSettings.opacity
        });
    }

    async createViewingSession(documentId, userId) {
        const sessionId = crypto.randomUUID();
        
        const session = {
            id: sessionId,
            documentId,
            userId,
            created: Date.now(),
            expiresAt: Date.now() + this.options.maxViewDuration * 1000
        };

        this.sessions.set(sessionId, session);

        // Set session expiry
        setTimeout(() => {
            this.invalidateSession(sessionId);
        }, this.options.maxViewDuration * 1000);

        return sessionId;
    }

    async invalidateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // Remove session
        this.sessions.delete(sessionId);

        // Cleanup temporary files
        await this.cleanupSessionFiles(session);

        // Create audit log
        await this.createAuditLog({
            action: 'session_end',
            documentId: session.documentId,
            userId: session.userId,
            sessionId,
            timestamp: new Date()
        });
    }

    async verifyAccess(documentId, userId) {
        const document = await this.getDocument(documentId);
        if (!document) {
            throw new Error('Document not found');
        }

        // Check if user is owner
        if (document.owner === userId) {
            return {
                view: true,
                edit: true,
                print: true,
                download: true
            };
        }

        // Check permissions
        const permissions = document.permissions.get(userId);
        if (!permissions) {
            throw new Error('Access denied');
        }

        // Check expiry if set
        if (permissions.expiresAt && Date.now() > permissions.expiresAt) {
            throw new Error('Access expired');
        }

        return permissions;
    }

    async encryptFile(sourcePath, destinationPath, key) {
        const readStream = fs.createReadStream(sourcePath);
        const writeStream = fs.createWriteStream(destinationPath);
        const iv = crypto.randomBytes(16);

        // Write IV at the beginning of the file
        await writeStream.write(iv);

        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

        await new Promise((resolve, reject) => {
            readStream
                .pipe(cipher)
                .pipe(writeStream)
                .on('finish', resolve)
                .on('error', reject);
        });

        // Write auth tag at the end
        await writeStream.write(cipher.getAuthTag());
    }

    async decryptFile(sourcePath, destinationPath, key) {
        const data = await fs.readFile(sourcePath);
        
        // Extract IV and auth tag
        const iv = data.slice(0, 16);
        const authTag = data.slice(-16);
        const encrypted = data.slice(16, -16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);

        await fs.writeFile(destinationPath, decrypted);
    }

    async rotateDocumentKey(documentId) {
        const document = await this.getDocument(documentId);
        if (!document) {
            throw new Error('Document not found');
        }

        // Generate new key
        const newKey = await this.generateEncryptionKey();
        const newKeyId = await this.storeEncryptionKey(newKey);

        // Create temp path for re-encryption
        const tempPath = path.join(this.options.tempDir, crypto.randomUUID());

        try {
            // Decrypt with old key
            await this.decryptFile(
                document.path,
                tempPath,
                await this.getEncryptionKey(document.keyId)
            );

            // Encrypt with new key
            await this.encryptFile(
                tempPath,
                document.path,
                newKey
            );

            // Update document record
            document.keyId = newKeyId;
            await this.updateDocument(document);

            // Create audit log
            await this.createAuditLog({
                action: 'key_rotation',
                documentId,
                timestamp: new Date()
            });

        } finally {
            // Cleanup temp file
            await fs.unlink(tempPath).catch(() => {});
        }
    }

    async createAuditLog(data) {
        await this.options.database.createAuditLog({
            ...data,
            ip: data.ip || 'system',
            userAgent: data.userAgent || 'system'
        });
    }

    validatePermissions(permissions) {
        const validPermissions = ['view', 'edit', 'print', 'download'];
        
        for (const [permission, value] of Object.entries(permissions)) {
            if (!validPermissions.includes(permission)) {
                throw new Error(`Invalid permission: ${permission}`);
            }
            if (typeof value !== 'boolean') {
                throw new Error(`Invalid permission value for ${permission}`);
            }
        }
    }

    handleError(message, error) {
        this.options.logger?.error(message, {
            error: error.message,
            stack: error.stack,
            timestamp: new Date()
        });
    }
}

// Usage example:
const documentManager = new SecureDocumentManager({
    storageDir: './storage',
    tempDir: './temp',
    database: dbConnection,
    cache: redisClient,
    logger: loggingService
});

// Upload document
const documentId = await documentManager.uploadDocument(
    file,
    {
        title: 'Confidential Report',
        author: 'John Doe',
        subject: 'Q4 Financial Results'
    },
    'user123'
);

// Grant access
await documentManager.grantAccess(
    documentId,
    'user456',
    {
        view: true,
        print: false,
        download: false,
        watermark: true
    }
);

// View document
const viewingSession = await documentManager.viewDocument(
    documentId,
    'user456'
);