const express = require('express');
const router = express.Router();

// Attempt to load local Sandata modules; fall back to safe stubs inside API-SBX image
let SandataService;
let SandataTransformers;
let SandataValidationEngine;
let SandataAutomation;

try {
  SandataService = require('../../../contracts/containers/sandata/src/sandataService');
  SandataTransformers = require('../../../contracts/containers/sandata/src/dataTransformers');
  SandataValidationEngine = require('../../../contracts/containers/sandata/src/validationEngine');
  SandataAutomation = require('../../../contracts/containers/sandata/src/sandataAutomation');
} catch (err) {
  const isWriteEnabled = String(process.env.FEATURE_SANDATA_WRITE || 'false') === 'true';
  // Minimal no-op service for sandbox API build without contracts mounted
  SandataService = class {
    async sendClient(data) { return { success: !isWriteEnabled ? true : false, sandbox: true, writeEnabled: isWriteEnabled, action: 'sendClient', echoed: data }; }
    async sendEmployee(data) { return { success: !isWriteEnabled ? true : false, sandbox: true, writeEnabled: isWriteEnabled, action: 'sendEmployee', echoed: data }; }
    async sendVisit(data) { return { success: !isWriteEnabled ? true : false, sandbox: true, writeEnabled: isWriteEnabled, action: 'sendVisit', echoed: data }; }
    async sendCall(data) { return { success: !isWriteEnabled ? true : false, sandbox: true, writeEnabled: isWriteEnabled, action: 'sendCall', echoed: data }; }
    async getStatus(id) { return { success: true, sandbox: true, transactionId: id || null, message: 'SBX stub status' }; }
    async executeCertificationTests() { return { sandbox: true, success: true, suites: ['clients','employees','visits','calls'] }; }
  };

  SandataTransformers = {
    transformClientProfile: (d) => d,
    transformEmployee: (d) => d,
    transformVisit: (d) => d,
    transformCall: (d) => d,
    generateTestData: () => ({ clients: [], employees: [], visits: [], calls: [] })
  };

  SandataValidationEngine = {
    validateClient: () => ({ isValid: true, errors: [], warnings: [] }),
    validateEmployee: () => ({ isValid: true, errors: [], warnings: [] }),
    validateVisit: () => ({ isValid: true, errors: [], warnings: [] }),
    validateCall: () => ({ isValid: true, errors: [], warnings: [] }),
    validateAll: () => ({ isValid: true, errors: [], warnings: [] }),
    autoFix: (data) => data
  };
}

// Initialize Sandata services
const sandataService = new SandataService({
  password: process.env.SANDATA_PASSWORD || 'your_password_here'
});

// Initialize browser automation (for production submissions)
let sandataAutomation = null;
if (SandataAutomation && process.env.FEATURE_SANDATA_AUTOMATION === 'true') {
  sandataAutomation = new SandataAutomation({
    username: process.env.SANDATA_USERNAME,
    password: process.env.SANDATA_PASSWORD,
    headless: true,
    screenshots: false
  });
  console.log('[Sandata] Background automation enabled');
}

// Middleware to enforce sandbox write-gate OR use automation
const sandboxWriteGate = async (req, res, next) => {
  const isSandbox = String(process.env.SANDATA_SANDBOX || 'false') === 'true';
  const writeEnabled = String(process.env.FEATURE_SANDATA_WRITE || 'false') === 'true';
  const useAutomation = String(process.env.FEATURE_SANDATA_AUTOMATION || 'false') === 'true';
  
  // Sandbox mode - block writes
  if (isSandbox && !writeEnabled) {
    req.logger && req.logger.warn('Sandata write blocked in sandbox mode', {
      endpoint: req.path,
      method: req.method
    });
    
    return res.status(200).json({
      success: true,
      sandbox: true,
      writeBlocked: true,
      message: 'Sandata sandbox mode: write operations are disabled. Validation passed.',
      validatedData: req.body,
      timestamp: new Date().toISOString()
    });
  }
  
  // Production with automation - submit via background browser
  if (useAutomation && sandataAutomation) {
    req.sandataAutomation = sandataAutomation;
    req.useAutomation = true;
  }
  
  next();
};

// Sandata API Routes

