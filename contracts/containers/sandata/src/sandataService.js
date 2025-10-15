/**
 * Sandata EVV Service Container
 * Handles all Sandata API operations for Nevada DHCFP certification
 */

const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

class SandataService {
  constructor(config) {
    this.config = {
      baseUrl: 'https://api.sandata.com',
      testAccount: '71607',
      testProviderId: '951002550',
      username: 'ghv99ail',
      password: config.password, // From environment
      providerName: 'UNITED FAMILY CAREGIVERS',
      providerId: '250038194',
      ...config
    };
    
    this.parser = new xml2js.Parser();
    this.builder = new xml2js.Builder();
  }

  // Authentication
  async authenticate() {
    try {
      const response = await axios.post(`${this.config.baseUrl}/auth`, {
        username: this.config.username,
        password: this.config.password,
        account: this.config.testAccount
      });
      
      this.authToken = response.data.token;
      return this.authToken;
    } catch (error) {
      console.error('Sandata authentication failed:', error.message);
      throw error;
    }
  }

  // Send Client Data
  async sendClient(clientData) {
    const xmlData = this.buildClientXML(clientData);
    return this.sendToSandata('/clients', xmlData);
  }

  // Send Employee Data
  async sendEmployee(employeeData) {
    const xmlData = this.buildEmployeeXML(employeeData);
    return this.sendToSandata('/employees', xmlData);
  }

  // Send Visit Data
  async sendVisit(visitData) {
    const xmlData = this.buildVisitXML(visitData);
    return this.sendToSandata('/visits', xmlData);
  }

  // Send Call Data
  async sendCall(callData) {
    const xmlData = this.buildCallXML(callData);
    return this.sendToSandata('/calls', xmlData);
  }

  // Check Transaction Status
  async getStatus(transactionId) {
    try {
      const response = await axios.get(`${this.config.baseUrl}/status/${transactionId}`, {
        headers: { 'Authorization': `Bearer ${this.authToken}` }
      });
      return response.data;
    } catch (error) {
      console.error('Status check failed:', error.message);
      throw error;
    }
  }

  // Build Client XML
  buildClientXML(clientData) {
    const xml = {
      Client: {
        $: { xmlns: 'http://www.sandata.com/Client' },
        ClientIdentifier: clientData.medicaidId,
        ClientFirstName: clientData.firstName,
        ClientLastName: clientData.lastName,
        ClientDateOfBirth: clientData.dateOfBirth,
        ClientPhoneType: clientData.phoneType || 'Mobile', // Fix: Work -> Mobile/Business
        ClientPhone: clientData.phone,
        ClientEmail: clientData.email,
        ClientAddress: {
          AddressLine1: clientData.address1,
          City: clientData.city,
          State: clientData.state || 'NV',
          ZipCode: clientData.zipCode
        },
        ClientStatus: clientData.status || 'Active',
        Version: clientData.version || '1'
      }
    };
    
    return this.builder.buildObject(xml);
  }

  // Build Employee XML
  buildEmployeeXML(employeeData) {
    const xml = {
      Employee: {
        $: { xmlns: 'http://www.sandata.com/Employee' },
        EmployeeIdentifier: employeeData.employeeId,
        EmployeeFirstName: employeeData.firstName,
        EmployeeLastName: employeeData.lastName,
        EmployeePhoneType: employeeData.phoneType || 'Mobile',
        EmployeePhone: employeeData.phone,
        EmployeeEmail: employeeData.email,
        EmployeeStatus: employeeData.status || 'Active',
        Version: employeeData.version || '1'
      }
    };
    
    return this.builder.buildObject(xml);
  }

  // Build Visit XML
  buildVisitXML(visitData) {
    const xml = {
      Visit: {
        $: { xmlns: 'http://www.sandata.com/Visit' },
        VisitKey: visitData.visitKey,
        ClientIdentifier: visitData.clientId,
        EmployeeIdentifier: visitData.employeeId,
        Service: {
          ServiceID: visitData.serviceId,
          ServiceStartDate: visitData.startDate,
          ServiceEndDate: visitData.endDate
        },
        CallAssignment: {
          CallType: visitData.callType || 'Mobile',
          TimeIn: visitData.timeIn,
          TimeOut: visitData.timeOut
        },
        VisitChanges: visitData.visitChanges || [],
        Version: visitData.version || '1'
      }
    };
    
    return this.builder.buildObject(xml);
  }

