// Frontend Poll System
class PollSystem {
  constructor() {
    this.API_URL = '/api/polls';
    this.currentUser = null;
    this.currentPoll = null;
    
    this.init();
  }

  async init() {
    this.initializeUI();
    this.setupEventListeners();
    await this.checkAuthStatus();
    await this.loadPolls();
  }

  initializeUI() {
    this.elements = {
      pollList: document.getElementById('poll-list'),
      createPollForm: document.getElementById('create-poll-form'),
      pollDetails: document.getElementById('poll-details'),
      resultsContainer: document.getElementById('results-container'),
      optionsContainer: document.getElementById('poll-options'),
      loginForm: document.getElementById('login-form'),
      authSection: document.getElementById('auth-section')
    };

    // Initialize Chart.js
    this.resultsChart = new Chart(
      document.getElementById('results-chart'),
      {
        type: 'bar',
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            title: { display: true }
          }
        }
      }
    );
  }

  setupEventListeners() {
    this.elements.createPollForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handlePollCreation();
    });

    this.elements.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    // Dynamic option fields for poll creation
    document.getElementById('add-option').addEventListener('click', () => {
      this.addOptionField();
    });
  }

  async checkAuthStatus() {
    try {
      const response = await fetch('/api/auth/status');
      const data = await response.json();
      
      if (data.authenticated) {
        this.currentUser = data.user;
        this.updateAuthUI(true);
      } else {
        this.updateAuthUI(false);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    }
  }

  updateAuthUI(isAuthenticated) {
    this.elements.authSection.innerHTML = isAuthenticated
      ? `Welcome, ${this.currentUser.username} | <button onclick="pollSystem.logout()">Logout</button>`
      : this.elements.loginForm.outerHTML;
  }

  async handleLogin() {
    const formData = new FormData(this.elements.loginForm);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.get('username'),
          password: formData.get('password')
        })
      });

      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        this.updateAuthUI(true);
        this.loadPolls();
      } else {
        this.showError('Login failed');
      }
    } catch (error) {
      this.showError('Login failed');
    }
  }

  async loadPolls() {
    try {
      const response = await fetch(this.API_URL);
      const polls = await response.json();
      this.displayPolls(polls);
    } catch (error) {
      this.showError('Failed to load polls');
    }
  }

  displayPolls(polls) {
    this.elements.pollList.innerHTML = polls.map(poll => `
      <div class="poll-item" data-id="${poll.id}">
        <h3>${this.escapeHtml(poll.title)}</h3>
        <p>${this.escapeHtml(poll.description)}</p>
        <div class="poll-meta">
          <span>Created by: ${this.escapeHtml(poll.creator)}</span>
          <span>Responses: ${poll.response_count}</span>
        </div>
        <button onclick="pollSystem.viewPoll(${poll.id})">View Poll</button>
      </div>
    `).join('');
  }

  async viewPoll(pollId) {
    try {
      const [pollData, results] = await Promise.all([
        this.fetchPollData(pollId),
        this.fetchPollResults(pollId)
      ]);

      this.currentPoll = pollData;
      this.displayPollDetails(pollData);
      this.displayPollResults(results);
    } catch (error) {
      this.showError('Failed to load poll details');
    }
  }

  async fetchPollData(pollId) {
    const response = await fetch(`${this.API_URL}/${pollId}`);
    if (!response.ok) throw new Error('Failed to fetch poll');
    return response.json();
  }

  async fetchPollResults(pollId) {
    const response = await fetch(`${this.API_URL}/${pollId}/results`);
    if (!response.ok) throw new Error('Failed to fetch results');
    return response.json();
  }

  displayPollDetails(poll) {
    this.elements.pollDetails.innerHTML = `
      <h2>${this.escapeHtml(poll.title)}</h2>
      <p>${this.escapeHtml(poll.description)}</p>
      <form id="vote-form" onsubmit="pollSystem.submitVote(event)">
        ${poll.options.map(option => `
          <div class="option">
            <input type="radio" 
                   name="vote" 
                   value="${option.id}" 
                   id="option-${option.id}"
                   ${this.hasVoted(poll.id) ? 'disabled' : ''}>
            <label for="option-${option.id}">
              ${this.escapeHtml(option.text)}
            </label>
          </div>
        `).join('')}
        <button type="submit" ${this.hasVoted(poll.id) ? 'disabled' : ''}>
          Submit Vote
        </button>
      </form>
    `;
  }

  displayPollResults(results) {
    this.resultsChart.data = {
      labels: results.options.map(o => o.text),
      datasets: [{
        data: results.options.map(o => o.votes),
        backgroundColor: this.generateColors(results.options.length)
      }]
    };
    this.resultsChart.options.plugins.title.text = 'Poll Results';
    this.resultsChart.update();

    // Display detailed statistics
    this.elements.resultsContainer.innerHTML = `
      <div class="stats">
        <p>Total Votes: ${results.total_votes}</p>
        <div class="options-breakdown">
          ${results.options.map(option => `
            <div class="option-stat">
              <span>${this.escapeHtml(option.text)}</span>
              <span>${option.votes} votes (${option.percentage}%)</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  async handlePollCreation() {
    const formData = new FormData(this.elements.createPollForm);
    const options = Array.from(document.querySelectorAll('.option-input'))
      .map(input => input.value)
      .filter(value => value.trim() !== '');

    const pollData = {
      title: formData.get('title'),
      description: formData.get('description'),
      options: options,
      settings: {
        multiple_votes: formData.get('multiple_votes') === 'on',
        end_date: formData.get('end_date')
      }
    };

    try {
      const response = await fetch(this.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pollData)
      });

      if (response.ok) {
        this.elements.createPollForm.reset();
        this.loadPolls();
        this.showSuccess('Poll created successfully');
      } else {
        this.showError('Failed to create poll');
      }
    } catch (error) {
      this.showError('Failed to create poll');
    }
  }

  async submitVote(event) {
    event.preventDefault();
    
    if (!this.currentUser) {
      this.showError('Please login to vote');
      return;
    }

    const formData = new FormData(event.target);
    const optionId = formData.get('vote');

    try {
      const response = await fetch(`${this.API_URL}/${this.currentPoll.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id: optionId })
      });

      if (response.ok) {
        this.saveVoteLocally(this.currentPoll.id);
        await this.viewPoll(this.currentPoll.id);
        this.showSuccess('Vote submitted successfully');
      } else {
        this.showError('Failed to submit vote');
      }
    } catch (error) {
      this.showError('Failed to submit vote');
    }
  }

  hasVoted(pollId) {
    const votes = JSON.parse(localStorage.getItem('poll_votes') || '{}');
    return votes[pollId] === true;
  }

  saveVoteLocally(pollId) {
    const votes = JSON.parse(localStorage.getItem('poll_votes') || '{}');
    votes[pollId] = true;
    localStorage.setItem('poll_votes', JSON.stringify(votes));
  }

  addOptionField() {
    const optionField = document.createElement('div');
    optionField.className = 'option-field';
    optionField.innerHTML = `
      <input type="text" class="option-input" placeholder="Enter option">
      <button type="button" onclick="this.parentElement.remove()">Remove</button>
    `;
    this.elements.optionsContainer.appendChild(optionField);
  }

  generateColors(count) {
    const colors = [
      '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
      '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
    ];
    return Array(count).fill().map((_, i) => colors[i % colors.length]);
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

// Backend (Node.js with Express and PostgreSQL)
const express = require('express');
const { Pool } = require('pg');
const app = express();

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'poll_system',
  password: 'your_password',
  port: 5432,
});

// Database schema
const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS polls (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    creator_id INTEGER REFERENCES users(id),
    settings JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS poll_options (
    id SERIAL PRIMARY KEY,
    poll_id INTEGER REFERENCES polls(id),
    text VARCHAR(255) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS votes (
    id SERIAL PRIMARY KEY,
    poll_id INTEGER REFERENCES polls(id),
    option_id INTEGER REFERENCES poll_options(id),
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(poll_id, user_id)
  );
`;

// API Routes
app.get('/api/polls', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.username as creator, COUNT(v.id) as response_count
      FROM polls p
      LEFT JOIN users u ON p.creator_id = u.id
      LEFT JOIN votes v ON p.id = v.poll_id
      GROUP BY p.id, u.username
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});

app.get('/api/polls/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const poll = await pool.query(`
      SELECT p.*, u.username as creator
      FROM polls p
      LEFT JOIN users u ON p.creator_id = u.id
      WHERE p.id = $1
    `, [id]);

    const options = await pool.query(`
      SELECT * FROM poll_options WHERE poll_id = $1
    `, [id]);

    res.json({
      ...poll.rows[0],
      options: options.rows
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch poll' });
  }
});

app.get('/api/polls/:id/results', async (req, res) => {
  try {
    const { id } = req.params;
    const results = await pool.query(`
      SELECT 
        po.id,
        po.text,
        COUNT(v.id) as votes,
        ROUND(COUNT(v.id)::DECIMAL / 
          (SELECT COUNT(*) FROM votes WHERE poll_id = $1) * 100, 2) as percentage
      FROM poll_options po
      LEFT JOIN votes v ON po.id = v.option_id
      WHERE po.poll_id = $1
      GROUP BY po.id, po.text
    `, [id]);

    const totalVotes = await pool.query(`
      SELECT COUNT(*) as total FROM votes WHERE poll_id = $1
    `, [id]);

    res.json({
      options: results.rows,
      total_votes: parseInt(totalVotes.rows[0].total)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Initialize application
const pollSystem = new PollSystem();