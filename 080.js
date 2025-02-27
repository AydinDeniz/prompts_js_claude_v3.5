class SessionRecorder {
    constructor(options = {}) {
        this.options = {
            maxDuration: options.maxDuration || 300000, // 5 minutes
            playbackSpeed: options.playbackSpeed || 1,
            storageKey: options.storageKey || 'session-recording',
            excludeSelectors: options.excludeSelectors || ['.private', '.sensitive']
        };

        this.events = [];
        this.isRecording = false;
        this.isPlaying = false;
        this.startTime = null;
        this.playerInstance = null;
    }

    init() {
        this.setupUI();
        this.bindEvents();
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="session-recorder">
                <div class="recorder-controls">
                    <button id="start-recording" class="record-btn">
                        <span class="record-icon"></span> Record
                    </button>
                    <button id="stop-recording" class="stop-btn" disabled>
                        <span class="stop-icon"></span> Stop
                    </button>
                    <button id="play-recording" class="play-btn" disabled>
                        <span class="play-icon"></span> Play
                    </button>
                </div>
                
                <div class="playback-controls" style="display: none;">
                    <input type="range" id="playback-progress" min="0" max="100" value="0">
                    <div class="speed-controls">
                        <button data-speed="0.5">0.5x</button>
                        <button data-speed="1" class="active">1x</button>
                        <button data-speed="2">2x</button>
                    </div>
                </div>

                <div class="recording-status">
                    <span class="status-text"></span>
                    <span class="timer">00:00</span>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        this.addStyles();
    }

    addStyles() {
        const styles = `
            .session-recorder {
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: white;
                padding: 15px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 10000;
            }

            .recorder-controls {
                display: flex;
                gap: 10px;
                margin-bottom: 10px;
            }

            .recorder-controls button {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .record-btn {
                background: #f44336;
                color: white;
            }

            .stop-btn {
                background: #666;
                color: white;
            }

            .play-btn {
                background: #4CAF50;
                color: white;
            }

            .record-icon, .stop-icon, .play-icon {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                display: inline-block;
            }

            .record-icon {
                background: white;
                animation: pulse 2s infinite;
            }

            .recording .record-icon {
                animation: pulse 1s infinite;
            }

            .playback-controls {
                margin-top: 10px;
            }

            #playback-progress {
                width: 100%;
                margin: 10px 0;
            }

            .speed-controls {
                display: flex;
                justify-content: center;
                gap: 5px;
            }

            .speed-controls button {
                padding: 4px 8px;
                border: 1px solid #ddd;
                background: white;
                border-radius: 4px;
                cursor: pointer;
            }

            .speed-controls button.active {
                background: #2196F3;
                color: white;
                border-color: #2196F3;
            }

            .recording-status {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 10px;
                font-size: 12px;
                color: #666;
            }

            .cursor-highlight {
                position: absolute;
                width: 20px;
                height: 20px;
                background: rgba(255, 0, 0, 0.3);
                border-radius: 50%;
                pointer-events: none;
                transition: all 0.1s ease;
                z-index: 9999;
            }

            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        document.getElementById('start-recording').onclick = () => this.startRecording();
        document.getElementById('stop-recording').onclick = () => this.stopRecording();
        document.getElementById('play-recording').onclick = () => this.playRecording();

        document.querySelectorAll('.speed-controls button').forEach(button => {
            button.onclick = () => this.setPlaybackSpeed(parseFloat(button.dataset.speed));
        });

        document.getElementById('playback-progress').oninput = (e) => {
            if (this.playerInstance) {
                this.playerInstance.seekTo(parseFloat(e.target.value));
            }
        };
    }

    startRecording() {
        this.isRecording = true;
        this.events = [];
        this.startTime = Date.now();

        this.updateUI('recording');
        this.attachRecordingListeners();

        // Start timer
        this.startTimer();
    }

    stopRecording() {
        this.isRecording = false;
        this.detachRecordingListeners();
        this.updateUI('stopped');
        this.saveRecording();
    }

    attachRecordingListeners() {
        this.recordEvent = this.recordEvent.bind(this);

        document.addEventListener('click', this.recordEvent);
        document.addEventListener('input', this.recordEvent);
        document.addEventListener('scroll', this.debounce(this.recordEvent, 100));
        document.addEventListener('mousemove', this.throttle(this.recordEvent, 100));
    }

    detachRecordingListeners() {
        document.removeEventListener('click', this.recordEvent);
        document.removeEventListener('input', this.recordEvent);
        document.removeEventListener('scroll', this.recordEvent);
        document.removeEventListener('mousemove', this.recordEvent);
    }

    recordEvent(event) {
        if (!this.isRecording) return;

        // Check if element should be excluded
        if (this.shouldExcludeElement(event.target)) return;

        const timestamp = Date.now() - this.startTime;
        let eventData = {
            type: event.type,
            timestamp,
            target: this.getElementPath(event.target)
        };

        switch (event.type) {
            case 'click':
                eventData.x = event.clientX;
                eventData.y = event.clientY;
                break;
            case 'input':
                eventData.value = event.target.value;
                break;
            case 'scroll':
                eventData.scrollX = window.scrollX;
                eventData.scrollY = window.scrollY;
                break;
            case 'mousemove':
                eventData.x = event.clientX;
                eventData.y = event.clientY;
                break;
        }

        this.events.push(eventData);
    }

    playRecording() {
        if (this.isPlaying) return;

        this.isPlaying = true;
        this.updateUI('playing');

        this.playerInstance = new SessionPlayer(
            this.events,
            this.options.playbackSpeed,
            () => {
                this.isPlaying = false;
                this.updateUI('stopped');
            }
        );

        this.playerInstance.play();
    }

    saveRecording() {
        try {
            localStorage.setItem(this.options.storageKey, JSON.stringify(this.events));
        } catch (error) {
            console.error('Failed to save recording:', error);
        }
    }

    loadRecording() {
        try {
            const saved = localStorage.getItem(this.options.storageKey);
            if (saved) {
                this.events = JSON.parse(saved);
                return true;
            }
        } catch (error) {
            console.error('Failed to load recording:', error);
        }
        return false;
    }

    getElementPath(element) {
        const path = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let selector = element.nodeName.toLowerCase();
            if (element.id) {
                selector += `#${element.id}`;
            } else {
                let sibling = element;
                let nth = 1;
                while (sibling = sibling.previousElementSibling) {
                    if (sibling.nodeName.toLowerCase() === selector) nth++;
                }
                if (nth !== 1) selector += `:nth-of-type(${nth})`;
            }
            path.unshift(selector);
            element = element.parentNode;
        }
        return path.join(' > ');
    }

    shouldExcludeElement(element) {
        return this.options.excludeSelectors.some(selector => 
            element.matches(selector) || element.closest(selector)
        );
    }

    updateUI(state) {
        const startBtn = document.getElementById('start-recording');
        const stopBtn = document.getElementById('stop-recording');
        const playBtn = document.getElementById('play-recording');
        const status = document.querySelector('.status-text');
        const playbackControls = document.querySelector('.playback-controls');

        switch (state) {
            case 'recording':
                startBtn.disabled = true;
                stopBtn.disabled = false;
                playBtn.disabled = true;
                status.textContent = 'Recording...';
                playbackControls.style.display = 'none';
                break;
            case 'playing':
                startBtn.disabled = true;
                stopBtn.disabled = true;
                playBtn.disabled = true;
                status.textContent = 'Playing...';
                playbackControls.style.display = 'block';
                break;
            case 'stopped':
                startBtn.disabled = false;
                stopBtn.disabled = true;
                playBtn.disabled = false;
                status.textContent = 'Ready';
                playbackControls.style.display = 'block';
                break;
        }
    }

    startTimer() {
        const timerElement = document.querySelector('.timer');
        const startTime = Date.now();

        const updateTimer = () => {
            if (!this.isRecording) return;

            const elapsed = Date.now() - startTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            
            timerElement.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            if (elapsed < this.options.maxDuration) {
                requestAnimationFrame(updateTimer);
            } else {
                this.stopRecording();
            }
        };

        updateTimer();
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    throttle(func, limit) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
}