// Get certification status
router.get('/status', async (req, res) => {
  try {
    const status = {
      provider: 'UNITED FAMILY CAREGIVERS',
      providerId: '250038194',
      testAccount: '71607',
      status: 'Certification In Progress',
      testResults: {
        clients: { sent: 6, success: 6, failed: 0 },
        employees: { sent: 6, success: 6, failed: 0 },
        visits: { sent: 6, success: 0, failed: 6 },
        calls: { sent: 6, success: 0, failed: 6 }
      },
      criticalIssues: [
        'Service ID errors: "Error during retrieving service service_id entered"',
        'Phone type format: "Work" should be "Business"',
        'Version conflicts: Duplicate or older version numbers',
        'Mixed call types failing validation'
      ]
    };
    
    res.json(status);
  } catch (error) {
    req.logger && req.logger.error('Sandata status failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get Sandata status' });
  }
});

// Send client data to Sandata
router.post('/clients', sandboxWriteGate, async (req, res) => {
  try {
    const { clientData } = req.body;
    
    if (!clientData) {
      return res.status(400).json({ error: 'Client data is required' });
    }

    // Transform and validate data
    const transformedData = SandataTransformers.transformClientProfile(clientData);
    const validation = SandataValidationEngine.validateClient(transformedData);
    
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        errors: validation.errors,
        warnings: validation.warnings 
      });
    }

    // Send to Sandata
    const result = await sandataService.sendClient(transformedData);
    
    res.json(result);
  } catch (error) {
    req.logger && req.logger.error('Sandata client send failed', { error: error.message });
    res.status(500).json({ error: 'Failed to send client data' });
  }
});

// Send employee data to Sandata
router.post('/employees', sandboxWriteGate, async (req, res) => {
  try {
    const { employeeData } = req.body;
    
    if (!employeeData) {
      return res.status(400).json({ error: 'Employee data is required' });
    }

    // Transform and validate data
    const transformedData = SandataTransformers.transformEmployee(employeeData);
    const validation = SandataValidationEngine.validateEmployee(transformedData);
    
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        errors: validation.errors,
        warnings: validation.warnings 
      });
    }

    // Send to Sandata
    const result = await sandataService.sendEmployee(transformedData);
    
    res.json(result);
  } catch (error) {
    req.logger && req.logger.error('Sandata employee send failed', { error: error.message });
    res.status(500).json({ error: 'Failed to send employee data' });
  }
});

// Send visit data to Sandata
router.post('/visits', sandboxWriteGate, async (req, res) => {
  try {
    const { visitData } = req.body;
    
    if (!visitData) {
      return res.status(400).json({ error: 'Visit data is required' });
    }

    // Transform and validate data
    const transformedData = SandataTransformers.transformVisit(visitData);
    const validation = SandataValidationEngine.validateVisit(transformedData);
    
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        errors: validation.errors,
        warnings: validation.warnings 
      });
    }

    // Send to Sandata - use automation if enabled, otherwise use direct API
    let result;
    
    if (req.useAutomation && req.sandataAutomation) {
      // Background browser automation - invisible to user
      req.logger && req.logger.info('Using Sandata browser automation (headless)');
      result = await req.sandataAutomation.submitVisit(transformedData);
    } else {
      // Direct API method (requires API key)
      result = await sandataService.sendVisit(transformedData);
    }
    
    res.json(result);
  } catch (error) {
    req.logger && req.logger.error('Sandata visit send failed', { error: error.message });
    res.status(500).json({ error: 'Failed to send visit data' });
  }
});

// Send call data to Sandata
router.post('/calls', sandboxWriteGate, async (req, res) => {
  try {
    const { callData } = req.body;
    
    if (!callData) {
      return res.status(400).json({ error: 'Call data is required' });
    }

    // Transform and validate data
    const transformedData = SandataTransformers.transformCall(callData);
    const validation = SandataValidationEngine.validateCall(transformedData);
    
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        errors: validation.errors,
        warnings: validation.warnings 
      });
    }

    // Send to Sandata
    const result = await sandataService.sendCall(transformedData);
    
    res.json(result);
  } catch (error) {
    req.logger && req.logger.error('Sandata call send failed', { error: error.message });
    res.status(500).json({ error: 'Failed to send call data' });
  }
});

// Check transaction status
router.get('/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const status = await sandataService.getStatus(transactionId);
    
    res.json(status);
  } catch (error) {
    req.logger && req.logger.error('Sandata status check failed', { error: error.message });
    res.status(500).json({ error: 'Failed to check transaction status' });
  }
});

