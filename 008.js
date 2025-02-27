const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static('public'));

// Store active users and their connections
const activeUsers = new Map();

// Message history
const messageHistory = [];
const MAX_HISTORY = 50;

class ChatServer {
  constructor(wss) {
    this.wss = wss;
    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws) => {
      const userId = uuidv4();
      ws.userId = userId;

      this.handleNewConnection(ws);
      this.setupMessageHandler(ws);
      this.setupDisconnection(ws);
      this.setupHeartbeat(ws);
    });
  }

  handleNewConnection(ws) {
    ws.isAlive = true;

    // Send connection acknowledgment
    ws.send(JSON.stringify({
      type: 'connection_ack',
      userId: ws.userId,
      timestamp: Date.now()
    }));

    // Send message history
    ws.send(JSON.stringify({
      type: 'history',
      messages: messageHistory
    }));
  }

  setupMessageHandler(ws) {
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        switch (message.type) {
          case 'join':
            this.handleUserJoin(ws, message);
            break;
          case 'chat':
            this.handleChatMessage(ws, message);
            break;
          case 'typing':
            this.handleTypingStatus(ws, message);
            break;
          case 'pong':
            ws.isAlive = true;
            break;
          default:
            console.log('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Message handling error:', error);
      }
    });
  }

  handleUserJoin(ws, message) {
    const userData = {
      id: ws.userId,
      username: message.username,
      connection: ws
    };

    activeUsers.set(ws.userId, userData);

    // Broadcast user joined message
    this.broadcast({
      type: 'user_joined',
      userId: ws.userId,
      username: message.username,
      timestamp: Date.now(),
      activeUsers: this.getActiveUsersList()
    });
  }

  handleChatMessage(ws, message) {
    const user = activeUsers.get(ws.userId);
    if (!user) return;

    const chatMessage = {
      type: 'chat',
      id: uuidv4(),
      userId: ws.userId,
      username: user.username,
      content: message.content,
      timestamp: Date.now()
    };

    // Store message in history
    messageHistory.push(chatMessage);
    if (messageHistory.length > MAX_HISTORY) {
      messageHistory.shift();
    }

    // Broadcast message
    this.broadcast(chatMessage);
  }

  handleTypingStatus(ws, message) {
    const user = activeUsers.get(ws.userId);
    if (!user) return;

    this.broadcast({
      type: 'typing',
      userId: ws.userId,
      username: user.username,
      isTyping: message.isTyping
    }, ws); // Exclude sender
  }

  setupDisconnection(ws) {
    ws.on('close', () => {
      const user = activeUsers.get(ws.userId);
      if (user) {
        activeUsers.delete(ws.userId);

        // Broadcast user left message
        this.broadcast({
          type: 'user_left',
          userId: ws.userId,
          username: user.username,
          timestamp: Date.now(),
          activeUsers: this.getActiveUsersList()
        });
      }
    });
  }

  setupHeartbeat(ws) {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  }

  broadcast(message, excludeWs = null) {
    this.wss.clients.forEach((client) => {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  getActiveUsersList() {
    return Array.from(activeUsers.values()).map(user => ({
      id: user.id,
      username: user.username
    }));
  }
}

// Initialize chat server
const chatServer = new ChatServer(wss);

// Heartbeat interval
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Client-side code (public/index.html)
`
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Chat</title>
    <style>
        .chat-container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        .messages {
            height: 400px;
            overflow-y: auto;
            border: 1px solid #ccc;
            padding: 10px;
            margin-bottom: 20px;
        }
        .user-list {
            float: right;
            width: 200px;
            border: 1px solid #ccc;
            padding: 10px;
        }
        .typing-indicator {
            font-style: italic;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="user-list" id="userList">
            <h3>Active Users</h3>
            <ul id="activeUsers"></ul>
        </div>
        <div class="messages" id="messages"></div>
        <div class="typing-indicator" id="typingIndicator"></div>
        <input type="text" id="messageInput" placeholder="Type a message...">
        <button onclick="sendMessage()">Send</button>
    </div>
    <script src="chat.js"></script>
</body>
</html>
`

// Client-side code (public/chat.js)
`
class ChatClient {
    constructor() {
        this.ws = null;
        this.userId = null;
        this.username = null;
        this.typingTimeout = null;
        this.setupWebSocket();
        this.setupEventListeners();
    }

    setupWebSocket() {
        this.ws = new WebSocket(\`ws://\${window.location.host}\`);
        
        this.ws.onopen = () => {
            this.promptUsername();
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };

        this.ws.onclose = () => {
            console.log('Connection closed');
            setTimeout(() => this.setupWebSocket(), 5000);
        };
    }

    setupEventListeners() {
        const messageInput = document.getElementById('messageInput');
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
            this.handleTyping();
        });
    }

    promptUsername() {
        const username = prompt('Enter your username:');
        if (username) {
            this.username = username;
            this.sendJoinMessage(username);
        } else {
            this.promptUsername();
        }
    }

    sendJoinMessage(username) {
        this.send({
            type: 'join',
            username: username
        });
    }

    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const content = messageInput.value.trim();
        
        if (content) {
            this.send({
                type: 'chat',
                content: content
            });
            messageInput.value = '';
        }
    }

    handleTyping() {
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }

        this.send({
            type: 'typing',
            isTyping: true
        });

        this.typingTimeout = setTimeout(() => {
            this.send({
                type: 'typing',
                isTyping: false
            });
        }, 1000);
    }

    handleMessage(message) {
        switch (message.type) {
            case 'connection_ack':
                this.userId = message.userId;
                break;
            case 'chat':
                this.displayMessage(message);
                break;
            case 'user_joined':
            case 'user_left':
                this.updateUserList(message.activeUsers);
                this.displaySystemMessage(message);
                break;
            case 'typing':
                this.updateTypingIndicator(message);
                break;
            case 'history':
                this.displayMessageHistory(message.messages);
                break;
        }
    }

    displayMessage(message) {
        const messages = document.getElementById('messages');
        const messageElement = document.createElement('div');
        messageElement.innerHTML = \`
            <strong>\${message.username}:</strong> 
            \${this.escapeHtml(message.content)}
            <small>\${new Date(message.timestamp).toLocaleTimeString()}</small>
        \`;
        messages.appendChild(messageElement);
        messages.scrollTop = messages.scrollHeight;
    }

    displaySystemMessage(message) {
        const messages = document.getElementById('messages');
        const messageElement = document.createElement('div');
        messageElement.style.color = '#666';
        messageElement.innerHTML = \`
            <em>\${message.username} \${message.type === 'user_joined' ? 'joined' : 'left'} the chat</em>
            <small>\${new Date(message.timestamp).toLocaleTimeString()}</small>
        \`;
        messages.appendChild(messageElement);
    }

    displayMessageHistory(messages) {
        const messagesDiv = document.getElementById('messages');
        messagesDiv.innerHTML = '';
        messages.forEach(message => this.displayMessage(message));
    }

    updateUserList(users) {
        const userList = document.getElementById('activeUsers');
        userList.innerHTML = users
            .map(user => \`<li>\${this.escapeHtml(user.username)}</li>\`)
            .join('');
    }

    updateTypingIndicator(message) {
        const indicator = document.getElementById('typingIndicator');
        if (message.isTyping && message.userId !== this.userId) {
            indicator.textContent = \`\${message.username} is typing...\`;
        } else {
            indicator.textContent = '';
        }
    }

    send(message) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// Initialize chat client
const chat = new ChatClient();
`