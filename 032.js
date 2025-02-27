class SmartHomeAssistant {
  constructor() {
    this.devices = new Map();
    this.recognition = null;
    this.socket = null;
    this.isListening = false;
    this.commandPatterns = new Map();
    
    this.init();
  }

  async init() {
    this.initializeSpeechRecognition();
    this.setupWebSocket();
    this.setupCommandPatterns();
    this.initializeUI();
    await this.loadDevices();
  }

  initializeSpeechRecognition() {
    this.recognition = new webkitSpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    
    this.recognition.onresult = (event) => {
      const command = event.results[event.results.length - 1][0].transcript;
      this.processVoiceCommand(command.toLowerCase());
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
    };
  }

  setupWebSocket() {
    this.socket = new WebSocket('ws://localhost:1880/ws/devices');
    
    this.socket.onmessage = (event) => {
      const update = JSON.parse(event.data);
      this.handleDeviceUpdate(update);
    };

    this.socket.onclose = () => {
      setTimeout(() => this.setupWebSocket(), 1000);
    };
  }

  setupCommandPatterns() {
    this.commandPatterns.set(/turn (on|off) (?:the )?(.+)/, (matches) => {
      const state = matches[1] === 'on';
      const device = matches[2];
      this.controlDevice(device, state);
    });

    this.commandPatterns.set(/set (?:the )?(.+) to (.+)/, (matches) => {
      const device = matches[1];
      const value = matches[2];
      this.setDeviceValue(device, value);
    });

    this.commandPatterns.set(/what is (?:the )?(.+) status/, (matches) => {
      const device = matches[1];
      this.getDeviceStatus(device);
    });
  }

  initializeUI() {
    this.elements = {
      deviceList: document.getElementById('device-list'),
      statusPanel: document.getElementById('status-panel'),
      voiceButton: document.getElementById('voice-control'),
      notificationArea: document.getElementById('notifications')
    };

    this.elements.voiceButton.addEventListener('click', () => {
      this.toggleVoiceRecognition();
    });

    this.setupDashboard();
  }

  setupDashboard() {
    this.dashboard = {
      temperature: new Chart(
        document.getElementById('temperature-chart'), {
          type: 'line',
          options: {
            responsive: true,
            animation: false
          }
        }
      ),
      energy: new Chart(
        document.getElementById('energy-chart'), {
          type: 'bar',
          options: {
            responsive: true
          }
        }
      )
    };
  }

  async loadDevices() {
    try {
      const response = await fetch('http://localhost:1880/api/devices');
      const devices = await response.json();
      
      devices.forEach(device => {
        this.devices.set(device.id, device);
      });
      
      this.updateDeviceList();
    } catch (error) {
      console.error('Failed to load devices:', error);
    }
  }

  toggleVoiceRecognition() {
    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
      this.elements.voiceButton.classList.remove('active');
    } else {
      this.recognition.start();
      this.isListening = true;
      this.elements.voiceButton.classList.add('active');
    }
  }

  processVoiceCommand(command) {
    for (const [pattern, handler] of this.commandPatterns) {
      const matches = command.match(pattern);
      if (matches) {
        handler(matches);
        this.speak(`Processing command: ${command}`);
        return;
      }
    }
    
    this.speak("Sorry, I didn't understand that command");
  }

  async controlDevice(deviceName, state) {
    const device = this.findDeviceByName(deviceName);
    if (!device) {
      this.speak(`Device ${deviceName} not found`);
      return;
    }

    try {
      await fetch(`http://localhost:1880/api/devices/${device.id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state })
      });

      this.speak(`${deviceName} turned ${state ? 'on' : 'off'}`);
    } catch (error) {
      this.speak(`Failed to control ${deviceName}`);
    }
  }

  async setDeviceValue(deviceName, value) {
    const device = this.findDeviceByName(deviceName);
    if (!device) {
      this.speak(`Device ${deviceName} not found`);
      return;
    }

    try {
      await fetch(`http://localhost:1880/api/devices/${device.id}/setValue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });

      this.speak(`Set ${deviceName} to ${value}`);
    } catch (error) {
      this.speak(`Failed to set value for ${deviceName}`);
    }
  }

  getDeviceStatus(deviceName) {
    const device = this.findDeviceByName(deviceName);
    if (!device) {
      this.speak(`Device ${deviceName} not found`);
      return;
    }

    const status = device.state ? 'on' : 'off';
    const value = device.value ? ` and set to ${device.value}` : '';
    this.speak(`${deviceName} is ${status}${value}`);
  }

  findDeviceByName(name) {
    return Array.from(this.devices.values())
      .find(device => device.name.toLowerCase() === name.toLowerCase());
  }

  handleDeviceUpdate(update) {
    const device = this.devices.get(update.id);
    if (device) {
      Object.assign(device, update);
      this.updateDeviceStatus(device);
      this.updateDashboardCharts();
    }
  }

  updateDeviceList() {
    this.elements.deviceList.innerHTML = Array.from(this.devices.values())
      .map(device => `
        <div class="device-card ${device.state ? 'active' : ''}">
          <h3>${device.name}</h3>
          <p>Type: ${device.type}</p>
          ${device.value ? `<p>Value: ${device.value}</p>` : ''}
          <div class="device-controls">
            <button onclick="assistant.controlDevice('${device.name}', true)">
              On
            </button>
            <button onclick="assistant.controlDevice('${device.name}', false)">
              Off
            </button>
            ${device.type === 'dimmer' ? `
              <input type="range" min="0" max="100" value="${device.value || 0}"
                onchange="assistant.setDeviceValue('${device.name}', this.value)">
            ` : ''}
          </div>
        </div>
      `).join('');
  }

  updateDeviceStatus(device) {
    const card = this.elements.deviceList
      .querySelector(`[data-device-id="${device.id}"]`);
    
    if (card) {
      card.classList.toggle('active', device.state);
      const valueDisplay = card.querySelector('.device-value');
      if (valueDisplay && device.value !== undefined) {
        valueDisplay.textContent = device.value;
      }
    }
  }

  updateDashboardCharts() {
    const temperatureData = Array.from(this.devices.values())
      .filter(device => device.type === 'temperature')
      .map(device => ({
        label: device.name,
        data: device.history || []
      }));

    const energyData = Array.from(this.devices.values())
      .filter(device => device.type === 'energy')
      .map(device => ({
        label: device.name,
        data: [device.value || 0]
      }));

    this.dashboard.temperature.data = {
      labels: temperatureData[0]?.data.map((_, i) => i) || [],
      datasets: temperatureData
    };
    this.dashboard.temperature.update();

    this.dashboard.energy.data = {
      labels: this.devices
        .filter(device => device.type === 'energy')
        .map(device => device.name),
      datasets: [{
        label: 'Energy Consumption',
        data: energyData.map(d => d.data[0])
      }]
    };
    this.dashboard.energy.update();
  }

  speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
    
    this.showNotification(text);
  }

  showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    
    this.elements.notificationArea.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
}

// Initialize assistant
const assistant = new SmartHomeAssistant();