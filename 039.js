class RobotControlSystem {
  constructor() {
    this.board = null;
    this.components = new Map();
    this.programs = new Map();
    this.currentProgram = null;
    this.isRunning = false;
    
    this.init();
  }

  async init() {
    await this.initializeHardware();
    this.setupInterface();
    this.setupWebSocket();
    this.initializeBlockly();
  }

  async initializeHardware() {
    try {
      this.board = new five.Board();
      
      this.board.on('ready', () => {
        this.setupComponents();
        this.emit('hardware-ready');
      });

      this.board.on('error', (error) => {
        console.error('Board error:', error);
        this.emit('hardware-error', error);
      });
    } catch (error) {
      console.error('Hardware initialization failed:', error);
    }
  }

  setupComponents() {
    // Motors
    this.components.set('leftMotor', new five.Motor({
      pins: { pwm: 3, dir: 4 }
    }));

    this.components.set('rightMotor', new five.Motor({
      pins: { pwm: 5, dir: 6 }
    }));

    // Sensors
    this.components.set('distanceSensor', new five.Proximity({
      controller: "HCSR04",
      pin: 7
    }));

    this.components.set('lightSensor', new five.Light({
      pin: "A0"
    }));

    // Servo
    this.components.set('headServo', new five.Servo({
      pin: 9,
      range: [0, 180]
    }));

    // LED indicators
    this.components.set('statusLED', new five.Led(13));

    this.setupSensorEvents();
  }

  setupSensorEvents() {
    const distanceSensor = this.components.get('distanceSensor');
    const lightSensor = this.components.get('lightSensor');

    distanceSensor.on('data', (data) => {
      this.emit('distance-reading', data.cm);
      this.checkObstacle(data.cm);
    });

    lightSensor.on('change', (data) => {
      this.emit('light-reading', data);
    });
  }

  setupInterface() {
    this.elements = {
      programList: document.getElementById('program-list'),
      blocklyWorkspace: document.getElementById('blockly-workspace'),
      controlPanel: document.getElementById('control-panel'),
      sensorReadings: document.getElementById('sensor-readings'),
      console: document.getElementById('robot-console')
    };

    this.setupControlPanel();
  }

  setupWebSocket() {
    this.server = new WebSocket.Server({ port: 8080 });
    
    this.server.on('connection', (socket) => {
      socket.on('message', (message) => {
        this.handleRemoteCommand(JSON.parse(message));
      });
    });
  }

  initializeBlockly() {
    Blockly.defineBlocksWithJsonArray([
      // Movement blocks
      {
        type: 'robot_move_forward',
        message0: 'Move forward for %1 seconds',
        args0: [
          {
            type: 'field_number',
            name: 'DURATION',
            value: 1
          }
        ],
        previousStatement: null,
        nextStatement: null,
        colour: 160
      },
      // Turn blocks
      {
        type: 'robot_turn',
        message0: 'Turn %1 for %2 seconds',
        args0: [
          {
            type: 'field_dropdown',
            name: 'DIRECTION',
            options: [
              ['left', 'LEFT'],
              ['right', 'RIGHT']
            ]
          },
          {
            type: 'field_number',
            name: 'DURATION',
            value: 1
          }
        ],
        previousStatement: null,
        nextStatement: null,
        colour: 160
      },
      // Sensor blocks
      {
        type: 'robot_check_distance',
        message0: 'Distance < %1 cm',
        args0: [
          {
            type: 'field_number',
            name: 'THRESHOLD',
            value: 20
          }
        ],
        output: 'Boolean',
        colour: 210
      }
    ]);

    this.workspace = Blockly.inject(this.elements.blocklyWorkspace, {
      toolbox: this.createToolbox()
    });
  }

  createToolbox() {
    return {
      kind: 'categoryToolbox',
      contents: [
        {
          kind: 'category',
          name: 'Movement',
          colour: 160,
          contents: [
            { kind: 'block', type: 'robot_move_forward' },
            { kind: 'block', type: 'robot_turn' }
          ]
        },
        {
          kind: 'category',
          name: 'Sensors',
          colour: 210,
          contents: [
            { kind: 'block', type: 'robot_check_distance' }
          ]
        },
        {
          kind: 'category',
          name: 'Logic',
          colour: 290,
          contents: [
            { kind: 'block', type: 'controls_if' },
            { kind: 'block', type: 'controls_repeat' }
          ]
        }
      ]
    };
  }

  generateCode() {
    const code = Blockly.JavaScript.workspaceToCode(this.workspace);
    return `async function runProgram() {\n${code}\n}`;
  }

  async executeProgram(programId) {
    const program = this.programs.get(programId);
    if (!program) return;

    this.isRunning = true;
    this.currentProgram = program;

    try {
      const func = new Function('robot', program.code);
      await func(this);
    } catch (error) {
      console.error('Program execution error:', error);
      this.log('error', error.message);
    }

    this.isRunning = false;
    this.currentProgram = null;
  }

  // Robot Control Methods
  async moveForward(duration, speed = 255) {
    const leftMotor = this.components.get('leftMotor');
    const rightMotor = this.components.get('rightMotor');

    leftMotor.forward(speed);
    rightMotor.forward(speed);

    await this.wait(duration * 1000);

    leftMotor.stop();
    rightMotor.stop();
  }

  async turn(direction, duration) {
    const leftMotor = this.components.get('leftMotor');
    const rightMotor = this.components.get('rightMotor');

    if (direction === 'LEFT') {
      leftMotor.reverse(255);
      rightMotor.forward(255);
    } else {
      leftMotor.forward(255);
      rightMotor.reverse(255);
    }

    await this.wait(duration * 1000);

    leftMotor.stop();
    rightMotor.stop();
  }

  async rotateHead(angle) {
    const headServo = this.components.get('headServo');
    headServo.to(angle);
    await this.wait(500); // Wait for servo to reach position
  }

  checkObstacle(distance) {
    if (distance < 20 && this.isRunning) {
      this.emit('obstacle-detected', distance);
      this.stopProgram();
    }
  }

  stopProgram() {
    this.isRunning = false;
    
    // Stop all motors
    this.components.get('leftMotor').stop();
    this.components.get('rightMotor').stop();
    
    this.log('info', 'Program stopped');
  }

  // Remote Control Interface
  handleRemoteCommand(command) {
    switch (command.type) {
      case 'move':
        this.moveForward(command.duration, command.speed);
        break;
      case 'turn':
        this.turn(command.direction, command.duration);
        break;
      case 'head':
        this.rotateHead(command.angle);
        break;
      case 'program':
        this.executeProgram(command.programId);
        break;
      case 'stop':
        this.stopProgram();
        break;
    }
  }

  // Utility Methods
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  log(level, message) {
    const logEntry = {
      timestamp: new Date(),
      level,
      message
    };

    this.elements.console.innerHTML += `
      <div class="log-entry ${level}">
        ${logEntry.timestamp.toISOString()} - ${message}
      </div>
    `;
    this.elements.console.scrollTop = this.elements.console.scrollHeight;
  }

  emit(event, data) {
    this.server.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event, data }));
      }
    });
  }
}