class SessionPlayer {
    constructor(events, speed, onComplete) {
        this.events = events;
        this.speed = speed;
        this.onComplete = onComplete;
        this.currentIndex = 0;
        this.startTime = null;
        this.cursorElement = this.createCursor();
    }

    createCursor() {
        const cursor = document.createElement('div');
        cursor.className = 'cursor-highlight';
        document.body.appendChild(cursor);
        return cursor;
    }

    play() {
        this.startTime = Date.now();
        this.playNextEvent();
    }

    playNextEvent() {
        if (this.currentIndex >= this.events.length) {
            this.complete();
            return;
        }

        const event = this.events[this.currentIndex];
        const currentTime = (Date.now() - this.startTime) * this.speed;

        if (currentTime >= event.timestamp) {
            this.executeEvent(event);
            this.currentIndex++;
            requestAnimationFrame(() => this.playNextEvent());
        } else {
            setTimeout(() => this.playNextEvent(), 
                (event.timestamp / this.speed) - currentTime);
        }
    }

    executeEvent(event) {
        const element = document.querySelector(event.target);
        if (!element) return;

        switch (event.type) {
            case 'click':
                this.simulateClick(event, element);
                break;
            case 'input':
                element.value = event.value;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                break;
            case 'scroll':
                window.scrollTo(event.scrollX, event.scrollY);
                break;
            case 'mousemove':
                this.moveCursor(event.x, event.y);
                break;
        }
    }

    simulateClick(event, element) {
        this.moveCursor(event.x, event.y);
        element.focus();
        element.click();
    }

    moveCursor(x, y) {
        this.cursorElement.style.left = x + 'px';
        this.cursorElement.style.top = y + 'px';
    }

    seekTo(percentage) {
        const targetTime = (this.events[this.events.length - 1].timestamp * percentage) / 100;
        this.currentIndex = this.events.findIndex(event => event.timestamp >= targetTime);
        this.startTime = Date.now() - (targetTime / this.speed);
    }

    complete() {
        this.cursorElement.remove();
        if (this.onComplete) this.onComplete();
    }
}

// Initialize
const sessionRecorder = new SessionRecorder({
    maxDuration: 300000, // 5 minutes
    playbackSpeed: 1,
    excludeSelectors: ['.private', '.sensitive']
});

sessionRecorder.init();