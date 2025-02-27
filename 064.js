class RealTimeTranslator {
    constructor() {
        this.recognition = new webkitSpeechRecognition() || new SpeechRecognition();
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.targetLanguage = 'es'; // default target language
    }

    init() {
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = async (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            
            if (event.results[0].isFinal) {
                const translation = await this.translate(transcript);
                this.speak(translation);
                this.updateUI(transcript, translation);
            }
        };

        this.setupUI();
    }

    async translate(text) {
        try {
            const response = await fetch('https://translation-api.example.com/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    targetLang: this.targetLanguage
                })
            });
            const data = await response.json();
            return data.translation;
        } catch (error) {
            console.error('Translation error:', error);
            return 'Translation error occurred';
        }
    }

    speak(text) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = this.targetLanguage;
        this.synthesis.speak(utterance);
    }

    toggleListening() {
        if (this.isListening) {
            this.recognition.stop();
            this.isListening = false;
        } else {
            this.recognition.start();
            this.isListening = true;
        }
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="translator-container">
                <select id="language-select">
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="it">Italian</option>
                    <option value="ja">Japanese</option>
                </select>
                <button id="toggle-listening">Start Listening</button>
                <div class="transcript-box">
                    <div id="original-text"></div>
                    <div id="translated-text"></div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        document.getElementById('toggle-listening').onclick = () => this.toggleListening();
        document.getElementById('language-select').onchange = (e) => {
            this.targetLanguage = e.target.value;
        };
    }

    updateUI(original, translation) {
        document.getElementById('original-text').textContent = original;
        document.getElementById('translated-text').textContent = translation;
    }
}

// Add styles
const styles = `
    .translator-container {
        max-width: 600px;
        margin: 20px auto;
        padding: 20px;
        border: 1px solid #ccc;
        border-radius: 8px;
    }
    .transcript-box {
        margin-top: 20px;
        padding: 10px;
        background: #f5f5f5;
    }
    #original-text, #translated-text {
        margin: 10px 0;
        padding: 10px;
        background: white;
        border-radius: 4px;
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize
const translator = new RealTimeTranslator();
translator.init();