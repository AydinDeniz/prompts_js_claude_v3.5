class NewsAggregator {
    constructor() {
        this.userPreferences = new Map();
        this.articles = [];
        this.categories = ['technology', 'business', 'sports', 'entertainment', 'science'];
        this.mlModel = null;
    }

    async init() {
        await this.loadMLModel();
        this.setupUI();
        await this.loadUserPreferences();
        await this.fetchAndProcessNews();
    }

    async loadMLModel() {
        // Load pre-trained TensorFlow.js model for text classification
        this.mlModel = await tf.loadLayersModel('path/to/model.json');
    }

    async fetchAndProcessNews() {
        try {
            const response = await fetch('https://news-api.example.com/articles');
            const rawArticles = await response.json();
            
            this.articles = await Promise.all(rawArticles.map(async article => ({
                ...article,
                summary: await this.generateSummary(article.content),
                category: await this.classifyArticle(article.content),
                score: await this.calculateUserRelevance(article)
            })));

            this.sortAndDisplayArticles();
        } catch (error) {
            console.error('Failed to fetch news:', error);
        }
    }

    async generateSummary(content) {
        // Using TensorFlow.js for extractive summarization
        const sentences = content.split(/[.!?]+/).filter(Boolean);
        const embeddings = await this.mlModel.predict(
            tf.tensor2d([content], [1, content.length])
        ).array();

        return sentences
            .slice(0, 3)
            .join('. ') + '.';
    }

    async classifyArticle(content) {
        const prediction = await this.mlModel.predict(
            tf.tensor2d([content], [1, content.length])
        ).array();

        return this.categories[prediction[0].indexOf(Math.max(...prediction[0]))];
    }

    async calculateUserRelevance(article) {
        const userInterests = Array.from(this.userPreferences.values());
        const articleVector = await this.getArticleVector(article);
        
        return this.cosineSimilarity(articleVector, userInterests);
    }

    cosineSimilarity(vectorA, vectorB) {
        const dotProduct = vectorA.reduce((acc, val, i) => acc + val * vectorB[i], 0);
        const magnitudeA = Math.sqrt(vectorA.reduce((acc, val) => acc + val * val, 0));
        const magnitudeB = Math.sqrt(vectorB.reduce((acc, val) => acc + val * val, 0));
        
        return dotProduct / (magnitudeA * magnitudeB);
    }

    async getArticleVector(article) {
        // Convert article content to vector representation using TensorFlow.js
        const embedding = await this.mlModel.predict(
            tf.tensor2d([article.content], [1, article.content.length])
        ).array();

        return embedding[0];
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="news-aggregator">
                <div class="preferences-panel">
                    <h3>Your Interests</h3>
                    <div class="categories">
                        ${this.categories.map(category => `
                            <label>
                                <input type="checkbox" value="${category}">
                                ${category.charAt(0).toUpperCase() + category.slice(1)}
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="news-feed" id="news-feed"></div>
                <div class="recommendations" id="recommendations"></div>
            </div>
        `;
        document.body.appendChild(container);

        this.bindEvents();
    }

    bindEvents() {
        document.querySelectorAll('.categories input').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updatePreferences();
                this.sortAndDisplayArticles();
            });
        });
    }

    updatePreferences() {
        const selectedCategories = Array.from(
            document.querySelectorAll('.categories input:checked')
        ).map(input => input.value);

        this.userPreferences.set('categories', selectedCategories);
        localStorage.setItem('newsPreferences', JSON.stringify(Array.from(this.userPreferences)));
    }

    async loadUserPreferences() {
        const saved = localStorage.getItem('newsPreferences');
        if (saved) {
            this.userPreferences = new Map(JSON.parse(saved));
            // Update UI to reflect saved preferences
            this.userPreferences.get('categories').forEach(category => {
                document.querySelector(`input[value="${category}"]`).checked = true;
            });
        }
    }

    sortAndDisplayArticles() {
        const sortedArticles = [...this.articles]
            .sort((a, b) => b.score - a.score);

        const newsContainer = document.getElementById('news-feed');
        newsContainer.innerHTML = sortedArticles.map(article => `
            <article class="news-card ${article.category}">
                <h2>${article.title}</h2>
                <div class="metadata">
                    <span class="category">${article.category}</span>
                    <span class="relevance">Relevance: ${Math.round(article.score * 100)}%</span>
                </div>
                <p class="summary">${article.summary}</p>
                <a href="${article.url}" target="_blank">Read more</a>
            </article>
        `).join('');
    }
}

// Add styles
const styles = `
    .news-aggregator {
        display: grid;
        grid-template-columns: 250px 1fr;
        gap: 20px;
        padding: 20px;
        max-width: 1200px;
        margin: 0 auto;
    }
    .preferences-panel {
        position: sticky;
        top: 20px;
        background: white;
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .categories {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .news-card {
        padding: 20px;
        margin-bottom: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        background: white;
    }
    .metadata {
        display: flex;
        gap: 15px;
        margin: 10px 0;
        font-size: 0.9em;
        color: #666;
    }
    .summary {
        line-height: 1.6;
        color: #333;
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize
const newsAggregator = new NewsAggregator();
newsAggregator.init();