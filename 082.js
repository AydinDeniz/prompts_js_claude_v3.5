class FormulaEvaluator {
    constructor() {
        this.variables = new Map();
        this.functions = new Map();
        this.operators = {
            '+': (a, b) => a + b,
            '-': (a, b) => a - b,
            '*': (a, b) => a * b,
            '/': (a, b) => b !== 0 ? a / b : this.throwError('Division by zero'),
            '^': (a, b) => Math.pow(a, b),
            '%': (a, b) => a % b
        };
    }

    init() {
        this.setupDefaultFunctions();
        this.setupUI();
    }

    setupDefaultFunctions() {
        // Math functions
        this.functions.set('sqrt', Math.sqrt);
        this.functions.set('abs', Math.abs);
        this.functions.set('round', Math.round);
        this.functions.set('floor', Math.floor);
        this.functions.set('ceil', Math.ceil);
        this.functions.set('sin', Math.sin);
        this.functions.set('cos', Math.cos);
        this.functions.set('tan', Math.tan);
        this.functions.set('log', Math.log);
        this.functions.set('exp', Math.exp);

        // Financial functions
        this.functions.set('pmt', (rate, nper, pv) => {
            if (rate === 0) return -pv / nper;
            return (rate * pv) / (1 - Math.pow(1 + rate, -nper));
        });
        
        this.functions.set('fv', (rate, nper, pmt, pv = 0) => {
            if (rate === 0) return -(pv + pmt * nper);
            return -(pv * Math.pow(1 + rate, nper) + 
                    pmt * (Math.pow(1 + rate, nper) - 1) / rate);
        });
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="formula-evaluator">
                <div class="input-section">
                    <input type="text" id="formula-input" 
                           placeholder="Enter formula (e.g., '2 * (x + 5)')">
                    <button id="evaluate-btn">Evaluate</button>
                </div>
                
                <div class="variables-section">
                    <h3>Variables</h3>
                    <div id="variables-list"></div>
                    <button id="add-variable">Add Variable</button>
                </div>
                
                <div class="result-section">
                    <div id="result"></div>
                    <div id="error" class="error"></div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        this.addStyles();
        this.bindEvents();
    }

    addStyles() {
        const styles = `
            .formula-evaluator {
                max-width: 600px;
                margin: 20px auto;
                padding: 20px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }

            .input-section {
                display: flex;
                gap: 10px;
                margin-bottom: 20px;
            }

            #formula-input {
                flex-grow: 1;
                padding: 10px;
                border: 2px solid #ddd;
                border-radius: 4px;
                font-size: 16px;
            }

            button {
                padding: 10px 20px;
                background: #2196F3;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }

            button:hover {
                background: #1976D2;
            }

            .variables-section {
                margin-bottom: 20px;
            }

            .variable-item {
                display: flex;
                gap: 10px;
                margin-bottom: 10px;
                align-items: center;
            }

            .variable-item input {
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
            }

            .result-section {
                padding: 15px;
                background: #f5f5f5;
                border-radius: 4px;
            }

            #result {
                font-size: 18px;
                font-weight: bold;
                color: #2196F3;
            }

            .error {
                color: #f44336;
                margin-top: 10px;
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    bindEvents() {
        document.getElementById('evaluate-btn').onclick = () => this.evaluateFromUI();
        document.getElementById('add-variable').onclick = () => this.addVariableInput();
        document.getElementById('formula-input').onkeypress = (e) => {
            if (e.key === 'Enter') this.evaluateFromUI();
        };
    }

    addVariableInput() {
        const container = document.getElementById('variables-list');
        const variableItem = document.createElement('div');
        variableItem.className = 'variable-item';
        variableItem.innerHTML = `
            <input type="text" placeholder="Variable name" class="var-name">
            <input type="number" placeholder="Value" class="var-value">
            <button class="remove-var">×</button>
        `;

        container.appendChild(variableItem);

        variableItem.querySelector('.remove-var').onclick = () => 
            variableItem.remove();
    }

    evaluateFromUI() {
        try {
            this.updateVariablesFromUI();
            const formula = document.getElementById('formula-input').value;
            const result = this.evaluate(formula);
            this.showResult(result);
        } catch (error) {
            this.showError(error.message);
        }
    }

    updateVariablesFromUI() {
        this.variables.clear();
        document.querySelectorAll('.variable-item').forEach(item => {
            const name = item.querySelector('.var-name').value.trim();
            const value = parseFloat(item.querySelector('.var-value').value);
            
            if (name && !isNaN(value)) {
                this.variables.set(name, value);
            }
        });
    }

    evaluate(formula) {
        try {
            const tokens = this.tokenize(formula);
            const postfix = this.infixToPostfix(tokens);
            return this.evaluatePostfix(postfix);
        } catch (error) {
            throw new Error(`Invalid formula: ${error.message}`);
        }
    }

    tokenize(formula) {
        const tokens = [];
        let current = '';
        
        for (let i = 0; i < formula.length; i++) {
            const char = formula[i];
            
            if (char === ' ') {
                if (current) tokens.push(current);
                current = '';
                continue;
            }
            
            if ('+-*/^%()'.includes(char)) {
                if (current) tokens.push(current);
                tokens.push(char);
                current = '';
                continue;
            }
            
            current += char;
        }
        
        if (current) tokens.push(current);
        
        return tokens;
    }

    infixToPostfix(tokens) {
        const output = [];
        const stack = [];
        const precedence = {
            '^': 4,
            '*': 3,
            '/': 3,
            '+': 2,
            '-': 2
        };

        for (const token of tokens) {
            if (this.isNumber(token) || this.isVariable(token) || this.isFunction(token)) {
                output.push(token);
            } else if (token === '(') {
                stack.push(token);
            } else if (token === ')') {
                while (stack.length && stack[stack.length - 1] !== '(') {
                    output.push(stack.pop());
                }
                stack.pop(); // Remove '('
            } else {
                while (stack.length && precedence[stack[stack.length - 1]] >= precedence[token]) {
                    output.push(stack.pop());
                }
                stack.push(token);
            }
        }

        while (stack.length) {
            output.push(stack.pop());
        }

        return output;
    }

    evaluatePostfix(tokens) {
        const stack = [];

        for (const token of tokens) {
            if (this.isNumber(token)) {
                stack.push(parseFloat(token));
            } else if (this.isVariable(token)) {
                const value = this.variables.get(token);
                if (value === undefined) {
                    throw new Error(`Undefined variable: ${token}`);
                }
                stack.push(value);
            } else if (this.isFunction(token)) {
                const func = this.functions.get(token);
                const args = [];
                for (let i = 0; i < func.length; i++) {
                    args.unshift(stack.pop());
                }
                stack.push(func(...args));
            } else {
                const b = stack.pop();
                const a = stack.pop();
                stack.push(this.operators[token](a, b));
            }
        }

        return stack[0];
    }

    isNumber(token) {
        return !isNaN(parseFloat(token));
    }

    isVariable(token) {
        return this.variables.has(token);
    }

    isFunction(token) {
        return this.functions.has(token);
    }

    showResult(result) {
        document.getElementById('result').textContent = 
            `Result: ${Number(result.toFixed(6))}`;
        document.getElementById('error').textContent = '';
    }

    showError(message) {
        document.getElementById('result').textContent = '';
        document.getElementById('error').textContent = message;
    }

    throwError(message) {
        throw new Error(message);
    }
}

// Initialize
const evaluator = new FormulaEvaluator();
evaluator.init();