// Web Interface
class RobotInterface {
  constructor(robot) {
    this.robot = robot;
    this.setupUI();
  }

  setupUI() {
    this.elements = {
      joystick: document.getElementById('joystick'),
      programEditor: document.getElementById('program-editor'),
      sensorDisplay: document.getElementById('sensor-display')
    };

    this.setupJoystick();
    this.setupProgramEditor();
    this.setupSensorDisplay();
  }

  setupJoystick() {
    const joystick = nipplejs.create({
      zone: this.elements.joystick,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'blue'
    });

    joystick.on('move', (evt, data) => {
      const angle = data.angle.degree;
      const force = Math.min(data.force, 1);

      this.robot.handleRemoteCommand({
        type: 'move',
        speed: force * 255,
        direction: this.calculateDirection(angle)
      });
    });

    joystick.on('end', () => {
      this.robot.handleRemoteCommand({ type: 'stop' });
    });
  }

  calculateDirection(angle) {
    if (angle > 315 || angle <= 45) return 'forward';
    if (angle > 45 && angle <= 135) return 'right';
    if (angle > 135 && angle <= 225) return 'backward';
    return 'left';
  }

  setupProgramEditor() {
    // Program editor UI implementation
  }

  setupSensorDisplay() {
    // Sensor display UI implementation
  }
}

// Initialize robot control system
const robotSystem = new RobotControlSystem();
const interface = new RobotInterface(robotSystem);