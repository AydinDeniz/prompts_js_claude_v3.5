const crypto = require('crypto');
const WebSocket = require('ws');
const STUN = require('stun');
const TURN = require('node-turn');

class SecureWebRTCManager {
    constructor(options = {}) {
        this.options = {
            signalServer: options.signalServer || 'wss://signal.example.com',
            stunServers: options.stunServers || [
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302'
            ],
            turnServers: options.turnServers || [],
            maxBitrate: options.maxBitrate || 2500000, // 2.5 Mbps
            minBitrate: options.minBitrate || 100000,  // 100 Kbps
            reconnectAttempts: options.reconnectAttempts || 3,
            keyRotationInterval: options.keyRotationInterval || 300000, // 5 minutes
            logger: options.logger
        };

        this.peers = new Map();
        this.connections = new Map();
        this.encryptionKeys = new Map();
        this.mediaConstraints = {
            audio: true,
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        };

        this.init();
    }

    async init() {
        try {
            await this.setupSignaling();
            await this.setupICEServers();
            this.startKeyRotation();
        } catch (error) {
            this.handleError('Initialization failed', error);
        }
    }

    async setupSignaling() {
        this.signalingSocket = new WebSocket(this.options.signalServer);

        this.signalingSocket.on('open', () => {
            this.log('Signaling connection established');
        });

        this.signalingSocket.on('message', (message) => {
            this.handleSignalingMessage(JSON.parse(message));
        });

        this.signalingSocket.on('close', () => {
            this.handleSignalingDisconnect();
        });

        this.signalingSocket.on('error', (error) => {
            this.handleError('Signaling error', error);
        });
    }

    async setupICEServers() {
        this.iceServers = [
            ...this.options.stunServers.map(url => ({ urls: url })),
            ...this.options.turnServers.map(server => ({
                urls: server.url,
                username: server.username,
                credential: server.credential
            }))
        ];
    }

    async joinRoom(roomId, userId) {
        try {
            this.roomId = roomId;
            this.userId = userId;

            // Request local media
            this.localStream = await this.getLocalMedia();

            // Join signaling room
            this.sendSignal({
                type: 'join',
                roomId,
                userId
            });

            return this.localStream;
        } catch (error) {
            this.handleError('Join room failed', error);
            throw error;
        }
    }

    async getLocalMedia() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia(
                this.mediaConstraints
            );

            // Apply initial encoding parameters
            this.setEncodingParameters(stream);

            return stream;
        } catch (error) {
            this.handleError('Media access failed', error);
            throw error;
        }
    }

    async createPeerConnection(peerId) {
        try {
            const connection = new RTCPeerConnection({
                iceServers: this.iceServers,
                iceTransportPolicy: 'all',
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require',
                sdpSemantics: 'unified-plan'
            });

            // Add local stream
            this.localStream.getTracks().forEach(track => {
                connection.addTrack(track, this.localStream);
            });

            // Setup encryption
            const encryptionKey = await this.generateEncryptionKey();
            this.encryptionKeys.set(peerId, encryptionKey);

            // Setup event handlers
            this.setupPeerConnectionHandlers(connection, peerId);

            // Store connection
            this.connections.set(peerId, connection);

            return connection;
        } catch (error) {
            this.handleError('Peer connection creation failed', error);
            throw error;
        }
    }

    setupPeerConnectionHandlers(connection, peerId) {
        // ICE candidate handling
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal({
                    type: 'ice_candidate',
                    candidate: event.candidate,
                    peerId
                });
            }
        };

        // Connection state changes
        connection.onconnectionstatechange = () => {
            this.handleConnectionStateChange(connection, peerId);
        };

        // Track handling
        connection.ontrack = (event) => {
            this.handleRemoteTrack(event, peerId);
        };

        // Data channel handling
        connection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, peerId);
        };

        // ICE connection state
        connection.oniceconnectionstatechange = () => {
            this.handleICEStateChange(connection, peerId);
        };
    }

    async handleSignalingMessage(message) {
        try {
            switch (message.type) {
                case 'peer_joined':
                    await this.handlePeerJoined(message.peerId);
                    break;
                case 'peer_left':
                    await this.handlePeerLeft(message.peerId);
                    break;
                case 'offer':
                    await this.handleOffer(message);
                    break;
                case 'answer':
                    await this.handleAnswer(message);
                    break;
                case 'ice_candidate':
                    await this.handleICECandidate(message);
                    break;
                case 'key_exchange':
                    await this.handleKeyExchange(message);
                    break;
            }
        } catch (error) {
            this.handleError('Signaling message handling failed', error);
        }
    }

    async handlePeerJoined(peerId) {
        try {
            // Create peer connection
            const connection = await this.createPeerConnection(peerId);

            // Create data channel
            const dataChannel = connection.createDataChannel('secure-channel', {
                ordered: true
            });
            this.setupDataChannel(dataChannel, peerId);

            // Create and send offer
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);

            // Send offer with encrypted key
            this.sendSignal({
                type: 'offer',
                peerId,
                offer,
                key: await this.encryptKeyForPeer(
                    this.encryptionKeys.get(peerId),
                    peerId
                )
            });
        } catch (error) {
            this.handleError('Peer joined handling failed', error);
        }
    }

    async handleOffer(message) {
        try {
            const { peerId, offer, key } = message;

            // Create peer connection if not exists
            let connection = this.connections.get(peerId);
            if (!connection) {
                connection = await this.createPeerConnection(peerId);
            }

            // Set encryption key
            const decryptedKey = await this.decryptKeyFromPeer(key);
            this.encryptionKeys.set(peerId, decryptedKey);

            // Set remote description
            await connection.setRemoteDescription(new RTCSessionDescription(offer));

            // Create and send answer
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);

            this.sendSignal({
                type: 'answer',
                peerId,
                answer
            });
        } catch (error) {
            this.handleError('Offer handling failed', error);
        }
    }

    async handleAnswer(message) {
        try {
            const { peerId, answer } = message;
            const connection = this.connections.get(peerId);
            
            if (connection) {
                await connection.setRemoteDescription(
                    new RTCSessionDescription(answer)
                );
            }
        } catch (error) {
            this.handleError('Answer handling failed', error);
        }
    }

    async handleICECandidate(message) {
        try {
            const { peerId, candidate } = message;
            const connection = this.connections.get(peerId);
            
            if (connection) {
                await connection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            this.handleError('ICE candidate handling failed', error);
        }
    }

    handleConnectionStateChange(connection, peerId) {
        switch (connection.connectionState) {
            case 'connected':
                this.onPeerConnected(peerId);
                break;
            case 'disconnected':
            case 'failed':
                this.handleConnectionFailure(peerId);
                break;
            case 'closed':
                this.cleanupPeerConnection(peerId);
                break;
        }
    }

    async handleConnectionFailure(peerId) {
        const connection = this.connections.get(peerId);
        if (!connection) return;

        // Try to reconnect