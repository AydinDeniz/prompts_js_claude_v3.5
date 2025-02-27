class OnlineClassroom {
  constructor(classId) {
    this.classId = classId;
    this.currentUser = null;
    this.zoomMeeting = null;
    this.participants = new Map();
    this.chatMessages = [];
    this.sharedFiles = [];
    
    // Firebase Config
    this.firebaseConfig = {
      apiKey: "your-api-key",
      authDomain: "your-domain.firebaseapp.com",
      projectId: "your-project-id",
      storageBucket: "your-storage-bucket",
      messagingSenderId: "your-sender-id",
      appId: "your-app-id"
    };

    // Zoom Config
    this.zoomConfig = {
      apiKey: "your-zoom-api-key",
      apiSecret: "your-zoom-api-secret"
    };

    this.init();
  }

  async init() {
    await this.initializeFirebase();
    this.initializeUI();
    await this.setupZoomClient();
    this.setupEventListeners();
    this.setupRealtimeListeners();
  }

  async initializeFirebase() {
    firebase.initializeApp(this.firebaseConfig);
    this.db = firebase.firestore();
    this.storage = firebase.storage();
    this.auth = firebase.auth();

    // Initialize user
    await this.authenticateUser();
  }

  initializeUI() {
    this.elements = {
      videoContainer: document.getElementById('video-container'),
      participantsList: document.getElementById('participants-list'),
      chatContainer: document.getElementById('chat-container'),
      chatMessages: document.getElementById('chat-messages'),
      chatInput: document.getElementById('chat-input'),
      fileUpload: document.getElementById('file-upload'),
      filesList: document.getElementById('files-list'),
      controls: document.getElementById('meeting-controls'),
      whiteboard: document.getElementById('whiteboard'),
      errorContainer: document.getElementById('error-container')
    };

    // Initialize whiteboard
    this.initializeWhiteboard();
  }

  async setupZoomClient() {
    try {
      const ZoomMtg = await import('@zoomus/websdk');
      ZoomMtg.setZoomJSLib('https://source.zoom.us/2.9.5/lib', '/av');
      
      ZoomMtg.preLoadWasm();
      ZoomMtg.prepareWebSDK();

      this.zoomClient = ZoomMtg;
      await this.initializeZoomMeeting();
    } catch (error) {
      this.showError('Failed to initialize Zoom client');
    }
  }

  async initializeZoomMeeting() {
    try {
      const meetingData = await this.fetchMeetingDetails();
      
      this.zoomClient.init({
        leaveUrl: window.location.origin,
        success: () => {
          this.joinZoomMeeting(meetingData);
        },
        error: (error) => {
          this.showError('Failed to initialize Zoom meeting');
          console.error(error);
        }
      });
    } catch (error) {
      this.showError('Failed to fetch meeting details');
    }
  }

  async fetchMeetingDetails() {
    const response = await fetch(`/api/meetings/${this.classId}`);
    if (!response.ok) throw new Error('Failed to fetch meeting details');
    return response.json();
  }

  joinZoomMeeting(meetingData) {
    this.zoomClient.join({
      meetingNumber: meetingData.meetingNumber,
      userName: this.currentUser.displayName,
      signature: meetingData.signature,
      apiKey: this.zoomConfig.apiKey,
      passWord: meetingData.password,
      success: () => {
        this.onMeetingJoined();
      },
      error: (error) => {
        this.showError('Failed to join meeting');
        console.error(error);
      }
    });
  }

  setupEventListeners() {
    // Chat input handler
    this.elements.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendChatMessage();
      }
    });

    // File upload handler
    this.elements.fileUpload.addEventListener('change', (e) => {
      this.handleFileUpload(e.target.files);
    });

    // Meeting controls
    this.elements.controls.addEventListener('click', (e) => {
      if (e.target.matches('[data-control]')) {
        this.handleMeetingControl(e.target.dataset.control);
      }
    });
  }

  setupRealtimeListeners() {
    // Listen for participant changes
    this.db.collection(`classes/${this.classId}/participants`)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            this.addParticipant(change.doc.data());
          } else if (change.type === 'removed') {
            this.removeParticipant(change.doc.id);
          }
        });
      });

    // Listen for chat messages
    this.db.collection(`classes/${this.classId}/messages`)
      .orderBy('timestamp')
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            this.displayChatMessage(change.doc.data());
          }
        });
      });

    // Listen for file updates
    this.db.collection(`classes/${this.classId}/files`)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            this.updateFilesList(change.doc.data());
          }
        });
      });
  }

  async authenticateUser() {
    // Implement your authentication logic here
    this.currentUser = await this.auth.currentUser;
    if (!this.currentUser) {
      throw new Error('User not authenticated');
    }
  }

  onMeetingJoined() {
    this.addParticipantToFirebase();
    this.setupMeetingEventHandlers();
    this.showNotification('Successfully joined the class');
  }

  async addParticipantToFirebase() {
    await this.db.collection(`classes/${this.classId}/participants`)
      .doc(this.currentUser.uid)
      .set({
        uid: this.currentUser.uid,
        name: this.currentUser.displayName,
        role: 'student', // or 'teacher'
        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  }

  setupMeetingEventHandlers() {
    this.zoomClient.inMeetingServiceListener('onUserJoin', (data) => {
      this.updateParticipantsList(data);
    });

    this.zoomClient.inMeetingServiceListener('onUserLeave', (data) => {
      this.removeParticipant(data.userId);
    });

    this.zoomClient.inMeetingServiceListener('onUserAudioStatusChange', (data) => {
      this.updateParticipantAudioStatus(data);
    });

    this.zoomClient.inMeetingServiceListener('onUserVideoStatusChange', (data) => {
      this.updateParticipantVideoStatus(data);
    });
  }

  async sendChatMessage() {
    const message = this.elements.chatInput.value.trim();
    if (!message) return;

    try {
      await this.db.collection(`classes/${this.classId}/messages`).add({
        text: message,
        sender: {
          uid: this.currentUser.uid,
          name: this.currentUser.displayName
        },
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      this.elements.chatInput.value = '';
    } catch (error) {
      this.showError('Failed to send message');
    }
  }

  displayChatMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${
      message.sender.uid === this.currentUser.uid ? 'own-message' : ''
    }`;

    messageElement.innerHTML = `
      <div class="message-header">
        <span class="sender-name">${message.sender.name}</span>
        <span class="message-time">
          ${new Date(message.timestamp?.toDate()).toLocaleTimeString()}
        </span>
      </div>
      <div class="message-content">${this.escapeHtml(message.text)}</div>
    `;

    this.elements.chatMessages.appendChild(messageElement);
    this.scrollChatToBottom();
  }

  async handleFileUpload(files) {
    Array.from(files).forEach(async file => {
      try {
        const storageRef = this.storage.ref(`classes/${this.classId}/files/${file.name}`);
        const uploadTask = storageRef.put(file);

        this.trackUploadProgress(uploadTask, file.name);

        const snapshot = await uploadTask;
        const downloadUrl = await snapshot.ref.getDownloadURL();

        await this.saveFileMetadata(file, downloadUrl);
      } catch (error) {
        this.showError(`Failed to upload ${file.name}`);
      }
    });
  }

  trackUploadProgress(uploadTask, fileName) {
    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        this.updateUploadProgress(fileName, progress);
      }
    );
  }

  async saveFileMetadata(file, downloadUrl) {
    await this.db.collection(`classes/${this.classId}/files`).add({
      name: file.name,
      type: file.type,
      size: file.size,
      url: downloadUrl,
      uploadedBy: {
        uid: this.currentUser.uid,
        name: this.currentUser.displayName
      },
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  updateFilesList(file) {
    const fileElement = document.createElement('div');
    fileElement.className = 'file-item';
    fileElement.innerHTML = `
      <span class="file-name">${file.name}</span>
      <span class="file-uploader">Uploaded by ${file.uploadedBy.name}</span>
      <a href="${file.url}" target="_blank" class="download-button">Download</a>
    `;

    this.elements.filesList.appendChild(fileElement);
  }

  initializeWhiteboard() {
    // Initialize whiteboard using Canvas API or a third-party library
    const canvas = this.elements.whiteboard;
    this.whiteboard = new WhiteboardCanvas(canvas, {
      onChange: (data) => this.broadcastWhiteboardChanges(data)
    });
  }

  broadcastWhiteboardChanges(data) {
    // Broadcast whiteboard changes to other participants
    this.db.collection(`classes/${this.classId}/whiteboard`)
      .add({
        data,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
  }

  handleMeetingControl(action) {
    switch (action) {
      case 'mute':
        this.zoomClient.mute();
        break;
      case 'video':
        this.zoomClient.stopVideo();
        break;
      case 'share':
        this.zoomClient.shareScreen();
        break;
      case 'leave':
        this.leaveMeeting();
        break;
    }
  }

  async leaveMeeting() {
    try {
      await this.db.collection(`classes/${this.classId}/participants`)
        .doc(this.currentUser.uid)
        .delete();

      this.zoomClient.leaveMeeting();
      window.location.href = '/dashboard';
    } catch (error) {
      this.showError('Failed to leave meeting properly');
    }
  }

  showError(message) {
    this.elements.errorContainer.textContent = message;
    this.elements.errorContainer.style.display = 'block';
    setTimeout(() => {
      this.elements.errorContainer.style.display = 'none';
    }, 5000);
  }

  showNotification(message) {
    // Implement notification display
  }

  scrollChatToBottom() {
    this.elements.chatMessages.scrollTop = 
      this.elements.chatMessages.scrollHeight;
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

// Initialize classroom
const classroom = new OnlineClassroom('class-id');