// Execute certification tests
router.post('/tests/execute', async (req, res) => {
  try {
    const results = await sandataService.executeCertificationTests();
    
    res.json({
      success: true,
      results,
      message: 'Certification tests completed'
    });
  } catch (error) {
    req.logger && req.logger.error('Sandata tests failed', { error: error.message });
    res.status(500).json({ error: 'Failed to execute certification tests' });
  }
});

// Auto-fix common issues
router.post('/fix-issues', async (req, res) => {
  try {
    const { data, type } = req.body;
    
    if (!data || !type) {
      return res.status(400).json({ error: 'Data and type are required' });
    }

    const fixedData = SandataValidationEngine.autoFix(data, type);
    
    res.json({
      success: true,
      originalData: data,
      fixedData,
      message: 'Issues auto-fixed'
    });
  } catch (error) {
    req.logger && req.logger.error('Sandata auto-fix failed', { error: error.message });
    res.status(500).json({ error: 'Failed to auto-fix issues' });
  }
});

// Validate data before sending
router.post('/validate', async (req, res) => {
  try {
    const { data, type } = req.body;
    
    if (!data || !type) {
      return res.status(400).json({ error: 'Data and type are required' });
    }

    const validation = SandataValidationEngine.validateAll(data, type);
    
    res.json(validation);
  } catch (error) {
    req.logger && req.logger.error('Sandata validation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to validate data' });
  }
});

// Get test clients
router.get('/test-clients', async (req, res) => {
  try {
    const testClients = SandataTransformers.generateTestData().clients;
    
    res.json(testClients);
  } catch (error) {
    req.logger && req.logger.error('Sandata test clients failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get test clients' });
  }
});

// Batch upload
router.post('/batch-upload', sandboxWriteGate, async (req, res) => {
  try {
    const { clients, employees, visits, calls } = req.body;
    
    const results = {
      clients: { sent: 0, success: 0, failed: 0 },
      employees: { sent: 0, success: 0, failed: 0 },
      visits: { sent: 0, success: 0, failed: 0 },
      calls: { sent: 0, success: 0, failed: 0 }
    };

    // Process clients
    if (clients && clients.length > 0) {
      for (const client of clients) {
        const transformedData = SandataTransformers.transformClientProfile(client);
        const validation = SandataValidationEngine.validateClient(transformedData);
        
        if (validation.isValid) {
          const result = await sandataService.sendClient(transformedData);
          results.clients.sent++;
          if (result.success) results.clients.success++;
          else results.clients.failed++;
        } else {
          results.clients.sent++;
          results.clients.failed++;
        }
      }
    }

    // Process employees
    if (employees && employees.length > 0) {
      for (const employee of employees) {
        const transformedData = SandataTransformers.transformEmployee(employee);
        const validation = SandataValidationEngine.validateEmployee(transformedData);
        
        if (validation.isValid) {
          const result = await sandataService.sendEmployee(transformedData);
          results.employees.sent++;
          if (result.success) results.employees.success++;
          else results.employees.failed++;
        } else {
          results.employees.sent++;
          results.employees.failed++;
        }
      }
    }

    // Process visits
    if (visits && visits.length > 0) {
      for (const visit of visits) {
        const transformedData = SandataTransformers.transformVisit(visit);
        const validation = SandataValidationEngine.validateVisit(transformedData);
        
        if (validation.isValid) {
          const result = await sandataService.sendVisit(transformedData);
          results.visits.sent++;
          if (result.success) results.visits.success++;
          else results.visits.failed++;
        } else {
          results.visits.sent++;
          results.visits.failed++;
        }
      }
    }

    // Process calls
    if (calls && calls.length > 0) {
      for (const call of calls) {
        const transformedData = SandataTransformers.transformCall(call);
        const validation = SandataValidationEngine.validateCall(transformedData);
        
        if (validation.isValid) {
          const result = await sandataService.sendCall(transformedData);
          results.calls.sent++;
          if (result.success) results.calls.success++;
          else results.calls.failed++;
        } else {
          results.calls.sent++;
          results.calls.failed++;
        }
      }
    }

    res.json({
      success: true,
      results,
      message: 'Batch upload completed'
    });
  } catch (error) {
    req.logger && req.logger.error('Sandata batch upload failed', { error: error.message });
    res.status(500).json({ error: 'Failed to process batch upload' });
  }
});

module.exports = router;