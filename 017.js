class CarRentalSystem {
  constructor() {
    this.API_URL = '/api/rentals';
    this.cars = [];
    this.selectedCar = null;
    this.bookingData = {};

    this.init();
  }

  async init() {
    this.initializeUI();
    this.setupValidation();
    this.setupEventListeners();
    await this.loadCarTypes();
  }

  initializeUI() {
    this.elements = {
      searchForm: document.getElementById('search-form'),
      bookingForm: document.getElementById('booking-form'),
      carResults: document.getElementById('car-results'),
      paymentSection: document.getElementById('payment-section'),
      totalPrice: document.getElementById('total-price'),
      dateInputs: document.querySelectorAll('input[type="date"]'),
      locationSelect: document.getElementById('pickup-location'),
      errorContainer: document.getElementById('error-container'),
      successMessage: document.getElementById('success-message')
    };

    // Initialize date pickers with min dates
    this.elements.dateInputs.forEach(input => {
      input.min = new Date().toISOString().split('T')[0];
    });
  }

  setupValidation() {
    this.validators = {
      name: value => {
        const regex = /^[a-zA-Z\s]{2,50}$/;
        return {
          isValid: regex.test(value),
          message: 'Name should be 2-50 characters long, letters only'
        };
      },
      email: value => {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return {
          isValid: regex.test(value),
          message: 'Please enter a valid email address'
        };
      },
      phone: value => {
        const regex = /^\+?[\d\s-]{10,}$/;
        return {
          isValid: regex.test(value),
          message: 'Please enter a valid phone number'
        };
      },
      licenseNumber: value => {
        const regex = /^[A-Z0-9]{5,15}$/i;
        return {
          isValid: regex.test(value),
          message: 'Please enter a valid license number'
        };
      },
      creditCard: value => {
        const regex = /^[0-9]{16}$/;
        return {
          isValid: regex.test(value.replace(/\s/g, '')),
          message: 'Please enter a valid 16-digit credit card number'
        };
      },
      cvv: value => {
        const regex = /^[0-9]{3,4}$/;
        return {
          isValid: regex.test(value),
          message: 'Please enter a valid CVV'
        };
      },
      expiryDate: value => {
        const [month, year] = value.split('/').map(Number);
        const now = new Date();
        const currentYear = now.getFullYear() % 100;
        const currentMonth = now.getMonth() + 1;
        
        return {
          isValid: month >= 1 && month <= 12 && 
                  year >= currentYear &&
                  (year > currentYear || month >= currentMonth),
          message: 'Please enter a valid expiry date (MM/YY)'
        };
      }
    };
  }

  setupEventListeners() {
    this.elements.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSearch();
    });

    this.elements.bookingForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleBooking();
    });

    // Real-time validation
    this.elements.bookingForm.querySelectorAll('input').forEach(input => {
      input.addEventListener('blur', () => {
        this.validateField(input);
      });
    });

    // Date range validation
    document.getElementById('pickup-date').addEventListener('change', () => {
      this.updateReturnDateMin();
    });

    // Update price on date change
    this.elements.dateInputs.forEach(input => {
      input.addEventListener('change', () => {
        this.updateTotalPrice();
      });
    });
  }

  async loadCarTypes() {
    try {
      const response = await fetch(`${this.API_URL}/cars`);
      this.cars = await response.json();
      this.populateCarTypes();
    } catch (error) {
      this.showError('Failed to load car types');
    }
  }

  populateCarTypes() {
    const carTypeSelect = document.getElementById('car-type');
    carTypeSelect.innerHTML = `
      <option value="">Select car type</option>
      ${this.cars.map(car => `
        <option value="${car.id}">${car.make} ${car.model} - $${car.daily_rate}/day</option>
      `).join('')}
    `;
  }

  async handleSearch() {
    const searchData = {
      pickupLocation: this.elements.locationSelect.value,
      pickupDate: document.getElementById('pickup-date').value,
      returnDate: document.getElementById('return-date').value,
      carType: document.getElementById('car-type').value
    };

    if (!this.validateSearchDates(searchData)) {
      return;
    }

    try {
      const response = await fetch(`${this.API_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchData)
      });

      const availableCars = await response.json();
      this.displaySearchResults(availableCars);
    } catch (error) {
      this.showError('Failed to search for available cars');
    }
  }

  validateSearchDates(data) {
    const pickup = new Date(data.pickupDate);
    const return_ = new Date(data.returnDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (pickup < today) {
      this.showError('Pickup date cannot be in the past');
      return false;
    }

    if (return_ <= pickup) {
      this.showError('Return date must be after pickup date');
      return false;
    }

    return true;
  }

  displaySearchResults(cars) {
    this.elements.carResults.innerHTML = cars.map(car => `
      <div class="car-card" data-car-id="${car.id}">
        <img src="${car.image}" alt="${car.make} ${car.model}">
        <h3>${car.make} ${car.model}</h3>
        <p>Year: ${car.year}</p>
        <p>Transmission: ${car.transmission}</p>
        <p>Seats: ${car.seats}</p>
        <p>Daily Rate: $${car.daily_rate}</p>
        <button onclick="carRental.selectCar(${car.id})">Select</button>
      </div>
    `).join('');
  }

  selectCar(carId) {
    this.selectedCar = this.cars.find(car => car.id === carId);
    this.elements.bookingForm.style.display = 'block';
    this.updateTotalPrice();
    this.scrollToBookingForm();
  }

  updateTotalPrice() {
    if (!this.selectedCar) return;

    const pickupDate = new Date(document.getElementById('pickup-date').value);
    const returnDate = new Date(document.getElementById('return-date').value);
    const days = Math.ceil((returnDate - pickupDate) / (1000 * 60 * 60 * 24));

    if (days > 0) {
      const totalPrice = days * this.selectedCar.daily_rate;
      this.elements.totalPrice.textContent = `$${totalPrice}`;
      this.bookingData.totalPrice = totalPrice;
    }
  }

  updateReturnDateMin() {
    const pickupDate = document.getElementById('pickup-date').value;
    const returnDateInput = document.getElementById('return-date');
    returnDateInput.min = pickupDate;
    
    if (returnDateInput.value < pickupDate) {
      returnDateInput.value = pickupDate;
    }
  }

  async handleBooking() {
    if (!this.validateBookingForm()) {
      return;
    }

    const formData = new FormData(this.elements.bookingForm);
    const bookingData = {
      ...Object.fromEntries(formData),
      carId: this.selectedCar.id,
      totalPrice: this.bookingData.totalPrice
    };

    try {
      const response = await fetch(`${this.API_URL}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData)
      });

      if (response.ok) {
        const result = await response.json();
        this.showBookingConfirmation(result);
      } else {
        throw new Error('Booking failed');
      }
    } catch (error) {
      this.showError('Failed to process booking');
    }
  }

  validateBookingForm() {
    let isValid = true;
    const requiredFields = this.elements.bookingForm.querySelectorAll('[required]');

    requiredFields.forEach(field => {
      if (!this.validateField(field)) {
        isValid = false;
      }
    });

    return isValid;
  }

  validateField(field) {
    const validator = this.validators[field.name];
    if (!validator) return true;

    const result = validator(field.value);
    this.toggleFieldError(field, result.isValid ? '' : result.message);
    return result.isValid;
  }

  toggleFieldError(field, message) {
    const errorElement = document.getElementById(`${field.name}-error`);
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = message ? 'block' : 'none';
    }
    field.classList.toggle('invalid', !!message);
  }

  showBookingConfirmation(result) {
    this.elements.successMessage.innerHTML = `
      <h2>Booking Confirmed!</h2>
      <p>Booking Reference: ${result.bookingId}</p>
      <p>Total Price: $${result.totalPrice}</p>
      <p>A confirmation email has been sent to your email address.</p>
    `;
    this.elements.successMessage.style.display = 'block';
    this.elements.bookingForm.reset();
    this.scrollToElement(this.elements.successMessage);
  }

  showError(message) {
    this.elements.errorContainer.textContent = message;
    this.elements.errorContainer.style.display = 'block';
    setTimeout(() => {
      this.elements.errorContainer.style.display = 'none';
    }, 5000);
  }

  scrollToBookingForm() {
    this.scrollToElement(this.elements.bookingForm);
  }

  scrollToElement(element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Backend (Express.js and MySQL)
const express = require('express');
const mysql = require('mysql2/promise');
const app = express();

const pool = mysql.createPool({
  host: 'localhost',
  user: 'your_username',
  password: 'your_password',
  database: 'car_rental',
  waitForConnections: true,
  connectionLimit: 10
});

// Database schema
const schema = `
  CREATE TABLE IF NOT EXISTS cars (
    id INT PRIMARY KEY AUTO_INCREMENT,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INT NOT NULL,
    transmission VARCHAR(20) NOT NULL,
    seats INT NOT NULL,
    daily_rate DECIMAL(10,2) NOT NULL,
    image_url VARCHAR(255),
    status ENUM('available', 'rented', 'maintenance') DEFAULT 'available'
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    address VARCHAR(255) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    car_id INT,
    pickup_location_id INT,
    return_location_id INT,
    pickup_date DATE NOT NULL,
    return_date DATE NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    customer_email VARCHAR(100) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    license_number VARCHAR(20) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    status ENUM('pending', 'confirmed', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (car_id) REFERENCES cars(id),
    FOREIGN KEY (pickup_location_id) REFERENCES locations(id),
    FOREIGN KEY (return_location_id) REFERENCES locations(id)
  );
`;

// API Routes
app.get('/api/rentals/cars', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM cars WHERE status = "available"');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cars' });
  }
});

