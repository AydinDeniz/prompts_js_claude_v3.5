// Frontend validation and submission
const validateAndSubmitForm = async (event) => {
  event.preventDefault();
  
  const formData = {
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim()
  };

  const validationRules = {
    name: {
      pattern: /^[a-zA-Z\s]{2,50}$/,
      message: 'Name must be 2-50 characters long and contain only letters'
    },
    email: {
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: 'Please enter a valid email address'
    },
    phone: {
      pattern: /^\+?[\d\s-]{10,}$/,
      message: 'Please enter a valid phone number'
    }
  };

  const errors = {};
  let isValid = true;

  // Validate each field
  Object.keys(formData).forEach(field => {
    if (!validationRules[field].pattern.test(formData[field])) {
      errors[field] = validationRules[field].message;
      isValid = false;
      showError(field, validationRules[field].message);
    } else {
      clearError(field);
    }
  });

  if (!isValid) {
    return false;
  }

  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData)
    });

    const result = await response.json();

    if (response.ok) {
      showSuccess('Form submitted successfully!');
      resetForm();
    } else {
      showError('form', result.message || 'Submission failed');
    }
  } catch (error) {
    showError('form', 'Network error occurred');
  }
};

// Helper functions
const showError = (field, message) => {
  const errorElement = document.getElementById(`${field}-error`);
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = 'block';
  }
};

const clearError = (field) => {
  const errorElement = document.getElementById(`${field}-error`);
  if (errorElement) {
    errorElement.textContent = '';
    errorElement.style.display = 'none';
  }
};

const showSuccess = (message) => {
  const successElement = document.getElementById('success-message');
  if (successElement) {
    successElement.textContent = message;
    successElement.style.display = 'block';
    setTimeout(() => {
      successElement.style.display = 'none';
    }, 3000);
  }
};

const resetForm = () => {
  document.getElementById('contact-form').reset();
};

// Backend Node.js code
const express = require('express');
const mysql = require('mysql2/promise');
const app = express();

app.use(express.json());

// Database configuration
const dbConfig = {
  host: 'localhost',
  user: 'your_username',
  password: 'your_password',
  database: 'your_database'
};

// Create database connection pool
const pool = mysql.createPool(dbConfig);

app.post('/api/submit', async (req, res) => {
  const { name, email, phone } = req.body;

  try {
    const connection = await pool.getConnection();
    
    try {
      await connection.execute(
        'INSERT INTO contacts (name, email, phone) VALUES (?, ?, ?)',
        [name, email, phone]
      );

      res.status(200).json({ 
        success: true, 
        message: 'Contact information saved successfully' 
      });
    } catch (error) {
      console.error('Database error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error saving to database' 
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Database connection error' 
    });
  }
});

// HTML form
`
<form id="contact-form" onsubmit="validateAndSubmitForm(event)">
  <div class="form-group">
    <label for="name">Name:</label>
    <input type="text" id="name" required>
    <span id="name-error" class="error"></span>
  </div>

  <div class="form-group">
    <label for="email">Email:</label>
    <input type="email" id="email" required>
    <span id="email-error" class="error"></span>
  </div>

  <div class="form-group">
    <label for="phone">Phone:</label>
    <input type="tel" id="phone" required>
    <span id="phone-error" class="error"></span>
  </div>

  <button type="submit">Submit</button>
  <div id="success-message" class="success"></div>
  <div id="form-error" class="error"></div>
</form>
`

// Basic CSS
`
.error {
  color: red;
  display: none;
  font-size: 0.8em;
  margin-top: 5px;
}

.success {
  color: green;
  display: none;
  font-size: 0.9em;
  margin-top: 10px;
}

.form-group {
  margin-bottom: 15px;
}
`