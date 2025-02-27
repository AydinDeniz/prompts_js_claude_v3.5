class DistributedFileSystem {
  constructor() {
    this.files = new Map();
    this.peers = new Map();
    this.versions = new Map();
    this.conflicts = new Map();
    this.changes = new Map();
    this.currentUser = null;
    
    this.init();
  }

  async init() {
    await this.initializePeerNetwork();
    this.setupDatabase();
    this.initializeUI();
    this.setupEventListeners();
    await this.loadUserData();
    this.startSyncProcess();
  }

  async initializePeerNetwork() {
    // Initialize WebRTC peer connections
    this.peerNetwork = new PeerNetwork({
      id: this.generatePeerId(),
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      }
    });

    this.peerNetwork.on('connection', (connection) => {
      this.handlePeerConnection(connection);
    });

    this.peerNetwork.on('data', (data) => {
      this.handlePeerData(data);
    });
  }

  setupDatabase() {
    this.db = new PouchDB('distributed_files');
    
    // Setup sync with local storage for offline support
    PouchDB.sync('distributed_files', 'local_files', {
      live: true,
      retry: true
    });
  }

  initializeUI() {
    this.elements = {
      fileList: document.getElementById('file-list'),
      peerList: document.getElementById('peer-list'),
      syncStatus: document.getElementById('sync-status'),
      conflictPanel: document.getElementById('conflict-panel'),
      versionHistory: document.getElementById('version-history')
    };

    this.setupFileViewer();
  }

  setupFileViewer() {
    this.fileViewer = CodeMirror(document.getElementById('file-viewer'), {
      mode: 'text/plain',
      theme: 'monokai',
      lineNumbers: true,
      autofocus: true,
      lineWrapping: true
    });

    this.fileViewer.on('change', (cm, change) => {
      if (!change.origin) return;
      this.handleFileChange(change);
    });
  }

  setupEventListeners() {
    document.getElementById('upload-file').addEventListener('change', (e) => {
      this.handleFileUpload(e.target.files[0]);
    });

    document.getElementById('create-file').addEventListener('click', () => {
      this.createNewFile();
    });

    document.getElementById('share-file').addEventListener('click', () => {
      this.shareFile();
    });
  }

  async loadUserData() {
    try {
      const userData = await this.db.get('userData');
      this.currentUser = userData;
      await this.loadFiles();
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  }

  async loadFiles() {
    try {
      const result = await this.db.allDocs({
        include_docs: true,
        attachments: true,
        startkey: 'file:',
        endkey: 'file:\ufff0'
      });

      result.rows.forEach(row => {
        this.files.set(row.id, row.doc);
      });

      this.updateFileList();
    } catch (error) {
      console.error('Failed to load files:', error);
    }
  }

  handlePeerConnection(connection) {
    const peerId = connection.peer;
    this.peers.set(peerId, connection);

    connection.on('data', (data) => {
      this.handlePeerData(data);
    });

    connection.on('close', () => {
      this.peers.delete(peerId);
      this.updatePeerList();
    });

    this.updatePeerList();
    this.syncWithPeer(peerId);
  }

  handlePeerData(data) {
    switch (data.type) {
      case 'file_change':
        this.handleRemoteFileChange(data);
        break;
      case 'sync_request':
        this.handleSyncRequest(data);
        break;
      case 'version_update':
        this.handleVersionUpdate(data);
        break;
      case 'conflict':
        this.handleConflict(data);
        break;
    }
  }

  async handleFileUpload(file) {
    try {
      const fileData = await this.readFile(file);
      const fileId = `file:${Date.now()}`;
      
      const fileDoc = {
        _id: fileId,
        name: file.name,
        type: file.type,
        content: fileData,
        version: 1,
        created: new Date(),
        createdBy: this.currentUser.id,
        lastModified: new Date(),
        lastModifiedBy: this.currentUser.id,
        shared: []
      };

      await this.db.put(fileDoc);
      this.files.set(fileId, fileDoc);
      this.broadcastFileChange(fileId, 'create');
      this.updateFileList();
    } catch (error) {
      console.error('File upload failed:', error);
    }
  }

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  async handleFileChange(change) {
    const fileId = this.currentFile;
    if (!fileId) return;

    const file = this.files.get(fileId);
    const newContent = this.fileViewer.getValue();

    try {
      const newVersion = {
        _id: `version:${fileId}:${Date.now()}`,
        fileId,
        content: newContent,
        changes: [change],
        timestamp: new Date(),
        author: this.currentUser.id
      };

      await this.db.put(newVersion);
      this.versions.set(newVersion._id, newVersion);

      file.content = newContent;
      file.version++;
      file.lastModified = new Date();
      file.lastModifiedBy = this.currentUser.id;

      await this.db.put(file);
      this.broadcastFileChange(fileId, 'update', change);
    } catch (error) {
      console.error('Failed to save file changes:', error);
      this.handleChangeError(error);
    }
  }

  async handleRemoteFileChange(data) {
    const { fileId, change, version } = data;
    const file = this.files.get(fileId);

    if (!file) return;

    if (version <= file.version) {
      // Ignore outdated changes
      return;
    }

    try {
      if (this.hasConflict(file, change)) {
        await this.handleConflictingChanges(file, change);
      } else {
        await this.applyRemoteChange(file, change);
      }
    } catch (error) {
      console.error('Failed to handle remote change:', error);
    }
  }

  hasConflict(file, change) {
    const localChanges = this.changes.get(file._id) || [];
    return localChanges.some(localChange => 
      this.changesOverlap(localChange, change)
    );
  }

  changesOverlap(change1, change2) {
    // Check if changes affect the same region of text
    return (change1.from.line === change2.from.line &&
            change1.from.ch < change2.to.ch &&
            change2.from.ch < change1.to.ch);
  }

  async handleConflictingChanges(file, change) {
    const conflict = {
      id: `conflict:${file._id}:${Date.now()}`,
      fileId: file._id,
      localVersion: file.version,
      remoteVersion: change.version,
      localContent: file.content,
      remoteContent: this.applyChange(file.content, change),
      timestamp: new Date()
    };

    this.conflicts.set(conflict.id, conflict);
    this.showConflictResolution(conflict);
  }

  showConflictResolution(conflict) {
    this.elements.conflictPanel.innerHTML = `
      <div class="conflict-resolution">
        <h3>Conflict Detected</h3>
        <div class="versions">
          <div class="local-version">
            <h4>Your Version</h4>
            <pre>${conflict.localContent}</pre>
          </div>
          <div class="remote-version">
            <h4>Remote Version</h4>
            <pre>${conflict.remoteContent}</pre>
          </div>
        </div>
        <div class="resolution-actions">
          <button onclick="dfs.resolveConflict('${conflict.id}', 'local')">
            Keep Your Version
          </button>
          <button onclick="dfs.resolveConflict('${conflict.id}', 'remote')">
            Accept Remote Version
          </button>
          <button onclick="dfs.mergeConflict('${conflict.id}')">
            Merge Changes
          </button>
        </div>
      </div>
    `;
  }

  async resolveConflict(conflictId, choice) {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return;

    const file = this.files.get(conflict.fileId);
    const content = choice === 'local' ? 
      conflict.localContent : 
      conflict.remoteContent;

    try {
      await this.updateFileContent(file