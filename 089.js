const WebSocket = require('ws');
const crypto = require('crypto');

class ChatServer {
    constructor(options = {}) {
        this.options = {
            port: options.port || 8080,
            maxConnections: options.maxConnections || 10000,
            messageRateLimit: options.messageRateLimit || 10, // messages per second
            maxMessageSize: options.maxMessageSize || 1024 * 10, // 10KB
            pingInterval: options.pingInterval || 30000, // 30 seconds
            authTimeout: options.authTimeout || 5000, // 5 seconds
            database: options.database,
            logger: options.logger
        };

        this.clients = new Map();
        this.rooms = new Map();
        this.messageHistory = new Map();
        this.rateLimiters = new Map();
    }

    init() {
        this.server = new WebSocket.Server({
            port: this.options.port,
            maxPayload: this.options.maxMessageSize,
            clientTracking: true,
            verifyClient: this.verifyClient.bind(this)
        });

        this.setupEventListeners();
        this.startPingInterval();
        this.logger.info(`Chat server started on port ${this.options.port}`);
    }

    verifyClient(info, callback) {
        const token = this.extractToken(info.req);
        if (!token) {
            callback(false, 401, 'Unauthorized');
            return;
        }

        this.validateToken(token)
            .then(user => {
                info.req.user = user;
                callback(true);
            })
            .catch(error => {
                this.logger.warn('Authentication failed:', error);
                callback(false, 401, 'Invalid token');
            });
    }

    setupEventListeners() {
        this.server.on('connection', (ws, req) => {
            this.handleNewConnection(ws, req);
        });

        this.server.on('error', error => {
            this.logger.error('WebSocket server error:', error);
        });
    }

    async handleNewConnection(ws, req) {
        try {
            const client = await this.createClient(ws, req);
            this.clients.set(client.id, client);

            // Setup client event listeners
            ws.on('message', data => this.handleMessage(client, data));
            ws.on('close', () => this.handleDisconnection(client));
            ws.on('error', error => this.handleClientError(client, error));

            // Send connection acknowledgment
            this.sendToClient(client, {
                type: 'connection_ack',
                data: {
                    clientId: client.id,
                    user: client.user
                }
            });

            // Broadcast user online status
            this.broadcastUserStatus(client, 'online');

        } catch (error) {
            this.logger.error('Connection handling error:', error);
            ws.close(1011, 'Internal server error');
        }
    }

    async createClient(ws, req) {
        const client = {
            id: crypto.randomUUID(),
            ws,
            user: req.user,
            rooms: new Set(),
            connectedAt: Date.now(),
            lastActivity: Date.now(),
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
        };

        // Initialize rate limiter for this client
        this.rateLimiters.set(client.id, {
            count: 0,
            lastReset: Date.now()
        });

        return client;
    }

    async handleMessage(client, data) {
        try {
            // Update last activity
            client.lastActivity = Date.now();

            // Check rate limit
            if (!this.checkRateLimit(client)) {
                this.sendError(client, 'Rate limit exceeded');
                return;
            }

            // Parse message
            const message = this.parseMessage(data);
            if (!message) return;

            // Process message based on type
            switch (message.type) {
                case 'chat':
                    await this.handleChatMessage(client, message);
                    break;
                case 'join_room':
                    await this.handleJoinRoom(client, message);
                    break;
                case 'leave_room':
                    await this.handleLeaveRoom(client, message);
                    break;
                case 'typing':
                    await this.handleTypingStatus(client, message);
                    break;
                case 'pong':
                    // Handle ping response
                    break;
                default:
                    this.sendError(client, 'Unknown message type');
            }

        } catch (error) {
            this.logger.error('Message handling error:', error);
            this.sendError(client, 'Failed to process message');
        }
    }

    async handleChatMessage(client, message) {
        const { roomId, content, replyTo } = message.data;

        // Validate room
        const room = this.rooms.get(roomId);
        if (!room) {
            this.sendError(client, 'Room not found');
            return;
        }

        // Check if client is in room
        if (!client.rooms.has(roomId)) {
            this.sendError(client, 'Not a member of this room');
            return;
        }

        // Validate content
        if (!this.validateMessageContent(content)) {
            this.sendError(client, 'Invalid message content');
            return;
        }

        // Create message object
        const chatMessage = {
            id: crypto.randomUUID(),
            roomId,
            sender: client.user,
            content,
            replyTo,
            timestamp: Date.now()
        };

        // Store message in history
        await this.storeMessage(chatMessage);

        // Broadcast to room members
        this.broadcastToRoom(roomId, {
            type: 'chat_message',
            data: chatMessage
        });

        // Send delivery confirmation
        this.sendToClient(client, {
            type: 'message_delivered',
            data: {
                messageId: chatMessage.id,
                timestamp: chatMessage.timestamp
            }
        });
    }

