/**
 * Sandata Data Transformers
 * Converts internal data formats to Sandata-compliant XML
 */

class SandataTransformers {
  
  // Transform internal client profile to Sandata client format
  static transformClientProfile(profile) {
    return {
      medicaidId: profile.medicaidId || profile.id,
      firstName: profile.firstName || profile.name?.split(' ')[0],
      lastName: profile.lastName || profile.name?.split(' ').slice(1).join(' '),
      dateOfBirth: profile.dateOfBirth || profile.dob,
      phoneType: this.fixPhoneType(profile.phoneType),
      phone: profile.phone,
      email: profile.email,
      address1: profile.address?.split(',')[0] || profile.address,
      city: profile.city || 'Las Vegas',
      state: 'NV',
      zipCode: profile.zipCode || '89101',
      status: profile.status || 'Active',
      version: '1'
    };
  }

  // Transform internal employee data to Sandata employee format
  static transformEmployee(employee) {
    return {
      employeeId: employee.id || employee.employeeId,
      firstName: employee.firstName || employee.name?.split(' ')[0],
      lastName: employee.lastName || employee.name?.split(' ').slice(1).join(' '),
      phoneType: this.fixPhoneType(employee.phoneType),
      phone: employee.phone,
      email: employee.email,
      status: employee.status || 'Active',
      version: '1'
    };
  }

  // Transform visit data to Sandata visit format
  static transformVisit(visit) {
    return {
      visitKey: visit.id || visit.visitKey,
      clientId: visit.clientId || visit.medicaidId,
      employeeId: visit.employeeId || visit.caregiverId,
      serviceId: visit.serviceId || 'PCS001',
      startDate: this.formatDate(visit.startDate || visit.date),
      endDate: this.formatDate(visit.endDate || visit.date),
      callType: this.fixCallType(visit.callType),
      timeIn: this.formatTime(visit.timeIn || visit.startTime),
      timeOut: this.formatTime(visit.timeOut || visit.endTime),
      visitChanges: visit.visitChanges || [],
      version: visit.version || '1'
    };
  }

  // Transform call data to Sandata call format
  static transformCall(call) {
    return {
      callKey: call.id || call.callKey,
      visitKey: call.visitKey || call.visitId,
      callType: this.fixCallType(call.callType),
      callAssignment: call.callAssignment || 'Time In',
      callDateTime: this.formatDateTime(call.callDateTime || call.timestamp),
      version: call.version || '1'
    };
  }

  // Fix phone type format (Sandata compliance)
  static fixPhoneType(phoneType) {
    const phoneTypeMap = {
      'Work': 'Business',
      'Mobile': 'Mobile',
      'Home': 'Home',
      'Other': 'Other',
      'Cell': 'Mobile',
      'Office': 'Business'
    };
    
    return phoneTypeMap[phoneType] || 'Mobile';
  }

  // Fix call type format (Sandata compliance)
  static fixCallType(callType) {
    const validCallTypes = ['Mobile', 'Telephony', 'Manual', 'Other'];
    return validCallTypes.includes(callType) ? callType : 'Mobile';
  }

  // Format date for Sandata (YYYY-MM-DD)
  static formatDate(date) {
    if (!date) return new Date().toISOString().split('T')[0];
    
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }

  // Format time for Sandata (HH:MM:SS)
  static formatTime(time) {
    if (!time) return '00:00:00';
    
    if (typeof time === 'string') {
      // Handle various time formats
      if (time.includes(':')) {
        const parts = time.split(':');
        if (parts.length === 2) {
          return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
        }
        return time;
      }
    }
    
    return '00:00:00';
  }

  // Format datetime for Sandata
  static formatDateTime(dateTime) {
    if (!dateTime) return new Date().toISOString();
    
    const d = new Date(dateTime);
    return d.toISOString();
  }

  // Validate data before sending to Sandata
  static validateClientData(clientData) {
    const errors = [];
    
    if (!clientData.medicaidId) errors.push('Medicaid ID is required');
    if (!clientData.firstName) errors.push('First name is required');
    if (!clientData.lastName) errors.push('Last name is required');
    if (!clientData.dateOfBirth) errors.push('Date of birth is required');
    if (!clientData.phone) errors.push('Phone number is required');
    
    // Validate phone type
    const validPhoneTypes = ['Home', 'Mobile', 'Business', 'Other'];
    if (clientData.phoneType && !validPhoneTypes.includes(clientData.phoneType)) {
      errors.push(`Invalid phone type: ${clientData.phoneType}`);
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Validate employee data
  static validateEmployeeData(employeeData) {
    const errors = [];
    
    if (!employeeData.employeeId) errors.push('Employee ID is required');
    if (!employeeData.firstName) errors.push('First name is required');
    if (!employeeData.lastName) errors.push('Last name is required');
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Validate visit data
  static validateVisitData(visitData) {
    const errors = [];
    
    if (!visitData.visitKey) errors.push('Visit key is required');
    if (!visitData.clientId) errors.push('Client ID is required');
    if (!visitData.employeeId) errors.push('Employee ID is required');
    if (!visitData.serviceId) errors.push('Service ID is required');
    if (!visitData.startDate) errors.push('Start date is required');
    if (!visitData.endDate) errors.push('End date is required');
    
    // Validate call type
    const validCallTypes = ['Mobile', 'Telephony', 'Manual', 'Other'];
    if (visitData.callType && !validCallTypes.includes(visitData.callType)) {
      errors.push(`Invalid call type: ${visitData.callType}`);
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Generate test data for certification
  static generateTestData() {
    return {
      clients: [
        {
          medicaidId: '00002173648', // Tobista Kefeni
          firstName: 'Tobista',
          lastName: 'Kefeni',
          dateOfBirth: '2017-03-02',
          phoneType: 'Mobile',
          phone: '7025551234',
          email: 'tobista@example.com',
          address1: '123 Test St',
          city: 'Las Vegas',
          state: 'NV',
          zipCode: '89101',
          status: 'Active',
          version: '1'
        },
        // Add more test clients...
      ],
      employees: [
        {
          employeeId: 'EMP001',
          firstName: 'John',
          lastName: 'Smith',
          phoneType: 'Mobile',
          phone: '7025550001',
          email: 'john@unitedfamilycaregivers.com',
          status: 'Active',
          version: '1'
        },
        // Add more test employees...
      ],
      visits: [
        {
          visitKey: 'VISIT001',
          clientId: '00002173648',
          employeeId: 'EMP001',
          serviceId: 'PCS001',
          startDate: '2025-01-01',
          endDate: '2025-01-01',
          callType: 'Mobile',
          timeIn: '09:00:00',
          timeOut: '17:00:00',
          version: '1'
        },
        // Add more test visits...
      ]
    };
  }
}

module.exports = SandataTransformers;







