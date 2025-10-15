/**
 * Sandata Validation Engine
 * Validates data compliance before sending to Sandata
 */

class SandataValidationEngine {
  
  // Validate all data types
  static validateAll(data, type) {
    switch (type) {
      case 'client':
        return this.validateClient(data);
      case 'employee':
        return this.validateEmployee(data);
      case 'visit':
        return this.validateVisit(data);
      case 'call':
        return this.validateCall(data);
      default:
        return { isValid: false, errors: ['Unknown data type'] };
    }
  }

  // Validate client data
  static validateClient(clientData) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!clientData.medicaidId) errors.push('Medicaid ID is required');
    if (!clientData.firstName) errors.push('First name is required');
    if (!clientData.lastName) errors.push('Last name is required');
    if (!clientData.dateOfBirth) errors.push('Date of birth is required');

    // Phone validation
    if (!clientData.phone) {
      errors.push('Phone number is required');
    } else {
      const phoneRegex = /^\+?1?[2-9]\d{2}[2-9]\d{2}\d{4}$/;
      if (!phoneRegex.test(clientData.phone.replace(/[^\d]/g, ''))) {
        warnings.push('Phone number format may be invalid');
      }
    }

    // Phone type validation
    const validPhoneTypes = ['Home', 'Mobile', 'Business', 'Other'];
    if (clientData.phoneType && !validPhoneTypes.includes(clientData.phoneType)) {
      errors.push(`Invalid phone type: ${clientData.phoneType}. Must be one of: ${validPhoneTypes.join(', ')}`);
    }

    // Date validation
    if (clientData.dateOfBirth) {
      const dob = new Date(clientData.dateOfBirth);
      if (isNaN(dob.getTime())) {
        errors.push('Invalid date of birth format');
      } else if (dob > new Date()) {
        errors.push('Date of birth cannot be in the future');
      }
    }

    // Email validation
    if (clientData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(clientData.email)) {
        warnings.push('Email format may be invalid');
      }
    }

    // Address validation
    if (!clientData.address1) warnings.push('Address line 1 is recommended');
    if (!clientData.city) warnings.push('City is recommended');
    if (!clientData.zipCode) warnings.push('ZIP code is recommended');

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score: this.calculateScore(errors.length, warnings.length)
    };
  }

  // Validate employee data
  static validateEmployee(employeeData) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!employeeData.employeeId) errors.push('Employee ID is required');
    if (!employeeData.firstName) errors.push('First name is required');
    if (!employeeData.lastName) errors.push('Last name is required');

    // Phone validation
    if (employeeData.phone) {
      const phoneRegex = /^\+?1?[2-9]\d{2}[2-9]\d{2}\d{4}$/;
      if (!phoneRegex.test(employeeData.phone.replace(/[^\d]/g, ''))) {
        warnings.push('Phone number format may be invalid');
      }
    }

    // Phone type validation
    const validPhoneTypes = ['Home', 'Mobile', 'Business', 'Other'];
    if (employeeData.phoneType && !validPhoneTypes.includes(employeeData.phoneType)) {
      errors.push(`Invalid phone type: ${employeeData.phoneType}`);
    }

    // Email validation
    if (employeeData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(employeeData.email)) {
        warnings.push('Email format may be invalid');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score: this.calculateScore(errors.length, warnings.length)
    };
  }

  // Validate visit data
  static validateVisit(visitData) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!visitData.visitKey) errors.push('Visit key is required');
    if (!visitData.clientId) errors.push('Client ID is required');
    if (!visitData.employeeId) errors.push('Employee ID is required');
    if (!visitData.serviceId) errors.push('Service ID is required');
    if (!visitData.startDate) errors.push('Start date is required');
    if (!visitData.endDate) errors.push('End date is required');

    // Date validation
    if (visitData.startDate && visitData.endDate) {
      const startDate = new Date(visitData.startDate);
      const endDate = new Date(visitData.endDate);
      
      if (isNaN(startDate.getTime())) {
        errors.push('Invalid start date format');
      }
      if (isNaN(endDate.getTime())) {
        errors.push('Invalid end date format');
      }
      if (startDate > endDate) {
        errors.push('Start date cannot be after end date');
      }
    }

    // Time validation
    if (visitData.timeIn && visitData.timeOut) {
      const timeIn = this.parseTime(visitData.timeIn);
      const timeOut = this.parseTime(visitData.timeOut);
      
      if (timeIn >= timeOut) {
        warnings.push('Time in should be before time out');
      }
    }

    // Call type validation
    const validCallTypes = ['Mobile', 'Telephony', 'Manual', 'Other'];
    if (visitData.callType && !validCallTypes.includes(visitData.callType)) {
      errors.push(`Invalid call type: ${visitData.callType}`);
    }

    // Service ID validation
    if (visitData.serviceId && !this.isValidServiceId(visitData.serviceId)) {
      warnings.push('Service ID format may be invalid');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score: this.calculateScore(errors.length, warnings.length)
    };
  }

  // Validate call data
  static validateCall(callData) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!callData.callKey) errors.push('Call key is required');
    if (!callData.visitKey) errors.push('Visit key is required');
    if (!callData.callType) errors.push('Call type is required');
    if (!callData.callAssignment) errors.push('Call assignment is required');
    if (!callData.callDateTime) errors.push('Call date time is required');

    // Call type validation
    const validCallTypes = ['Mobile', 'Telephony', 'Manual', 'Other'];
    if (!validCallTypes.includes(callData.callType)) {
      errors.push(`Invalid call type: ${callData.callType}`);
    }

    // Call assignment validation
    const validAssignments = ['Time In', 'Time Out'];
    if (!validAssignments.includes(callData.callAssignment)) {
      errors.push(`Invalid call assignment: ${callData.callAssignment}`);
    }

    // DateTime validation
    if (callData.callDateTime) {
      const callDateTime = new Date(callData.callDateTime);
      if (isNaN(callDateTime.getTime())) {
        errors.push('Invalid call date time format');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score: this.calculateScore(errors.length, warnings.length)
    };
  }

  // Parse time string to minutes for comparison
  static parseTime(timeString) {
    const parts = timeString.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }

  // Validate service ID format
  static isValidServiceId(serviceId) {
    // Basic service ID validation - adjust based on Sandata requirements
    return /^[A-Z0-9]+$/.test(serviceId);
  }

  // Calculate validation score
  static calculateScore(errorCount, warningCount) {
    const maxScore = 100;
    const errorPenalty = 20;
    const warningPenalty = 5;
    
    return Math.max(0, maxScore - (errorCount * errorPenalty) - (warningCount * warningPenalty));
  }

  // Auto-fix common issues
  static autoFix(data, type) {
    const fixed = { ...data };

    switch (type) {
      case 'client':
        // Fix phone type
        if (fixed.phoneType === 'Work') {
          fixed.phoneType = 'Business';
        }
        // Fix date format
        if (fixed.dateOfBirth && !fixed.dateOfBirth.includes('-')) {
          const date = new Date(fixed.dateOfBirth);
          fixed.dateOfBirth = date.toISOString().split('T')[0];
        }
        break;

      case 'employee':
        // Fix phone type
        if (fixed.phoneType === 'Work') {
          fixed.phoneType = 'Business';
        }
        break;

      case 'visit':
        // Fix call type
        if (fixed.callType && !['Mobile', 'Telephony', 'Manual', 'Other'].includes(fixed.callType)) {
          fixed.callType = 'Mobile';
        }
        // Fix time format
        if (fixed.timeIn && !fixed.timeIn.includes(':')) {
          fixed.timeIn = '00:00:00';
        }
        if (fixed.timeOut && !fixed.timeOut.includes(':')) {
          fixed.timeOut = '00:00:00';
        }
        break;
    }

    return fixed;
  }

  // Batch validation for multiple records
  static validateBatch(records, type) {
    const results = records.map(record => ({
      data: record,
      validation: this.validateAll(record, type)
    }));

    const summary = {
      total: records.length,
      valid: results.filter(r => r.validation.isValid).length,
      invalid: results.filter(r => !r.validation.isValid).length,
      averageScore: results.reduce((sum, r) => sum + r.validation.score, 0) / results.length
    };

    return {
      results,
      summary
    };
  }
}

module.exports = SandataValidationEngine;







