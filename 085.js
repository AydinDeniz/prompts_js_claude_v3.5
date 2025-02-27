class JSONParser {
    constructor(options = {}) {
        this.options = {
            maxDepth: options.maxDepth || 20,
            maxSize: options.maxSize || 1024 * 1024, // 1MB
            allowedTypes: options.allowedTypes || ['object', 'array', 'string', 'number', 'boolean', 'null'],
            dateFormat: options.dateFormat || 'ISO', // 'ISO' or 'timestamp'
            strictMode: options.strictMode !== false,
            customValidators: options.customValidators || {}
        };

        this.errors = [];
    }

    parse(input, schema = null) {
        try {
            // Reset errors array
            this.errors = [];

            // Input validation
            if (!input) {
                throw new Error('Empty input');
            }

            // Size validation
            if (typeof input === 'string' && input.length > this.options.maxSize) {
                throw new Error(`Input exceeds maximum size of ${this.options.maxSize} bytes`);
            }

            // Parse JSON if string input
            let data = typeof input === 'string' ? this.parseJSON(input) : input;

            // Validate structure
            data = this.validateAndTransform(data, schema);

            return {
                success: true,
                data,
                errors: this.errors
            };

        } catch (error) {
            return {
                success: false,
                data: null,
                errors: [...this.errors, error.message]
            };
        }
    }

    parseJSON(input) {
        try {
            // Remove BOM if present
            const cleanInput = input.replace(/^\uFEFF/, '');
            
            // Try parsing
            return JSON.parse(cleanInput);
        } catch (error) {
            // Enhance error message with position information
            const position = this.findErrorPosition(error, input);
            throw new Error(`JSON parsing error at position ${position}: ${error.message}`);
        }
    }

    findErrorPosition(error, input) {
        const match = error.message.match(/position\s+(\d+)/);
        if (match) {
            return match[1];
        }

        // Manual position finding
        const lines = input.split('\n');
        let position = 0;
        let lineNumber = 1;
        let columnNumber = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (let j = 0; j < line.length; j++) {
                if (this.isInvalidJSONCharacter(line[j], position, input)) {
                    lineNumber = i + 1;
                    columnNumber = j + 1;
                    return `line ${lineNumber}, column ${columnNumber}`;
                }
                position++;
            }
            position++; // Account for newline
        }

        return 'unknown position';
    }

    isInvalidJSONCharacter(char, position, input) {
        // Check for common JSON syntax errors
        const prev = position > 0 ? input[position - 1] : '';
        const next = position < input.length - 1 ? input[position + 1] : '';

        // Unquoted string
        if (/[a-zA-Z]/.test(char) && !/["'\]]/.test(prev) && !/[:"'\[]/.test(next)) {
            return true;
        }

        // Missing comma
        if (char === '{' && prev === '}') return true;
        if (char === '[' && prev === ']') return true;

        // Invalid number format
        if (char === '.' && prev === '.') return true;

        return false;
    }

    validateAndTransform(data, schema = null, depth = 0) {
        // Check depth
        if (depth > this.options.maxDepth) {
            throw new Error(`Maximum object depth of ${this.options.maxDepth} exceeded`);
        }

        // Type validation
        const type = this.getType(data);
        if (!this.options.allowedTypes.includes(type)) {
            throw new Error(`Type '${type}' is not allowed`);
        }

        // Schema validation if provided
        if (schema) {
            this.validateSchema(data, schema);
        }

        // Transform based on type
        switch (type) {
            case 'object':
                return this.transformObject(data, schema, depth);
            case 'array':
                return this.transformArray(data, schema, depth);
            case 'string':
                return this.transformString(data, schema);
            case 'number':
                return this.transformNumber(data, schema);
            default:
                return data;
        }
    }

    transformObject(obj, schema, depth) {
        const transformed = {};

        for (const [key, value] of Object.entries(obj)) {
            // Validate key name
            if (this.options.strictMode && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
                this.errors.push(`Invalid key name: ${key}`);
                continue;
            }

            try {
                const schemaForKey = schema?.properties?.[key];
                transformed[key] = this.validateAndTransform(value, schemaForKey, depth + 1);
            } catch (error) {
                this.errors.push(`Error in key '${key}': ${error.message}`);
                if (this.options.strictMode) throw error;
            }
        }

        return transformed;
    }

    transformArray(arr, schema, depth) {
        return arr.map((item, index) => {
            try {
                const itemSchema = schema?.items;
                return this.validateAndTransform(item, itemSchema, depth + 1);
            } catch (error) {
                this.errors.push(`Error in array index ${index}: ${error.message}`);
                if (this.options.strictMode) throw error;
                return null;
            }
        }).filter(item => item !== null);
    }

    transformString(str, schema) {
        // Try parsing dates
        if (this.isDateString(str)) {
            return this.parseDate(str);
        }

        // Custom string transformations based on schema
        if (schema?.format) {
            return this.applyStringFormat(str, schema.format);
        }

        return str;
    }

    transformNumber(num, schema) {
        if (schema?.type === 'integer') {
            if (!Number.isInteger(num)) {
                throw new Error(`Expected integer, got ${num}`);
            }
        }

        if (schema?.minimum !== undefined && num < schema.minimum) {
            throw new Error(`Number ${num} is less than minimum ${schema.minimum}`);
        }

        if (schema?.maximum !== undefined && num > schema.maximum) {
            throw new Error(`Number ${num} is greater than maximum ${schema.maximum}`);
        }

        return num;
    }

    isDateString(str) {
        // ISO date format check
        const isoPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[-+]\d{2}:?\d{2})?)?$/;
        if (isoPattern.test(str)) return true;

        // Timestamp check
        const timestampPattern = /^\d{13}$/;
        return timestampPattern.test(str);
    }

    parseDate(str) {
        const date = new Date(str);
        if (isNaN(date.getTime())) {
            throw new Error(`Invalid date format: ${str}`);
        }

        return this.options.dateFormat === 'ISO' ? 
            date.toISOString() : 
            date.getTime();
    }

    applyStringFormat(str, format) {
        switch (format) {
            case 'email':
                if (!this.validateEmail(str)) {
                    throw new Error(`Invalid email format: ${str}`);
                }
                return str.toLowerCase();

            case 'url':
                if (!this.validateUrl(str)) {
                    throw new Error(`Invalid URL format: ${str}`);
                }
                return this.normalizeUrl(str);

            case 'phone':
                if (!this.validatePhone(str)) {
                    throw new Error(`Invalid phone format: ${str}`);
                }
                return this.normalizePhone(str);

            default:
                if (this.options.customValidators[format]) {
                    return this.options.customValidators[format](str);
                }
                return str;
        }
    }

    validateSchema(data, schema) {
        if (!schema) return;

        // Type validation
        if (schema.type && this.getType(data) !== schema.type) {
            throw new Error(`Expected type ${schema.type}, got ${this.getType(data)}`);
        }

        // Required fields
        if (schema.required && typeof data === 'object') {
            schema.required.forEach(field => {
                if (!(field in data)) {
                    throw new Error(`Missing required field: ${field}`);
                }
            });
        }

        // Pattern validation
        if (schema.pattern && typeof data === 'string') {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(data)) {
                throw new Error(`String does not match pattern: ${schema.pattern}`);
            }
        }

        // Enum validation
        if (schema.enum && !schema.enum.includes(data)) {
            throw new Error(`Value must be one of: ${schema.enum.join(', ')}`);
        }
    }

    getType(value) {
        if (value === null) return 'null';
        if (Array.isArray(value)) return 'array';
        return typeof value;
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    validateUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    validatePhone(phone) {
        const phoneRegex = /^\+?[\d\s-()]+$/;
        return phoneRegex.test(phone);
    }

    normalizeUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.toString();
        } catch {
            return url;
        }
    }

    normalizePhone(phone) {
        return phone.replace(/[\s-()]/g, '');
    }
}

// Usage example:
const parser = new JSONParser({
    maxDepth: 10,
    maxSize: 1024 * 1024,
    dateFormat: 'ISO',
    strictMode: true,
    customValidators: {
        zipcode: (str) => {
            const regex = /^\d{5}(-\d{4})?$/;
            if (!regex.test(str)) {
                throw new Error('Invalid ZIP code format');
            }
            return str;
        }
    }
});

// Example schema
const schema = {
    type: 'object',
    required: ['name', 'email'],
    properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        age: { type: 'number', minimum: 0, maximum: 120 },
        address: {
            type: 'object',
            properties: {
                street: { type: 'string' },
                zipcode: { type: 'string', format: 'zipcode' }
            }
        },
        tags: {
            type: 'array',
            items: { type: 'string' }
        }
    }
};

// Example usage
const jsonString = `{
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30,
    "address": {
        "street": "123 Main St",
        "zipcode": "12345"
    },
    "tags": ["user", "admin"],
    "createdAt": "2023-01-01T12:00:00Z"
}`;

const result = parser.parse(jsonString, schema);
console.log(result);