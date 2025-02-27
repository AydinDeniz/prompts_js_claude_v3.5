class TaskManagementSystem {
  constructor() {
    this.tasks = new Map();
    this.users = new Map();
    this.teams = new Map();
    this.socket = null;
    this.currentUser = null;
    
    this.init();
  }

  async init() {
    await this.setupWebSocket();
    this.initializeDatabase();
    this.setupEventListeners();
    this.initializeUI();
    await this.loadUserData();
  }

  async setupWebSocket() {
    this.socket = new WebSocket('ws://localhost:8080/tasks');
    
    this.socket.onmessage = (event) => {
      const update = JSON.parse(event.data);
      this.handleRealtimeUpdate(update);
    };

    this.socket.onclose = () => {
      console.log('WebSocket connection closed');
      setTimeout(() => this.setupWebSocket(), 5000); // Reconnect after 5s
    };
  }

  initializeDatabase() {
    this.db = new PouchDB('task_management');
    
    // Set up sync with remote database
    PouchDB.sync('task_management', 'http://localhost:5984/task_management', {
      live: true,
      retry: true
    });
  }

  initializeUI() {
    this.elements = {
      taskList: document.getElementById('task-list'),
      newTaskForm: document.getElementById('new-task-form'),
      filterControls: document.getElementById('filter-controls'),
      searchInput: document.getElementById('search-tasks'),
      teamPanel: document.getElementById('team-panel'),
      notificationArea: document.getElementById('notifications')
    };

    this.setupDragAndDrop();
  }

  setupDragAndDrop() {
    const columns = document.querySelectorAll('.task-column');
    columns.forEach(column => {
      new Sortable(column, {
        group: 'tasks',
        animation: 150,
        onEnd: (evt) => this.handleTaskMove(evt)
      });
    });
  }

  setupEventListeners() {
    this.elements.newTaskForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createNewTask(new FormData(e.target));
    });

    this.elements.searchInput.addEventListener('input', (e) => {
      this.filterTasks(e.target.value);
    });

    document.addEventListener('task-update', (e) => {
      this.updateTask(e.detail);
    });
  }

  async loadUserData() {
    try {
      const userData = await this.db.get('currentUser');
      this.currentUser = userData;
      await this.loadUserTasks();
      this.updateUI();
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  }

  async createNewTask(formData) {
    const task = {
      id: `task-${Date.now()}`,
      title: formData.get('title'),
      description: formData.get('description'),
      priority: formData.get('priority'),
      deadline: formData.get('deadline'),
      assignee: formData.get('assignee'),
      status: 'todo',
      created: new Date(),
      createdBy: this.currentUser.id,
      attachments: [],
      comments: [],
      tags: formData.get('tags').split(',').map(tag => tag.trim()),
      subtasks: []
    };

    try {
      await this.db.put({
        _id: task.id,
        ...task
      });

      this.tasks.set(task.id, task);
      this.broadcastUpdate({
        type: 'task-created',
        task
      });

      this.updateUI();
      this.showNotification('Task created successfully');
    } catch (error) {
      console.error('Failed to create task:', error);
      this.showError('Failed to create task');
    }
  }

  async updateTask(update) {
    const task = this.tasks.get(update.taskId);
    if (!task) return;

    const updatedTask = {
      ...task,
      ...update.changes,
      lastModified: new Date(),
      modifiedBy: this.currentUser.id
    };

    try {
      const doc = await this.db.get(task.id);
      await this.db.put({
        ...updatedTask,
        _rev: doc._rev
      });

      this.tasks.set(task.id, updatedTask);
      this.broadcastUpdate({
        type: 'task-updated',
        task: updatedTask
      });

      this.updateUI();
    } catch (error) {
      console.error('Failed to update task:', error);
      this.showError('Failed to update task');
    }
  }

  async deleteTask(taskId) {
    try {
      const doc = await this.db.get(taskId);
      await this.db.remove(doc);

      this.tasks.delete(taskId);
      this.broadcastUpdate({
        type: 'task-deleted',
        taskId
      });

      this.updateUI();
      this.showNotification('Task deleted successfully');
    } catch (error) {
      console.error('Failed to delete task:', error);
      this.showError('Failed to delete task');
    }
  }

  handleTaskMove(event) {
    const taskId = event.item.dataset.taskId;
    const newStatus = event.to.dataset.status;
    
    this.updateTask({
      taskId,
      changes: { status: newStatus }
    });
  }

  async assignTask(taskId, userId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const user = this.users.get(userId);
    if (!user) return;

    await this.updateTask({
      taskId,
      changes: {
        assignee: userId,
        assignedAt: new Date()
      }
    });

    this.notifyUser(userId, {
      type: 'task-assigned',
      taskId,
      assignedBy: this.currentUser.id
    });
  }

  async addComment(taskId, comment) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const newComment = {
      id: `comment-${Date.now()}`,
      content: comment,
      author: this.currentUser.id,
      timestamp: new Date()
    };

    await this.updateTask({
      taskId,
      changes: {
        comments: [...task.comments, newComment]
      }
    });
  }

  async addAttachment(taskId, file) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const attachment = {
      id: `attachment-${Date.now()}`,
      name: file.name,
      type: file.type,
      size: file.size,
      uploadedBy: this.currentUser.id,
      timestamp: new Date()
    };

    await this.updateTask({
      taskId,
      changes: {
        attachments: [...task.attachments, attachment]
      }
    });

    // Upload file to storage
    await this.uploadAttachment(taskId, attachment.id, file);
  }

  filterTasks(searchTerm) {
    const filteredTasks = Array.from(this.tasks.values()).filter(task => {
      const searchString = `${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase();
      return searchString.includes(searchTerm.toLowerCase());
    });

    this.updateTaskList(filteredTasks);
  }

  updateUI() {
    this.updateTaskList(Array.from(this.tasks.values()));
    this.updateStatistics();
    this.updateTeamPanel();
  }

  updateTaskList(tasks) {
    const columns = {
      todo: [],
      inProgress: [],
      review: [],
      done: []
    };

    tasks.forEach(task => {
      columns[task.status].push(this.createTaskElement(task));
    });

    Object.entries(columns).forEach(([status, tasks]) => {
      const column = document.querySelector(`.task-column[data-status="${status}"]`);
      column.innerHTML = tasks.join('');
    });
  }

  createTaskElement(task) {
    return `
      <div class="task-card" data-task-id="${task.id}">
        <div class="task-header">
          <h3>${task.title}</h3>
          <span class="priority ${task.priority}">${task.priority}</span>
        </div>
        <div class="task-body">
          <p>${task.description}</p>
          <div class="task-meta">
            <span class="deadline">Due: ${this.formatDate(task.deadline)}</span>
            <span class="assignee">
              ${this.renderAssignee(task.assignee)}
            </span>
          </div>
          <div class="task-tags">
            ${task.tags.map(tag => `
              <span class="tag">${tag}</span>
            `).join('')}
          </div>
        </div>
        <div class="task-footer">
          <button onclick="taskManager.openTaskDetails('${task.id}')">
            Details
          </button>
          <div class="task-actions">
            ${this.renderTaskActions(task)}
          </div>
        </div>
      </div>
    `;
  }

  renderTaskActions(task) {
    const actions = [];
    
    if (this.canEditTask(task)) {
      actions.push(`
        <button onclick="taskManager.editTask('${task.id}')">
          Edit
        </button>
      `);
    }

    if (this.canDeleteTask(task)) {
      actions.push(`
        <button onclick="taskManager.deleteTask('${task.id}')">
          Delete
        </button>
      `);
    }

    return actions.join('');
  }

  updateStatistics() {
    const stats = this.calculateStatistics();
    
    document.getElementById('statistics').innerHTML = `
      <div class="stat-card">
        <h4>Total Tasks</h4>
        <span>${stats.total}</span>
      </div>
      <div class="stat-card">
        <h4>Completed</h4>
        <span>${stats.completed}</span>
      </div>
      <div class="stat-card">
        <h4>Overdue</h4>
        <span>${stats.overdue}</span>
      </div>
    `;
  }

  calculateStatistics() {
    const now = new Date();
    let total = 0;
    let completed = 0;
    let overdue = 0;

    this.tasks.forEach(task => {
      total++;
      if (task.status === 'done') completed++;
      if (new Date(task.deadline) < now && task.status !== 'done') overdue++;
    });

    return { total, completed, overdue };
  }

  handleRealtimeUpdate(update) {
    switch (update.type) {
      case 'task-created':
        this.tasks.set(update.task.id, update.task);
        break;
      case 'task-updated':
        this.tasks.set(update.task.id, update.task);
        break;
      case 'task-deleted':
        this.tasks.delete(update.taskId);
        break;
      case 'comment-added':
        this.handleNewComment(update);
        break;
    }

    this.updateUI();
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    this.elements.notificationArea.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
  }

  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
}

// Initialize task manager
const taskManager = new TaskManagementSystem();