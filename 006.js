class ImageCompressor {
  constructor(options = {}) {
    this.defaults = {
      quality: 0.7,
      maxWidth: 1920,
      maxHeight: 1080,
      mimeType: 'image/jpeg',
      fileName: 'compressed-image'
    };
    this.options = { ...this.defaults, ...options };
  }

  compress(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('Please provide a valid image file'));
        return;
      }

      const reader = new FileReader();
      reader.readAsDataURL(file);

      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;

        img.onload = () => {
          const { width, height } = this.calculateDimensions(img);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          canvas.width = width;
          canvas.height = height;

          // Apply smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw image on canvas
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob and resolve promise
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Canvas to Blob conversion failed'));
                return;
              }

              const compressedFile = new File(
                [blob],
                this.options.fileName + this.getFileExtension(this.options.mimeType),
                {
                  type: this.options.mimeType
                }
              );

              resolve({
                file: compressedFile,
                originalSize: this.formatBytes(file.size),
                compressedSize: this.formatBytes(blob.size),
                compressionRatio: ((1 - blob.size / file.size) * 100).toFixed(2) + '%',
                width,
                height,
                downloadUrl: URL.createObjectURL(blob)
              });
            },
            this.options.mimeType,
            this.options.quality
          );
        };

        img.onerror = () => {
          reject(new Error('Failed to load image'));
        };
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
    });
  }

  calculateDimensions(img) {
    let { maxWidth, maxHeight } = this.options;
    let width = img.width;
    let height = img.height;

    // Calculate new dimensions while maintaining aspect ratio
    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    return { width, height };
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
  }

  getFileExtension(mimeType) {
    switch (mimeType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      default:
        return '.jpg';
    }
  }
}

// Usage example with HTML
`
<div class="image-compressor">
  <input type="file" id="imageInput" accept="image/*">
  <div class="compression-options">
    <label>
      Quality (0-1):
      <input type="number" id="qualityInput" min="0" max="1" step="0.1" value="0.7">
    </label>
    <label>
      Max Width:
      <input type="number" id="widthInput" value="1920">
    </label>
    <label>
      Max Height:
      <input type="number" id="heightInput" value="1080">
    </label>
  </div>
  <div id="preview"></div>
  <div id="stats"></div>
</div>
`

// Implementation
const imageInput = document.getElementById('imageInput');
const qualityInput = document.getElementById('qualityInput');
const widthInput = document.getElementById('widthInput');
const heightInput = document.getElementById('heightInput');
const preview = document.getElementById('preview');
const stats = document.getElementById('stats');

imageInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const compressor = new ImageCompressor({
    quality: parseFloat(qualityInput.value),
    maxWidth: parseInt(widthInput.value),
    maxHeight: parseInt(heightInput.value),
    fileName: 'compressed-' + file.name.split('.')[0]
  });

  try {
    preview.innerHTML = 'Compressing...';
    stats.innerHTML = '';

    const result = await compressor.compress(file);

    // Display preview
    preview.innerHTML = `
      <div class="image-preview">
        <img src="${result.downloadUrl}" alt="Compressed preview">
        <a href="${result.downloadUrl}" 
           download="${result.file.name}" 
           class="download-button">Download Compressed Image</a>
      </div>
    `;

    // Display stats
    stats.innerHTML = `
      <div class="compression-stats">
        <p>Original Size: ${result.originalSize}</p>
        <p>Compressed Size: ${result.compressedSize}</p>
        <p>Compression Ratio: ${result.compressionRatio}</p>
        <p>Dimensions: ${result.width}x${result.height}</p>
      </div>
    `;
  } catch (error) {
    preview.innerHTML = `Error: ${error.message}`;
  }
});

// Basic CSS
`
.image-compressor {
  max-width: 800px;
  margin: 20px auto;
  padding: 20px;
}

.compression-options {
  margin: 20px 0;
  display: flex;
  gap: 20px;
}

.compression-options label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.image-preview {
  margin: 20px 0;
  text-align: center;
}

.image-preview img {
  max-width: 100%;
  height: auto;
  margin-bottom: 10px;
}

.download-button {
  display: inline-block;
  padding: 10px 20px;
  background-color: #007bff;
  color: white;
  text-decoration: none;
  border-radius: 5px;
}

.compression-stats {
  margin: 20px 0;
  padding: 10px;
  background-color: #f8f9fa;
  border-radius: 5px;
}
`