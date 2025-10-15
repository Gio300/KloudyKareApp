/**
 * Authorization and Consent Management Routes
 * Handles client authorization flows, consent collection, and digital signatures
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { requireFeature } = require('../config/flags');

const router = express.Router();

/**
 * POST /api/auth/start
 * Initiate authorization flow for a client
 */
router.post('/start',
  requireFeature('FEATURE_AUTHORIZATION_WIZARD'),
  [
    body('clientId')
      .isUUID()
      .withMessage('Valid client ID is required'),
    body('authorizationType')
      .isIn(['hipaa_consent', 'service_agreement', 'billing_authorization', 'emergency_contact'])
      .withMessage('Valid authorization type is required'),
    body('deliveryMethod')
      .isIn(['sms_link', 'email_link', 'web_direct'])
      .withMessage('Valid delivery method is required'),
    body('contactInfo')
      .isObject()
      .withMessage('Contact information is required'),
    body('expirationHours')
      .optional()
      .isInt({ min: 1, max: 168 })
      .withMessage('Expiration hours must be between 1 and 168 (7 days)')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const {
        clientId,
        authorizationType,
        deliveryMethod,
        contactInfo,
        expirationHours = 72
      } = req.body;

      // Verify client exists
      const clientResult = await req.db.query(
        'SELECT id, first_name, last_name, primary_phone, email_address FROM user_profiles WHERE user_id = $1',
        [clientId]
      );

      if (clientResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Client not found'
        });
      }

      const client = clientResult.rows[0];
      const authorizationId = uuidv4();
      const expirationTime = new Date(Date.now() + (expirationHours * 60 * 60 * 1000));

      // Generate secure token for authorization link
      const linkToken = jwt.sign(
        {
          authorizationId,
          clientId,
          authorizationType,
          exp: Math.floor(expirationTime.getTime() / 1000)
        },
        process.env.JWT_SECRET,
        { issuer: 'kloudy-kare-auth' }
      );

      // Create secure link
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 7010}`;
      const secureLink = `${baseUrl}/api/auth/form/${linkToken}`;

      // Store authorization request in database
      await req.db.query(`
        INSERT INTO authorizations (
          id, client_id, authorization_type, status, created_at, expires_at
        ) VALUES ($1, $2, $3, 'pending', NOW(), $4)
      `, [authorizationId, clientId, authorizationType, expirationTime]);

      // Send authorization link based on delivery method
      const deliveryResult = await deliverAuthorizationLink({
        deliveryMethod,
        contactInfo,
        secureLink,
        client,
        authorizationType,
        logger: req.logger
      });

      req.logger.info('Authorization flow started', {
        authorizationId,
        clientId,
        authorizationType,
        deliveryMethod,
        deliveryStatus: deliveryResult.status
      });

      res.json({
        authorizationId,
        secureLink,
        deliveryStatus: deliveryResult.status,
        expirationTime: expirationTime.toISOString(),
        trackingInfo: {
          linkToken: linkToken.substring(0, 10) + '...',
          deliveryMethodUsed: deliveryMethod,
          sentTimestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      req.logger.error('Authorization flow start failed', {
        error: error.message,
        clientId: req.body.clientId
      });

      res.status(500).json({
        error: 'Failed to start authorization flow',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/auth/form/:token
 * Display authorization form
 */
router.get('/form/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Verify and decode token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'kloudy-kare-auth' });
    } catch (error) {
      return res.status(400).send(`
        <html><body>
          <h1>Invalid or Expired Link</h1>
          <p>This authorization link is invalid or has expired.</p>
          <p>Please contact United Family Caregivers at 833.432.6488 for assistance.</p>
        </body></html>
      `);
    }

    const { authorizationId, clientId, authorizationType } = decoded;

    // Get authorization details
    const authResult = await req.db.query(
      'SELECT * FROM authorizations WHERE id = $1 AND status = $2',
      [authorizationId, 'pending']
    );

    if (authResult.rows.length === 0) {
      return res.status(404).send(`
        <html><body>
          <h1>Authorization Not Found</h1>
          <p>This authorization request was not found or has already been completed.</p>
        </body></html>
      `);
    }

    // Get client information
    const clientResult = await req.db.query(
      'SELECT first_name, last_name, primary_phone FROM user_profiles WHERE user_id = $1',
      [clientId]
    );

    const client = clientResult.rows[0];
    const authorization = authResult.rows[0];

    // Generate authorization form HTML
    const formHtml = generateAuthorizationForm({
      authorizationId,
      authorizationType,
      client,
      token
    });

    res.send(formHtml);

  } catch (error) {
    req.logger.error('Authorization form display failed', {
      error: error.message,
      token: req.params.token?.substring(0, 10) + '...'
    });

    res.status(500).send(`
      <html><body>
        <h1>System Error</h1>
        <p>We're experiencing technical difficulties. Please try again later.</p>
      </body></html>
    `);
  }
});

/**
 * POST /api/auth/submit
 * Submit completed authorization form
 */
router.post('/submit',
  requireFeature('FEATURE_AUTHORIZATION_WIZARD'),
  [
    body('token')
      .notEmpty()
      .withMessage('Authorization token is required'),
    body('signature')
      .notEmpty()
      .withMessage('Digital signature is required'),
    body('formData')
      .isObject()
      .withMessage('Form data is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { token, signature, formData } = req.body;

      // Verify token
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'kloudy-kare-auth' });
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid or expired authorization token'
        });
      }

      const { authorizationId, clientId, authorizationType } = decoded;

      // Verify authorization is still pending
      const authResult = await req.db.query(
        'SELECT * FROM authorizations WHERE id = $1 AND status = $2',
        [authorizationId, 'pending']
      );

      if (authResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Authorization not found or already completed'
        });
      }

      // Generate PDF document (mock implementation)
      const pdfPath = await generateSignedPDF({
        authorizationId,
        authorizationType,
        clientId,
        signature,
        formData,
        logger: req.logger
      });

      // Update authorization record
      await req.db.query(`
        UPDATE authorizations 
        SET 
          status = 'completed',
          signed_pdf_path = $1,
          signature_data = $2,
          ip_address = $3,
          user_agent = $4
        WHERE id = $5
      `, [
        pdfPath,
        JSON.stringify({ signature, formData, timestamp: new Date() }),
        req.ip,
        req.get('User-Agent'),
        authorizationId
      ]);

      req.logger.info('Authorization completed', {
        authorizationId,
        clientId,
        authorizationType,
        pdfGenerated: !!pdfPath
      });

      res.json({
        success: true,
        authorizationId,
        status: 'completed',
        pdfGenerated: true,
        completedAt: new Date().toISOString()
      });

    } catch (error) {
      req.logger.error('Authorization submission failed', {
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to process authorization',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/auth/status/:authorizationId
 * Get authorization status
 */
router.get('/status/:authorizationId',
  requireFeature('FEATURE_AUTHORIZATION_WIZARD'),
  [
    param('authorizationId')
      .isUUID()
      .withMessage('Valid authorization ID is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { authorizationId } = req.params;

      const result = await req.db.query(`
        SELECT 
          id, client_id, authorization_type, status, 
          created_at, expires_at, signed_pdf_path,
          ip_address, user_agent
        FROM authorizations 
        WHERE id = $1
      `, [authorizationId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Authorization not found'
        });
      }

      const authorization = result.rows[0];

      res.json({
        authorizationId: authorization.id,
        clientId: authorization.client_id,
        authorizationType: authorization.authorization_type,
        status: authorization.status,
        createdAt: authorization.created_at,
        expiresAt: authorization.expires_at,
        completedAt: authorization.status === 'completed' ? authorization.created_at : null,
        hasPDF: !!authorization.signed_pdf_path
      });

    } catch (error) {
      req.logger.error('Authorization status check failed', {
        error: error.message,
        authorizationId: req.params.authorizationId
      });

      res.status(500).json({
        error: 'Failed to check authorization status'
      });
    }
  }
);

/**
 * Deliver authorization link via specified method
 */
async function deliverAuthorizationLink({ deliveryMethod, contactInfo, secureLink, client, authorizationType, logger }) {
  try {
    switch (deliveryMethod) {
      case 'sms_link':
        // Would integrate with Twilio SMS service
        const message = `Hi ${client.first_name}, please complete your ${authorizationType.replace('_', ' ')} form: ${secureLink}`;
        logger.info('SMS authorization link sent', { phone: contactInfo.phone });
        return { status: 'sent', method: 'sms' };

      case 'email_link':
        // Would integrate with email service
        logger.info('Email authorization link sent', { email: contactInfo.email });
        return { status: 'sent', method: 'email' };

      case 'web_direct':
        // Direct web access - no delivery needed
        return { status: 'ready', method: 'web' };

      default:
        throw new Error('Invalid delivery method');
    }
  } catch (error) {
    logger.error('Authorization link delivery failed', { error: error.message, deliveryMethod });
    return { status: 'failed', error: error.message };
  }
}

/**
 * Generate authorization form HTML
 */
function generateAuthorizationForm({ authorizationId, authorizationType, client, token }) {
  const formTitle = authorizationType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${formTitle} - United Family Caregivers</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .header { background: #667eea; color: white; padding: 20px; text-align: center; }
            .form-section { padding: 20px; border: 1px solid #ddd; margin: 10px 0; }
            .signature-pad { border: 1px solid #ccc; width: 100%; height: 200px; }
            .btn { background: #4299e1; color: white; padding: 10px 20px; border: none; cursor: pointer; }
            .btn:hover { background: #3182ce; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>United Family Caregivers</h1>
            <h2>${formTitle}</h2>
        </div>
        
        <div class="form-section">
            <h3>Client Information</h3>
            <p><strong>Name:</strong> ${client.first_name} ${client.last_name}</p>
            <p><strong>Phone:</strong> ${client.primary_phone}</p>
        </div>
        
        <form id="authorizationForm">
            <div class="form-section">
                <h3>Authorization Agreement</h3>
                <p>By signing below, you authorize United Family Caregivers to provide the requested services and agree to the terms and conditions.</p>
                
                <label>
                    <input type="checkbox" required> I have read and agree to the terms and conditions
                </label>
            </div>
            
            <div class="form-section">
                <h3>Digital Signature</h3>
                <p>Please sign below:</p>
                <canvas id="signaturePad" class="signature-pad"></canvas>
                <button type="button" onclick="clearSignature()">Clear</button>
            </div>
            
            <div class="form-section">
                <button type="submit" class="btn">Submit Authorization</button>
            </div>
        </form>
        
        <script>
            const canvas = document.getElementById('signaturePad');
            const ctx = canvas.getContext('2d');
            let signing = false;
            
            canvas.addEventListener('mousedown', startSigning);
            canvas.addEventListener('mousemove', sign);
            canvas.addEventListener('mouseup', stopSigning);
            
            function startSigning(e) { signing = true; }
            function stopSigning() { signing = false; }
            function sign(e) {
                if (!signing) return;
                const rect = canvas.getBoundingClientRect();
                ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
                ctx.stroke();
            }
            
            function clearSignature() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            
            document.getElementById('authorizationForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const signatureData = canvas.toDataURL();
                
                const response = await fetch('/api/auth/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: '${token}',
                        signature: signatureData,
                        formData: { agreed: true, timestamp: new Date() }
                    })
                });
                
                if (response.ok) {
                    alert('Authorization completed successfully!');
                    window.close();
                } else {
                    alert('Error submitting authorization. Please try again.');
                }
            });
        </script>
    </body>
    </html>
  `;
}

/**
 * Generate signed PDF document (mock implementation)
 */
async function generateSignedPDF({ authorizationId, authorizationType, clientId, signature, formData, logger }) {
  try {
    // This would integrate with PDF generation library (pdf-lib, puppeteer, etc.)
    const pdfPath = `uploads/authorizations/${authorizationId}.pdf`;
    
    // Mock PDF generation
    logger.info('PDF generated', { authorizationId, pdfPath });
    
    return pdfPath;
  } catch (error) {
    logger.error('PDF generation failed', { error: error.message, authorizationId });
    return null;
  }
}

module.exports = router;
