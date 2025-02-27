class VirtualClassroom {
    constructor() {
        this.peers = new Map();
        this.localStream = null;
        this.whiteboard = null;
        this.messages = [];
    }

    async init() {
        this.setupUI();
        await this.initializeWebRTC();
        this.initializeWhiteboard();
        this.setupChat();
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="virtual-classroom">
                <div class="video-grid" id="video-grid"></div>
                <div class="whiteboard-container">
                    <canvas id="whiteboard"></canvas>
                    <div class="tools">
                        <button id="pen">✏️</button>
                        <button id="eraser">🧹</button>
                        <input type="color" id="color-picker">
                        <input type="range" id="brush-size" min="1" max="20">
                        <button id="clear">Clear</button>
                    </div>
                </div>
                <div class="chat-container">
                    <div id="chat-messages"></div>
                    <input type="text" id="chat-input" placeholder="Type a message...">
                </div>
            </div>
        `;
        document.body.appendChild(container);
    }

    async initializeWebRTC() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            const localVideo = document.createElement('video');
            localVideo.muted = true;
            localVideo.srcObject = this.localStream;
            localVideo.play();
            
            document.getElementById('video-grid').appendChild(localVideo);
            
            this.setupSignaling();
        } catch (error) {
            console.error('Media device error:', error);
        }
    }

    initializeWhiteboard() {
        this.whiteboard = new fabric.Canvas('whiteboard', {
            isDrawingMode: true,
            width: 800,
            height: 600
        });

        this.whiteboard.freeDrawingBrush.width = 5;
        this.whiteboard.freeDrawingBrush.color = '#000000';

        document.getElementById('pen').onclick = () => {
            this.whiteboard.isDrawingMode = true;
            this.whiteboard.freeDrawingBrush.width = 5;
        };

        document.getElementById('eraser').onclick = () => {
            this.whiteboard.isDrawingMode = true;
            this.whiteboard.freeDrawingBrush.width = 20;
            this.whiteboard.freeDrawingBrush.color = '#ffffff';
        };

        document.getElementById('color-picker').onchange = (e) => {
            this.whiteboard.freeDrawingBrush.color = e.target.value;
        };

        document.getElementById('brush-size').onchange = (e) => {
            this.whiteboard.freeDrawingBrush.width = parseInt(e.target.value);
        };

        document.getElementById('clear').onclick = () => {
            this.whiteboard.clear();
        };

        this.whiteboard.on('path:created', (e) => {
            this.broadcastWhiteboardUpdate(e.path);
        });
    }

    setupChat() {
        const chatInput = document.getElementById('chat-input');
        const chatMessages = document.getElementById('chat-messages');

        chatInput.onkeypress = (e) => {
            if (e.key === 'Enter' && chatInput.value.trim()) {
                const message = {
                    text: chatInput.value.trim(),
                    sender: 'Me',
                    timestamp: new Date()
                };
                this.messages.push(message);
                this.displayMessage(message);
                this.broadcastMessage(message);
                chatInput.value = '';
            }
        };
    }

    displayMessage(message) {
        const chatMessages = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        messageElement.innerHTML = `
            <span class="sender">${message.sender}</span>
            <span class="text">${message.text}</span>
            <span class="timestamp">${message.timestamp.toLocaleTimeString()}</span>
        `;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    setupSignaling() {
        this.socket = new WebSocket('wss://your-signaling-server.com');
        
        this.socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            switch(data.type) {
                case 'user-connected':
                    await this.handleUserConnected(data.userId);
                    break;
                case 'user-disconnected':
                    this.handleUserDisconnected(data.userId);
                    break;
                case 'whiteboard-update':
                    this.handleWhiteboardUpdate(data.path);
                    break;
                case 'chat-message':
                    this.handleChatMessage(data.message);
                    break;
            }
        };
    }

    broadcastWhiteboardUpdate(path) {
        this.socket.send(JSON.stringify({
            type: 'whiteboard-update',
            path: path
        }));
    }

    broadcastMessage(message) {
        this.socket.send(JSON.stringify({
            type: 'chat-message',
            message: message
        }));
    }
}

// Add styles
const styles = `
    .virtual-classroom {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 20px;
        padding: 20px;
        height: 100vh;
    }
    .video-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 10px;
    }
    .whiteboard-container {
        border: 1px solid #ccc;
        padding: 10px;
    }
    .tools {
        margin-top: 10px;
        display: flex;
        gap: 10px;
    }
    .chat-container {
        border: 1px solid #ccc;
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    #chat-messages {
        flex-grow: 1;
        overflow-y: auto;
        padding: 10px;
    }
    #chat-input {
        padding: 10px;
        border-top: 1px solid #ccc;
    }
    .message {
        margin: 5px 0;
        padding: 5px;
        background: #f5f5f5;
        border-radius: 4px;
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize
const classroom = new VirtualClassroom();
classroom.init();