app.post('/api/rentals/search', async (req, res) => {
  const { pickupLocation, pickupDate, returnDate, carType } = req.body;

  try {
    const [cars] = await pool.query(`
      SELECT c.* FROM cars c
      LEFT JOIN bookings b ON c.id = b.car_id
      WHERE c.id = ? AND c.status = 'available'
      AND NOT EXISTS (
        SELECT 1 FROM bookings
        WHERE car_id = c.id
        AND status = 'confirmed'
        AND (
          (pickup_date BETWEEN ? AND ?)
          OR (return_date BETWEEN ? AND ?)
          OR (pickup_date <= ? AND return_date >= ?)
        )
      )
    `, [carType, pickupDate, returnDate, pickupDate, returnDate, pickupDate, returnDate]);

    res.json(cars);
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/api/rentals/book', async (req, res) => {
  const booking = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Check car availability again
    const [carAvailable] = await connection.query(`
      SELECT 1 FROM cars
      WHERE id = ? AND status = 'available'
      AND NOT EXISTS (
        SELECT 1 FROM bookings
        WHERE car_id = ?
        AND status = 'confirmed'
        AND (
          (pickup_date BETWEEN ? AND ?)
          OR (return_date BETWEEN ? AND ?)
          OR (pickup_date <= ? AND return_date >= ?)
        )
      )
    `, [booking.carId, booking.carId, booking.pickupDate, booking.returnDate,
        booking.pickupDate, booking.returnDate, booking.pickupDate, booking.returnDate]);

    if (!carAvailable.length) {
      throw new Error('Car is no longer available');
    }

    // Create booking
    const [result] = await connection.query(`
      INSERT INTO bookings SET ?
    `, {
      car_id: booking.carId,
      pickup_location_id: booking.pickupLocation,
      return_location_id: booking.returnLocation,
      pickup_date: booking.pickupDate,
      return_date: booking.returnDate,
      customer_name: booking.name,
      customer_email: booking.email,
      customer_phone: booking.phone,
      license_number: booking.licenseNumber,
      total_price: booking.totalPrice