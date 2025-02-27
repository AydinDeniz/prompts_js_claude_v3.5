class CollaborativeEditor {
  constructor(documentId) {
    this.documentId = documentId;
    this.currentUser = null;
    this.collaborators = new Map();
    this.version = 0;
    this.pendingOperations = [];
    this.isProcessing = false;

    // Firebase config
    this.firebaseConfig = {
      // Your Firebase configuration
      apiKey: "your-api-key",
      authDomain: "your-domain.firebaseapp.com",
      projectId: "your-project-id",
      databaseURL: "your-database-url"
    };

    this.init();
  }

  async init() {
    await this.initializeFirebase();
    this.initializeWebSocket();
    this.initializeEditor();
    this.setupEventListeners();
    await this.loadDocument();
  }

  async initializeFirebase() {
    firebase.initializeApp(this.firebaseConfig);
    this.db = firebase.firestore();
    this.auth = firebase.auth();
    
    // Initialize user
    await this.authenticateUser();
  }

  initializeWebSocket() {
    this.ws = new WebSocket(`wss://your-websocket-server.com/doc/${this.documentId}`);
    
    this.ws.onopen = () => {
      this.sendOperation({
        type: 'join',
        userId: this.currentUser.uid,
        username: this.currentUser.displayName
      });
    };

    this.ws.onmessage = (event) => {
      const operation = JSON.parse(event.data);
      this.handleOperation(operation);
    };

    this.ws.onclose = () => {
      setTimeout(() => this.initializeWebSocket(), 1000);
    };
  }

  initializeEditor() {
    this.editor = new QuillEditor('#editor', {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ 'header': [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['link', 'blockquote', 'code-block'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }]
        ],
        history: {
          userOnly: true
        }
      }
    });

    // Track cursor positions
    this.cursors = {};
  }

  setupEventListeners() {
    this.editor.on('text-change', (delta, oldDelta, source) => {
      if (source === 'user') {
        this.handleLocalChange(delta);
      }
    });

    this.editor.on('selection-change', (range) => {
      if (range) {
        this.broadcastCursorPosition(range);
      }
    });

    // Handle permissions changes
    this.db.collection('permissions')
      .doc(this.documentId)
      .onSnapshot((snapshot) => {
        this.updatePermissions(snapshot.data());
      });
  }

  async authenticateUser() {
    // Implement your authentication logic here
    this.currentUser = await this.auth.currentUser;
    if (!this.currentUser) {
      throw new Error('User not authenticated');
    }
  }

  async loadDocument() {
    try {
      const docRef = this.db.collection('documents').doc(this.documentId);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error('Document not found');
      }

      const data = doc.data();
      this.version = data.version;
      this.editor.setContents(data.content);

      // Subscribe to real-time updates
      this.subscribeToUpdates();
    } catch (error) {
      console.error('Error loading document:', error);
    }
  }

  subscribeToUpdates() {
    this.db.collection('documents')
      .doc(this.documentId)
      .onSnapshot((snapshot) => {
        const data = snapshot.data();
        this.handleRemoteUpdate(data);
      });
  }

  handleLocalChange(delta) {
    const operation = {
      type: 'change',
      userId: this.currentUser.uid,
      version: this.version,
      delta: delta,
      timestamp: Date.now()
    };

    this.pendingOperations.push(operation);
    this.processOperations();
  }

  async processOperations() {
    if (this.isProcessing || this.pendingOperations.length === 0) {
      return;
    }

    this.isProcessing = true;
    const operation = this.pendingOperations.shift();

    try {
      await this.sendOperation(operation);
      this.version++;
      
      // Save to version history
      await this.saveVersion(operation);
    } catch (error) {
      console.error('Error processing operation:', error);
      this.pendingOperations.unshift(operation);
    } finally {
      this.isProcessing = false;
      this.processOperations();
    }
  }

  async sendOperation(operation) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(operation));
    }
  }

  async handleOperation(operation) {
    switch (operation.type) {
      case 'change':
        await this.handleRemoteChange(operation);
        break;
      case 'cursor':
        this.updateCollaboratorCursor(operation);
        break;
      case 'join':
      case 'leave':
        this.updateCollaborators(operation);
        break;
    }
  }

  async handleRemoteChange(operation) {
    if (operation.userId === this.currentUser.uid) {
      return;
    }

    if (operation.version !== this.version) {
      await this.resolveConflict(operation);
      return;
    }

    this.applyChange(operation.delta);
    this.version++;
  }

  async resolveConflict(operation) {
    try {
      const transformedDelta = this.transformDelta(
        operation.delta,
        this.pendingOperations
      );
      this.applyChange(transformedDelta);
    } catch (error) {
      console.error('Conflict resolution failed:', error);
      await this.reloadDocument();
    }
  }

  applyChange(delta) {
    this.editor.updateContents(delta, 'silent');
  }

  transformDelta(delta, operations) {
    // Implement Operational Transform logic here
    return delta;
  }

  broadcastCursorPosition(range) {
    this.sendOperation({
      type: 'cursor',
      userId: this.currentUser.uid,
      username: this.currentUser.displayName,
      range: range
    });
  }

  updateCollaboratorCursor(operation) {
    if (operation.userId === this.currentUser.uid) {
      return;
    }

    let cursor = this.cursors[operation.userId];
    if (!cursor) {
      cursor = this.createCursorElement(operation);
      this.cursors[operation.userId] = cursor;
    }

    this.updateCursorPosition(cursor, operation.range);
  }

  createCursorElement(operation) {
    const cursor = document.createElement('div');
    cursor.className = 'collaborator-cursor';
    cursor.style.backgroundColor = this.getRandomColor();
    
    const label = document.createElement('div');
    label.className = 'collaborator-label';
    label.textContent = operation.username;
    cursor.appendChild(label);

    document.querySelector('.ql-editor').appendChild(cursor);
    return cursor;
  }

  updateCursorPosition(cursor, range) {
    const bounds = this.editor.getBounds(range.index, range.length);
    cursor.style.top = bounds.top + 'px';
    cursor.style.left = bounds.left + 'px';
    cursor.style.height = bounds.height + 'px';
  }

  async saveVersion(operation) {
    try {
      await this.db.collection('versions').add({
        documentId: this.documentId,
        userId: this.currentUser.uid,
        operation: operation,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Error saving version:', error);
    }
  }

  async updatePermissions(permissions) {
    const userPermission = permissions[this.currentUser.uid];
    this.editor.enable(userPermission === 'write');
    
    // Update UI based on permissions
    this.updateUIPermissions(userPermission);
  }

  updateUIPermissions(permission) {
    const toolbar = document.querySelector('.ql-toolbar');
    toolbar.style.display = permission === 'write' ? 'block' : 'none';
  }

  getRandomColor() {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1',
      '#96CEB4', '#FFEEAD', '#D4A5A5'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  destroy() {
    this.ws.close();
    this.editor.destroy();
    // Cleanup Firebase listeners
    this.unsubscribeFromUpdates && this.unsubscribeFromUpdates();
  }
}

// CSS styles
`
.collaborator-cursor {
  position: absolute;
  width: 2px;
  pointer-events: none;
  transition: all 0.1s ease;
}

.collaborator-label {
  position: absolute;
  top: -20px;
  left: 0;
  background: inherit;
  padding: 2px 4px;
  border-radius: 3px;
  color: white;
  font-size: 12px;
  white-space: nowrap;
}

.ql-editor {
  position: relative;
  min-height: 300px;
}

.version-history {
  position: fixed;
  right: 0;
  top: 0;
  width: 300px;
  height: 100%;
  background: #f8f9fa;
  padding: 20px;
  box-shadow: -2px 0 5px rgba(0,0,0,0.1);
}

.permission-indicator {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 8px 12px;
  border-radius: 4px;
  background: #e9ecef;
  font-size: 14px;
}
`

// Initialize editor
const editor = new CollaborativeEditor('document-id');

// Cleanup on page unload
window.addEventListener('unload', () => {
  editor.destroy();
});
