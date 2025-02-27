class WeatherDashboard {
  constructor() {
    this.API_KEY = 'your_api_key';
    this.BASE_URL = 'https://api.openweathermap.org/data/2.5';
    this.MAX_HISTORY = 5;
    this.charts = {};
    
    this.initializeUI();
    this.loadSearchHistory();
    this.setupEventListeners();
  }

  initializeUI() {
    this.elements = {
      searchForm: document.getElementById('search-form'),
      searchInput: document.getElementById('city-input'),
      historyContainer: document.getElementById('search-history'),
      currentWeather: document.getElementById('current-weather'),
      forecast: document.getElementById('forecast'),
      temperatureChart: document.getElementById('temperature-chart'),
      humidityChart: document.getElementById('humidity-chart')
    };
  }

  setupEventListeners() {
    this.elements.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSearch();
    });

    this.elements.historyContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-item')) {
        this.handleHistoryClick(e.target.textContent);
      }
    });
  }

  async handleSearch() {
    const city = this.elements.searchInput.value.trim();
    if (!city) return;

    try {
      await this.fetchAndDisplayWeather(city);
      this.updateSearchHistory(city);
      this.elements.searchInput.value = '';
    } catch (error) {
      this.showError('Failed to fetch weather data');
    }
  }

  async handleHistoryClick(city) {
    await this.fetchAndDisplayWeather(city);
  }

  async fetchAndDisplayWeather(city) {
    try {
      const currentWeather = await this.fetchCurrentWeather(city);
      const forecast = await this.fetchForecast(city);
      
      this.displayCurrentWeather(currentWeather);
      this.displayForecast(forecast);
      this.updateCharts(forecast);
    } catch (error) {
      throw new Error('Failed to fetch weather data');
    }
  }

  async fetchCurrentWeather(city) {
    const response = await fetch(
      `${this.BASE_URL}/weather?q=${city}&appid=${this.API_KEY}&units=metric`
    );
    
    if (!response.ok) {
      throw new Error('City not found');
    }
    
    return response.json();
  }

  async fetchForecast(city) {
    const response = await fetch(
      `${this.BASE_URL}/forecast?q=${city}&appid=${this.API_KEY}&units=metric`
    );
    
    if (!response.ok) {
      throw new Error('Forecast data not available');
    }
    
    return response.json();
  }

  displayCurrentWeather(data) {
    const weather = {
      city: data.name,
      temperature: Math.round(data.main.temp),
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      description: data.weather[0].description,
      icon: data.weather[0].icon
    };

    this.elements.currentWeather.innerHTML = `
      <div class="current-weather-card">
        <h2>${weather.city}</h2>
        <img src="http://openweathermap.org/img/w/${weather.icon}.png" alt="Weather icon">
        <p class="temperature">${weather.temperature}°C</p>
        <p class="description">${weather.description}</p>
        <p>Humidity: ${weather.humidity}%</p>
        <p>Wind Speed: ${weather.windSpeed} m/s</p>
      </div>
    `;
  }

  displayForecast(data) {
    const dailyForecasts = this.processForecastData(data.list);
    
    this.elements.forecast.innerHTML = dailyForecasts
      .map(day => `
        <div class="forecast-card">
          <h3>${day.date}</h3>
          <img src="http://openweathermap.org/img/w/${day.icon}.png" alt="Weather icon">
          <p class="temperature">${Math.round(day.temp)}°C</p>
          <p class="description">${day.description}</p>
          <p>Humidity: ${day.humidity}%</p>
        </div>
      `)
      .join('');
  }

  processForecastData(forecastList) {
    const dailyData = {};
    
    forecastList.forEach(item => {
      const date = new Date(item.dt * 1000).toLocaleDateString();
      
      if (!dailyData[date]) {
        dailyData[date] = {
          date,
          temp: item.main.temp,
          humidity: item.main.humidity,
          description: item.weather[0].description,
          icon: item.weather[0].icon
        };
      }
    });

    return Object.values(dailyData);
  }

  updateCharts(forecast) {
    const chartData = this.prepareChartData(forecast.list);
    
    this.updateTemperatureChart(chartData);
    this.updateHumidityChart(chartData);
  }

  prepareChartData(forecastList) {
    return forecastList.slice(0, 8).map(item => ({
      time: new Date(item.dt * 1000).toLocaleTimeString(),
      temp: item.main.temp,
      humidity: item.main.humidity
    }));
  }

  updateTemperatureChart(data) {
    if (this.charts.temperature) {
      this.charts.temperature.destroy();
    }

    this.charts.temperature = new Chart(this.elements.temperatureChart, {
      type: 'line',
      data: {
        labels: data.map(item => item.time),
        datasets: [{
          label: 'Temperature (°C)',
          data: data.map(item => item.temp),
          borderColor: 'rgb(255, 99, 132)',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: false
          }
        }
      }
    });
  }

  updateHumidityChart(data) {
    if (this.charts.humidity) {
      this.charts.humidity.destroy();
    }

    this.charts.humidity = new Chart(this.elements.humidityChart, {
      type: 'line',
      data: {
        labels: data.map(item => item.time),
        datasets: [{
          label: 'Humidity (%)',
          data: data.map(item => item.humidity),
          borderColor: 'rgb(54, 162, 235)',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            max: 100
          }
        }
      }
    });
  }

  updateSearchHistory(city) {
    let history = this.getSearchHistory();
    
    // Remove city if it already exists
    history = history.filter(item => item.toLowerCase() !== city.toLowerCase());
    
    // Add new city at the beginning
    history.unshift(city);
    
    // Keep only the last MAX_HISTORY items
    history = history.slice(0, this.MAX_HISTORY);
    
    localStorage.setItem('weatherSearchHistory', JSON.stringify(history));
    this.displaySearchHistory(history);
  }

  getSearchHistory() {
    const history = localStorage.getItem('weatherSearchHistory');
    return history ? JSON.parse(history) : [];
  }

  loadSearchHistory() {
    const history = this.getSearchHistory();
    this.displaySearchHistory(history);
  }

  displaySearchHistory(history) {
    this.elements.historyContainer.innerHTML = history
      .map(city => `<button class="history-item">${city}</button>`)
      .join('');
  }

  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
      errorDiv.remove();
    }, 3000);
  }
}