    async handleJoinRoom(client, message) {
        const { roomId } = message.data;

        // Check if room exists, create if not
        let room = this.rooms.get(roomId);
        if (!room) {
            room = await this.createRoom(roomId);
        }

        // Check permissions
        if (!await this.canJoinRoom(client, room)) {
            this.sendError(client, 'Access denied');
            return;
        }

        // Add client to room
        room.members.add(client.id);
        client.rooms.add(roomId);

        // Send room history
        const history = await this.getRoomHistory(roomId);
        this.sendToClient(client, {
            type: 'room_history',
            data: {
                roomId,
                messages: history
            }
        });

        // Broadcast join notification
        this.broadcastToRoom(roomId, {
            type: 'user_joined',
            data: {
                roomId,
                user: client.user
            }
        }, [client.id]); // Exclude sender
    }

    async handleLeaveRoom(client, message) {
        const { roomId } = message.data;
        const room = this.rooms.get(roomId);

        if (room && client.rooms.has(roomId)) {
            room.members.delete(client.id);
            client.rooms.delete(roomId);

            // Broadcast leave notification
            this.broadcastToRoom(roomId, {
                type: 'user_left',
                data: {
                    roomId,
                    user: client.user
                }
            });

            // Clean up empty rooms
            if (room.members.size === 0) {
                this.rooms.delete(roomId);
            }
        }
    }

    handleTypingStatus(client, message) {
        const { roomId, isTyping } = message.data;

        if (client.rooms.has(roomId)) {
            this.broadcastToRoom(roomId, {
                type: 'typing_status',
                data: {
                    roomId,
                    user: client.user,
                    isTyping
                }
            }, [client.id]); // Exclude sender
        }
    }

    handleDisconnection(client) {
        // Remove from all rooms
        client.rooms.forEach(roomId => {
            const room = this.rooms.get(roomId);
            if (room) {
                room.members.delete(client.id);
                // Broadcast leave notification
                this.broadcastToRoom(roomId, {
                    type: 'user_left',
                    data: {
                        roomId,
                        user: client.user
                    }
                });
            }
        });

        // Broadcast offline status
        this.broadcastUserStatus(client, 'offline');

        // Clean up client data
        this.clients.delete(client.id);
        this.rateLimiters.delete(client.id);
    }

    handleClientError(client, error) {
        this.logger.error(`Client error (${client.id}):`, error);
        client.ws.close(1011, 'Internal error');
    }

    broadcastToRoom(roomId, message, excludeClients = []) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.members.forEach(clientId => {
            if (!excludeClients.includes(clientId)) {
                const client = this.clients.get(clientId);
                if (client) {
                    this.sendToClient(client, message);
                }
            }
        });
    }

    broadcastUserStatus(client, status) {
        const statusMessage = {
            type: 'user_status',
            data: {
                user: client.user,
                status,
                timestamp: Date.now()
            }
        };

        // Broadcast to all rooms the client is in
        client.rooms.forEach(roomId => {
            this.broadcastToRoom(roomId, statusMessage, [client.id]);
        });
    }

    sendToClient(client, message) {
        try {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify(message));
            }
        } catch (error) {
            this.logger.error(`Failed to send message to client ${client.id}:`, error);
        }
    }

    sendError(client, message) {
        this.sendToClient(client, {
            type: 'error',
            data: { message }
        });
    }

    checkRateLimit(client) {
        const limiter = this.rateLimiters.get(client.id);
        const now = Date.now();

        // Reset counter if time window has passed
        if (now - limiter.lastReset >= 1000) {
            limiter.count = 0;
            limiter.lastReset = now;
        }

        // Check limit
        if (limiter.count >= this.options.messageRateLimit) {
            return false;
        }

        limiter.count++;
        return true;
    }

    validateMessageContent(content) {
        // Check size
        if (!content || content.length > this.options.maxMessageSize) {
            return false;
        }

        // Check for malicious content
        const dangerous = /<script|javascript:|data:/i;
        if (dangerous.test(content)) {
            return false;
        }

        return true;
    }

    startPingInterval() {
        setInterval(() => {
            this.clients.forEach(client => {
                // Check if client is still responsive
                if (Date.now() - client.lastActivity > this.options.pingInterval * 2) {
                    client.ws.close(1000, 'Ping timeout');
                    return;
                }

                // Send ping
                this.sendToClient(client, { type: 'ping' });
            });
        }, this.options.pingInterval);
    }

    async storeMessage(message) {
        // Store in memory
        let roomHistory = this.messageHistory.get(message.roomId);
        if (!roomHistory) {
            roomHistory = [];
            this.messageHistory.set(message.roomId, roomHistory);
        }
        roomHistory.push(message);

        // Trim history if too long
        if (roomHistory.length > 100) {
            roomHistory.shift();
        }

        // Store in database
        if (this.options.database) {
            await this.options.database.storeMessage(message);
        }
    }

    async getRoomHistory(roomId) {
        if (this.options.database) {
            return await this.options.database.getMessages(roomId, 50);
        }
        return this.messageHistory.get(roomId) || [];
    }
}

// Usage example:
const chatServer = new ChatServer({
    port: 8080,
    database: dbConnection,
    logger: loggingService
});

chatServer.init();