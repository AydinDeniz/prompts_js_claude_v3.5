class CollaborativeEditor {
  constructor() {
    this.peers = new Map();
    this.editor = null;
    this.currentFile = null;
    this.changes = [];
    this.git = null;
    
    this.init();
  }

  async init() {
    this.initializeEditor();
    this.setupWebRTC();
    this.setupGit();
    this.bindEvents();
  }

  initializeEditor() {
    this.editor = monaco.editor.create(
      document.getElementById('editor-container'), {
        value: '',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: true }
    });

    this.editor.onDidChangeModelContent((event) => {
      this.handleEditorChange(event);
    });
  }

  setupWebRTC() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    this.dataChannel = this.peerConnection.createDataChannel('code', {
      ordered: true
    });

    this.dataChannel.onmessage = (event) => {
      this.handlePeerMessage(JSON.parse(event.data));
    };

    this.setupSignaling();
  }

  async setupSignaling() {
    this.socket = new WebSocket('ws://localhost:3000/signaling');

    this.socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'offer':
          await this.handleOffer(message);
          break;
        case 'answer':
          await this.handleAnswer(message);
          break;
        case 'ice-candidate':
          await this.handleIceCandidate(message);
          break;
        case 'peer-joined':
          await this.handlePeerJoined(message);
          break;
      }
    };
  }

  async setupGit() {
    try {
      this.git = new Git({
        baseDir: '/workspace',
        binary: 'git',
        maxConcurrentProcesses: 6
      });
    } catch (error) {
      console.error('Git initialization failed:', error);
    }
  }

  bindEvents() {
    document.getElementById('new-file').onclick = () => this.createNewFile();
    document.getElementById('save-file').onclick = () => this.saveFile();
    document.getElementById('commit').onclick = () => this.commitChanges();
    document.getElementById('share').onclick = () => this.shareSession();
  }

  async handleEditorChange(event) {
    const change = {
      type: 'edit',
      changes: event.changes,
      timestamp: Date.now(),
      author: this.sessionId
    };

    this.changes.push(change);
    this.broadcastChange(change);
    this.updateChangeIndicators();
  }

  broadcastChange(change) {
    if (this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({
        type: 'code-change',
        data: change
      }));
    }
  }

  async handlePeerMessage(message) {
    switch (message.type) {
      case 'code-change':
        await this.applyPeerChange(message.data);
        break;
      case 'cursor-update':
        this.updatePeerCursor(message.data);
        break;
      case 'file-request':
        this.sendFileContent(message.data);
        break;
    }
  }

  async applyPeerChange(change) {
    const currentPosition = this.editor.getPosition();
    
    this.editor.executeEdits('peer', change.changes.map(c => ({
      range: monaco.Range.fromPositions(
        this.positionFromOffset(c.rangeOffset),
        this.positionFromOffset(c.rangeOffset + c.rangeLength)
      ),
      text: c.text,
      forceMoveMarkers: true
    })));

    this.editor.setPosition(currentPosition);
  }

  updatePeerCursor(data) {
    const { peerId, position } = data;
    let decoration = this.peers.get(peerId)?.decoration;

    if (!decoration) {
      decoration = {
        id: `cursor-${peerId}`,
        options: {
          className: 'peer-cursor',
          hoverMessage: { value: `Cursor: ${peerId}` }
        }
      };
      this.peers.set(peerId, { decoration });
    }

    this.editor.deltaDecorations(
      [decoration.id],
      [{
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column + 1
        ),
        options: decoration.options
      }]
    );
  }

  async createNewFile() {
    const filename = prompt('Enter file name:');
    if (!filename) return;

    this.currentFile = {
      name: filename,
      content: ''
    };

    this.editor.setValue('');
    this.updateFileTree();
  }

  async saveFile() {
    if (!this.currentFile) return;

    const content = this.editor.getValue();
    
    try {
      await this.git.write(this.currentFile.name, content);
      this.showNotification('File saved successfully');
    } catch (error) {
      this.showError('Failed to save file');
    }
  }

  async commitChanges() {
    if (!this.git) return;

    const message = prompt('Enter commit message:');
    if (!message) return;

    try {
      await this.git.add('.');
      await this.git.commit(message);
      this.showNotification('Changes committed successfully');
    } catch (error) {
      this.showError('Failed to commit changes');
    }
  }

  async shareSession() {
    const sessionId = crypto.randomUUID();
    
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.socket.send(JSON.stringify({
        type: 'create-session',
        sessionId,
        offer
      }));

      this.showNotification(`Session ID: ${sessionId}`);
    } catch (error) {
      this.showError('Failed to create sharing session');
    }
  }

  async joinSession(sessionId) {
    try {
      this.socket.send(JSON.stringify({
        type: 'join-session',
        sessionId
      }));
    } catch (error) {
      this.showError('Failed to join session');
    }
  }

  async handleOffer(message) {
    try {
      await this.peerConnection.setRemoteDescription(message.offer);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.socket.send(JSON.stringify({
        type: 'answer',
        sessionId: message.sessionId,
        answer
      }));
    } catch (error) {
      this.showError('Failed to handle offer');
    }
  }

  async handleAnswer(message) {
    try {
      await this.peerConnection.setRemoteDescription(message.answer);
    } catch (error) {
      this.showError('Failed to handle answer');
    }
  }

  async handleIceCandidate(message) {
    try {
      await this.peerConnection.addIceCandidate(message.candidate);
    } catch (error) {
      this.showError('Failed to handle ICE candidate');
    }
  }

  showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  showError(message) {
    this.showNotification(`Error: ${message}`);
  }

  positionFromOffset(offset) {
    return this.editor.getModel().getPositionAt(offset);
  }

  updateChangeIndicators() {
    const decorations = this.changes.map(change => ({
      range: new monaco.Range(
        change.lineNumber,
        1,
        change.lineNumber,
        1
      ),
      options: {
        isWholeLine: true,
        className: `change-indicator ${change.author === this.sessionId ? 'self' : 'peer'}`
      }
    }));

    this.editor.deltaDecorations([], decorations);
  }
}

// Initialize editor
const editor = new CollaborativeEditor();