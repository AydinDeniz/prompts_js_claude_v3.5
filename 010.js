class EventController {
  /**
   * Creates a debounced version of a function
   * @param {Function} func - The function to debounce
   * @param {number} wait - The delay in milliseconds
   * @param {Object} options - Additional options
   * @param {boolean} options.leading - Execute on the leading edge
   * @param {boolean} options.trailing - Execute on the trailing edge
   * @returns {Function} - Debounced function
   */
  static debounce(func, wait = 250, options = {}) {
    let timeoutId;
    let lastArgs;
    let lastThis;
    let lastCallTime;
    let lastInvokeTime = 0;
    let leading = !!options.leading;
    let trailing = 'trailing' in options ? !!options.trailing : true;
    let maxWait = options.maxWait;
    let result;

    function invokeFunc(time) {
      const args = lastArgs;
      const thisArg = lastThis;

      lastArgs = lastThis = undefined;
      lastInvokeTime = time;
      result = func.apply(thisArg, args);
      return result;
    }

    function leadingEdge(time) {
      lastInvokeTime = time;
      timeoutId = setTimeout(timerExpired, wait);
      return leading ? invokeFunc(time) : result;
    }

    function remainingWait(time) {
      const timeSinceLastCall = time - lastCallTime;
      const timeSinceLastInvoke = time - lastInvokeTime;
      const timeWaiting = wait - timeSinceLastCall;

      return maxWait === undefined
        ? timeWaiting
        : Math.min(timeWaiting, maxWait - timeSinceLastInvoke);
    }

    function shouldInvoke(time) {
      const timeSinceLastCall = time - lastCallTime;
      const timeSinceLastInvoke = time - lastInvokeTime;

      return (
        lastCallTime === undefined ||
        timeSinceLastCall >= wait ||
        timeSinceLastCall < 0 ||
        (maxWait !== undefined && timeSinceLastInvoke >= maxWait)
      );
    }

    function timerExpired() {
      const time = Date.now();
      if (shouldInvoke(time)) {
        return trailingEdge(time);
      }
      timeoutId = setTimeout(timerExpired, remainingWait(time));
    }

    function trailingEdge(time) {
      timeoutId = undefined;

      if (trailing && lastArgs) {
        return invokeFunc(time);
      }
      lastArgs = lastThis = undefined;
      return result;
    }

    function cancel() {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      lastInvokeTime = 0;
      lastArgs = lastCallTime = lastThis = timeoutId = undefined;
    }

    function flush() {
      return timeoutId === undefined ? result : trailingEdge(Date.now());
    }

    function debounced(...args) {
      const time = Date.now();
      const isInvoking = shouldInvoke(time);

      lastArgs = args;
      lastThis = this;
      lastCallTime = time;

      if (isInvoking) {
        if (timeoutId === undefined) {
          return leadingEdge(lastCallTime);
        }
        if (maxWait !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(timerExpired, wait);
          return invokeFunc(lastCallTime);
        }
      }
      if (timeoutId === undefined) {
        timeoutId = setTimeout(timerExpired, wait);
      }
      return result;
    }

    debounced.cancel = cancel;
    debounced.flush = flush;
    return debounced;
  }

  /**
   * Creates a throttled version of a function
   * @param {Function} func - The function to throttle
   * @param {number} wait - The throttle interval in milliseconds
   * @param {Object} options - Additional options
   * @param {boolean} options.leading - Execute on the leading edge
   * @param {boolean} options.trailing - Execute on the trailing edge
   * @returns {Function} - Throttled function
   */
  static throttle(func, wait = 250, options = {}) {
    return EventController.debounce(func, wait, {
      leading: true,
      trailing: options.trailing !== false,
      maxWait: wait
    });
  }
}

// Example usage:
class ScrollHandler {
  constructor() {
    // Debounced scroll handler
    this.debouncedScroll = EventController.debounce(
      this.handleScroll.bind(this),
      250,
      { leading: true, trailing: true }
    );

    // Throttled scroll handler
    this.throttledScroll = EventController.throttle(
      this.handleScroll.bind(this),
      250
    );

    // Bind event listeners
    this.bindEvents();
  }

  bindEvents() {
    // Using debounced handler
    window.addEventListener('scroll', this.debouncedScroll);

    // Using throttled handler
    // window.addEventListener('scroll', this.throttledScroll);
  }

  handleScroll(event) {
    console.log('Scroll position:', window.scrollY);
    // Handle scroll event
  }

  destroy() {
    // Clean up
    window.removeEventListener('scroll', this.debouncedScroll);
    this.debouncedScroll.cancel();
    // window.removeEventListener('scroll', this.throttledScroll);
    // this.throttledScroll.cancel();
  }
}

// Example with resize handler
class ResizeHandler {
  constructor() {
    this.debouncedResize = EventController.debounce(
      this.handleResize.bind(this),
      250
    );
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('resize', this.debouncedResize);
  }

  handleResize(event) {
    console.log('Window size:', {
      width: window.innerWidth,
      height: window.innerHeight
    });
    // Handle resize event
  }

  destroy() {
    window.removeEventListener('resize', this.debouncedResize);
    this.debouncedResize.cancel();
  }
}

// Example with input handler
class SearchHandler {
  constructor() {
    this.searchInput = document.querySelector('#search-input');
    this.debouncedSearch = EventController.debounce(
      this.handleSearch.bind(this),
      300
    );
    this.bindEvents();
  }

  bindEvents() {
    this.searchInput.addEventListener('input', this.debouncedSearch);
  }

  async handleSearch(event) {
    const query = event.target.value;
    try {
      const results = await this.performSearch(query);
      this.updateResults(results);
    } catch (error) {
      console.error('Search error:', error);
    }
  }

  async performSearch(query) {
    // Simulate API call
    return new Promise(resolve => {
      setTimeout(() => {
        resolve([`Result for: ${query}`]);
      }, 100);
    });
  }

  updateResults(results) {
    console.log('Search results:', results);
    // Update UI with results
  }

  destroy() {
    this.searchInput.removeEventListener('input', this.debouncedSearch);
    this.debouncedSearch.cancel();
  }
}

// Usage examples:
const scrollHandler = new ScrollHandler();
const resizeHandler = new ResizeHandler();
const searchHandler = new SearchHandler();

// Clean up when needed
// scrollHandler.destroy();
// resizeHandler.destroy();
// searchHandler.destroy();

// Simple usage examples:
const debouncedFn = EventController.debounce(() => {
  console.log('Debounced function called');
}, 1000);

const throttledFn = EventController.throttle(() => {
  console.log('Throttled function called');
}, 1000);

// Test the functions
window.addEventListener('scroll', debouncedFn);
window.addEventListener('scroll', throttledFn);