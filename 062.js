class CryptoTradingBot {
  constructor() {
    this.exchanges = new Map();
    this.strategies = new Map();
    this.positions = new Map();
    this.trades = new Map();
    this.marketData = new Map();
    this.signals = new Map();
    
    this.init();
  }

  async init() {
    await this.initializeExchanges();
    this.setupDatabase();
    this.initializeStrategies();
    this.setupWebSocket();
    this.initializeUI();
    this.startMonitoring();
  }

  async initializeExchanges() {
    // Initialize exchange APIs
    this.exchanges.set('binance', new BinanceAPI({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET
    }));

    this.exchanges.set('coinbase', new CoinbaseAPI({
      apiKey: process.env.COINBASE_API_KEY,
      apiSecret: process.env.COINBASE_API_SECRET
    }));

    // Authenticate and verify API connections
    await Promise.all(
      Array.from(this.exchanges.values()).map(exchange => 
        exchange.authenticate()
      )
    );
  }

  setupDatabase() {
    this.db = new PouchDB('crypto_trading_bot');
    
    PouchDB.sync('crypto_trading_bot', 'http://localhost:5984/crypto_trading_bot', {
      live: true,
      retry: true
    });
  }

  initializeStrategies() {
    // Register trading strategies
    this.strategies.set('movingAverageCrossover', {
      name: 'Moving Average Crossover',
      parameters: {
        shortPeriod: 9,
        longPeriod: 21,
        signalPeriod: 9
      },
      indicator: new MovingAverageCrossover()
    });

    this.strategies.set('rsiStrategy', {
      name: 'RSI Strategy',
      parameters: {
        period: 14,
        overbought: 70,
        oversold: 30
      },
      indicator: new RSIStrategy()
    });

    this.strategies.set('bollingerBands', {
      name: 'Bollinger Bands Strategy',
      parameters: {
        period: 20,
        standardDeviations: 2
      },
      indicator: new BollingerBandsStrategy()
    });
  }

  setupWebSocket() {
    this.socket = new WebSocket('wss://stream.binance.com:9443/ws');
    
    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMarketData(data);
    };

    this.socket.onclose = () => {
      console.log('WebSocket connection closed');
      setTimeout(() => this.setupWebSocket(), 5000);
    };
  }

  initializeUI() {
    this.elements = {
      tradingView: document.getElementById('trading-view'),
      strategyPanel: document.getElementById('strategy-panel'),
      positionsTable: document.getElementById('positions-table'),
      tradeLog: document.getElementById('trade-log'),
      performanceChart: document.getElementById('performance-chart')
    };

    this.setupCharts();
    this.setupEventListeners();
  }

  setupCharts() {
    this.charts = {
      performance: new Chart(document.getElementById('performance-chart'), {
        type: 'line',
        options: {
          scales: { y: { beginAtZero: true } }
        }
      }),

      indicators: new Chart(document.getElementById('indicators-chart'), {
        type: 'line',
        options: {
          scales: { y: { beginAtZero: false } }
        }
      })
    };
  }

  startMonitoring() {
    // Start market data monitoring
    this.monitorMarketData();
    
    // Start strategy evaluation
    setInterval(() => this.evaluateStrategies(), 1000);
    
    // Start position monitoring
    setInterval(() => this.monitorPositions(), 5000);
    
    // Update performance metrics
    setInterval(() => this.updatePerformanceMetrics(), 60000);
  }

  async monitorMarketData() {
    const pairs = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT'];
    
    for (const exchange of this.exchanges.values()) {
      for (const pair of pairs) {
        try {
          const ticker = await exchange.fetchTicker(pair);
          this.updateMarketData(exchange.id, pair, ticker);
        } catch (error) {
          console.error(`Failed to fetch ticker for ${pair}:`, error);
        }
      }
    }
  }

  updateMarketData(exchangeId, pair, ticker) {
    const key = `${exchangeId}-${pair}`;
    const data = {
      timestamp: new Date(),
      price: ticker.last,
      volume: ticker.volume,
      high: ticker.high,
      low: ticker.low,
      bid: ticker.bid,
      ask: ticker.ask
    };

    this.marketData.set(key, data);
    this.updateCharts(key, data);
    this.checkAlerts(key, data);
  }

  async evaluateStrategies() {
    for (const [strategyId, strategy] of this.strategies) {
      for (const [marketKey, data] of this.marketData) {
        try {
          const signal = await strategy.indicator.evaluate(data);
          if (signal) {
            this.handleTradingSignal(strategyId, marketKey, signal);
          }
        } catch (error) {
          console.error(`Strategy evaluation failed for ${strategyId}:`, error);
        }
      }
    }
  }

  async handleTradingSignal(strategyId, marketKey, signal) {
    const [exchangeId, pair] = marketKey.split('-');
    const exchange = this.exchanges.get(exchangeId);
    
    if (signal.action === 'buy' && this.canOpenPosition(pair)) {
      await this.openPosition(exchange, pair, signal);
    } else if (signal.action === 'sell' && this.hasOpenPosition(pair)) {
      await this.closePosition(exchange, pair, signal);
    }

    this.logSignal(strategyId, marketKey, signal);
  }

  async openPosition(exchange, pair, signal) {
    try {
      const order = await exchange.createOrder(pair, 'market', 'buy', signal.amount);
      
      const position = {
        id: `pos-${Date.now()}`,
        exchange: exchange.id,
        pair,
        type: 'long',
        entryPrice: order.price,
        amount: order.amount,
        timestamp: new Date(),
        status: 'open'
      };

      this.positions.set(position.id, position);
      this.logTrade('open', position, order);
      this.updateUI();
    } catch (error) {
      console.error('Failed to open position:', error);
      this.logError('open_position', error);
    }
  }

  async closePosition(exchange, pair, signal) {
    const position = this.getOpenPosition(pair);
    if (!position) return;

    try {
      const order = await exchange.createOrder(
        pair,
        'market',
        'sell',
        position.amount
      );

      position.status = 'closed';
      position.exitPrice = order.price;
      position.closedAt = new Date();
      position.profit = this.calculateProfit(position);

      await this.updatePosition(position);
      this.logTrade('close', position, order);
      this.updateUI();
    } catch (error) {
      console.error('Failed to close position:', error);
      this.logError('close_position', error);
    }
  }

  calculateProfit(position) {
    const entryValue = position.entryPrice * position.amount;
    const exitValue = position.exitPrice * position.amount;
    return position.type === 'long' ? exitValue - entryValue : entryValue - exitValue;
  }

  async updatePosition(position) {
    try {
      const doc = await this.db.get(position.id);
      await this.db.put({
        ...doc,
        ...position
      });
    } catch (error) {
      console.error('Failed to update position:', error);
    }
  }

  logTrade(type, position, order) {
    const trade = {
      id: `trade-${Date.now()}`,
      type,
      position: position.id,
      exchange: position.exchange,
      pair: position.pair,
      price: order.price,
      amount: order.amount,
      timestamp: new Date()
    };

    this.trades.set(trade.id, trade);
    this.updateTradeLog(trade);
  }

  updateTradeLog(trade) {
    const logEntry = document.createElement('div');
    logEntry.className = `trade-log-entry ${trade.type}`;
    logEntry.innerHTML = `
      <span class="timestamp">${this.formatTime(trade.timestamp)}</span>
      <span class="type">${trade.type.toUpperCase()}</span>
      <span class="pair">${trade.pair}</span>
      <span class="price">${trade.price}</span>
      <span class="amount">${trade.amount}</span>
    `;
    this.elements.tradeLog.prepend(logEntry);
  }

  updatePerformanceMetrics() {
    const metrics = this.calculatePerformanceMetrics();
    this.updatePerformanceChart(metrics);
    this.updatePerformanceTable(metrics);
  }

  calculatePerformanceMetrics() {
    const closedPositions = Array.from(this.positions.values())
      .filter(p => p.status === 'closed');

    return {
      totalTrades: closedPositions.length,
      profitableTrades: clos