const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class SecureFileTransfer {
    constructor(options = {}) {
        this.options = {
            port: options.port || 8080,
            maxConcurrentTransfers: options.maxConcurrentTransfers || 3,
            chunkSize: options.chunkSize || 1024 * 1024, // 1MB
            maxFileSize: options.maxFileSize || 1024 * 1024 * 1024, // 1GB
            throttleRate: options.throttleRate || 1024 * 1024 * 5, // 5MB/s
            tempDir: options.tempDir || './temp',
            keyExchangeTimeout: options.keyExchangeTimeout || 30000, // 30 seconds
            verificationRetries: options.verificationRetries || 3
        };

        this.activeTransfers = new Map();
        this.transferQueue = [];
        this.clients = new Map();
    }

    init() {
        this.setupWebSocketServer();
        this.ensureTempDirectory();
        this.startMaintenanceInterval();
    }

    setupWebSocketServer() {
        this.server = new WebSocket.Server({
            port: this.options.port,
            clientTracking: true,
            verifyClient: this.verifyClient.bind(this)
        });

        this.server.on('connection', this.handleConnection.bind(this));
        this.server.on('error', this.handleServerError.bind(this));
    }

    verifyClient(info, callback) {
        // Implement client verification logic
        // For example, verify tokens, check IP whitelist, etc.
        callback(true);
    }

    handleConnection(ws, req) {
        const clientId = this.generateClientId();
        const client = {
            id: clientId,
            ws,
            transfers: new Map(),
            keyPair: null,
            sharedSecrets: new Map()
        };

        this.clients.set(clientId, client);

        ws.on('message', (data) => this.handleMessage(client, data));
        ws.on('close', () => this.handleDisconnection(client));
        ws.on('error', (error) => this.handleClientError(client, error));

        // Initialize key exchange
        this.initiateKeyExchange(client);
    }

    async initiateKeyExchange(client) {
        try {
            // Generate ephemeral key pair for perfect forward secrecy
            const keyPair = await this.generateKeyPair();
            client.keyPair = keyPair;

            // Send public key to client
            this.sendToClient(client, {
                type: 'key_exchange',
                publicKey: keyPair.publicKey
            });

            // Set timeout for key exchange completion
            client.keyExchangeTimeout = setTimeout(() => {
                if (!client.sharedSecrets.size) {
                    client.ws.close(1008, 'Key exchange timeout');
                }
            }, this.options.keyExchangeTimeout);

        } catch (error) {
            this.handleError(client, 'Key exchange failed', error);
        }
    }

    async handleMessage(client, data) {
        try {
            const message = this.decryptMessage(client, data);
            if (!message) return;

            switch (message.type) {
                case 'key_exchange_response':
                    await this.handleKeyExchangeResponse(client, message);
                    break;
                case 'transfer_request':
                    await this.handleTransferRequest(client, message);
                    break;
                case 'chunk_request':
                    await this.handleChunkRequest(client, message);
                    break;
                case 'chunk_received':
                    await this.handleChunkReceived(client, message);
                    break;
                case 'transfer_complete':
                    await this.handleTransferComplete(client, message);
                    break;
                case 'transfer_error':
                    await this.handleTransferError(client, message);
                    break;
            }
        } catch (error) {
            this.handleError(client, 'Message handling failed', error);
        }
    }

    async handleKeyExchangeResponse(client, message) {
        try {
            const { clientPublicKey, encryptedSecret } = message;

            // Derive shared secret
            const sharedSecret = crypto.diffieHellman({
                privateKey: client.keyPair.privateKey,
                publicKey: clientPublicKey
            });

            // Verify and store shared secret
            const secret = this.decryptWithPrivateKey(
                encryptedSecret,
                client.keyPair.privateKey
            );

            client.sharedSecrets.set(message.sessionId, {
                secret: sharedSecret,
                timestamp: Date.now()
            });

            clearTimeout(client.keyExchangeTimeout);

            // Acknowledge key exchange completion
            this.sendToClient(client, {
                type: 'key_exchange_complete',
                sessionId: message.sessionId
            });

        } catch (error) {
            this.handleError(client, 'Key exchange response failed', error);
        }
    }

    async handleTransferRequest(client, message) {
        try {
            const { fileInfo, sessionId } = message;

            // Validate file info
            if (!this.validateFileInfo(fileInfo)) {
                throw new Error('Invalid file information');
            }

            // Check file size
            if (fileInfo.size > this.options.maxFileSize) {
                throw new Error('File size exceeds limit');
            }

            // Create transfer record
            const transferId = this.generateTransferId();
            const transfer = {
                id: transferId,
                fileInfo,
                sessionId,
                chunks: new Map(),
                startTime: Date.now(),
                status: 'pending',
                progress: 0,
                tempPath: path.join(this.options.tempDir, transferId)
            };

            client.transfers.set(transferId, transfer);

            // Calculate chunks
            const chunks = this.calculateChunks(fileInfo.size);
            transfer.totalChunks = chunks.length;

            // Create temporary file
            await this.createTempFile(transfer.tempPath, fileInfo.size);

            // Send transfer acknowledgment
            this.sendToClient(client, {
                type: 'transfer_ready',
                transferId,
                chunks: chunks.length
            });

            // Add to queue if needed
            if (this.activeTransfers.size >= this.options.maxConcurrentTransfers) {
                this.transferQueue.push({ client, transfer });
            } else {
                this.startTransfer(client, transfer);
            }

        } catch (error) {
            this.handleError(client, 'Transfer request failed', error);
        }
    }

    async handleChunkRequest(client, message) {
        try {
            const { transferId, chunkIndex } = message;
            const transfer = client.transfers.get(transferId);

            if (!transfer || transfer.status !== 'active') {
                throw new Error('Invalid transfer');
            }

            // Read chunk from file
            const chunk = await this.readChunk(
                transfer.fileInfo.path,
                chunkIndex,
                this.options.chunkSize
            );

            // Calculate chunk checksum
            const checksum = this.calculateChecksum(chunk);

            // Encrypt chunk
            const encryptedChunk = this.encryptChunk(
                chunk,
                client.sharedSecrets.get(transfer.sessionId).secret
            );

            // Send chunk
            this.sendToClient(client, {
                type: 'chunk_data',
                transferId,
                chunkIndex,
                data: encryptedChunk,
                checksum
            });

            // Update transfer progress
            transfer.progress = (chunkIndex + 1) / transfer.totalChunks;
            this.emitProgress(client, transfer);

        } catch (error) {
            this.handleError(client, 'Chunk request faile