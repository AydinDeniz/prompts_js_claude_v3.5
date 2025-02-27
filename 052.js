class WeatherDashboard {
  constructor() {
    this.currentLocation = null;
    this.weatherData = null;
    this.historicalData = null;
    this.favorites = new Set();
    this.charts = null;
    
    this.init();
  }

  async init() {
    this.initializeUI();
    await this.loadFavorites();
    await this.setupGeolocation();
    this.setupEventListeners();
    this.setupCharts();
  }

  initializeUI() {
    this.elements = {
      currentWeather: document.getElementById('current-weather'),
      hourlyForecast: document.getElementById('hourly-forecast'),
      weeklyForecast: document.getElementById('weekly-forecast'),
      locationSearch: document.getElementById('location-search'),
      favoritesList: document.getElementById('favorites-list'),
      historicalData: document.getElementById('historical-data'),
      alertsPanel: document.getElementById('weather-alerts'),
      chartContainer: document.getElementById('chart-container')
    };
  }

  async setupGeolocation() {
    try {
      const position = await this.getCurrentPosition();
      this.currentLocation = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };
      await this.loadWeatherData();
    } catch (error) {
      console.error('Geolocation failed:', error);
      this.showError('Could not get location. Please search manually.');
    }
  }

  getCurrentPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });
  }

  setupEventListeners() {
    this.elements.locationSearch.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLocationSearch(new FormData(e.target));
    });

    document.getElementById('refresh-data').addEventListener('click', () => {
      this.loadWeatherData();
    });

    document.getElementById('toggle-unit').addEventListener('click', () => {
      this.toggleTemperatureUnit();
    });
  }

  setupCharts() {
    this.charts = {
      temperature: new Chart(
        document.getElementById('temperature-chart'), {
          type: 'line',
          options: {
            responsive: true,
            plugins: {
              title: {
                display: true,
                text: 'Temperature Trend'
              }
            },
            scales: {
              y: {
                beginAtZero: false
              }
            }
          }
        }
      ),

      precipitation: new Chart(
        document.getElementById('precipitation-chart'), {
          type: 'bar',
          options: {
            responsive: true,
            plugins: {
              title: {
                display: true,
                text: 'Precipitation Probability'
              }
            }
          }
        }
      ),

      windSpeed: new Chart(
        document.getElementById('wind-chart'), {
          type: 'line',
          options: {
            responsive: true,
            plugins: {
              title: {
                display: true,
                text: 'Wind Speed'
              }
            }
          }
        }
      )
    };
  }

  async loadWeatherData() {
    try {
      const [current, hourly, daily] = await Promise.all([
        this.fetchCurrentWeather(),
        this.fetchHourlyForecast(),
        this.fetchDailyForecast()
      ]);

      this.weatherData = {
        current,
        hourly,
        daily
      };

      this.updateDashboard();
    } catch (error) {
      console.error('Failed to load weather data:', error);
      this.showError('Failed to load weather data');
    }
  }

  async fetchCurrentWeather() {
    const response = await fetch(
      `${this.API_BASE_URL}/weather?lat=${this.currentLocation.lat}&lon=${this.currentLocation.lon}&appid=${this.API_KEY}&units=metric`
    );
    return response.json();
  }

  async fetchHourlyForecast() {
    const response = await fetch(
      `${this.API_BASE_URL}/forecast/hourly?lat=${this.currentLocation.lat}&lon=${this.currentLocation.lon}&appid=${this.API_KEY}&units=metric`
    );
    return response.json();
  }

  async fetchDailyForecast() {
    const response = await fetch(
      `${this.API_BASE_URL}/forecast/daily?lat=${this.currentLocation.lat}&lon=${this.currentLocation.lon}&appid=${this.API_KEY}&units=metric`
    );
    return response.json();
  }

  async fetchHistoricalData(startDate, endDate) {
    const response = await fetch(
      `${this.API_BASE_URL}/history?lat=${this.currentLocation.lat}&lon=${this.currentLocation.lon}&start=${startDate}&end=${endDate}&appid=${this.API_KEY}&units=metric`
    );
    return response.json();
  }

  updateDashboard() {
    this.updateCurrentWeather();
    this.updateHourlyForecast();
    this.updateWeeklyForecast();
    this.updateCharts();
    this.checkWeatherAlerts();
  }

  updateCurrentWeather() {
    const current = this.weatherData.current;
    
    this.elements.currentWeather.innerHTML = `
      <div class="current-conditions">
        <h2>${this.formatLocation(current.name)}</h2>
        <div class="temperature">
          ${this.formatTemperature(current.main.temp)}
        </div>
        <div class="weather-icon">
          <img src="${this.getWeatherIcon(current.weather[0].icon)}" 
               alt="${current.weather[0].description}">
        </div>
        <div class="conditions">
          ${current.weather[0].description}
        </div>
        <div class="details">
          <div class="detail">
            <span>Feels like:</span>
            ${this.formatTemperature(current.main.feels_like)}
          </div>
          <div class="detail">
            <span>Humidity:</span>
            ${current.main.humidity}%
          </div>
          <div class="detail">
            <span>Wind:</span>
            ${this.formatWindSpeed(current.wind.speed)}
          </div>
          <div class="detail">
            <span>Pressure:</span>
            ${current.main.pressure} hPa
          </div>
        </div>
      </div>
    `;
  }

  updateHourlyForecast() {
    const hourly = this.weatherData.hourly.list.slice(0, 24);
    
    this.elements.hourlyForecast.innerHTML = `
      <div class="hourly-scroll">
        ${hourly.map(hour => `
          <div class="hour-forecast">
            <div class="time">${this.formatTime(hour.dt)}</div>
            <img src="${this.getWeatherIcon(hour.weather[0].icon)}" 
                 alt="${hour.weather[0].description}">
            <div class="temp">${this.formatTemperature(hour.main.temp)}</div>
            <div class="precip">
              ${hour.pop > 0 ? `${Math.round(hour.pop * 100)}%` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  updateWeeklyForecast() {
    const daily = this.weatherData.daily.list;
    
    this.elements.weeklyForecast.innerHTML = `
      <div class="weekly-grid">
        ${daily.map(day => `
          <div class="day-forecast">
            <div class="date">${this.formatDate(day.dt)}</div>
            <img src="${this.getWeatherIcon(day.weather[0].icon)}" 
                 alt="${day.weather[0].description}">
            <div class="temp-range">
              <span class="high">${this.formatTemperature(day.temp.max)}</span>
              <span class="low">${this.formatTemperature(day.temp.min)}</span>
            </div>
            <div class="conditions">${day.weather[0].description}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  updateCharts() {
    // Temperature chart
    const hourly = this.weatherData.hourly.list;
    this.charts.temperature.data = {
      labels: hourly.map(hour => this.formatTime(hour.dt)),
      datasets: [{
        label: 'Temperature',
        data: hourly.map(hour => hour.main.temp),
        borderColor: 'rgb(255, 99, 132)',
        tension: 0.1
      }]
    };
    this.charts.temperature.update();

    // Precipitation chart
    this.charts.precipitation.data = {
      labels: hourly.map(hour => this.formatTime(hour.dt)),
      datasets: [{
        label: 'Precipitation Probability',
        data: hourly.map(hour => hour.pop * 100),
        backgroundColor: 'rgb(54, 162, 235)'
      }]
    };
    this.charts.precipitation.update();

    // Wind speed chart
    this.charts.windSpeed.data = {
      labels: hourly.map(hour => this.formatTime(hour.dt)),
      datasets: [{
        label: 'Wind Speed',
        data: hourly.map(hour => hour.wind.speed),
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      }]
    };
    this.charts.windSpeed.update();
  }

  checkWeatherAlerts() {
    const alerts = this.weatherData.current.alerts || [];
    
    this.elements.alertsPanel.innerHTML = alerts.length ? `
      <div class="alerts-container">
        ${alerts.map(alert => `
          <div class="alert ${this.getAlertSeverityClass(alert.severity)}">
            <h4>${alert.event}</h4>
            <p>${alert.description}</p>
            <span class="alert-time">
              ${this.formatTimeRange(alert.start, alert.end)}
            </span>
          </div>
        `).join('')}
      </div>
    ` : '';
  }

  async handleLocationSearch(formData) {
    const location = formData.get('location');
    try {
      const coordinates = await this.geocodeLocation(location);
      this.currentLocation = coordinates;
      await this.loadWeatherData();
      this.updateLocationHistory(location, coordinates);
    } catch (error) {
      console.error('Location search failed:', error);
      this.showError('Location not found');
    }
  }

  async geocodeLocation(location) {
    const response = await fetch(
      `${this.GEOCODING_API_URL}?q=${encodeURIComponent(location)}&appid=${this.API_KEY}`
    );
    const data = await response.json();
    
    if (!data.length) {
      throw new Error('Location not found');
    }

    return {
      lat: data[0].lat,
      lon: data[0].lon
    };
  }

  toggleTemperatureUnit() {
    this.useMetric = !this.useMetric;
    this.updateDashboard();
  }

  formatTemperature(temp) {
    if (!this.useMetric) {
      temp = (temp * 9/5) + 32;
    }
    return `${Math.round(temp)}°${this.useMetric ? 'C' : 'F'}`;
  }

  formatWindSpeed(speed) {
    if (!this.useMetric) {
      speed = speed * 2.237; // Convert m/s to mph
    }
    return `${Math.round(speed)} ${this.useMetric ? 'm/s' : 'mph'}`;
  }

  formatTime(timestamp) {
    return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  formatDate(timestamp) {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  formatTimeRange(start, end) {
    return `${this.formatTime(start)} - ${this.formatTime(end)}`;
  }

  getWeatherIcon(iconCode) {
    return `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
  }

  getAlertSeverityClass(severity) {
    const severityMap = {
      'Extreme': 'alert-extreme',
      'Severe': 'alert-severe',
      'Moderate': 'alert-moderate',
      'Minor': 'alert-minor'
    };
    return severityMap[severity] || 'alert-info';
  }

  showError(message) {
    const alert = document.createElement('div');
    alert.className = 'error-alert';
    alert.textContent = message;
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 5000);
  }
}

// Initialize dashboard
const weatherDashboard = new WeatherDashboard();