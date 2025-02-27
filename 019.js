class AppointmentScheduler {
  constructor() {
    this.API_URL = '/api/appointments';
    this.calendar = null;
    this.selectedSlot = null;
    this.doctors = [];
    this.specialties = [];
    
    this.init();
  }

  async init() {
    this.initializeUI();
    await this.loadInitialData();
    this.setupCalendar();
    this.setupEventListeners();
    this.setupFormValidation();
  }

  initializeUI() {
    this.elements = {
      calendar: document.getElementById('calendar'),
      bookingForm: document.getElementById('booking-form'),
      specialtySelect: document.getElementById('specialty'),
      doctorSelect: document.getElementById('doctor'),
      timeSlots: document.getElementById('time-slots'),
      patientForm: document.getElementById('patient-form'),
      confirmationModal: document.getElementById('confirmation-modal'),
      errorContainer: document.getElementById('error-container')
    };
  }

  async loadInitialData() {
    try {
      const [specialtiesResponse, doctorsResponse] = await Promise.all([
        fetch(`${this.API_URL}/specialties`),
        fetch(`${this.API_URL}/doctors`)
      ]);

      this.specialties = await specialtiesResponse.json();
      this.doctors = await doctorsResponse.json();

      this.populateSpecialties();
    } catch (error) {
      this.showError('Failed to load initial data');
    }
  }

  setupCalendar() {
    this.calendar = new FullCalendar.Calendar(this.elements.calendar, {
      initialView: 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      },
      selectable: true,
      selectConstraint: 'businessHours',
      businessHours: {
        daysOfWeek: [1, 2, 3, 4, 5], // Monday - Friday
        startTime: '09:00',
        endTime: '17:00',
      },
      select: (info) => this.handleDateSelect(info),
      events: (info, successCallback, failureCallback) => 
        this.loadEvents(info, successCallback, failureCallback),
      eventClick: (info) => this.handleEventClick(info),
      validRange: {
        start: new Date()
      }
    });

    this.calendar.render();
  }

  setupEventListeners() {
    this.elements.specialtySelect.addEventListener('change', () => {
      this.updateDoctorsList();
    });

    this.elements.doctorSelect.addEventListener('change', () => {
      this.calendar.refetchEvents();
    });

    this.elements.bookingForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleBookingSubmit();
    });
  }

  setupFormValidation() {
    this.validators = {
      name: {
        validate: value => /^[a-zA-Z\s]{2,50}$/.test(value),
        message: 'Please enter a valid name (2-50 characters)'
      },
      email: {
        validate: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        message: 'Please enter a valid email address'
      },
      phone: {
        validate: value => /^\+?[\d\s-]{10,}$/.test(value),
        message: 'Please enter a valid phone number'
      },
      insurance: {
        validate: value => value.length >= 5,
        message: 'Please enter a valid insurance number'
      }
    };

    // Add real-time validation
    Object.keys(this.validators).forEach(field => {
      const input = document.getElementById(field);
      if (input) {
        input.addEventListener('blur', () => this.validateField(field));
      }
    });
  }

  populateSpecialties() {
    this.elements.specialtySelect.innerHTML = `
      <option value="">Select Specialty</option>
      ${this.specialties.map(specialty => `
        <option value="${specialty.id}">${specialty.name}</option>
      `).join('')}
    `;
  }

  updateDoctorsList() {
    const specialtyId = this.elements.specialtySelect.value;
    const filteredDoctors = this.doctors.filter(
      doctor => doctor.specialty_id === parseInt(specialtyId)
    );

    this.elements.doctorSelect.innerHTML = `
      <option value="">Select Doctor</option>
      ${filteredDoctors.map(doctor => `
        <option value="${doctor.id}">Dr. ${doctor.name}</option>
      `).join('')}
    `;

    this.calendar.refetchEvents();
  }

  async loadEvents(info, successCallback, failureCallback) {
    const doctorId = this.elements.doctorSelect.value;
    if (!doctorId) {
      successCallback([]);
      return;
    }

    try {
      const response = await fetch(
        `${this.API_URL}/slots?doctor_id=${doctorId}&start=${info.startStr}&end=${info.endStr}`
      );
      const events = await response.json();
      
      successCallback(events.map(event => ({
        id: event.id,
        title: event.booked ? 'Booked' : 'Available',
        start: event.start_time,
        end: event.end_time,
        backgroundColor: event.booked ? '#ff4444' : '#4CAF50',
        extendedProps: {
          booked: event.booked
        }
      })));
    } catch (error) {
      failureCallback(error);
    }
  }

  handleDateSelect(info) {
    const now = new Date();
    const selectedDate = info.start;

    if (selectedDate < now) {
      this.showError('Cannot book appointments in the past');
      return;
    }

    this.selectedSlot = {
      start: info.start,
      end: info.end
    };

    this.showTimeSlots(info.start);
  }

  showTimeSlots(date) {
    const timeSlots = this.generateTimeSlots(date);
    
    this.elements.timeSlots.innerHTML = `
      <div class="time-slots-grid">
        ${timeSlots.map(slot => `
          <button class="time-slot" data-time="${slot.time}">
            ${slot.formatted}
          </button>
        `).join('')}
      </div>
    `;

    this.elements.timeSlots.style.display = 'block';
    this.addTimeSlotsListeners();
  }

  generateTimeSlots(date) {
    const slots = [];
    const startHour = 9;
    const endHour = 17;
    const interval = 30; // minutes

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += interval) {
        const time = new Date(date);
        time.setHours(hour, minute, 0, 0);

        slots.push({
          time: time.toISOString(),
          formatted: time.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })
        });
      }
    }

    return slots;
  }

  addTimeSlotsListeners() {
    const slots = this.elements.timeSlots.querySelectorAll('.time-slot');
    slots.forEach(slot => {
      slot.addEventListener('click', () => {
        slots.forEach(s => s.classList.remove('selected'));
        slot.classList.add('selected');
        this.selectedSlot.time = slot.dataset.time;
        this.elements.bookingForm.style.display = 'block';
      });
    });
  }

  async handleBookingSubmit() {
    if (!this.validateForm()) {
      return;
    }

    const formData = new FormData(this.elements.bookingForm);
    const appointmentData = {
      doctor_id: this.elements.doctorSelect.value,
      start_time: this.selectedSlot.time,
      patient: {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        insurance: formData.get('insurance'),
        notes: formData.get('notes')
      }
    };

    try {
      const response = await fetch(`${this.API_URL}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appointmentData)
      });

      if (response.ok) {
        const result = await response.json();
        this.showConfirmation(result);
        this.calendar.refetchEvents();
      } else {
        throw new Error('Booking failed');
      }
    } catch (error) {
      this.showError('Failed to book appointment');
    }
  }

  validateForm() {
    let isValid = true;
    const requiredFields = ['name', 'email', 'phone', 'insurance'];

    requiredFields.forEach(field => {
      if (!this.validateField(field)) {
        isValid = false;
      }
    });

    return isValid;
  }

  validateField(field) {
    const input = document.getElementById(field);
    const validator = this.validators[field];
    
    if (!validator) return true;

    const isValid = validator.validate(input.value);
    this.toggleFieldError(field, isValid ? '' : validator.message);
    return isValid;
  }

  toggleFieldError(field, message) {
    const errorElement = document.getElementById(`${field}-error`);
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = message ? 'block' : 'none';
    }
  }

  showConfirmation(appointment) {
    this.elements.confirmationModal.innerHTML = `
      <div class="modal-content">
        <h2>Appointment Confirmed</h2>
        <p>Date: ${new Date(appointment.start_time).toLocaleDateString()}</p>
        <p>Time: ${new Date(appointment.start_time).toLocaleTimeString()}</p>
        <p>Doctor: Dr. ${appointment.doctor_name}</p>
        <p>Reference: ${appointment.reference_number}</p>
        <p>A confirmation email has been sent to your email address.</p>
        <button onclick="appointmentScheduler.closeConfirmation()">Close</button>
      </div>
    `;
    
    this.elements.confirmationModal.style.display = 'block';
    this.elements.bookingForm.reset();
    this.elements.timeSlots.style.display = 'none';
  }

  closeConfirmation() {
    this.elements.confirmationModal.style.display = 'none';
  }

  showError(message) {
    this.elements.errorContainer.textContent = message;
    this.elements.errorContainer.style.display = 'block';
    
    setTimeout(() => {
      this.elements.errorContainer.style.display = 'none';
    }, 5000);
  }
}

// Backend (Node.js with Express and PostgreSQL)
const express = require('express');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  user: 'your_username',
  host: 'localhost',
  database: 'healthcare_scheduler',
  password: 'your_password',
  port: 5432,
});

// Database schema
const schema = `
  CREATE TABLE specialties (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL
  );

  CREATE TABLE doctors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    specialty_id INTEGER REFERENCES specialties(id),
    email VARCHAR(100) UNIQUE NOT NULL
  );

  CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    doctor_id INTEGER REFERENCES doctors(id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    patient_name VARCHAR(100) NOT NULL,
    patient_email VARCHAR(100) NOT NULL,
    patient_phone VARCHAR(20) NOT NULL,
    patient_insurance VARCHAR(50) NOT NULL,
    notes TEXT,
    reference_number VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'confirmed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX idx_appointments_doctor_time 
    ON appointments(doctor_id, start_time);
`;

// Initialize scheduler
const appointmentScheduler = new AppointmentScheduler();