  // Build Call XML
  buildCallXML(callData) {
    const xml = {
      Call: {
        $: { xmlns: 'http://www.sandata.com/Call' },
        CallKey: callData.callKey,
        VisitKey: callData.visitKey,
        CallType: callData.callType,
        CallAssignment: callData.callAssignment,
        CallDateTime: callData.callDateTime,
        Version: callData.version || '1'
      }
    };
    
    return this.builder.buildObject(xml);
  }

  // Send data to Sandata
  async sendToSandata(endpoint, xmlData) {
    try {
      if (!this.authToken) {
        await this.authenticate();
      }

      const response = await axios.post(`${this.config.baseUrl}${endpoint}`, xmlData, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/xml'
        }
      });

      return {
        success: true,
        transactionId: response.data.transactionId,
        message: response.data.message
      };
    } catch (error) {
      console.error(`Sandata ${endpoint} failed:`, error.message);
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  // Load test clients from Sandata
  async loadTestClients() {
    try {
      const response = await axios.get(`${this.config.baseUrl}/test-clients`, {
        headers: { 'Authorization': `Bearer ${this.authToken}` }
      });
      return response.data;
    } catch (error) {
      console.error('Failed to load test clients:', error.message);
      return [];
    }
  }

  // Execute certification test scenarios
  async executeCertificationTests() {
    const results = {
      clients: { sent: 0, success: 0, failed: 0 },
      employees: { sent: 0, success: 0, failed: 0 },
      visits: { sent: 0, success: 0, failed: 0 },
      calls: { sent: 0, success: 0, failed: 0 }
    };

    // Test 1: Send 6+ Client records
    const testClients = await this.loadTestClients();
    for (let i = 0; i < Math.min(6, testClients.length); i++) {
      const result = await this.sendClient(testClients[i]);
      results.clients.sent++;
      if (result.success) results.clients.success++;
      else results.clients.failed++;
    }

    // Test 2: Send 6+ Employee records
    const testEmployees = this.generateTestEmployees();
    for (let i = 0; i < 6; i++) {
      const result = await this.sendEmployee(testEmployees[i]);
      results.employees.sent++;
      if (result.success) results.employees.success++;
      else results.employees.failed++;
    }

    // Test 3: Send 6+ Visit records
    const testVisits = this.generateTestVisits();
    for (let i = 0; i < 6; i++) {
      const result = await this.sendVisit(testVisits[i]);
      results.visits.sent++;
      if (result.success) results.visits.success++;
      else results.visits.failed++;
    }

    return results;
  }

  // Generate test employees
  generateTestEmployees() {
    return [
      { employeeId: 'EMP001', firstName: 'John', lastName: 'Smith', phone: '7025550001', phoneType: 'Mobile' },
      { employeeId: 'EMP002', firstName: 'Jane', lastName: 'Doe', phone: '7025550002', phoneType: 'Mobile' },
      { employeeId: 'EMP003', firstName: 'Mike', lastName: 'Johnson', phone: '7025550003', phoneType: 'Mobile' },
      { employeeId: 'EMP004', firstName: 'Sarah', lastName: 'Wilson', phone: '7025550004', phoneType: 'Mobile' },
      { employeeId: 'EMP005', firstName: 'David', lastName: 'Brown', phone: '7025550005', phoneType: 'Mobile' },
      { employeeId: 'EMP006', firstName: 'Lisa', lastName: 'Davis', phone: '7025550006', phoneType: 'Mobile' }
    ];
  }

  // Generate test visits
  generateTestVisits() {
    return [
      { 
        visitKey: 'VISIT001', 
        clientId: '00002173648', // Tobista Kefeni
        employeeId: 'EMP001',
        serviceId: 'PCS001',
        startDate: '2025-01-01',
        endDate: '2025-01-01',
        callType: 'Mobile',
        timeIn: '09:00:00',
        timeOut: '17:00:00'
      },
      // Add more test visits...
    ];
  }
}

module.exports = SandataService;







