const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const ClamAV = require('clamav.js');
const ExifTool = require('exiftool-vendored').ExifTool;
const mime = require('mime-types');
const { pipeline } = require('stream/promises');

class SecureFileUploader {
    constructor(options = {}) {
        this.options = {
            tempDir: options.tempDir || './temp',
            quarantineDir: options.quarantineDir || './quarantine',
            storageDir: options.storageDir || './storage',
            maxFileSize: options.maxFileSize || 1024 * 1024 * 1024, // 1GB
            chunkSize: options.chunkSize || 1024 * 1024 * 2, // 2MB
            allowedTypes: options.allowedTypes || new Set([
                'image/jpeg', 'image/png', 'application/pdf'
            ]),
            quotaPerUser: options.quotaPerUser || 1024 * 1024 * 1024 * 10, // 10GB
            rateLimit: options.rateLimit || {
                windowMs: 15 * 60 * 1000, // 15 minutes
                maxRequests: 100
            },
            scanTimeout: options.scanTimeout || 30000, // 30 seconds
            maxConcurrentUploads: options.maxConcurrentUploads || 3,
            database: options.database,
            cache: options.cache,
            logger: options.logger
        };

        this.uploads = new Map();
        this.scanners = new Map();
        this.rateLimiters = new Map();
        
        this.init();
    }

    async init() {
        await this.ensureDirectories();
        await this.initializeVirusScanner();
        this.startMaintenanceTask();
    }

    async ensureDirectories() {
        for (const dir of [
            this.options.tempDir,
            this.options.quarantineDir,
            this.options.storageDir
        ]) {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    async initializeVirusScanner() {
        this.clamav = new ClamAV();
        await this.clamav.init({
            removeInfected: true,
            quarantineInfected: true,
            quarantinePath: this.options.quarantineDir,
            debugMode: false,
            fileList: null,
            scanLog: null,
            preference: 'security'
        });
    }

    async initiateUpload(userId, fileInfo) {
        try {
            // Validate user quota
            await this.checkUserQuota(userId);

            // Check rate limit
            await this.checkRateLimit(userId);

            // Validate file info
            this.validateFileInfo(fileInfo);

            // Generate upload ID
            const uploadId = crypto.randomUUID();

            // Create upload record
            const upload = {
                id: uploadId,
                userId,
                fileInfo,
                chunks: new Map(),
                status: 'pending',
                createdAt: Date.now(),
                tempPath: path.join(this.options.tempDir, uploadId)
            };

            // Store upload record
            this.uploads.set(uploadId, upload);

            // Calculate chunks
            const chunks = this.calculateChunks(fileInfo.size);

            return {
                uploadId,
                chunks,
                chunkSize: this.options.chunkSize
            };

        } catch (error) {
            this.handleError('Upload initiation failed', error);
            throw error;
        }
    }

    async uploadChunk(uploadId, chunkIndex, chunkData) {
        try {
            const upload = this.uploads.get(uploadId);
            if (!upload) {
                throw new Error('Upload not found');
            }

            // Validate chunk
            this.validateChunk(chunkData, chunkIndex, upload);

            // Write chunk to temporary file
            await this.writeChunk(upload, chunkIndex, chunkData);

            // Update upload record
            upload.chunks.set(chunkIndex, {
                size: chunkData.length,
                hash: this.calculateHash(chunkData),
                status: 'uploaded'
            });

            // Check if upload is complete
            if (this.isUploadComplete(upload)) {
                await this.processCompleteUpload(upload);
            }

            return {
                status: 'success',
                chunksReceived: upload.chunks.size,
                isComplete: this.isUploadComplete(upload)
            };

        } catch (error) {
            this.handleError('Chunk upload failed', error);
            throw error;
        }
    }

    async processCompleteUpload(upload) {
        try {
            // Change status to processing
            upload.status = 'processing';

            // Combine chunks
            await this.combineChunks(upload);

            // Verify file integrity
            await this.verifyFileIntegrity(upload);

            // Scan for viruses
            const scanResult = await this.scanFile(upload);
            if (!scanResult.isClean) {
                throw new Error('Malware detected');
            }

            // Strip metadata
            await this.stripMetadata(upload);

            // Verify content type
            await this.verifyContentType(upload);

            // Move to final storage
            const storagePath = await this.moveToStorage(upload);

            // Update database
            await this.updateFileRecord(upload, storagePath);

            // Update user quota
            await this.updateUserQuota(upload.userId, upload.fileInfo.size);

            // Cleanup
            await this.cleanupUpload(upload);

            upload.status = 'complete';

        } catch (error) {
            upload.status = 'failed';
            upload.error = error.message;
            await this.handleFailedUpload(upload);
            throw error;
        }
    }

    async scanFile(upload) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Scan timeout'));
            }, this.options.scanTimeout);

