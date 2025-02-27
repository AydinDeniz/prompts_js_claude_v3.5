class TypingSpeedMonitor {
    constructor(options = {}) {
        this.options = {
            targetWPM: options.targetWPM || 60,
            updateInterval: options.updateInterval || 500,
            minWordLength: options.minWordLength || 1,
            sampleText: options.sampleText || this.getDefaultSampleText(),
            container: options.container || '#typing-monitor'
        };

        this.stats = {
            startTime: null,
            wordCount: 0,
            errorCount: 0,
            currentWPM: 0,
            accuracy: 100,
            isTracking: false
        };
    }

    init() {
        this.setupUI();
        this.bindEvents();
    }

    setupUI() {
        const container = document.querySelector(this.options.container);
        container.innerHTML = `
            <div class="typing-monitor">
                <div class="stats-panel">
                    <div class="stat-box">
                        <label>WPM</label>
                        <div class="stat-value" id="wpm">0</div>
                    </div>
                    <div class="stat-box">
                        <label>Accuracy</label>
                        <div class="stat-value" id="accuracy">100%</div>
                    </div>
                    <div class="stat-box">
                        <label>Time</label>
                        <div class="stat-value" id="time">0:00</div>
                    </div>
                </div>

                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill" id="wpm-progress"></div>
                    </div>
                    <div class="target-indicator">Target: ${this.options.targetWPM} WPM</div>
                </div>

                <div class="text-container">
                    <div class="sample-text" id="sample-text"></div>
                    <textarea 
                        id="typing-input"
                        placeholder="Start typing to begin..."
                        spellcheck="false"
                    ></textarea>
                </div>

                <div class="controls">
                    <button id="reset-test">Reset Test</button>
                    <button id="change-text">New Text</button>
                </div>
            </div>
        `;

        this.addStyles();
        this.displaySampleText();
    }

    addStyles() {
        const styles = `
            .typing-monitor {
                max-width: 800px;
                margin: 20px auto;
                padding: 20px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }

            .stats-panel {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 20px;
                margin-bottom: 20px;
            }

            .stat-box {
                background: #f5f5f5;
                padding: 15px;
                border-radius: 6px;
                text-align: center;
            }

            .stat-box label {
                display: block;
                color: #666;
                font-size: 14px;
                margin-bottom: 5px;
            }

            .stat-value {
                font-size: 24px;
                font-weight: bold;
                color: #2196F3;
            }

            .progress-container {
                margin-bottom: 20px;
            }

            .progress-bar {
                height: 10px;
                background: #f0f0f0;
                border-radius: 5px;
                overflow: hidden;
                margin-bottom: 5px;
            }

            .progress-fill {
                height: 100%;
                background: #4CAF50;
                width: 0;
                transition: width 0.3s ease;
            }

            .target-indicator {
                text-align: right;
                font-size: 12px;
                color: #666;
            }

            .text-container {
                margin-bottom: 20px;
            }

            .sample-text {
                font-size: 18px;
                line-height: 1.6;
                margin-bottom: 20px;
                padding: 15px;
                background: #f9f9f9;
                border-radius: 6px;
                color: #666;
            }

            #typing-input {
                width: 100%;
                height: 150px;
                padding: 15px;
                font-size: 18px;
                line-height: 1.6;
                border: 2px solid #e0e0e0;
                border-radius: 6px;
                resize: none;
            }

            #typing-input:focus {
                outline: none;
                border-color: #2196F3;
            }

            .controls {
                display: flex;
                gap: 10px;
            }

            button {
                padding: 10px 20px;
                border: none;
                border-radius: 4px;
                background: #2196F3;
                color: white;
                cursor: pointer;
                transition: background 0.3s ease;
            }

            button:hover {
                background: #1976D2;
            }

            .error {
                background: #ffebee;
            }

            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }

            .milestone {
                animation: pulse 0.5s ease;
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        const input = document.getElementById('typing-input');
        const resetButton = document.getElementById('reset-test');
        const changeTextButton = document.getElementById('change-text');

        input.addEventListener('input', () => this.handleInput());
        input.addEventListener('keydown', (e) => this.handleKeydown(e));
        resetButton.addEventListener('click', () => this.resetTest());
        changeTextButton.addEventListener('click', () => this.changeText());
    }

    handleInput() {
        if (!this.stats.isTracking) {
            this.startTracking();
        }

        this.calculateStats();
        this.updateUI();
    }

    handleKeydown(event) {
        // Prevent tab key from changing focus
        if (event.key === 'Tab') {
            event.preventDefault();
        }
    }

    startTracking() {
        this.stats.isTracking = true;
        this.stats.startTime = new Date();
        this.startUpdateTimer();
    }

    calculateStats() {
        const input = document.getElementById('typing-input');
        const sampleText = document.getElementById('sample-text').textContent;
        const currentText = input.value;
        
        // Calculate WPM
        const timeElapsed = (new Date() - this.stats.startTime) / 60000; // minutes
        const words = currentText.trim().split(/\s+/).filter(word => 
            word.length >= this.options.minWordLength).length;
        this.stats.currentWPM = Math.round(words / timeElapsed);

        // Calculate accuracy
        let errors = 0;
        for (let i = 0; i < currentText.length; i++) {
            if (currentText[i] !== sampleText[i]) {
                errors++;
            }
        }
        this.stats.errorCount = errors;
        this.stats.accuracy = Math.max(0, Math.round(
            100 * (1 - errors / currentText.length)
        ));
    }

    updateUI() {
        // Update stats
        document.getElementById('wpm').textContent = this.stats.currentWPM;
        document.getElementById('accuracy').textContent = `${this.stats.accuracy}%`;
        document.getElementById('time').textContent = this.getElapsedTimeString();

        // Update progress bar
        const progressPercent = Math.min(
            (this.stats.currentWPM / this.options.targetWPM) * 100, 
            100
        );
        document.getElementById('wpm-progress').style.width = `${progressPercent}%`;

        // Highlight milestone achievements
        if (this.stats.currentWPM > this.options.targetWPM) {
            document.getElementById('wpm').classList.add('milestone');
            setTimeout(() => {
                document.getElementById('wpm').classList.remove('milestone');
            }, 500);
        }
    }

    startUpdateTimer() {
        setInterval(() => {
            if (this.stats.isTracking) {
                this.updateUI();
            }
        }, this.options.updateInterval);
    }

    resetTest() {
        document.getElementById('typing-input').value = '';
        this.stats = {
            startTime: null,
            wordCount: 0,
            errorCount: 0,
            currentWPM: 0,
            accuracy: 100,
            isTracking: false
        };
        this.updateUI();
    }

    changeText() {
        this.resetTest();
        this.displaySampleText();
    }

    displaySampleText() {
        document.getElementById('sample-text').textContent = this.options.sampleText;
    }

    getElapsedTimeString() {
        if (!this.stats.startTime) return '0:00';
        
        const seconds = Math.floor((new Date() - this.stats.startTime) / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    getDefaultSampleText() {
        return `The quick brown fox jumps over the lazy dog. This pangram contains every letter of the English alphabet at least once. Typing practice is essential for improving your speed and accuracy on the keyboard.`;
    }
}

// Initialize
const typingMonitor = new TypingSpeedMonitor({
    targetWPM: 60,
    updateInterval: 500,
    minWordLength: 1,
    container: '#typing-monitor'
});

typingMonitor.init();

// Usage:
/*
<div id="typing-monitor"></div>
*/