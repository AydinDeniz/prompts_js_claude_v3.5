class HomeAutomationDashboard {
    constructor() {
        this.devices = new Map();
        this.routines = new Map();
        this.energyData = new Map();
        this.mqtt = null;
    }

    async init() {
        await this.connectMQTT();
        this.setupUI();
        await this.loadDevices();
        this.initializeRoutines();
        this.startEnergyMonitoring();
    }

    async connectMQTT() {
        // Connect to MQTT broker for IoT communication
        this.mqtt = await mqtt.connect('wss://your-mqtt-broker.com', {
            username: 'your_username',
            password: 'your_password'
        });

        this.mqtt.on('connect', () => {
            console.log('Connected to MQTT broker');
            this.subscribeToTopics();
        });

        this.mqtt.on('message', (topic, message) => {
            this.handleDeviceMessage(topic, JSON.parse(message.toString()));
        });
    }

    subscribeToTopics() {
        this.mqtt.subscribe('home/+/status');
        this.mqtt.subscribe('home/+/energy');
        this.mqtt.subscribe('home/+/sensor');
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="home-dashboard">
                <nav class="dashboard-nav">
                    <button data-view="devices" class="active">Devices</button>
                    <button data-view="routines">Routines</button>
                    <button data-view="energy">Energy</button>
                    <button data-view="analytics">Analytics</button>
                </nav>
                
                <div class="dashboard-content">
                    <div id="devices-view" class="view active">
                        <div class="room-grid" id="room-grid"></div>
                    </div>
                    
                    <div id="routines-view" class="view">
                        <div class="routines-list" id="routines-list"></div>
                        <button id="add-routine">Add Routine</button>
                    </div>
                    
                    <div id="energy-view" class="view">
                        <div class="energy-charts" id="energy-charts"></div>
                        <div class="energy-summary" id="energy-summary"></div>
                    </div>
                    
                    <div id="analytics-view" class="view">
                        <div class="analytics-widgets" id="analytics-widgets"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        this.bindEvents();
    }

    async loadDevices() {
        try {
            const response = await fetch('https://api.example.com/devices');
            const devices = await response.json();
            
            devices.forEach(device => {
                this.devices.set(device.id, {
                    ...device,
                    status: 'offline',
                    lastUpdate: null
                });
            });
            
            this.renderDevices();
        } catch (error) {
            console.error('Failed to load devices:', error);
        }
    }

    renderDevices() {
        const roomGrid = document.getElementById('room-grid');
        const devicesByRoom = this.groupDevicesByRoom();

        roomGrid.innerHTML = Array.from(devicesByRoom.entries()).map(([room, devices]) => `
            <div class="room-card">
                <h3>${room}</h3>
                <div class="device-grid">
                    ${devices.map(device => this.createDeviceCard(device)).join('')}
                </div>
            </div>
        `).join('');
    }

    createDeviceCard(device) {
        return `
            <div class="device-card ${device.status}" data-device-id="${device.id}">
                <div class="device-icon">${this.getDeviceIcon(device.type)}</div>
                <div class="device-info">
                    <h4>${device.name}</h4>
                    <p class="device-status">${device.status}</p>
                    ${this.getDeviceControls(device)}
                </div>
            </div>
        `;
    }

    getDeviceControls(device) {
        switch (device.type) {
            case 'light':
                return `
                    <div class="device-controls">
                        <input type="range" min="0" max="100" value="${device.brightness || 0}"
                            class="brightness-slider" data-device-id="${device.id}">
                        <input type="color" value="${device.color || '#ffffff'}"
                            class="color-picker" data-device-id="${device.id}">
                    </div>
                `;
            case 'thermostat':
                return `
                    <div class="device-controls">
                        <input type="number" min="16" max="30" value="${device.temperature || 20}"
                            class="temperature-input" data-device-id="${device.id}">
                        <select class="mode-select" data-device-id="${device.id}">
                            <option value="heat" ${device.mode === 'heat' ? 'selected' : ''}>Heat</option>
                            <option value="cool" ${device.mode === 'cool' ? 'selected' : ''}>Cool</option>
                            <option value="auto" ${device.mode === 'auto' ? 'selected' : ''}>Auto</option>
                        </select>
                    </div>
                `;
            default:
                return `
                    <div class="device-controls">
                        <button class="toggle-btn" data-device-id="${device.id}">
                            ${device.status === 'on' ? 'Turn Off' : 'Turn On'}
                        </button>
                    </div>
                `;
        }
    }

    initializeRoutines() {
        const defaultRoutines = [
            {
                id: 'morning',
                name: 'Morning Routine',
                triggers: [{ type: 'time', value: '07:00' }],
                actions: [
                    { deviceId: 'light1', action: 'on', brightness: 100 },
                    { deviceId: 'thermostat1', action: 'setTemp', value: 22 }
                ]
            },
            {
                id: 'night',
                name: 'Night Routine',
                triggers: [{ type: 'time', value: '22:00' }],
                actions: [
                    { deviceId: 'light1', action: 'off' },
                    { deviceId: 'thermostat1', action: 'setTemp', value: 18 }
                ]
            }
        ];

        defaultRoutines.forEach(routine => this.routines.set(routine.id, routine));
        this.renderRoutines();
    }

    startEnergyMonitoring() {
        setInterval(() => this.updateEnergyData(), 60000); // Update every minute
        this.updateEnergyData(); // Initial update
    }

    async updateEnergyData() {
        try {
            const response = await fetch('https://api.example.com/energy');
            const data = await response.json();
            
            this.energyData.set('current', data);
            this.renderEnergyCharts();
        } catch (error) {
            console.error('Failed to update energy data:', error);
        }
    }

    renderEnergyCharts() {
        const energyCharts = document.getElementById('energy-charts');
        const data = this.energyData.get('current');

        if (!data) return;

        // Create energy consumption chart using Chart.js
        const ctx = document.createElement('canvas').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.timestamps,
                datasets: [{
                    label: 'Energy Consumption (kWh)',
                    data: data.consumption,
                    borderColor: '#2196F3',
                    fill: false
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });

        energyCharts.appendChild(ctx.canvas);
    }

    bindEvents() {
        // Navigation
        document.querySelectorAll('.dashboard-nav button').forEach(button => {
            button.addEventListener('click', () => this.switchView(button.dataset.view));
        });

        // Device controls
        document.addEventListener('change', (e) => {
            if (e.target.matches('.brightness-slider')) {
                this.updateDeviceBrightness(e.target.dataset.deviceId, e.target.value);
            } else if (e.target.matches('.color-picker')) {
                this.updateDeviceColor(e.target.dataset.deviceId, e.target.value);
            } else if (e.target.matches('.temperature-input')) {
                this.updateDeviceTemperature(e.target.dataset.deviceId, e.target.value);
            }
        });

        // Toggle buttons
        document.addEventListener('click', (e) => {
            if (e.target.matches('.toggle-btn')) {
                this.toggleDevice(e.target.dataset.deviceId);
            }
        });
    }

    switchView(viewName) {
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        document.getElementById(`${viewName}-view`).classList.add('active');
        
        document.querySelectorAll('.dashboard-nav button').forEach(button => {
            button.classList.toggle('active', button.dataset.view === viewName);
        });
    }

    async updateDeviceState(deviceId, state) {
        try {
            await this.mqtt.publish(`home/${deviceId}/set`, JSON.stringify(state));
        } catch (error) {
            console.error(`Failed to update device ${deviceId}:`, error);
        }
    }
}

// Add styles
const styles = `
    .home-dashboard {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: #f5f5f5;
    }
    .dashboard-nav {
        display: flex;
        gap: 20px;
        padding: 20px;
        background: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .dashboard-content {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
    }
    .room-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 20px;
    }
    .device-card {
        background: white;
        border-radius: 8px;
        padding: 15px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .device-controls {
        margin-top: 10px;
        display: flex;
        gap: 10px;
    }
    .energy-charts {
        background: white;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 20px;
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize
const homeDashboard = new HomeAutomationDashboard();
homeDashboard.init();