// HTML structure
`
<!DOCTYPE html>
<html>
<head>
    <title>Weather Dashboard</title>
    <link rel="stylesheet" href="styles.css">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="dashboard">
        <div class="search-section">
            <form id="search-form">
                <input type="text" id="city-input" placeholder="Enter city name">
                <button type="submit">Search</button>
            </form>
            <div id="search-history"></div>
        </div>

        <div id="current-weather"></div>
        
        <div class="charts-container">
            <canvas id="temperature-chart"></canvas>
            <canvas id="humidity-chart"></canvas>
        </div>

        <div id="forecast"></div>
    </div>
    <script src="weather-dashboard.js"></script>
</body>
</html>
`

// CSS styles
`
.dashboard {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}

.search-section {
    margin-bottom: 20px;
}

#search-form {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
}

#city-input {
    flex: 1;
    padding: 8px;
    font-size: 16px;
}

.history-item {
    margin: 5px;
    padding: 5px 10px;
    background: #f0f0f0;
    border: none;
    border-radius: 3px;
    cursor: pointer;
}

.current-weather-card {
    background: #fff;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    margin-bottom: 20px;
}

.forecast {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin-top: 20px;
}

.forecast-card {
    background: #fff;
    padding: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    text-align: center;
}

.charts-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin: 20px 0;
}

.error-message {
    position: fixed;
    top: 20px;
    right: 20px;
    background: #ff4444;
    color: white;
    padding: 10px 20px;
    border-radius: 4px;
    animation: fadeIn 0.3s, fadeOut 0.3s 2.7s;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
}
`

// Initialize the dashboard
const weatherDashboard = new WeatherDashboard();