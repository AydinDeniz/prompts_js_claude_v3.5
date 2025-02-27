class VideoUploadPlatform {
  constructor() {
    this.API_URL = '/api/videos';
    this.ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
    this.MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
    this.uploadQueue = [];
    this.currentUploads = 0;
    this.MAX_CONCURRENT_UPLOADS = 3;

    this.init();
  }

  async init() {
    this.initializeUI();
    this.setupEventListeners();
    await this.loadCategories();
    this.processUploadQueue();
  }

  initializeUI() {
    this.elements = {
      uploadForm: document.getElementById('upload-form'),
      fileInput: document.getElementById('video-file'),
      previewContainer: document.getElementById('preview-container'),
      categorySelect: document.getElementById('video-category'),
      progressContainer: document.getElementById('upload-progress'),
      uploadList: document.getElementById('upload-list'),
      errorContainer: document.getElementById('error-container')
    };

    // Initialize drag and drop zone
    this.initializeDragDrop();
  }

  setupEventListeners() {
    this.elements.uploadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleUpload();
    });

    this.elements.fileInput.addEventListener('change', (e) => {
      this.handleFileSelect(e.target.files);
    });
  }

  initializeDragDrop() {
    const dropZone = document.getElementById('drop-zone');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    dropZone.addEventListener('dragover', () => {
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      dropZone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      this.handleFileSelect(files);
    });
  }

  async loadCategories() {
    try {
      const response = await fetch(`${this.API_URL}/categories`);
      const categories = await response.json();
      this.populateCategories(categories);
    } catch (error) {
      this.showError('Failed to load categories');
    }
  }

  populateCategories(categories) {
    this.elements.categorySelect.innerHTML = `
      <option value="">Select category</option>
      ${categories.map(category => `
        <option value="${category._id}">${category.name}</option>
      `).join('')}
    `;
  }

  handleFileSelect(files) {
    Array.from(files).forEach(file => {
      if (this.validateFile(file)) {
        this.createVideoPreview(file);
      }
    });
  }

  validateFile(file) {
    if (!this.ALLOWED_VIDEO_TYPES.includes(file.type)) {
      this.showError(`Invalid file type: ${file.type}`);
      return false;
    }

    if (file.size > this.MAX_FILE_SIZE) {
      this.showError('File size exceeds maximum limit (500MB)');
      return false;
    }

    return true;
  }

  createVideoPreview(file) {
    const previewId = `preview-${Date.now()}`;
    const preview = document.createElement('div');
    preview.className = 'video-preview';
    preview.id = previewId;

    preview.innerHTML = `
      <video controls>
        <source src="${URL.createObjectURL(file)}" type="${file.type}">
      </video>
      <div class="preview-info">
        <input type="text" placeholder="Video title" required>
        <textarea placeholder="Description"></textarea>
        <select class="category-select">
          ${this.elements.categorySelect.innerHTML}
        </select>
        <button onclick="videoUploader.removePreview('${previewId}')">
          Remove
        </button>
      </div>
    `;

    this.elements.previewContainer.appendChild(preview);
    preview.dataset.file = file;
  }

  removePreview(previewId) {
    const preview = document.getElementById(previewId);
    if (preview) {
      URL.revokeObjectURL(preview.querySelector('video source').src);
      preview.remove();
    }
  }

  async handleUpload() {
    const previews = this.elements.previewContainer.querySelectorAll('.video-preview');
    
    previews.forEach(preview => {
      const uploadData = this.getUploadData(preview);
      if (uploadData) {
        this.addToUploadQueue(uploadData);
      }
    });

    this.processUploadQueue();
  }

  getUploadData(preview) {
    const title = preview.querySelector('input[type="text"]').value.trim();
    const description = preview.querySelector('textarea').value.trim();
    const categoryId = preview.querySelector('.category-select').value;
    const file = preview.dataset.file;

    if (!title || !categoryId) {
      this.showError('Title and category are required');
      return null;
    }

    return {
      file,
      metadata: {
        title,
        description,
        categoryId,
        fileType: file.type,
        fileSize: file.size
      }
    };
  }

  addToUploadQueue(uploadData) {
    const uploadId = Date.now().toString();
    this.createUploadListItem(uploadId, uploadData.metadata.title);
    
    this.uploadQueue.push({
      id: uploadId,
      ...uploadData
    });
  }

  createUploadListItem(uploadId, title) {
    const listItem = document.createElement('div');
    listItem.className = 'upload-item';
    listItem.id = `upload-${uploadId}`;
    
    listItem.innerHTML = `
      <div class="upload-info">
        <span class="upload-title">${title}</span>
        <span class="upload-status">Queued</span>
      </div>
      <div class="progress-bar">
        <div class="progress" style="width: 0%"></div>
      </div>
    `;

    this.elements.uploadList.appendChild(listItem);
  }

  async processUploadQueue() {
    while (this.uploadQueue.length > 0 && this.currentUploads < this.MAX_CONCURRENT_UPLOADS) {
      const upload = this.uploadQueue.shift();
      this.currentUploads++;
      
      try {
        await this.uploadVideo(upload);
      } catch (error) {
        this.updateUploadStatus(upload.id, 'error', error.message);
      } finally {
        this.currentUploads--;
        this.processUploadQueue();
      }
    }
  }

  async uploadVideo(upload) {
    // Get pre-signed URL for S3 upload
    const presignedUrl = await this.getPresignedUrl(upload);
    
    // Upload to S3
    await this.uploadToS3(upload, presignedUrl);
    
    // Create video record in MongoDB
    await this.createVideoRecord(upload);
    
    this.updateUploadStatus(upload.id, 'complete');
  }

  async getPresignedUrl(upload) {
    const response = await fetch(`${this.API_URL}/presigned-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: upload.metadata.title,
        fileType: upload.metadata.fileType
      })
    });

    if (!response.ok) {
      throw new Error('Failed to get upload URL');
    }

    return await response.json();
  }

  async uploadToS3(upload, presignedUrl) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = (event.loaded / event.total) * 100;
          this.updateUploadProgress(upload.id, progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          resolve();
        } else {
          reject(new Error('Upload failed'));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      xhr.open('PUT', presignedUrl.url);
      xhr.setRequestHeader('Content-Type', upload.metadata.fileType);
      xhr.send(upload.file);
    });
  }

  async createVideoRecord(upload) {
    const response = await fetch(`${this.API_URL}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...upload.metadata,
        s3Key: upload.s3Key
      })
    });

    if (!response.ok) {
      throw new Error('Failed to create video record');
    }
  }

  updateUploadProgress(uploadId, progress) {
    const uploadItem = document.getElementById(`upload-${uploadId}`);
    if (uploadItem) {
      const progressBar = uploadItem.querySelector('.progress');
      const status = uploadItem.querySelector('.upload-status');
      
      progressBar.style.width = `${progress}%`;
      status.textContent = `Uploading: ${Math.round(progress)}%`;
    }
  }

  updateUploadStatus(uploadId, status, message = '') {
    const uploadItem = document.getElementById(`upload-${uploadId}`);
    if (uploadItem) {
      const statusElement = uploadItem.querySelector('.upload-status');
      statusElement.textContent = status === 'error' ? 
        `Error: ${message}` : 'Upload Complete';
      
      uploadItem.classList.add(status);
    }
  }

  showError(message) {
    this.elements.errorContainer.textContent = message;
    this.elements.errorContainer.style.display = 'block';
    setTimeout(() => {
      this.elements.errorContainer.style.display = 'none';
    }, 5000);
  }
}

