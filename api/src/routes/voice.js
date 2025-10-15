const express = require('express');
const router = express.Router();
const TwilioService = require('../services/twilioService');

// Voice call endpoints for eligibility verification

// Make outbound call for eligibility verification
router.post('/make-call', async (req, res) => {
  try {
    const { phoneNumber, clientName, medicaidId } = req.body;
    
    if (!phoneNumber || !clientName || !medicaidId) {
      return res.status(400).json({ 
        error: 'Missing required fields: phoneNumber, clientName, medicaidId' 
      });
    }

    console.log('Making eligibility call:', { phoneNumber, clientName, medicaidId });
    
    const result = await TwilioService.makeEligibilityCall(phoneNumber, clientName, medicaidId);
    
    if (result.success) {
      res.json({ 
        success: true, 
        callSid: result.sid,
        message: 'Eligibility call initiated successfully' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('Make call error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to initiate call' 
    });
  }
});

// Handle call status updates
router.post('/status', (req, res) => {
  const { CallSid, CallStatus, CallDuration, From, To } = req.body;
  
  console.log('Call status update:', {
    callSid: CallSid,
    status: CallStatus,
    duration: CallDuration,
    from: From,
    to: To
  });
  
  // Log call status for monitoring
  if (CallStatus === 'completed') {
    console.log(`Call ${CallSid} completed. Duration: ${CallDuration} seconds`);
  }
  
  res.type('text/xml').send('<Response></Response>');
});

// Handle call callback (when user presses digits)
router.post('/callback', (req, res) => {
  const { CallSid, Digits, From } = req.body;
  
  console.log('Call callback:', { callSid: CallSid, digits: Digits, from: From });
  
  let twimlResponse;
  
  // Save simple eligibility choices for Nevada test case when 1 is pressed
  if (Digits === '1') {
    // Upsert basic eligibility snapshot for the caller
    fetch('http://localhost:7010/api/eligibility/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: From,
        eligibility_type: 'mco',
        mco_name: 'Practice MCO',
        has_transportation: false,
        transportation_provider: null,
        intake_source: 'voice',
        eligibility_notes: 'Confirmed via IVR: data captured during eligibility test.'
      })
    }).catch(err => console.error('eligibility upsert from callback failed', err.message));
  }
  
  if (Digits === '1') {
    // User confirmed information
    twimlResponse = `
      <Response>
        <Say voice="alice">
          Thank you for confirming your information. 
          A representative will contact you within 24 hours to schedule your Medicaid interview.
          Have a great day!
        </Say>
        <Hangup/>
      </Response>
    `;
  } else if (Digits === '2') {
    // User wants to speak with representative
    twimlResponse = `
      <Response>
        <Say voice="alice">
          Please hold while we connect you with a representative. 
          Our business hours are Monday through Friday, 8 AM to 5 PM Pacific Time.
        </Say>
        <Dial>8334326588</Dial>
        <Say voice="alice">Thank you for calling United Family Caregivers.</Say>
        <Hangup/>
      </Response>
    `;
  } else {
    // Invalid input
    twimlResponse = `
      <Response>
        <Say voice="alice">I didn't understand that. Please press 1 to confirm your information, or press 2 to speak with a representative.</Say>
        <Gather numDigits="1" action="/api/voice/callback" method="POST">
          <Say voice="alice">Press 1 to confirm, or press 2 for assistance.</Say>
        </Gather>
        <Say voice="alice">Thank you for your time. Goodbye.</Say>
        <Hangup/>
      </Response>
    `;
  }
  
  res.type('text/xml').send(twimlResponse);
});

// Send verification SMS
router.post('/send-sms', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: phoneNumber, message' 
      });
    }

    console.log('Sending SMS:', { phoneNumber, message });
    
    const result = await TwilioService.sendVerificationSMS(phoneNumber, message);
    
    if (result.success) {
      res.json({ 
        success: true, 
        messageSid: result.sid,
        message: 'SMS sent successfully' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('Send SMS error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send SMS' 
    });
  }
});

// Handle incoming SMS webhook
router.post('/sms-webhook', async (req, res) => {
  try {
    await TwilioService.handleIncomingSMS(req, res);
  } catch (error) {
    console.error('SMS webhook error:', error);
    res.type('text/xml').send('<Response></Response>');
  }
});

// Verify phone number (for trial account)
router.post('/verify-phone', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ 
        error: 'Missing phoneNumber' 
      });
    }

    console.log('Verifying phone:', phoneNumber);
    
    const result = await TwilioService.verifyPhoneNumber(phoneNumber);
    
    if (result.success) {
      res.json({ 
        success: true, 
        verificationSid: result.sid,
        message: 'Verification code sent to phone' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('Verify phone error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to verify phone' 
    });
  }
});

// Check verification code
router.post('/check-verification', async (req, res) => {
  try {
    const { phoneNumber, code } = req.body;
    
    if (!phoneNumber || !code) {
      return res.status(400).json({ 
        error: 'Missing required fields: phoneNumber, code' 
      });
    }

    console.log('Checking verification:', { phoneNumber, code });
    
    const result = await TwilioService.checkVerificationCode(phoneNumber, code);
    
    res.json({ 
      success: result.success, 
      status: result.status,
      message: result.success ? 'Phone verified successfully' : 'Invalid verification code'
    });
  } catch (error) {
    console.error('Check verification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check verification code' 
    });
  }
});

// Get call status
router.get('/call-status/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    
    const status = await TwilioService.getCallStatus(callSid);
    
    res.json(status);
  } catch (error) {
    console.error('Get call status error:', error);
    res.status(500).json({ 
      error: 'Failed to get call status' 
    });
  }
});

// Test endpoint for eligibility verification
router.post('/test-eligibility', async (req, res) => {
  try {
    const { phoneNumber, clientName, medicaidId, testType = 'call' } = req.body;
    
    if (!phoneNumber || !clientName || !medicaidId) {
      return res.status(400).json({ 
        error: 'Missing required fields: phoneNumber, clientName, medicaidId' 
      });
    }

    console.log('Testing eligibility verification:', { phoneNumber, clientName, medicaidId, testType });
    
    if (testType === 'call') {
      // Make voice call
      const callResult = await TwilioService.makeEligibilityCall(phoneNumber, clientName, medicaidId);
      
      if (callResult.success) {
        res.json({ 
          success: true, 
          type: 'call',
          callSid: callResult.sid,
          message: 'Eligibility call initiated successfully' 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: callResult.error 
        });
      }
    } else if (testType === 'sms') {
      // Send SMS
      const smsMessage = `Hello ${clientName}, this is United Family Caregivers. Your Medicaid ID ${medicaidId} is being processed for PCS eligibility. Reply YES to confirm or call 833-432-6588 for assistance.`;
      
      const smsResult = await TwilioService.sendVerificationSMS(phoneNumber, smsMessage);
      
      if (smsResult.success) {
        res.json({ 
          success: true, 
          type: 'sms',
          messageSid: smsResult.sid,
          message: 'Eligibility SMS sent successfully' 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: smsResult.error 
        });
      }
    } else {
      res.status(400).json({ 
        error: 'Invalid testType. Use "call" or "sms"' 
      });
    }
  } catch (error) {
    console.error('Test eligibility error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to test eligibility verification' 
    });
  }
});

module.exports = router;