            this.clamav.scanFile(upload.tempPath)
                .then(result => {
                    clearTimeout(timeout);
                    resolve({
                        isClean: !result.isInfected,
                        threats: result.viruses || []
                    });
                })
                .catch(reject);
        });
    }

    async stripMetadata(upload) {
        const exif = new ExifTool();
        try {
            // Create temporary file for cleaned version
            const cleanPath = `${upload.tempPath}.clean`;

            // Strip metadata
            await exif.write(upload.tempPath, {
                all: '', // Remove all metadata
                overwrite_original: true
            });

            // Verify file still valid
            await this.verifyFileIntegrity({
                ...upload,
                tempPath: cleanPath
            });

            // Replace original with cleaned version
            await fs.rename(cleanPath, upload.tempPath);

        } finally {
            await exif.end();
        }
    }

    async verifyContentType(upload) {
        // Read file magic numbers
        const buffer = Buffer.alloc(4096);
        const fd = await fs.open(upload.tempPath, 'r');
        await fd.read(buffer, 0, 4096, 0);
        await fd.close();

        // Detect content type
        const detectedType = this.detectContentType(buffer);

        // Verify against claimed type
        if (detectedType !== upload.fileInfo.type) {
            throw new Error('Content type mismatch');
        }

        // Verify allowed type
        if (!this.options.allowedTypes.has(detectedType)) {
            throw new Error('Content type not allowed');
        }
    }

    detectContentType(buffer) {
        const signatures = {
            'image/jpeg': [[0xFF, 0xD8, 0xFF]],
            'image/png': [[0x89, 0x50, 0x4E, 0x47]],
            'application/pdf': [[0x25, 0x50, 0x44, 0x46]]
        };

        for (const [type, sigs] of Object.entries(signatures)) {
            for (const sig of sigs) {
                if (sig.every((byte, i) => buffer[i] === byte)) {
                    return type;
                }
            }
        }

        return 'application/octet-stream';
    }

    async writeChunk(upload, index, data) {
        const start = index * this.options.chunkSize;
        const fd = await fs.open(upload.tempPath, 'a');
        await fd.write(data, 0, data.length, start);
        await fd.close();
    }

    async combineChunks(upload) {
        // Verify all chunks present
        const expectedChunks = Math.ceil(upload.fileInfo.size / this.options.chunkSize);
        if (upload.chunks.size !== expectedChunks) {
            throw new Error('Missing chunks');
        }

        // Verify file size
        const stats = await fs.stat(upload.tempPath);
        if (stats.size !== upload.fileInfo.size) {
            throw new Error('File size mismatch');
        }
    }

    async verifyFileIntegrity(upload) {
        // Calculate file hash
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(upload.tempPath);
        
        await new Promise((resolve, reject) => {
            stream.on('data', data => hash.update(data));
            stream.on('end', resolve);
            stream.on('error', reject);
        });

        const fileHash = hash.digest('hex');

        // Compare with original hash
        if (fileHash !== upload.fileInfo.hash) {
            throw new Error('File integrity check failed');
        }
    }

    async moveToStorage(upload) {
        const storagePath = this.generateStoragePath(upload);
        await fs.mkdir(path.dirname(storagePath), { recursive: true });
        await fs.rename(upload.tempPath, storagePath);
        return storagePath;
    }

    generateStoragePath(upload) {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        return path.join(
            this.options.storageDir,
            String(year),
            month,
            day,
            `${upload.id}${path.extname(upload.fileInfo.name)}`
        );
    }

    async checkUserQuota(userId) {
        const usedSpace = await this.options.database.getUserQuota(userId);
        if (usedSpace >= this.options.quotaPerUser) {
            throw new Error('User quota exceeded');
        }
    }

    async updateUserQuota(userId, size) {
        await this.options.database.incrementUserQuota(userId, size);
    }

    async checkRateLimit(userId) {
        const key = `ratelimit:${userId}`;
        const now = Date.now();
        
        let limiter = this.rateLimiters.get(userId);
        if (!limiter) {
            limiter = {
                requests: 0,
                window: now
            };
            this.rateLimiters.set(userId, limiter);
        }

        // Reset window if expired
        if (now - limiter.window > this.options.rateLimit.windowMs) {
            limiter.requests = 0;
            limiter.window = now;
        }

        // Check limit
        if (limiter.requests >= this.options.rateLimit.maxRequests) {
            throw new Error('Rate limit exceeded');
        }

        limiter.requests++;
    }

    validateFileInfo(fileInfo) {
        // Check required fields
        if (!fileInfo.name || !fileInfo.size || !fileInfo.type) {
            throw new Error('Missing required file information');
        }

        // Check file size
        if (fileInfo.size > this.options.maxFileSize) {
            throw new Error('File size exceeds limit');
        }

        // Check file type
        if (!this.options.allowedTypes.has(fileInfo.type)) {
            throw new Error('File type not allowed');
        }

        // Validate filename
        if (!/^[a-zA-Z0-9-_. ]+$/.test(fileInfo.name)) {
            throw new Error('Invalid filename');
        }
    }

    validateChunk(chunk, index, upload) {
        // Check chunk size
        if (index < Math.floor(upload.fileInfo.size / this.options.chunkSize)) {
            if (chunk.length !== this.options.chunkSize) {
                throw new Error('Invalid chunk size');
            }
        } else {
            const expectedSize = upload.fileInfo.size % this.options.chunkSize;
            if (chunk.length !== expectedSize) {
                throw new Error('Invalid final chunk size');
            }
        }
    }

    isUploadComplete(upload) {
        const expectedChunks = Math.ceil(upload.fileInfo.size / this.options.chunkSize);
        return upload.chunks.size === expectedChunks;
    }

    async handleFailedUpload(upload) {
        try {
            // Log failure
            this.options.logger.error('Upload failed', {
                uploadId: upload.id,
                userId: upload.userId,
                error: upload.error
            });

            // Move to quarantine if necessary
            if (upload.error.includes('Malware')) {
                const quarantinePath = path.join(
                    this.options.quarantineDir,
                    `${upload.id}${path.extname(upload.fileInfo.name)}`
                );
                await fs.rename(upload.tempPath, quarantinePath);
            }

            // Cleanup
            await this.cleanupUpload(upload);

        } catch (error) {
            this.handleError('Failed upload handling failed', error);
        }
    }

    async cleanupUpload(upload) {
        try {
            // Remove temporary file
            await fs.unlink(upload.tempPath).catch(() => {});

            // Remove upload record
            this.uploads.delete(upload.id);

        } catch (error) {
            this.handleError('Upload cleanup failed', error);
        }
    }

    startMaintenanceTask() {
        setInterval(() => {
            this.cleanupStaleUploads();
            this.cleanupRateLimiters();
        }, 15 * 60 * 1000); // 15 minutes
    }

    async cleanupStaleUploads() {
        const now = Date.now();
        for (const [id, upload] of this.uploads.entries()) {
            if (now - upload.createdAt > 24 * 60 * 60 * 1000) { // 24 hours
                await this.cleanupUpload(upload);
            }
        }
    }

    cleanupRateLimiters() {
        const now = Date.now();
        for (const [userId, limiter] of this.rateLimiters.entries()) {
            if (now - limiter.window > this.options.rateLimit.windowMs) {
                this.rateLimiters.delete(userId);
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
const uploader = new SecureFileUploader({
    tempDir: './temp',
    quarantineDir: './quarantine',
    storageDir: './storage',
    maxFileSize: 1024 * 1024 * 1024, // 1GB
    allowedTypes: new Set(['image/jpeg', 'image/png', 'application/pdf']),