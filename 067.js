class StockMarketVisualizer {
    constructor() {
        this.stockData = new Map();
        this.activeCharts = new Map();
        this.websocket = null;
        this.predictiveModel = null;
    }

    async init() {
        await this.loadLibraries();
        this.setupUI();
        this.initializeWebSocket();
        await this.loadHistoricalData();
    }

    async loadLibraries() {
        // Load D3.js and TensorFlow.js
        await Promise.all([
            this.loadScript('https://d3js.org/d3.v7.min.js'),
            this.loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs/dist/tf.min.js')
        ]);
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="stock-dashboard">
                <div class="controls-panel">
                    <div class="symbol-search">
                        <input type="text" id="stock-search" placeholder="Search stock symbol...">
                        <button id="add-chart">Add Chart</button>
                    </div>
                    <div class="time-controls">
                        <button data-range="1d">1D</button>
                        <button data-range="1w">1W</button>
                        <button data-range="1m">1M</button>
                        <button data-range="3m">3M</button>
                        <button data-range="1y">1Y</button>
                    </div>
                    <div class="indicators">
                        <select id="technical-indicators" multiple>
                            <option value="sma">SMA</option>
                            <option value="ema">EMA</option>
                            <option value="rsi">RSI</option>
                            <option value="macd">MACD</option>
                        </select>
                    </div>
                </div>
                <div class="charts-grid" id="charts-container"></div>
                <div class="prediction-panel">
                    <h3>Predictive Analytics</h3>
                    <div id="prediction-results"></div>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('add-chart').onclick = () => {
            const symbol = document.getElementById('stock-search').value.toUpperCase();
            if (symbol) this.addNewChart(symbol);
        };

        document.querySelectorAll('.time-controls button').forEach(button => {
            button.onclick = () => this.updateTimeRange(button.dataset.range);
        });

        document.getElementById('technical-indicators').onchange = (e) => {
            this.updateIndicators(Array.from(e.target.selectedOptions, option => option.value));
        };
    }

    initializeWebSocket() {
        this.websocket = new WebSocket('wss://your-stock-data-server.com');
        this.websocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.updateChartData(data);
        };
    }

    async loadHistoricalData() {
        for (const symbol of this.stockData.keys()) {
            try {
                const response = await fetch(`https://api.example.com/historical/${symbol}`);
                const data = await response.json();
                this.stockData.set(symbol, data);
                this.updateChart(symbol);
            } catch (error) {
                console.error(`Failed to load historical data for ${symbol}:`, error);
            }
        }
    }

    addNewChart(symbol) {
        const chartContainer = document.createElement('div');
        chartContainer.className = 'chart-widget';
        chartContainer.innerHTML = `
            <div class="chart-header">
                <h3>${symbol}</h3>
                <button class="close-chart">×</button>
            </div>
            <div id="chart-${symbol}" class="chart-area"></div>
            <div class="chart-controls">
                <button class="toggle-prediction">Show Prediction</button>
            </div>
        `;
        document.getElementById('charts-container').appendChild(chartContainer);

        this.createChart(symbol);
        this.subscribeToRealtimeData(symbol);
    }

    createChart(symbol) {
        const svg = d3.select(`#chart-${symbol}`)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '400');

        // Create D3.js chart
        const margin = {top: 20, right: 30, bottom: 30, left: 60};
        const width = svg.node().getBoundingClientRect().width - margin.left - margin.right;
        const height = 400 - margin.top - margin.bottom;

        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Add axes
        const x = d3.scaleTime().range([0, width]);
        const y = d3.scaleLinear().range([height, 0]);

        g.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0,${height})`);

        g.append('g')
            .attr('class', 'y-axis');

        // Add line path
        g.append('path')
            .attr('class', 'line')
            .attr('fill', 'none')
            .attr('stroke', 'steelblue')
            .attr('stroke-width', 1.5);

        this.activeCharts.set(symbol, {svg, x, y, width, height});
    }

    updateChart(symbol) {
        const chart = this.activeCharts.get(symbol);
        const data = this.stockData.get(symbol);

        if (!chart || !data) return;

        const {svg, x, y, width, height} = chart;

        // Update scales
        x.domain(d3.extent(data, d => new Date(d.timestamp)));
        y.domain([
            d3.min(data, d => d.low),
            d3.max(data, d => d.high)
        ]);

        // Update line
        const line = d3.line()
            .x(d => x(new Date(d.timestamp)))
            .y(d => y(d.close));

        svg.select('.line')
            .datum(data)
            .attr('d', line);

        // Update axes
        svg.select('.x-axis').call(d3.axisBottom(x));
        svg.select('.y-axis').call(d3.axisLeft(y));
    }

    async generatePrediction(symbol) {
        const data = this.stockData.get(symbol);
        if (!data || !this.predictiveModel) return;

        const input = this.preprocessData(data);
        const prediction = await this.predictiveModel.predict(input).array();
        
        this.displayPrediction(symbol, prediction[0]);
    }

    preprocessData(data) {
        // Convert data to tensor format for prediction
        return tf.tensor2d(data.map(d => [
            d.open, d.high, d.low, d.close, d.volume
        ]));
    }

    displayPrediction(symbol, prediction) {
        const predictionDiv = document.querySelector(`#chart-${symbol} .prediction-overlay`);
        if (!predictionDiv) return;

        predictionDiv.innerHTML = `
            <div class="prediction-value">
                Predicted Close: $${prediction[0].toFixed(2)}
                <div class="confidence">Confidence: ${(prediction[1] * 100).toFixed(1)}%</div>
            </div>
        `;
    }
}

// Add styles
const styles = `
    .stock-dashboard {
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 20px;
        background: #f5f5f5;
    }
    .controls-panel {
        display: flex;
        gap: 20px;
        padding: 15px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .charts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
        gap: 20px;
    }
    .chart-widget {
        background: white;
        border-radius: 8px;
        padding: 15px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .chart-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
    }
    .chart-area {
        height: 400px;
    }
    .line {
        fill: none;
        stroke: #2196F3;
        stroke-width: 1.5;
    }
    .prediction-overlay {
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(255,255,255,0.9);
        padding: 10px;
        border-radius: 4px;
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize
const stockVisualizer = new StockMarketVisualizer();
stockVisualizer.init();