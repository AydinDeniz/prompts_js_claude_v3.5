class FileUploadManager {
    constructor(options = {}) {
        this.options = {
            allowedTypes: options.allowedTypes || {
                images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
                documents: ['application/pdf', 'application/msword', 
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                          'application/vnd.ms-excel',
                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            },
            maxFileSize: options.maxFileSize || 5 * 1024 * 1024, // 5MB
            maxTotalSize: options.maxTotalSize || 50 * 1024 * 1024, // 50MB
            uploadEndpoint: options.uploadEndpoint || '/api/upload',
            chunkedUpload: options.chunkedUpload !== false,
            chunkSize: options.chunkSize || 1024 * 1024, // 1MB chunks
            concurrent: options.concurrent || 3,
            compression: options.compression || {
                images: true,
                quality: 0.8
            }
        };

        this.uploads = new Map();
        this.totalUploaded = 0;
        this.uploadQueue = [];
    }

    init() {
        this.setupUI();
        this.bindEvents();
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="file-upload-container">
                <div class="upload-zone" id="uploadZone">
                    <div class="upload-prompt">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <p>Drag & Drop files here or click to select</p>
                        <p class="upload-limits">
                            Max file size: ${this.formatSize(this.options.maxFileSize)}<br>
                            Allowed types: ${this.getAllowedExtensions().join(', ')}
                        </p>
                    </div>
                    <input type="file" id="fileInput" multiple style="display: none">
                </div>

                <div class="upload-list" id="uploadList"></div>

                <div class="upload-controls">
                    <button id="startUpload" disabled>Start Upload</button>
                    <button id="cancelAll">Cancel All</button>
                </div>

                <div class="upload-progress">
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                    </div>
                    <div class="progress-text">0% Complete</div>
                </div>
            </div>
        `;

        document.body.appendChild(container);
        this.addStyles();
    }

    addStyles() {
        const styles = `
            .file-upload-container {
                max-width: 800px;
                margin: 20px auto;
                padding: 20px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }

            .upload-zone {
                border: 2px dashed #ccc;
                border-radius: 8px;
                padding: 40px;
                text-align: center;
                background: #f9f9f9;
                cursor: pointer;
                transition: all 0.3s ease;
            }

            .upload-zone.drag-over {
                background: #e3f2fd;
                border-color: #2196F3;
            }

            .upload-prompt i {
                font-size: 48px;
                color: #666;
                margin-bottom: 15px;
            }

            .upload-limits {
                font-size: 12px;
                color: #666;
                margin-top: 10px;
            }

            .upload-list {
                margin-top: 20px;
            }

            .upload-item {
                display: flex;
                align-items: center;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 4px;
                margin-bottom: 10px;
                background: white;
            }

            .file-icon {
                width: 40px;
                height: 40px;
                margin-right: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #f5f5f5;
                border-radius: 4px;
            }

            .file-info {
                flex-grow: 1;
            }

            .file-name {
                font-weight: bold;
                margin-bottom: 5px;
            }

            .file-meta {
                font-size: 12px;
                color: #666;
            }

            .file-actions {
                display: flex;
                gap: 10px;
            }

            .progress-bar {
                height: 4px;
                background: #f0f0f0;
                border-radius: 2px;
                margin: 5px 0;
                overflow: hidden;
            }

            .progress-fill {
                height: 100%;
                background: #4CAF50;
                width: 0;
                transition: width 0.3s ease;
            }

            .upload-controls {
                margin: 20px 0;
                display: flex;
                gap: 10px;
            }

            button {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                transition: background 0.3s ease;
            }

            #startUpload {
                background: #4CAF50;
                color: white;
            }

            #startUpload:disabled {
                background: #ccc;
                cursor: not-allowed;
            }

            #cancelAll {
                background: #f44336;
                color: white;
            }

            .error {
                color: #f44336;
                font-size: 12px;
                margin-top: 5px;
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const startButton = document.getElementById('startUpload');
        const cancelButton = document.getElementById('cancelAll');

        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', e => this.handleDragOver(e));
        uploadZone.addEventListener('dragleave', e => this.handleDragLeave(e));
        uploadZone.addEventListener('drop', e => this.handleDrop(e));

        fileInput.addEventListener('change', e => this.handleFileSelect(e));
        startButton.addEventListener('click', () => this.startUploads());
        cancelButton.addEventListener('click', () => this.cancelAll());
    }

    handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.add('drag-over');
    }

    handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');
    }

    handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');

        const files = Array.from(event.dataTransfer.files);
        this.processFiles(files);
    }

    handleFileSelect(event) {
        const files = Array.from(event.target.files);
        this.processFiles(files);
        event.target.value = ''; // Reset input
    }

    async processFiles(files) {
        for (const file of files) {
            try {
                await this.validateFile(file);
                const upload = this.createUpload(file);
                this.uploads.set(upload.id, upload);
                this.renderUpload(upload);
            } catch (error) {
                this.showError(file.name, error.message);
            }
        }

        this.updateStartButton();
    }

    async validateFile(file) {
        // Check file size
        if (file.size > this.options.maxFileSize) {
            throw new Error(`File size exceeds ${this.formatSize(this.options.maxFileSize)}`);
        }

        // Check total upload size
        if (this.totalUploaded + file.size > this.options.maxTotalSize) {
            throw new Error('Total upload size limit exceeded');
        }

        // Check file type
        if (!this.isAllowedType(file.type)) {
            throw new Error('File type not allowed');
        }

        // Check file content (magic numbers)
        await this.validateFileContent(file);
    }

    async validateFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const arr = new Uint8Array(reader.result);
                const header = Array.from(arr.slice(0, 4))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');

                if (!this.isValidMagicNumber(header, file.type)) {
                    reject(new Error('Invalid file content'));
                }
                resolve();
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file.slice(0, 4));
        });
    }

    isValidMagicNumber(header, type) {
        const signatures = {
            'image/jpeg': ['ffd8ff'],
            'image/png': ['89504e47'],
            'image/gif': ['47494638'],
            'application/pdf': ['25504446'],
            // Add more signatures as needed
        };

        return !signatures[type] || signatures[type].some(sig => header.startsWith(sig));
    }

    createUpload(file) {
        const upload = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            file,
            progress: 0,
            status: 'pending',
            chunks: [],
            uploadedChunks: 0
        };

        if (this.options.chunkedUpload) {
            upload.chunks = this.createChunks(file);
        }

        return upload;
    }

    createChunks(file) {
        const chunks = [];
        let offset = 0;
        
        while (offset < file.size) {
            chunks.push({
                start: offset,
                end: Math.min(offset + this.options.chunkSize, file.size)
            });
            offset += this.options.chunkSize;
        }

        return chunks;
    }

    renderUpload(upload) {
        const list = document.getElementById('uploadList');
        const item = document.createElement('div');
        item.className = 'upload-item';
        item.dataset.uploadId = upload.id;

        item.innerHTML = `
            <div class="file-icon">
                <i class="fas ${this.getFileIcon(upload.file.type)}"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${upload.file.name}</div>
                <div class="file-meta">
                    ${this.formatSize(upload.file.size)} • ${this.getFileType(upload.file.type)}
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
            </div>
            <div class="file-actions">
                <button class="cancel-upload">Cancel</button>
            </div>
        `;

        list.appendChild(item);

        item.querySelector('.cancel-upload').addEventListener('click', () => 
            this.cancelUpload(upload.id));
    }

    async startUploads() {
        const pending = Array.from(this.uploads.values())
            .filter(upload => upload.status === 'pending');

        const chunks = [];
        for (const upload of pending) {
            if (this.options.chunkedUpload) {
                chunks.push(...upload.chunks.map(chunk => ({
                    uploadId: upload.id,
                    chunk
                })));
            } else {
                chunks.push({ uploadId: upload.id });
            }
        }

        // Process chunks with concurrency limit
        const concurrent = this.options.concurrent;
        while (chunks.length > 0) {
            const batch = chunks.splice(0, concurrent);
            await Promise.all(batch.map(item => this.processChunk(item)));
        }
    }

    async processChunk({ uploadId, chunk }) {
        const upload = this.uploads.get(uploadId);
        if (!upload || upload.status === 'cancelled') return;

        try {
            const file = upload.file;
            let data;

            if (chunk) {
                data = file.slice(chunk.start, chunk.end);
            } else {
                data = file;
            }

            // Compress if needed
            if (this.shouldCompress(file)) {
                data = await this.compressFile(data);
            }

            const formData = new Form