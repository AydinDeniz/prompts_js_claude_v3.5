// Frontend Registration Form and Validation
class EventRegistration {
  constructor() {
    this.form = document.getElementById('registration-form');
    this.submitButton = document.getElementById('submit-button');
    this.initializeForm();
  }

  initializeForm() {
    this.form.addEventListener('submit', this.handleSubmit.bind(this));
    this.setupFormValidation();
  }

  setupFormValidation() {
    const inputs = this.form.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.addEventListener('input', () => this.validateField(input));
    });
  }

  validateField(field) {
    const validationRules = {
      name: {
        pattern: /^[a-zA-Z\s]{2,50}$/,
        message: 'Name must be between 2-50 characters'
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

    const rule = validationRules[field.name];
    if (!rule) return true;

    const isValid = rule.pattern.test(field.value);
    this.toggleFieldError(field, isValid ? '' : rule.message);
    return isValid;
  }

  toggleFieldError(field, message) {
    const errorElement = document.getElementById(`${field.name}-error`);
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = message ? 'block' : 'none';
    }
    field.classList.toggle('invalid', !!message);
  }

  async handleSubmit(event) {
    event.preventDefault();
    
    if (!this.validateForm()) {
      return;
    }

    this.submitButton.disabled = true;
    const formData = this.getFormData();

    try {
      const response = await this.submitRegistration(formData);
      this.handleRegistrationSuccess(response);
    } catch (error) {
      this.handleRegistrationError(error);
    } finally {
      this.submitButton.disabled = false;
    }
  }

  validateForm() {
    const inputs = this.form.querySelectorAll('input, select');
    let isValid = true;

    inputs.forEach(input => {
      if (!this.validateField(input)) {
        isValid = false;
      }
    });

    return isValid;
  }

  getFormData() {
    return {
      name: this.form.elements.name.value,
      email: this.form.elements.email.value,
      phone: this.form.elements.phone.value,
      eventId: this.form.elements.eventId.value,
      dietaryPreferences: Array.from(this.form.elements.dietary)
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.value),
      specialRequirements: this.form.elements.specialRequirements.value
    };
  }

  async submitRegistration(formData) {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }

  handleRegistrationSuccess(response) {
    // Show success message
    this.showMessage('success', 'Registration successful! Check your email for confirmation.');
    this.form.reset();
  }

  handleRegistrationError(error) {
    this.showMessage('error', `Registration failed: ${error.message}`);
  }

  showMessage(type, message) {
    const messageElement = document.getElementById('message');
    messageElement.textContent = message;
    messageElement.className = `message ${type}`;
    messageElement.style.display = 'block';

    setTimeout(() => {
      messageElement.style.display = 'none';
    }, 5000);
  }
}

// Backend (Node.js/Express/MongoDB)
const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// MongoDB Schema
const registrationSchema = new mongoose.Schema({
  registrationId: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4()
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  phone: String,
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  dietaryPreferences: [String],
  specialRequirements: String,
  qrCode: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled'],
    default: 'pending'
  }
});

const Registration = mongoose.model('Registration', registrationSchema);

// Email Service
class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      // Configure email transport
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async sendConfirmationEmail(registration, qrCodeBuffer) {
    const emailTemplate = this.getEmailTemplate(registration);

    await this.transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: registration.email,
      subject: 'Event Registration Confirmation',
      html: emailTemplate,
      attachments: [
        {
          filename: 'qr-code.png',
          content: qrCodeBuffer
        }
      ]
    });
  }

  getEmailTemplate(registration) {
    return `
      <h1>Registration Confirmation</h1>
      <p>Dear ${registration.name},</p>
      <p>Thank you for registering for our event.</p>
      <p>Your registration ID is: ${registration.registrationId}</p>
      <p>Please keep your QR code handy for check-in.</p>
    `;
  }
}

// QR Code Service
class QRCodeService {
  static async generate(data) {
    try {
      return await QRCode.toBuffer(JSON.stringify(data), {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 300
      });
    } catch (error) {
      console.error('QR Code generation failed:', error);
      throw error;
    }
  }
}

// Registration Controller
class RegistrationController {
  static async register(req, res) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const registration = new Registration({
        ...req.body,
        registrationId: uuidv4()
      });

      // Generate QR Code
      const qrData = {
        registrationId: registration.registrationId,
        name: registration.name,
        eventId: registration.eventId
      };

      const qrCodeBuffer = await QRCodeService.generate(qrData);
      registration.qrCode = qrCodeBuffer.toString('base64');

      // Save registration
      await registration.save({ session });

      // Send confirmation email
      const emailService = new EmailService();
      await emailService.sendConfirmationEmail(registration, qrCodeBuffer);

      await session.commitTransaction();

      res.status(201).json({
        message: 'Registration successful',
        registrationId: registration.registrationId
      });
    } catch (error) {
      await session.abortTransaction();
      console.error('Registration failed:', error);
      res.status(500).json({
        message: 'Registration failed',
        error: error.message
      });
    } finally {
      session.endSession();
    }
  }
}

// Express Routes
app.post('/api/register', RegistrationController.register);

// HTML Template
`
<!DOCTYPE html>
<html>
<head>
    <title>Event Registration</title>
    <style>
        .form-group {
            margin-bottom: 15px;
        }
        .invalid {
            border-color: red;
        }
        .error {
            color: red;
            display: none;
            font-size: 12px;
        }
        .message {
            padding: 10px;
            margin: 10px 0;
            border-radius: 4px;
        }
        .message.success {
            background-color: #dff0d8;
            color: #3c763d;
        }
        .message.error {
            background-color: #f2dede;
            color: #a94442;
        }
    </style>
</head>
<body>
    <div id="message" style="display: none;"></div>
    <form id="registration-form">
        <div class="form-group">
            <label for="name">Name:</label>
            <input type="text" id="name" name="name" required>
            <div id="name-error" class="error"></div>
        </div>

        <div class="form-group">
            <label for="email">Email:</label>
            <input type="email" id="email" name="email" required>
            <div id="email-error" class="error"></div>
        </div>

        <div class="form-group">
            <label for="phone">Phone:</label>
            <input type="tel" id="phone" name="phone">
            <div id="phone-error" class="error"></div>
        </div>

        <div class="form-group">
            <label for="eventId">Event:</label>
            <select id="eventId" name="eventId" required>
                <option value="">Select an event</option>
                <!-- Add event options dynamically -->
            </select>
        </div>

        <div class="form-group">
            <label>Dietary Preferences:</label>
            <div>
                <input type="checkbox" name="dietary" value="vegetarian">
                <label>Vegetarian</label>
            </div>
            <div>
                <input type="checkbox" name="dietary" value="vegan">
                <label>Vegan</label>
            </div>
            <div>
                <input type="checkbox" name="dietary" value="gluten-free">
                <label>Gluten-free</label>
            </div>
        </div>

        <div class="form-group">
            <label for="specialRequirements">Special Requirements:</label>
            <textarea id="specialRequirements" name="specialRequirements"></textarea>
        </div>

        <button type="submit" id="submit-button">Register</button>
    </form>

    <script src="registration.js"></script>
</body>
</html>
`