// Backend (Node.js with Express, MongoDB, and AWS S3)
const express = require('express');
const mongoose = require('mongoose');
const AWS = require('aws-sdk');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// MongoDB Schema
const videoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  s3Key: { type: String, required: true },
  fileType: { type: String, required: true },
  fileSize: { type: Number, required: true },
  status: {
    type: String,
    enum: ['processing', 'ready', 'error'],
    default: 'processing'
  },
  uploadedAt: { type: Date, default: Date.now },
  processingProgress: { type: Number, default: 0 }
});

const Video = mongoose.model('Video', videoSchema);

// API Routes
app.post('/api/videos/presigned-url', async (req, res) => {
  try {
    const fileKey = `videos/${uuidv4()}`;
    const presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: process.env.S3_BUCKET,
      Key: fileKey,
      ContentType: req.body.fileType,
      Expires: 3600 // URL expires in 1 hour
    });

    res.json({ url: presignedUrl, key: fileKey });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

app.post('/api/videos', async (req, res) => {
  try {
    const video = new Video({
      ...req.body,
      status: 'processing'
    });

    await video.save();
    
    // Trigger video processing (transcoding, thumbnail generation, etc.)
    processVideo(video._id);

    res.status(201).json(video);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create video record' });
  }
});

// Initialize platform
const videoUploader = new VideoUploadPlatform();