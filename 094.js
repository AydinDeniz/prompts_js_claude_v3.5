class SecuritySanitizer {
    constructor(options = {}) {
        this.options = {
            encoding: options.encoding || 'UTF-8',
            maxInputLength: options.maxInputLength || 1024 * 1024, // 1MB
            allowedTags: options.allowedTags || [],
            allowedAttributes: options.allowedAttributes || {},
            allowedProtocols: options.allowedProtocols || ['http:', 'https:', 'mailto:'],
            sqlKeywords: options.sqlKeywords || this.getDefaultSqlKeywords(),
            tenantRules: options.tenantRules || new Map(),
            customEncoders: options.customEncoders || new Map(),
            logger: options.logger
        };

        this.encoders = this.setupEncoders();
        this.validators = this.setupValidators();
        this.cache = new Map();
    }

    setupEncoders() {
        return {
            html: (input) => this.encodeHTML(input),
            url: (input) => encodeURIComponent(input),
            sql: (input) => this.encodeSQLString(input),
            js: (input) => this.encodeJavaScript(input),
            css: (input) => this.encodeCSS(input),
            xml: (input) => this.encodeXML(input),
            ...Object.fromEntries(this.options.customEncoders)
        };
    }

    setupValidators() {
        return {
            email: (input) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(input);
            },
            url: (input) => {
                try {
                    const url = new URL(input);
                    return this.options.allowedProtocols.includes(url.protocol);
                } catch {
                    return false;
                }
            },
            alphanumeric: (input) => /^[a-zA-Z0-9]+$/.test(input),
            numeric: (input) => /^\d+$/.test(input),
            date: (input) => !isNaN(Date.parse(input)),
            phone: (input) => /^\+?[\d\s-()]+$/.test(input)
        };
    }

    sanitize(input, context = 'text', tenantId = null) {
        try {
            // Input validation
            if (!this.validateInput(input)) {
                throw new Error('Invalid input');
            }

            // Get tenant-specific rules
            const rules = this.getTenantRules(tenantId);

            // Apply context-specific sanitization
            let sanitized = this.applySanitization(input, context, rules);

            // Apply tenant-specific transformations
            if (rules.transformations) {
                sanitized = this.applyTransformations(sanitized, rules.transformations);
            }

            // Cache result
            this.cacheResult(input, context, tenantId, sanitized);

            return sanitized;

        } catch (error) {
            this.handleError(error, input, context, tenantId);
            throw error;
        }
    }

    validateInput(input) {
        // Check input type
        if (typeof input !== 'string') {
            return false;
        }

        // Check input length
        if (input.length > this.options.maxInputLength) {
            return false;
        }

        // Check for null bytes
        if (input.includes('\0')) {
            return false;
        }

        return true;
    }

    getTenantRules(tenantId) {
        if (!tenantId) {
            return {};
        }

        // Get cached rules
        const cached = this.cache.get(`rules:${tenantId}`);
        if (cached && cached.expiry > Date.now()) {
            return cached.rules;
        }

        // Get rules from options
        const rules = this.options.tenantRules.get(tenantId) || {};

        // Cache rules
        this.cache.set(`rules:${tenantId}`, {
            rules,
            expiry: Date.now() + 300000 // 5 minutes
        });

        return rules;
    }

    applySanitization(input, context, rules) {
        switch (context) {
            case 'html':
                return this.sanitizeHTML(input, rules);
            case 'sql':
                return this.sanitizeSQL(input, rules);
            case 'js':
                return this.sanitizeJavaScript(input, rules);
            case 'url':
                return this.sanitizeURL(input, rules);
            case 'css':
                return this.sanitizeCSS(input, rules);
            case 'xml':
                return this.sanitizeXML(input, rules);
            default:
                return this.sanitizeText(input, rules);
        }
    }

    sanitizeHTML(input, rules) {
        // Create DOM parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(input, 'text/html');

        // Remove unwanted tags
        this.removeUnwantedTags(doc.body, rules.allowedTags || this.options.allowedTags);

        // Clean attributes
        this.cleanAttributes(doc.body, rules.allowedAttributes || this.options.allowedAttributes);

        // Encode special characters
        return this.encoders.html(doc.body.innerHTML);
    }

    removeUnwantedTags(element, allowedTags) {
        const children = Array.from(element.children);
        
        for (const child of children) {
            if (!allowedTags.includes(child.tagName.toLowerCase())) {
                // Replace with text content
                const text = document.createTextNode(child.textContent);
                child.parentNode.replaceChild(text, child);
            } else {
                this.removeUnwantedTags(child, allowedTags);
            }
        }
    }

    cleanAttributes(element, allowedAttributes) {
        const children = Array.from(element.children);
        
        for (const child of children) {
            const tagName = child.tagName.toLowerCase();
            const allowed = allowedAttributes[tagName] || [];

            // Remove unwanted attributes
            Array.from(child.attributes).forEach(attr => {
                if (!allowed.includes(attr.name)) {
                    child.removeAttribute(attr.name);
                }
            });

            // Clean URLs in attributes
            allowed.forEach(attrName => {
                if (child.hasAttribute(attrName)) {
                    const value = child.getAttribute(attrName);
                    if (this.isURLAttribute(attrName)) {
                        child.setAttribute(attrName, this.sanitizeURL(value));
                    }
                }
            });

            this.cleanAttributes(child, allowedAttributes);
        }
    }

    sanitizeSQL(input, rules) {
        // Remove SQL comments
        let sanitized = input.replace(/\/\*.*?\*\/|--.*$/gm, '');

        // Escape SQL keywords
        const keywords = rules.sqlKeywords || this.options.sqlKeywords;
        keywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            sanitized = sanitized.replace(regex, this.encoders.sql(keyword));
        });

        return sanitized;
    }

    sanitizeJavaScript(input, rules) {
        // Remove potential script execution
        let sanitized = input.replace(/<\s*script[^>]*>.*?<\s*\/\s*script\s*>/gi, '');

        // Encode JavaScript special characters
        sanitized = this.encoders.js(sanitized);

        // Remove potential eval() and similar functions
        const dangerousFunctions = rules.dangerousFunctions || [
            'eval', 'setTimeout', 'setInterval', 'Function'
        ];

        dangerousFunctions.forEach(func => {
            const regex = new RegExp(`\\b${func}\\s*\\(`, 'g');
            sanitized = sanitized.replace(regex, `/* blocked ${func} */(`);
        });

        return sanitized;
    }

    sanitizeURL(input, rules) {
        try {
            const url = new URL(input);

            // Check protocol
            if (!this.options.allowedProtocols.includes(url.protocol)) {
                throw new Error('Invalid protocol');
            }

            // Clean query parameters
            if (rules.cleanQueryParams) {
                const params = new URLSearchParams(url.search);
                for (const [key, value] of params.entries()) {
                    params.set(key, this.sanitizeText(value));
                }
                url.search = params.toString();
            }

            return url.toString();
        } catch {
            return '#';
        }
    }

    sanitizeCSS(input, rules) {
        // Remove CSS comments
        let sanitized = input.replace(/\/\*.*?\*\//g, '');

        // Remove potentially dangerous properties
        const dangerousProperties = rules.dangerousProperties || [
            'expression', 'behavior', 'javascript', 'vbscript'
        ];

        dangerousProperties.forEach(prop => {
            const regex = new RegExp(`${prop}\\s*:`, 'gi');
            sanitized = sanitized.replace(regex, '/* blocked */: ');
        });

        return this.encoders.css(sanitized);
    }

    sanitizeXML(input, rules) {
        // Create XML parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(input, 'text/xml');

        if (doc.getElementsByTagName('parsererror').length > 0) {
            throw new Error('Invalid XML');
        }

        // Remove processing instructions
        const removePI = (node) => {
            const children = Array.from(node.childNodes);
            children.forEach(child => {
                if (child.nodeType === 7) { // Processing instruction
                    node.removeChild(child);
                } else if (child.nodeType === 1) { // Element
                    removePI(child);
                }
            });
        };

        removePI(doc.documentElement);

        return this.encoders.xml(new XMLSerializer().serializeToString(doc));
    }

    sanitizeText(input, rules) {
        // Basic text sanitization
        let sanitized = input;

        // Apply character encoding
        sanitized = this.convertEncoding(sanitized, rules.encoding || this.options.