class StockTradingSimulator {
  constructor() {
    this.portfolio = new Portfolio();
    this.marketData = new MarketDataStream();
    this.tradingEngine = new TradingEngine();
    this.visualization = new PortfolioVisualizer();
    
    this.init();
  }

  async init() {
    await this.setupWebSocket();
    this.initializeUI();
    this.setupEventListeners();
    this.startDataStream();
  }

  setupWebSocket() {
    this.ws = new WebSocket('wss://api.stockmarket.com/stream');
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMarketData(data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.reconnectWebSocket();
    };
  }

  initializeUI() {
    this.elements = {
      portfolioValue: document.getElementById('portfolio-value'),
      stockList: document.getElementById('stock-list'),
      tradeForm: document.getElementById('trade-form'),
      algorithmPanel: document.getElementById('algorithm-panel'),
      chartContainer: document.getElementById('chart-container')
    };

    this.visualization.initializeCharts();
  }

  setupEventListeners() {
    this.elements.tradeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.executeTrade(new FormData(e.target));
    });

    document.getElementById('add-algorithm').addEventListener('click', () => {
      this.showAlgorithmModal();
    });
  }

  startDataStream() {
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      symbols: this.portfolio.getWatchlist()
    }));
  }

  handleMarketData(data) {
    this.marketData.updatePrice(data.symbol, data.price);
    this.tradingEngine.evaluateAlgorithms(data);
    this.updateUI();
  }
}

class Portfolio {
  constructor() {
    this.positions = new Map();
    this.cash = 100000; // Starting cash
    this.transactions = [];
  }

  executeOrder(order) {
    const totalCost = order.price * order.quantity;
    
    if (order.type === 'buy' && totalCost > this.cash) {
      throw new Error('Insufficient funds');
    }

    const position = this.positions.get(order.symbol) || {
      quantity: 0,
      averagePrice: 0
    };

    if (order.type === 'buy') {
      position.quantity += order.quantity;
      position.averagePrice = 
        (position.averagePrice * position.quantity + totalCost) / 
        (position.quantity + order.quantity);
      this.cash -= totalCost;
    } else {
      if (position.quantity < order.quantity) {
        throw new Error('Insufficient shares');
      }
      position.quantity -= order.quantity;
      this.cash += totalCost;
    }

    this.positions.set(order.symbol, position);
    this.transactions.push({
      ...order,
      timestamp: new Date(),
      remainingCash: this.cash
    });
  }

  getPortfolioValue(currentPrices) {
    let stockValue = 0;
    for (const [symbol, position] of this.positions) {
      stockValue += position.quantity * currentPrices.get(symbol);
    }
    return this.cash + stockValue;
  }

  getPerformanceMetrics() {
    return {
      totalReturn: this.getPortfolioValue() - 100000,
      positions: Array.from(this.positions.entries()),
      cash: this.cash
    };
  }
}

class MarketDataStream {
  constructor() {
    this.prices = new Map();
    this.history = new Map();
  }

  updatePrice(symbol, price) {
    this.prices.set(symbol, price);
    
    if (!this.history.has(symbol)) {
      this.history.set(symbol, []);
    }
    
    this.history.get(symbol).push({
      price,
      timestamp: new Date()
    });

    // Keep last 24 hours of data
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.history.set(
      symbol,
      this.history.get(symbol).filter(data => data.timestamp > dayAgo)
    );
  }

  getPrice(symbol) {
    return this.prices.get(symbol);
  }

  getPriceHistory(symbol, timeframe) {
    const history = this.history.get(symbol) || [];
    const timeframeStart = Date.now() - timeframe;
    
    return history.filter(data => data.timestamp >= timeframeStart);
  }
}

class TradingEngine {
  constructor() {
    this.algorithms = new Map();
  }

  addAlgorithm(algorithm) {
    this.algorithms.set(algorithm.id, algorithm);
  }

  removeAlgorithm(id) {
    this.algorithms.delete(id);
  }

  evaluateAlgorithms(marketData) {
    for (const algorithm of this.algorithms.values()) {
      if (algorithm.shouldExecute(marketData)) {
        const order = algorithm.generateOrder(marketData);
        if (order) {
          this.executeOrder(order);
        }
      }
    }
  }

  executeOrder(order) {
    try {
      portfolio.executeOrder(order);
    } catch (error) {
      console.error('Order execution failed:', error);
    }
  }
}

class TradingAlgorithm {
  constructor(params) {
    this.id = Date.now().toString();
    this.params = params;
  }

  shouldExecute(marketData) {
    const price = marketData.price;
    const symbol = marketData.symbol;

    switch (this.params.strategy) {
      case 'movingAverage':
        return this.evaluateMovingAverage(symbol, price);
      case 'priceThreshold':
        return this.evaluatePriceThreshold(price);
      case 'volumeBreakout':
        return this.evaluateVolumeBreakout(marketData);
      default:
        return false;
    }
  }

  evaluateMovingAverage(symbol, currentPrice) {
    const history = marketData.getPriceHistory(symbol, this.params.timeframe);
    const ma = this.calculateMovingAverage(history);
    
    return this.params.condition === 'above' ? 
      currentPrice > ma : currentPrice < ma;
  }

  calculateMovingAverage(priceHistory) {
    return priceHistory
      .map(data => data.price)
      .reduce((sum, price) => sum + price, 0) / priceHistory.length;
  }

  generateOrder(marketData) {
    return {
      symbol: marketData.symbol,
      type: this.params.action,
      quantity: this.calculateQuantity(marketData),
      price: marketData.price
    };
  }

  calculateQuantity(marketData) {
    if (this.params.quantityType === 'fixed') {
      return this.params.quantity;
    }
    
    // Calculate based on portfolio value percentage
    const portfolioValue = portfolio.getPortfolioValue(marketData.prices);
    return Math.floor(
      (portfolioValue * this.params.portfolioPercentage) / marketData.price
    );
  }
}

class PortfolioVisualizer {
  constructor() {
    this.charts = new Map();
  }

  initializeCharts() {
    this.initializeValueChart();
    this.initializePositionsChart();
    this.initializeTradesChart();
  }

  initializeValueChart() {
    const margin = { top: 20, right: 20, bottom: 30, left: 50 };
    const width = 800 - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3.select('#value-chart')
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    this.charts.set('value', {
      svg,
      width,
      height,
      x: d3.scaleTime().range([0, width]),
      y: d3.scaleLinear().range([height, 0])
    });
  }

  updateValueChart(data) {
    const chart = this.charts.get('value');
    const { svg, width, height, x, y } = chart;

    x.domain(d3.extent(data, d => d.timestamp));
    y.domain([
      d3.min(data, d => d.value) * 0.95,
      d3.max(data, d => d.value) * 1.05
    ]);

    const line = d3.line()
      .x(d => x(d.timestamp))
      .y(d => y(d.value));

    svg.selectAll('*').remove();

    // Add axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x));

    svg.append('g')
      .call(d3.axisLeft(y));

    // Add line
    svg.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', 'steelblue')
      .attr('stroke-width', 1.5)
      .attr('d', line);
  }

  updateUI() {
    const metrics = portfolio.getPerformanceMetrics();
    
    this.updateValueChart([{
      timestamp: new Date(),
      value: metrics.totalValue
    }]);

    this.elements.portfolioValue.textContent = 
      `$${metrics.totalValue.toFixed(2)}`;
  }
}

// Initialize simulator
const simulator = new StockTradingSimulator();