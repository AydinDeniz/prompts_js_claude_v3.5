class LazyImageLoader {
    constructor(options = {}) {
        this.options = {
            rootMargin: options.rootMargin || '50px 0px',
            threshold: options.threshold || 0.1,
            placeholderColor: options.placeholderColor || '#f0f0f0',
            transitionDuration: options.transitionDuration || '0.3s',
            errorFallbackUrl: options.errorFallbackUrl || 'path/to/error-image.jpg'
        };
        
        this.observer = null;
        this.loadedImages = new Set();
    }

    init() {
        this.setupIntersectionObserver();
        this.setupImages();
        this.addStyles();
    }

    setupIntersectionObserver() {
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                }
            });
        }, {
            rootMargin: this.options.rootMargin,
            threshold: this.options.threshold
        });
    }

    setupImages() {
        const images = document.querySelectorAll('img[data-src]');
        images.forEach(img => {
            this.setupImagePlaceholder(img);
            this.observer.observe(img);
        });
    }

    addStyles() {
        const styles = `
            .lazy-image-container {
                position: relative;
                overflow: hidden;
                background: ${this.options.placeholderColor};
            }

            .lazy-image {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
                opacity: 0;
                transition: opacity ${this.options.transitionDuration} ease-in-out;
            }

            .lazy-image.loaded {
                opacity: 1;
            }

            .lazy-image.error {
                filter: grayscale(1);
                opacity: 0.7;
            }

            .placeholder {
                position: relative;
                width: 100%;
                height: 100%;
                background: ${this.options.placeholderColor};
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .placeholder-blur {
                filter: blur(10px);
                transform: scale(1.1);
                transition: filter ${this.options.transitionDuration} ease-in-out;
            }

            .loading-spinner {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 30px;
                height: 30px;
                border: 3px solid rgba(0, 0, 0, 0.1);
                border-top-color: #3498db;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                to { transform: translate(-50%, -50%) rotate(360deg); }
            }

            .error-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity ${this.options.transitionDuration};
            }

            .error-overlay.visible {
                opacity: 1;
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    setupImagePlaceholder(img) {
        const container = document.createElement('div');
        container.className = 'lazy-image-container';
        container.style.paddingBottom = this.calculateAspectRatio(img) + '%';

        // Create placeholder with thumbnail
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        
        if (img.dataset.thumbnail) {
            const thumbnailImg = document.createElement('img');
            thumbnailImg.src = img.dataset.thumbnail;
            thumbnailImg.className = 'placeholder-blur';
            placeholder.appendChild(thumbnailImg);
        }

        // Add loading spinner
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        placeholder.appendChild(spinner);

        // Wrap image in container
        img.parentNode.insertBefore(container, img);
        container.appendChild(placeholder);
        container.appendChild(img);

        // Add error overlay
        const errorOverlay = document.createElement('div');
        errorOverlay.className = 'error-overlay';
        errorOverlay.innerHTML = '<span>Failed to load image</span>';
        container.appendChild(errorOverlay);

        // Set initial image properties
        img.className = 'lazy-image';
        img.style.opacity = '0';
    }

    calculateAspectRatio(img) {
        const width = img.getAttribute('width') || img.dataset.width;
        const height = img.getAttribute('height') || img.dataset.height;
        
        if (width && height) {
            return (height / width) * 100;
        }
        
        return 75; // Default aspect ratio (4:3)
    }

    async loadImage(img) {
        if (this.loadedImages.has(img)) return;

        const container = img.closest('.lazy-image-container');
        const placeholder = container.querySelector('.placeholder');
        const errorOverlay = container.querySelector('.error-overlay');

        try {
            await this.preloadImage(img.dataset.src);
            
            // Remove placeholder blur if exists
            const thumbnailImg = placeholder.querySelector('.placeholder-blur');
            if (thumbnailImg) {
                thumbnailImg.style.filter = 'blur(0)';
            }

            // Set actual image
            img.src = img.dataset.src;
            img.classList.add('loaded');
            
            // Clean up
            this.loadedImages.add(img);
            this.observer.unobserve(img);
            
            // Smooth transition
            setTimeout(() => {
                placeholder.style.opacity = '0';
                setTimeout(() => placeholder.remove(), 300);
            }, 300);

        } catch (error) {
            console.error('Failed to load image:', error);
            this.handleImageError(img, errorOverlay);
        }
    }

    preloadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = reject;
            img.src = src;
        });
    }

    handleImageError(img, errorOverlay) {
        img.src = this.options.errorFallbackUrl;
        img.classList.add('error');
        errorOverlay.classList.add('visible');

        // Retry button
        const retryButton = document.createElement('button');
        retryButton.textContent = 'Retry';
        retryButton.onclick = () => this.retryLoading(img, errorOverlay);
        errorOverlay.appendChild(retryButton);
    }

    retryLoading(img, errorOverlay) {
        errorOverlay.classList.remove('visible');
        img.classList.remove('error');
        this.loadImage(img);
    }
}

// Usage
const lazyLoader = new LazyImageLoader({
    rootMargin: '50px 0px',
    threshold: 0.1,
    placeholderColor: '#f0f0f0',
    transitionDuration: '0.3s',
    errorFallbackUrl: '/path/to/error-image.jpg'
});

lazyLoader.init();

// Example HTML usage:
/*
<img 
    data-src="high-res-image.jpg"
    data-thumbnail="low-res-thumbnail.jpg"
    data-width="1920"
    data-height="1080"
    alt="Lazy loaded image"
>
*/