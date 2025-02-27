class ImageGallery {
    constructor() {
        this.images = [];
        this.uploadQueue = new Map();
        this.draggedItem = null;
    }

    init() {
        this.setupUI();
        this.bindEvents();
        this.loadExistingImages();
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="image-gallery">
                <div class="upload-section">
                    <div class="upload-zone" id="upload-zone">
                        <input type="file" id="file-input" multiple accept="image/*" style="display: none;">
                        <div class="upload-prompt">
                            <i class="fas fa-cloud-upload-alt"></i>
                            <p>Drag & Drop images here or click to select</p>
                        </div>
                    </div>
                    <div class="upload-progress" id="upload-progress"></div>
                </div>
                
                <div class="preview-section">
                    <h3>Preview</h3>
                    <div class="image-grid" id="image-grid"></div>
                </div>
                
                <div class="gallery-actions">
                    <button id="upload-all" class="primary-button">Upload All</button>
                    <button id="clear-all" class="secondary-button">Clear All</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        this.addStyles();
    }

    addStyles() {
        const styles = `
            .image-gallery {
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
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

            .image-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 20px;
                margin-top: 20px;
            }

            .image-item {
                position: relative;
                padding-bottom: 100%;
                background: #f0f0f0;
                border-radius: 8px;
                overflow: hidden;
                cursor: move;
            }

            .image-item img {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .image-item .remove-image {
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(255, 0, 0, 0.8);
                color: white;
                border: none;
                border-radius: 50%;
                width: 24px;
                height: 24px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .upload-progress {
                margin-top: 20px;
            }

            .progress-item {
                display: flex;
                align-items: center;
                margin-bottom: 10px;
                padding: 10px;
                background: white;
                border-radius: 4px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }

            .progress-bar {
                flex-grow: 1;
                height: 4px;
                background: #eee;
                border-radius: 2px;
                margin: 0 10px;
            }

            .progress-bar-fill {
                height: 100%;
                background: #4CAF50;
                border-radius: 2px;
                transition: width 0.3s ease;
            }

            .gallery-actions {
                margin-top: 20px;
                display: flex;
                gap: 10px;
            }

            .primary-button {
                background: #2196F3;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
            }

            .secondary-button {
                background: #f44336;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
            }

            .dragging {
                opacity: 0.5;
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        const uploadZone = document.getElementById('upload-zone');
        const fileInput = document.getElementById('file-input');
        const imageGrid = document.getElementById('image-grid');

        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        uploadZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        uploadZone.addEventListener('drop', (e) => this.handleDrop(e));
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        document.getElementById('upload-all').addEventListener('click', () => this.uploadAll());
        document.getElementById('clear-all').addEventListener('click', () => this.clearAll());

        // Drag and drop reordering
        imageGrid.addEventListener('dragstart', (e) => this.handleDragStart(e));
        imageGrid.addEventListener('dragend', (e) => this.handleDragEnd(e));
        imageGrid.addEventListener('dragover', (e) => this.handleGridDragOver(e));
        imageGrid.addEventListener('drop', (e) => this.handleGridDrop(e));
    }

    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
    }

    handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        
        const files = Array.from(e.dataTransfer.files).filter(file => 
            file.type.startsWith('image/'));
        this.processFiles(files);
    }

    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.processFiles(files);
        e.target.value = ''; // Reset file input
    }

    processFiles(files) {
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const image = {
                    id: Date.now() + Math.random().toString(36).substr(2, 9),
                    file: file,
                    preview: e.target.result,
                    status: 'pending'
                };
                this.images.push(image);
                this.renderPreview(image);
            };
            reader.readAsDataURL(file);
        });
    }

    renderPreview(image) {
        const imageGrid = document.getElementById('image-grid');
        const imageItem = document.createElement('div');
        imageItem.className = 'image-item';
        imageItem.draggable = true;
        imageItem.dataset.imageId = image.id;
        
        imageItem.innerHTML = `
            <img src="${image.preview}" alt="Preview">
            <button class="remove-image" data-image-id="${image.id}">×</button>
        `;

        imageGrid.appendChild(imageItem);
        
        imageItem.querySelector('.remove-image').addEventListener('click', () => 
            this.removeImage(image.id));
    }

    removeImage(imageId) {
        this.images = this.images.filter(img => img.id !== imageId);
        document.querySelector(`[data-image-id="${imageId}"]`).remove();
    }

    handleDragStart(e) {
        const imageItem = e.target.closest('.image-item');
        if (!imageItem) return;
        
        this.draggedItem = imageItem;
        imageItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDragEnd(e) {
        if (!this.draggedItem) return;
        this.draggedItem.classList.remove('dragging');
        this.draggedItem = null;
    }

    handleGridDragOver(e) {
        e.preventDefault();
        const imageItem = e.target.closest('.image-item');
        if (!imageItem || imageItem === this.draggedItem) return;

        const rect = imageItem.getBoundingClientRect();
        const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
        
        if (next) {
            imageItem.parentNode.insertBefore(this.draggedItem, imageItem.nextSibling);
        } else {
            imageItem.parentNode.insertBefore(this.draggedItem, imageItem);
        }
    }

    handleGridDrop(e) {
        e.preventDefault();
        this.updateImageOrder();
    }

    updateImageOrder() {
        const imageGrid = document.getElementById('image-grid');
        const newOrder = Array.from(imageGrid.children).map(item => 
            this.images.find(img => img.id === item.dataset.imageId));
        this.images = newOrder;
    }

    async uploadAll() {
        const pendingImages = this.images.filter(img => img.status === 'pending');
        
        for (const image of pendingImages) {
            await this.uploadImage(image);
        }
    }

    async uploadImage(image) {
        const formData = new FormData();
        formData.append('image', image.file);
        formData.append('position', this.images.indexOf(image));

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Upload failed');

            image.status = 'uploaded';
            this.updateUploadProgress(image.id, 100);
        } catch (error) {
            console.error('Upload error:', error);
            image.status = 'error';
            this.updateUploadProgress(image.id, 0, true);
        }
    }

    updateUploadProgress(imageId, progress, error = false) {
        const imageItem = document.querySelector(`[data-image-id="${imageId}"]`);
        if (!imageItem) return;

        imageItem.style.opacity = error ? 0.5 : 1;
        // Update progress indicator if needed
    }

    clearAll() {
        this.images = [];
        document.getElementById('image-grid').innerHTML = '';
    }

    async loadExistingImages() {
        try {
            const response = await fetch('/api/images');
            const images = await response.json();
            
            images.forEach(image => {
                this.images.push({
                    id: image.id,
                    preview: image.url,
                    status: 'uploaded'
                });
                this.renderPreview(this.images[this.images.length - 1]);
            });
        } catch (error) {
            console.error('Failed to load existing images:', error);
        }
    }
}

// Initialize
const gallery = new ImageGallery();
gallery.init();