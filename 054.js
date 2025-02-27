class SocialMediaAnalyzer {
  constructor() {
    this.data = {
      posts: new Map(),
      trends: new Map(),
      engagement: new Map(),
      sentiment: new Map()
    };
    this.apis = new Map();
    this.analytics = null;
    
    this.init();
  }

  async init() {
    await this.initializeAPIs();
    this.setupAnalytics();
    this.initializeUI();
    this.setupEventListeners();
    this.startRealTimeMonitoring();
  }

  async initializeAPIs() {
    // Initialize social media APIs
    this.apis.set('twitter', new TwitterAPI({
      apiKey: process.env.TWITTER_API_KEY,
      apiSecret: process.env.TWITTER_API_SECRET,
      bearerToken: process.env.TWITTER_BEARER_TOKEN
    }));

    this.apis.set('instagram', new InstagramAPI({
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
      clientId: process.env.INSTAGRAM_CLIENT_ID
    }));
  }

  setupAnalytics() {
    this.analytics = {
      sentiment: new SentimentAnalyzer(),
      trends: new TrendAnalyzer(),
      engagement: new EngagementAnalyzer(),
      demographics: new DemographicsAnalyzer()
    };
  }

  initializeUI() {
    this.elements = {
      dashboard: document.getElementById('analytics-dashboard'),
      trendChart: document.getElementById('trend-chart'),
      engagementMetrics: document.getElementById('engagement-metrics'),
      sentimentAnalysis: document.getElementById('sentiment-analysis'),
      demographicsPanel: document.getElementById('demographics-panel'),
      timelineView: document.getElementById('timeline-view')
    };

    this.setupCharts();
  }

  setupCharts() {
    this.charts = {
      engagement: new Chart(this.elements.trendChart, {
        type: 'line',
        options: {
          responsive: true,
          scales: { y: { beginAtZero: true } }
        }
      }),

      sentiment: new Chart(document.getElementById('sentiment-chart'), {
        type: 'doughnut',
        options: {
          responsive: true,
          plugins: { legend: { position: 'right' } }
        }
      }),

      demographics: new Chart(document.getElementById('demographics-chart'), {
        type: 'bar',
        options: {
          indexAxis: 'y',
          responsive: true
        }
      })
    };
  }

  setupEventListeners() {
    document.getElementById('fetch-data').addEventListener('click', () => {
      this.fetchSocialData();
    });

    document.getElementById('timeframe-selector').addEventListener('change', (e) => {
      this.updateTimeframe(e.target.value);
    });

    document.getElementById('platform-selector').addEventListener('change', (e) => {
      this.switchPlatform(e.target.value);
    });
  }

  async fetchSocialData() {
    try {
      const [twitterData, instagramData] = await Promise.all([
        this.fetchTwitterData(),
        this.fetchInstagramData()
      ]);

      await this.processData([...twitterData, ...instagramData]);
      this.updateDashboard();
    } catch (error) {
      console.error('Failed to fetch social data:', error);
      this.showError('Data fetch failed');
    }
  }

  async fetchTwitterData() {
    const api = this.apis.get('twitter');
    const tweets = await api.getUserTimeline({
      count: 200,
      include_rts: true
    });

    return tweets.map(tweet => ({
      platform: 'twitter',
      id: tweet.id_str,
      content: tweet.text,
      timestamp: new Date(tweet.created_at),
      engagement: {
        likes: tweet.favorite_count,
        retweets: tweet.retweet_count,
        replies: tweet.reply_count
      },
      media: tweet.entities.media || []
    }));
  }

  async fetchInstagramData() {
    const api = this.apis.get('instagram');
    const posts = await api.getUserMedia();

    return posts.map(post => ({
      platform: 'instagram',
      id: post.id,
      content: post.caption,
      timestamp: new Date(post.timestamp),
      engagement: {
        likes: post.like_count,
        comments: post.comments_count,
        saves: post.saved_count
      },
      media: post.media_url
    }));
  }

  async processData(posts) {
    // Process posts for sentiment analysis
    const sentimentResults = await Promise.all(
      posts.map(post => this.analytics.sentiment.analyze(post.content))
    );

    // Analyze engagement patterns
    const engagementMetrics = this.analytics.engagement.analyze(posts);

    // Identify trends
    const trends = this.analytics.trends.identify(posts);

    // Analyze demographics
    const demographics = await this.analytics.demographics.analyze(posts);

    // Store processed data
    this.data.posts = new Map(posts.map(post => [post.id, post]));
    this.data.sentiment = new Map(posts.map((post, i) => [
      post.id, 
      sentimentResults[i]
    ]));
    this.data.engagement = engagementMetrics;
    this.data.trends = trends;
    this.data.demographics = demographics;
  }

  updateDashboard() {
    this.updateEngagementChart();
    this.updateSentimentAnalysis();
    this.updateTrendingTopics();
    this.updateDemographics();
    this.updateTimelineView();
  }

  updateEngagementChart() {
    const engagementData = this.prepareEngagementData();
    
    this.charts.engagement.data = {
      labels: engagementData.labels,
      datasets: [{
        label: 'Engagement Rate',
        data: engagementData.rates,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      }]
    };
    this.charts.engagement.update();
  }

  prepareEngagementData() {
    const sortedPosts = Array.from(this.data.posts.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      labels: sortedPosts.map(post => 
        post.timestamp.toLocaleDateString()
      ),
      rates: sortedPosts.map(post => 
        this.calculateEngagementRate(post)
      )
    };
  }

  calculateEngagementRate(post) {
    const metrics = post.engagement;
    const totalEngagement = metrics.likes + 
      (metrics.retweets || 0) + 
      (metrics.comments || 0) + 
      (metrics.saves || 0);
    
    return (totalEngagement / this.getFollowerCount(post.platform)) * 100;
  }

  updateSentimentAnalysis() {
    const sentimentData = this.aggregateSentimentData();
    
    this.charts.sentiment.data = {
      labels: ['Positive', 'Neutral', 'Negative'],
      datasets: [{
        data: [
          sentimentData.positive,
          sentimentData.neutral,
          sentimentData.negative
        ],
        backgroundColor: [
          'rgb(75, 192, 192)',
          'rgb(255, 205, 86)',
          'rgb(255, 99, 132)'
        ]
      }]
    };
    this.charts.sentiment.update();
  }

  aggregateSentimentData() {
    return Array.from(this.data.sentiment.values())
      .reduce((acc, sentiment) => {
        acc[sentiment.label]++;
        return acc;
      }, { positive: 0, neutral: 0, negative: 0 });
  }

  updateTrendingTopics() {
    const trendingTopics = Array.from(this.data.trends.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 10);

    this.elements.trendChart.innerHTML = `
      <div class="trending-topics">
        ${trendingTopics.map(([topic, data]) => `
          <div class="trend-item">
            <span class="topic">${topic}</span>
            <span class="score">${data.score.toFixed(2)}</span>
            <div class="trend-graph">
              ${this.renderTrendGraph(data.history)}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderTrendGraph(history) {
    const max = Math.max(...history);
    return `
      <svg class="trend-line" viewBox="0 0 100 20">
        <polyline
          points="${history.map((value, index) => 
            `${(index / (history.length - 1)) * 100},${20 - (value / max) * 20}`
          ).join(' ')}"
        />
      </svg>
    `;
  }

  updateDemographics() {
    const demographics = this.data.demographics;
    
    this.charts.demographics.data = {
      labels: Object.keys(demographics.ageGroups),
      datasets: [{
        label: 'Age Distribution',
        data: Object.values(demographics.ageGroups),
        backgroundColor: 'rgba(75, 192, 192, 0.6)'
      }]
    };
    this.charts.demographics.update();
  }

  updateTimelineView() {
    const posts = Array.from(this.data.posts.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    this.elements.timelineView.innerHTML = posts.map(post => `
      <div class="post-card ${post.platform}">
        <div class="post-header">
          <span class="platform-icon">${this.getPlatformIcon(post.platform)}</span>
          <span class="timestamp">${post.timestamp.toLocaleString()}</span>
        </div>
        <div class="post-content">
          ${this.renderPostContent(post)}
        </div>
        <div class="post-metrics">
          ${this.renderEngagementMetrics(post)}
          <div class="sentiment-indicator ${this.getSentimentClass(post.id)}">
            ${this.getSentimentEmoji(post.id)}
          </div>
        </div>
      </div>
    `).join('');
  }

  startRealTimeMonitoring() {
    // Set up WebSocket connections for real-time updates
    this.apis.forEach(api => {
      api.streamUpdates(update => {
        this.processRealTimeUpdate(update);
      });
    });
  }

  async processRealTimeUpdate(update) {
    // Process new data
    const sentiment = await this.analytics.sentiment.analyze(update.content);
    
    // Update data stores
    this.data.posts.set(update.id, update);
    this.data.sentiment.set(update.id, sentiment);
    
    // Update trends
    this.data.trends = this.analytics.trends.update(
      this.data.trends,
      update
    );
    
    // Update UI
    this.updateDashboard();
  }

  exportAnalytics() {
    const report = {
      timestamp: new Date(),
      metrics: {
        engagement: this.data.engagement,
        sentiment: this.aggregateSentimentData(),
        trends: Array.from(this.data.trends.entries()),
        demographics: this.data.demographics
      },
      posts: Array.from(this.data.posts.values())
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `social-analytics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Initialize analyzer
const socialAnalyzer = new SocialMediaAnalyzer();