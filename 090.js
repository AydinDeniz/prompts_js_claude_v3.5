class RichTextEditor {
    constructor(options = {}) {
        this.options = {
            container: options.container || '#editor',
            displayContainer: options.displayContainer || '#preview',
            toolbarContainer: options.toolbarContainer || '#toolbar',
            maxLength: options.maxLength || 10000,
            allowedTags: options.allowedTags || [
                'p', 'br', 'b', 'i', 'u', 'strong', 'em',
                'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a'
            ],
            allowedAttributes: options.allowedAttributes || {
                'a': ['href', 'target'],
                'img': ['src', 'alt', 'title']
            },
            customStyles: options.customStyles || {},
            onChange: options.onChange || null,
            onError: options.onError || null
        };

        this.content = '';
        this.undoStack = [];
        this.redoStack = [];
        this.isComposing = false;
    }

    init() {
        this.setupEditor();
        this.setupToolbar();
        this.bindEvents();
    }

    setupEditor() {
        const container = document.querySelector(this.options.container);
        container.innerHTML = `
            <div class="rich-text-editor">
                <div class="editor-toolbar" id="toolbar"></div>
                <div class="editor-content" 
                     contenteditable="true" 
                     spellcheck="true"
                     role="textbox"
                     aria-multiline="true"></div>
                <div class="editor-statusbar">
                    <span class="char-count">0/${this.options.maxLength}</span>
                    <span class="editor-status"></span>
                </div>
            </div>
            <div class="preview-container" id="preview"></div>
        `;

        this.addStyles();
    }

    addStyles() {
        const styles = `
            .rich-text-editor {
                border: 1px solid #ddd;
                border-radius: 4px;
                background: white;
                margin-bottom: 20px;
            }

            .editor-toolbar {
                padding: 10px;
                border-bottom: 1px solid #ddd;
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
            }

            .toolbar-button {
                padding: 6px 12px;
                background: #f8f9fa;
                border: 1px solid #ddd;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .toolbar-button:hover {
                background: #e9ecef;
            }

            .toolbar-button.active {
                background: #e9ecef;
                border-color: #0d6efd;
            }

            .editor-content {
                min-height: 200px;
                padding: 15px;
                outline: none;
                overflow-y: auto;
            }

            .editor-content:focus {
                border-color: #0d6efd;
            }

            .editor-statusbar {
                padding: 5px 10px;
                border-top: 1px solid #ddd;
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                color: #666;
            }

            .preview-container {
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 15px;
                margin-top: 20px;
            }

            /* Custom styles for formatted content */
            .formatted-content h1 { font-size: 24px; margin-bottom: 15px; }
            .formatted-content h2 { font-size: 20px; margin-bottom: 12px; }
            .formatted-content h3 { font-size: 16px; margin-bottom: 10px; }
            .formatted-content p { margin-bottom: 10px; }
            .formatted-content ul, .formatted-content ol { margin-left: 20px; }
            .formatted-content a { color: #0d6efd; text-decoration: none; }
            .formatted-content a:hover { text-decoration: underline; }

            /* Custom styles from options */
            ${Object.entries(this.options.customStyles).map(([selector, rules]) => 
                `.formatted-content ${selector} { ${rules} }`
            ).join('\n')}
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    setupToolbar() {
        const toolbar = document.querySelector(`${this.options.container} .editor-toolbar`);
        
        const tools = [
            { command: 'bold', icon: '𝐁', title: 'Bold' },
            { command: 'italic', icon: '𝑰', title: 'Italic' },
            { command: 'underline', icon: '𝐔', title: 'Underline' },
            { command: 'separator' },
            { command: 'h1', icon: 'H1', title: 'Heading 1' },
            { command: 'h2', icon: 'H2', title: 'Heading 2' },
            { command: 'h3', icon: 'H3', title: 'Heading 3' },
            { command: 'separator' },
            { command: 'orderedList', icon: '1.', title: 'Numbered List' },
            { command: 'unorderedList', icon: '•', title: 'Bullet List' },
            { command: 'separator' },
            { command: 'createLink', icon: '🔗', title: 'Insert Link' },
            { command: 'separator' },
            { command: 'undo', icon: '↶', title: 'Undo' },
            { command: 'redo', icon: '↷', title: 'Redo' }
        ];

        toolbar.innerHTML = tools.map(tool => {
            if (tool.command === 'separator') {
                return '<div class="toolbar-separator"></div>';
            }
            return `
                <button class="toolbar-button" 
                        data-command="${tool.command}"
                        title="${tool.title}">
                    ${tool.icon}
                </button>
            `;
        }).join('');
    }

    bindEvents() {
        const editor = document.querySelector(`${this.options.container} .editor-content`);
        const toolbar = document.querySelector(`${this.options.container} .editor-toolbar`);

        // Editor events
        editor.addEventListener('input', () => this.handleInput());
        editor.addEventListener('keydown', (e) => this.handleKeyDown(e));
        editor.addEventListener('paste', (e) => this.handlePaste(e));
        editor.addEventListener('compositionstart', () => this.isComposing = true);
        editor.addEventListener('compositionend', () => {
            this.isComposing = false;
            this.handleInput();
        });

        // Toolbar events
        toolbar.addEventListener('click', (e) => {
            const button = e.target.closest('.toolbar-button');
            if (button) {
                this.executeCommand(button.dataset.command);
            }
        });

        // Save selection on blur
        editor.addEventListener('blur', () => {
            this.savedSelection = this.saveSelection();
        });

        // Restore selection on focus
        editor.addEventListener('focus', () => {
            if (this.savedSelection) {
                this.restoreSelection(this.savedSelection);
            }
        });
    }

    handleInput() {
        if (this.isComposing) return;

        const editor = document.querySelector(`${this.options.container} .editor-content`);
        const content = editor.innerHTML;

        // Check length
        if (this.getTextContent(content).length > this.options.maxLength) {
            editor.innerHTML = this.content;
            this.showError('Maximum length exceeded');
            return;
        }

        // Sanitize content
        const sanitized = this.sanitizeContent(content);
        if (sanitized !== content) {
            editor.innerHTML = sanitized;
        }

        // Update content and preview
        this.content = sanitized;
        this.updatePreview();
        this.updateCharCount();
        this.saveToUndoStack();

        // Trigger onChange callback
        if (this.options.onChange) {
            this.options.onChange(this.content);
        }
    }

    handleKeyDown(event) {
        // Handle keyboard shortcuts
        if (event.ctrlKey || event.metaKey) {
            switch (event.key.toLowerCase()) {
                case 'b':
                    event.preventDefault();
                    this.executeCommand('bold');
                    break;
                case 'i':
                    event.preventDefault();
                    this.executeCommand('italic');
                    break;
                case 'u':
                    event.preventDefault();
                    this.executeCommand('underline');
                    break;
                case 'z':
                    event.preventDefault();
                    if (event.shiftKey) {
                        this.redo();
                    } else {
                        this.undo();
                    }
                    break;
            }
        }
    }

    handlePaste(event) {
        event.preventDefault();

        // Get pasted content
        let content = event.clipboardData.getData('text/html') ||
                     event.clipboardData.getData('text/plain');

        // Convert plain text to HTML
        if (!content.startsWith('<')) {
            content = content.replace(/\n/g, '<br>');
        }

        // Sanitize and insert
        const sanitized = this.sanitizeContent(content);
        document.execCommand('insertHTML', false, sanitized);
    }

    executeCommand(command) {
        const editor = document.querySelector(`${this.options.container} .editor-content`);
        editor.focus();

        switch (command) {
            case 'createLink':
                this.createLink();
                break;
            case 'undo':
                this.undo();
                break;
            case 'redo':
                this.redo();
                break;
            default:
                document.execCommand(command, false, null);
        }

        this.handleInput();
    }

    createLink() {
        const url = prompt('Enter URL:');
        if (url) {
            const sanitizedUrl = this.sanitizeUrl(url);
            if (sanitizedUrl) {
                document.execCommand('createLink', false, sanitizedUrl);
            } else {
                this.showError('Invalid URL');
            }
        }
    }

    sanitizeContent(content) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        
        // Remove unwanted tags
        const walk = document.createTreeWalker(
            doc.body,
            NodeFilter.SHOW_ELEMENT,
            null,
            false
        );

        const nodesToRemove = [];
        while (walk.nextNode()) {
            const node = walk.currentNode;
            if (!this.options.allowedTags.includes(node.tagName.toLowerCase())) {
                nodesToRemove.push(node);
            } else {
                // Remove unwanted attributes
                const allowedAttrs = this.options.allowedAttributes[node.tagName.toLowerCase()] || [];
                Array.from(node.attributes).forEach(attr => {
                    if (!allowedAttrs.includes(attr.name)) {
                        node.removeAttribute(attr.name);
                    }
                });

                // Sanitize URLs
                if (node.tagName.toLowerCase() === 'a') {
                    const href = node.getAttribute('href');
                    if (href) {
                        const sanitizedUrl = this.sanitizeUrl(href);
                        if (sanitizedUrl) {
                            node.setAttribute('href', sanitizedUrl);
                            node.setAttribute('target', '_blank');
                            node.setAttribute('rel', 'noopener noreferrer');
                        } else {
                            nodesToRemove.push(node);
                        }
                    }
                }
            }
        }

        nodesToRemove.forEach(node => {
            node.parentNode.replaceChild(
                doc.createTextNode(node.textContent),
                node
            );
        });

        return doc.body.innerHTML;
    }

    sanitizeUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol) ? url : null;
        } catch {
            return null;
        }
    }

    updatePreview() {
        const preview = document.querySelector(this.options.displayContainer);
        preview.innerHTML = `
            <div class="formatted-content">
                ${this.content}
            </div>
        `;
    }

    updateCharCount() {
        const counter = document.querySelector(`${this.options.container} .char-count`);
        const count = this.getTextContent(this.content).length;
        counter.textContent = `${count}/${this.options.maxLength}`;
    }

    getTextContent(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    }

    saveToUndoStack() {
        this.undoStack.push(this.content);
        if (this.undoStack.length > 50) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    undo() {
        if (this.undoStack.length > 1) {
            this.redoStack.push(this.undoStack.pop());
            this.content = this.undoStack[this.undoStack.length - 1];
            this.updateEditor();
        }
    }

    redo() {
        if (this.redoStack.length > 0) {
            const content = this.redoStack.pop();
            this.undoStack.push(content);
            this.content = content;
            this.updateEditor();
        }
    }

    updateEditor() {
        const editor = document.querySelector(`${this.options.container} .editor-content`);
        editor.innerHTML = this.content;
        this.updatePreview();
        this.updateCharCount();
    }

    saveSelection() {
        if (window.getSelection) {
            const sel = window.getSelection();
            if (sel.getRangeAt && sel.rangeCount) {
                return sel.getRangeAt(0);
            }
        }
        return null;
    }

    restoreSelection(range) {
        if (range) {
            if (window.getSelection) {
                const sel = window.getSelection();