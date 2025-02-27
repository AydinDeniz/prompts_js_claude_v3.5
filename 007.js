class TaskQueue {
  constructor(concurrencyLimit = 3) {
    this.concurrencyLimit = concurrencyLimit;
    this.queue = [];
    this.activeCount = 0;
    this.results = new Map();
    this.taskCounter = 0;
  }

  async addTask(task, priority = 0) {
    const taskId = this.taskCounter++;
    const taskWrapper = {
      id: taskId,
      task,
      priority,
      status: 'pending',
      addedAt: Date.now()
    };

    this.queue.push(taskWrapper);
    this.sortQueue();
    
    // Start processing if we're under the concurrency limit
    if (this.activeCount < this.concurrencyLimit) {
      this.processNextTask();
    }

    return taskId;
  }

  sortQueue() {
    this.queue.sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt);
  }

  async processNextTask() {
    if (this.activeCount >= this.concurrencyLimit || this.queue.length === 0) {
      return;
    }

    const taskWrapper = this.queue.shift();
    this.activeCount++;
    taskWrapper.status = 'running';
    taskWrapper.startedAt = Date.now();

    try {
      const result = await Promise.resolve(taskWrapper.task());
      this.handleTaskCompletion(taskWrapper.id, result);
    } catch (error) {
      this.handleTaskError(taskWrapper.id, error);
    } finally {
      this.activeCount--;
      taskWrapper.completedAt = Date.now();
      this.processNextTask();
    }
  }

  handleTaskCompletion(taskId, result) {
    this.results.set(taskId, {
      status: 'completed',
      result,
      error: null
    });
  }

  handleTaskError(taskId, error) {
    this.results.set(taskId, {
      status: 'failed',
      result: null,
      error: error.message
    });
  }

  async getTaskResult(taskId) {
    if (!this.results.has(taskId)) {
      throw new Error('Task not found');
    }
    return this.results.get(taskId);
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      activeCount: this.activeCount,
      completedTasks: Array.from(this.results.entries()).filter(([_, result]) => 
        result.status === 'completed'
      ).length,
      failedTasks: Array.from(this.results.entries()).filter(([_, result]) => 
        result.status === 'failed'
      ).length
    };
  }

  clearResults() {
    this.results.clear();
  }
}

// Task Factory for testing
class TaskFactory {
  static createDelayedTask(delay, value) {
    return async () => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return value;
    };
  }

  static createErrorTask(delay) {
    return async () => {
      await new Promise(resolve => setTimeout(resolve, delay));
      throw new Error('Task failed');
    };
  }
}

// Example usage and testing
async function runExample() {
  const taskQueue = new TaskQueue(3);

  // Create an array of tasks with different priorities and execution times
  const tasks = [
    { task: TaskFactory.createDelayedTask(2000, 'Task 1'), priority: 1 },
    { task: TaskFactory.createDelayedTask(1000, 'Task 2'), priority: 2 },
    { task: TaskFactory.createDelayedTask(3000, 'Task 3'), priority: 0 },
    { task: TaskFactory.createErrorTask(1500), priority: 3 },
    { task: TaskFactory.createDelayedTask(2500, 'Task 5'), priority: 1 },
    { task: TaskFactory.createDelayedTask(1800, 'Task 6'), priority: 2 }
  ];

  // Add tasks to queue
  const taskIds = await Promise.all(
    tasks.map(({ task, priority }) => taskQueue.addTask(task, priority))
  );

  // Monitor queue status
  const statusInterval = setInterval(() => {
    const status = taskQueue.getQueueStatus();
    console.log('Queue Status:', status);
  }, 1000);

  // Wait for all tasks to complete
  await new Promise(resolve => {
    const checkCompletion = setInterval(() => {
      const status = taskQueue.getQueueStatus();
      if (status.queueLength === 0 && status.activeCount === 0) {
        clearInterval(checkCompletion);
        clearInterval(statusInterval);
        resolve();
      }
    }, 100);
  });

  // Get results
  const results = await Promise.all(
    taskIds.map(async id => {
      const result = await taskQueue.getTaskResult(id);
      return { id, ...result };
    })
  );

  console.log('Final Results:', results);
}

// Task Progress Monitoring
class TaskProgressMonitor {
  constructor(taskQueue) {
    this.taskQueue = taskQueue;
    this.listeners = new Set();
  }

  addListener(listener) {
    this.listeners.add(listener);
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }

  notifyListeners(status) {
    this.listeners.forEach(listener => listener(status));
  }

  startMonitoring(interval = 1000) {
    this.monitoringInterval = setInterval(() => {
      const status = this.taskQueue.getQueueStatus();
      this.notifyListeners(status);
    }, interval);
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }
}

// Example with progress monitoring
async function runWithMonitoring() {
  const taskQueue = new TaskQueue(3);
  const monitor = new TaskProgressMonitor(taskQueue);

  // Add progress listener
  monitor.addListener(status => {
    console.log('Progress Update:', {
      pending: status.queueLength,
      active: status.activeCount,
      completed: status.completedTasks,
      failed: status.failedTasks
    });
  });

  monitor.startMonitoring();

  try {
    await runExample();
  } finally {
    monitor.stopMonitoring();
  }
}

// Run the example
runWithMonitoring().catch(console.error);