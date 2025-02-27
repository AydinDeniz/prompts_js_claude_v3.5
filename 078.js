class InputValidator {
    constructor(options = {}) {
        this.options = {
            allowedCharacters: options.allowedCharacters || /^[a-zA-Z0-9\s.,!?-]*$/,
            maxLength: options.maxLength || 500,
            inputSelector: options.inputSelector || '.validated-input',
            showCounter: options.showCounter || true,
            showValidation: options.showValidation || true
        };
        
        this.invalidChars = new Set();
    }

    init() {
        this.setupUI();
        this.bindEvents();
    }

    setupUI() {
        const inputs = document.querySelectorAll(this.options.inputSelector);
        
        inputs.forEach(input => {
            const wrapper = document.createElement('div');
            wrapper.className = 'input-validator-wrapper';
            
            input.parentNode.insertBefore(wrapper, input);
            wrapper.appendChild(input);

            // Add validation feedback elements
            const feedbackContainer = document.createElement('div');
            feedbackContainer.className = 'validation-feedback';
            feedbackContainer.innerHTML = `
                <div class="invalid-chars"></div>
                ${this.options.showCounter ? 
                    `<div class="char-counter">
                        <span class="current">0</span>/<span class="max">${this.options.maxLength}</span>
                    </div>` : ''
                }
            `;
            wrapper.appendChild(feedbackContainer);
        });

        this.addStyles();
    }

    addStyles() {
        const styles = `
            .input-validator-wrapper {
                position: relative;
                width: 100%;
                margin-bottom: 20px;
            }

            .validated-input {
                width: 100%;
                padding: 10px;
                border: 2px solid #ddd;
                border-radius: 4px;
                font-size: 16px;
                transition: border-color 0.3s ease;
            }

            .validated-input:focus {
                outline: none;
                border-color: #2196F3;
            }

            .validated-input.has-error {
                border-color: #f44336;
            }

            .validation-feedback {
                margin-top: 5px;
                font-size: 14px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .invalid-chars {
                color: #f44336;
                min-height: 20px;
                animation: fadeIn 0.3s ease;
            }

            .char-counter {
                color: #666;
            }

            .char-counter.limit-reached {
                color: #f44336;
                font-weight: bold;
            }

            .validation-tooltip {
                position: absolute;
                background: #f44336;
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 14px;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%) translateY(-8px);
                white-space: nowrap;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
                z-index: 1000;
            }

            .validation-tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 6px solid transparent;
                border-top-color: #f44336;
            }

            .validation-tooltip.show {
                opacity: 1;
                visibility: visible;
                transform: translateX(-50%) translateY(0);
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }

            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-5px); }
                75% { transform: translateX(5px); }
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        document.querySelectorAll(this.options.inputSelector).forEach(input => {
            input.addEventListener('paste', (e) => this.handlePaste(e));
            input.addEventListener('input', (e) => this.handleInput(e));
            input.addEventListener('keypress', (e) => this.handleKeyPress(e));
        });
    }

    handlePaste(event) {
        event.preventDefault();
        
        const pastedText = (event.clipboardData || window.clipboardData).getData('text');
        const input = event.target;
        
        const sanitizedText = this.sanitizeInput(pastedText);
        
        // Insert at cursor position
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const currentValue = input.value;
        
        const newValue = currentValue.substring(0, start) + 
                        sanitizedText + 
                        currentValue.substring(end);

        if (newValue.length <= this.options.maxLength) {
            input.value = newValue;
            this.updateValidation(input, pastedText);
            
            // Set cursor position after pasted text
            input.setSelectionRange(start + sanitizedText.length, 
                                  start + sanitizedText.length);
        } else {
            this.showTooltip(input, 'Exceeds maximum length');
        }
    }

    handleInput(event) {
        const input = event.target;
        this.updateValidation(input, input.value);
    }

    handleKeyPress(event) {
        const char = String.fromCharCode(event.charCode);
        if (!this.options.allowedCharacters.test(char)) {
            event.preventDefault();
            this.showInvalidCharacter(event.target, char);
        }
    }

    sanitizeInput(text) {
        this.invalidChars.clear();
        
        let sanitized = '';
        for (let char of text) {
            if (this.options.allowedCharacters.test(char)) {
                sanitized += char;
            } else {
                this.invalidChars.add(char);
            }
        }
        
        return sanitized;
    }

    updateValidation(input, text) {
        const wrapper = input.closest('.input-validator-wrapper');
        const invalidCharsElement = wrapper.querySelector('.invalid-chars');
        const charCounter = wrapper.querySelector('.char-counter');
        
        // Update character counter
        if (charCounter) {
            const current = input.value.length;
            charCounter.querySelector('.current').textContent = current;
            charCounter.classList.toggle('limit-reached', 
                current >= this.options.maxLength);
        }

        // Show invalid characters
        if (this.invalidChars.size > 0) {
            const invalidCharsText = Array.from(this.invalidChars).join(' ');
            invalidCharsElement.textContent = 
                `Invalid characters: ${invalidCharsText}`;
            input.classList.add('has-error');
            
            // Animate the input
            input.style.animation = 'shake 0.3s ease';
            setTimeout(() => input.style.animation = '', 300);
        } else {
            invalidCharsElement.textContent = '';
            input.classList.remove('has-error');
        }
    }

    showInvalidCharacter(input, char) {
        this.showTooltip(input, `Character not allowed: ${char}`);
    }

    showTooltip(input, message) {
        let tooltip = input.parentElement.querySelector('.validation-tooltip');
        
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'validation-tooltip';
            input.parentElement.appendChild(tooltip);
        }

        tooltip.textContent = message;
        tooltip.classList.add('show');

        setTimeout(() => tooltip.classList.remove('show'), 2000);
    }
}

// Initialize
const validator = new InputValidator({
    allowedCharacters: /^[a-zA-Z0-9\s.,!?-]*$/,
    maxLength: 500,
    inputSelector: '.validated-input',
    showCounter: true,
    showValidation: true
});

validator.init();

// Usage example:
/*
<input type="text" 
       class="validated-input" 
       placeholder="Enter text here...">
*/