class CollaborativeEditor {
  constructor() {
    this.documents = new Map();
    this.users = new Map();
    this.changes = new Map();
    this.conflicts = new Map();
    this.socket = null;
    this.currentUser = null;
    
    this.init();
  }

  async init() {
    await this.setupWebSocket();
    this.initializeDatabase();
    this.setupEditor();
    this.initializeUI();
    this.setupEventListeners();
  }

  async setupWebSocket() {
    this.socket = new WebSocket('ws://localhost:8080/editor');
    
    this.socket.onmessage = (event) => {
      const update = JSON.parse(event.data);
      this.handleRealtimeUpdate(update);
    };

    this.socket.onclose = () => {
      console.log('WebSocket connection closed');
      setTimeout(() => this.setupWebSocket(), 5000);
    };
  }

  initializeDatabase() {
    this.db = new PouchDB('collaborative_editor');
    
    PouchDB.sync('collaborative_editor', 'http://localhost:5984/collaborative_editor', {
      live: true,
      retry: true
    });
  }

  setupEditor() {
    this.editor = CodeMirror(document.getElementById('editor-container'), {
      mode: 'markdown',
      theme: 'default',
      lineNumbers: true,
      lineWrapping: true,
      autofocus: true,
      extraKeys: {
        'Ctrl-S': () => this.saveDocument(),
        'Cmd-S': () => this.saveDocument()
      }
    });

    this.editor.on('change', (cm, change) => {
      if (!change.origin) return;
      this.handleEditorChange(change);
    });
  }

  initializeUI() {
    this.elements = {
      documentList: document.getElementById('document-list'),
      userList: document.getElementById('user-list'),
      commentPanel: document.getElementById('comment-panel'),
      versionHistory: document.getElementById('version-history'),
      conflictPanel: document.getElementById('conflict-panel')
    };

    this.setupToolbar();
  }

  setupToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.innerHTML = `
      <button onclick="editor.formatText('bold')">Bold</button>
      <button onclick="editor.formatText('italic')">Italic</button>
      <button onclick="editor.formatText('heading')">Heading</button>
      <button onclick="editor.insertLink()">Link</button>
      <button onclick="editor.insertImage()">Image</button>
      <select onchange="editor.changeMode(this.value)">
        <option value="markdown">Markdown</option>
        <option value="richtext">Rich Text</option>
      </select>
    `;
    document.getElementById('toolbar-container').appendChild(toolbar);
  }

  setupEventListeners() {
    document.getElementById('new-document').addEventListener('click', () => {
      this.createNewDocument();
    });

    document.getElementById('share-document').addEventListener('click', () => {
      this.shareDocument();
    });

    this.elements.documentList.addEventListener('click', (e) => {
      if (e.target.dataset.docId) {
        this.openDocument(e.target.dataset.docId);
      }
    });
  }

  async createNewDocument() {
    const doc = {
      id: `doc-${Date.now()}`,
      title: 'Untitled Document',
      content: '',
      createdAt: new Date(),
      createdBy: this.currentUser.id,
      collaborators: [this.currentUser.id],
      version: 1,
      changes: []
    };

    try {
      await this.db.put({
        _id: doc.id,
        ...doc
      });

      this.documents.set(doc.id, doc);
      this.updateDocumentList();
      this.openDocument(doc.id);
    } catch (error) {
      console.error('Failed to create document:', error);
    }
  }

  async openDocument(docId) {
    try {
      const doc = await this.db.get(docId);
      this.currentDocument = doc;
      this.editor.setValue(doc.content);
      this.loadComments(docId);
      this.loadVersionHistory(docId);
      this.broadcastPresence(docId);
    } catch (error) {
      console.error('Failed to open document:', error);
    }
  }

  handleEditorChange(change) {
    const changeObj = {
      id: `change-${Date.now()}-${this.currentUser.id}`,
      type: 'text',
      from: change.from,
      to: change.to,
      text: change.text,
      removed: change.removed,
      timestamp: new Date(),
      userId: this.currentUser.id
    };

    this.changes.set(changeObj.id, changeObj);
    this.broadcastChange(changeObj);
    this.updateVersionHistory(changeObj);
  }

  broadcastChange(change) {
    this.socket.send(JSON.stringify({
      type: 'change',
      documentId: this.currentDocument.id,
      change
    }));
  }

  handleRealtimeUpdate(update) {
    switch (update.type) {
      case 'change':
        this.applyRemoteChange(update.change);
        break;
      case 'presence':
        this.updateUserPresence(update.user);
        break;
      case 'comment':
        this.addComment(update.comment);
        break;
      case 'conflict':
        this.handleConflict(update.conflict);
        break;
    }
  }

  applyRemoteChange(change) {
    // Operational Transform to handle concurrent edits
    const transformedChange = this.transformChange(change);
    
    // Apply change to editor
    this.editor.operation(() => {
      this.editor.replaceRange(
        transformedChange.text,
        transformedChange.from,
        transformedChange.to
      );
    });
  }

  transformChange(change) {
    // Implement Operational Transform algorithm
    const pendingChanges = Array.from(this.changes.values())
      .filter(c => c.timestamp > change.timestamp);

    return pendingChanges.reduce((transformed, pending) => 
      this.transformOperations(transformed, pending),
      change
    );
  }

  transformOperations(op1, op2) {
    // Implement transformation rules for concurrent operations
    // This is a simplified version
    if (op1.from.line > op2.to.line) {
      return op1;
    }

    if (op1.from.line === op2.to.line && op1.from.ch > op2.to.ch) {
      return op1;
    }

    // Adjust positions based on previous changes
    return {
      ...op1,
      from: this.adjustPosition(op1.from, op2),
      to: this.adjustPosition(op1.to, op2)
    };
  }

  adjustPosition(pos, change) {
    if (pos.line < change.from.line) return pos;
    
    if (pos.line === change.from.line && pos.ch <= change.from.ch) {
      return pos;
    }

    const lineDiff = change.text.length - change.removed.length;
    const chDiff = change.text.join('\n').length - 
                  change.removed.join('\n').length;

    return {
      line: pos.line + lineDiff,
      ch: pos.line === change.from.line ? pos.ch + chDiff : pos.ch
    };
  }

  async saveDocument() {
    try {
      const doc = await this.db.get(this.currentDocument.id);
      
      await this.db.put({
        ...doc,
        content: this.editor.getValue(),
        version: doc.version + 1,
        lastModified: new Date(),
        lastModifiedBy: this.currentUser.id
      });

      this.showNotification('Document saved successfully');
    } catch (error) {
      console.error('Failed to save document:', error);
      this.handleSaveConflict(error);
    }
  }

  handleSaveConflict(error) {
    if (error.name === 'conflict') {
      this.resolveConflict(this.currentDocument.id);
    } else {
      this.showError('Failed to save document');
    }
  }

  async resolveConflict(docId) {
    try {
      const [localDoc, remoteDoc] = await Promise.all([
        this.db.get(docId),
        this.db.get(docId, { conflicts: true })
      ]);

      const conflict = {
        id: `conflict-${Date.now()}`,
        docId,
        local: localDoc,
        remote: remoteDoc,
        resolved: false
      };

      this.conflicts.set(conflict.id, conflict);
      this.showConflictResolution(conflict);
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  }

  showConflictResolution(conflict) {
    this.elements.conflictPanel.innerHTML = `
      <div class="conflict-resolution">
        <h3>Conflict Detected</h3>
        <div class="versions">
          <div class="local-version">
            <h4>Your Version</h4>
            <pre>${conflict.local.content}</pre>
          </div>
          <div class="remote-version">
            <h4>Remote Version</h4>
            <pre>${conflict.remote.content}</pre>
          </div>
        </div>
        <div class="resolution-actions">
          <button onclick="editor.resolveWithLocal('${conflict.id}')">
            Keep Your Version
          </button>
          <button onclick="editor.resolveWithRemote('${conflict.id}')">
            Keep Remote Version
          </button>
          <button onclick="editor.mergeVersions('${conflict.id}')">
            Merge Both
          </button>
        </div>
      </div>
    `;
  }

  async addComment(comment) {
    const docComments = this.comments.get(comment.docId) || [];
    docComments.push(comment);
    this.comments.set(comment.docId, docComments);
    
    await this.saveComment(comment);
    this.updateCommentPanel();
  }

  updateCommentPanel() {
    const comments = this.comments.get(this.currentDocument.id) || [];
    
    this.elements.commentPanel.innerHTML = `
      <div class="comments-container">
        ${comments.map(comment => `
          <div class="comment">
            <div class="comment-header">
              <span class="author">${comment.author}</span>
              <span class="timestamp">
                ${this.formatDate(comment.timestamp)}
              </span>
            </div>
            <div class="comment-content">${comment.content}</div>
            <div class="comment-actions">
              <button onclick="editor.replyToComment('${comment.id}')">
                Reply
              </button>
              ${comment.userId === this.currentUser.id ? `
                <button onclick="editor.deleteComment('${comment.id}')">
                  Delete
                </button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  formatDate(date) {
    return new Date(date).toLocaleString();
  }

  showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
}

// Initialize editor
const editor = new CollaborativeEditor();