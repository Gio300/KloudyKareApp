/**
 * Twilio SMS Integration Routes
 * Handles incoming SMS messages and integrates with MCP guardrails and profile building
 */

const express = require('express');
const twilio = require('twilio');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const ProfileService = require('../services/profileService');
const { requireFeature } = require('../config/flags');

const router = express.Router();

// Twilio webhook signature validation middleware
const validateTwilioSignature = (req, res, next) => {
  const twilioSignature = req.get('X-Twilio-Signature');
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!authToken) {
    req.logger.error('Twilio auth token not configured');
    return res.status(500).json({ error: 'Twilio not configured' });
  }

  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const isValid = twilio.validateRequest(authToken, twilioSignature, url, req.body);
  
  if (!isValid && process.env.PHASE === 'live') {
    req.logger.warn('Invalid Twilio signature', { 
      signature: twilioSignature,
      url: url 
    });
    return res.status(403).json({ error: 'Invalid signature' });
  }
  
  next();
};

/**
 * POST /api/twilio/webhook
 * Main webhook endpoint for incoming SMS messages
 */
router.post('/webhook', 
  requireFeature('FEATURE_TWILIO_SMS'),
  express.urlencoded({ extended: false }), // Twilio sends form data
  validateTwilioSignature,
  async (req, res) => {
    try {
      const { From: fromPhone, Body: messageBody, MessageSid: messageSid } = req.body;
      
      req.logger.info('Incoming SMS', {
        from: fromPhone,
        messageId: messageSid,
        bodyLength: messageBody?.length
      });

      // Create TwiML response
      const twiml = new twilio.twiml.MessagingResponse();
      
      // Process the message through MCP and AI pipeline
      const response = await processSMSMessage({
        phoneNumber: fromPhone,
        message: messageBody,
        messageId: messageSid,
        db: req.db,
        logger: req.logger
      });

      // Add response to TwiML
      if (response.reply) {
        twiml.message(response.reply);
      }

      // Log the interaction
      await logSMSInteraction({
        db: req.db,
        phoneNumber: fromPhone,
        inboundMessage: messageBody,
        outboundMessage: response.reply,
        messageId: messageSid,
        processingResult: response,
        logger: req.logger
      });

      // Return TwiML response
      res.type('text/xml');
      res.send(twiml.toString());

    } catch (error) {
      req.logger.error('SMS webhook processing failed', {
        error: error.message,
        stack: error.stack,
        messageId: req.body.MessageSid
      });

      // Return error response to user
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Sorry, we\'re experiencing technical difficulties. Please try again or call 833.432.6488 for assistance.');
      
      res.type('text/xml');
      res.send(twiml.toString());
    }
  }
);

/**
 * POST /api/twilio/send
 * Send outbound SMS message
 */
router.post('/send',
  requireFeature('FEATURE_TWILIO_SMS'),
  [
    body('to').matches(/^\+?1?[0-9]{10}$/).withMessage('Invalid phone number'),
    body('message').isLength({ min: 1, max: 1600 }).withMessage('Message required and must be under 1600 characters')
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

      const { to, message } = req.body;
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

      const result = await client.messages.create({
        body: message,
        from: process.env.TWILIO_SMS_NUMBER,
        to: to
      });

      req.logger.info('Outbound SMS sent', {
        to: to,
        messageId: result.sid,
        status: result.status
      });

      res.json({
        success: true,
        messageId: result.sid,
        status: result.status,
        to: to
      });

    } catch (error) {
      req.logger.error('Failed to send SMS', {
        error: error.message,
        to: req.body.to
      });

      res.status(500).json({
        error: 'Failed to send SMS',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/twilio/status/:messageId
 * Get SMS delivery status
 */
router.get('/status/:messageId', 
  requireFeature('FEATURE_TWILIO_SMS'),
  async (req, res) => {
    try {
      const { messageId } = req.params;
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

      const message = await client.messages(messageId).fetch();

      res.json({
        messageId: message.sid,
        status: message.status,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage,
        dateCreated: message.dateCreated,
        dateSent: message.dateSent,
        dateUpdated: message.dateUpdated
      });

    } catch (error) {
      req.logger.error('Failed to get SMS status', {
        error: error.message,
        messageId: req.params.messageId
      });

      res.status(500).json({
        error: 'Failed to retrieve message status',
        messageId: req.params.messageId
      });
    }
  }
);

/**
 * Process SMS message through MCP and AI pipeline
 */
async function processSMSMessage({ phoneNumber, message, messageId, db, logger }) {
  try {
    // Step 1: Check MCP guardrails
    const mcpResponse = await checkMCPGuardrails(message, phoneNumber);
    
    if (mcpResponse.action === 'block' || mcpResponse.action === 'redirect') {
      return {
        reply: mcpResponse.message,
        action: mcpResponse.action,
        escalate: mcpResponse.escalate
      };
    }

    // Step 2: Extract information from message using AI
    const extractedData = await extractInformationFromSMS(message, logger);

    // Step 3: Update user profile if information was extracted
    const profileService = new ProfileService(db, logger);
    let profileResult = null;
    
    if (extractedData && Object.keys(extractedData).length > 0) {
      profileResult = await profileService.createOrUpdateProfileFromSMS(
        phoneNumber,
        extractedData,
        message,
        determineConversationStage(message, extractedData)
      );
    }

    // Step 4: Generate AI response with context
    const aiResponse = await generateAIResponse({
      message,
      phoneNumber,
      extractedData,
      profileResult,
      mcpContext: mcpResponse.context,
      logger
    });

    // Step 5: Get next questions if profile is incomplete
    let nextQuestions = [];
    if (profileResult) {
      nextQuestions = await profileService.generateNextQuestions(
        profileResult.profile.id,
        determineConversationStage(message, extractedData)
      );
    }

    return {
      reply: aiResponse,
      extractedData,
      profileResult,
      nextQuestions,
      action: 'processed'
    };

  } catch (error) {
    logger.error('SMS processing pipeline failed', {
      error: error.message,
      phoneNumber,
      messageId
    });

    return {
      reply: "I'm sorry, I'm having trouble processing your message right now. Please try again or call 833.432.6488 for assistance.",
      action: 'error',
      error: error.message
    };
  }
}

/**
 * Check message against MCP guardrails
 */
async function checkMCPGuardrails(message, phoneNumber) {
  try {
    const mcpUrl = process.env.MCP_URL || 'http://mcp_service:8080';
    
    const response = await axios.post(`${mcpUrl}/process`, {
      message,
      context: { phoneNumber },
      userId: phoneNumber, // Use phone as temp user ID
      sessionId: `sms_${phoneNumber}_${Date.now()}`
    }, {
      timeout: 5000
    });

    return response.data;
  } catch (error) {
    // If MCP is unavailable, allow processing but log the error
    console.error('MCP service unavailable:', error.message);
    return {
      action: 'process',
      message: null,
      context: []
    };
  }
}

/**
 * Extract structured information from SMS using AI
 */
async function extractInformationFromSMS(message, logger) {
  try {
    // This would integrate with your AI service (Ollama/LLaMA)
    // For now, implement basic pattern matching

    const extractedData = {};
    const lowerMessage = message.toLowerCase();

    // Name extraction
    const namePatterns = [
      /my name is ([a-zA-Z\s]+)/i,
      /i'm ([a-zA-Z\s]+)/i,
      /i am ([a-zA-Z\s]+)/i
    ];
    
    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match) {
        const fullName = match[1].trim();
        const nameParts = fullName.split(' ');
        if (nameParts.length >= 2) {
          extractedData.firstName = nameParts[0];
          extractedData.lastName = nameParts.slice(-1)[0];
          if (nameParts.length > 2) {
            extractedData.middleName = nameParts.slice(1, -1).join(' ');
          }
        } else {
          extractedData.firstName = fullName;
        }
        break;
      }
    }

    // ZIP code extraction
    const zipMatch = message.match(/\b(\d{5})\b/);
    if (zipMatch) {
      extractedData.zipCode = zipMatch[1];
    }

    // Phone number extraction
    const phoneMatch = message.match(/\b(\d{3}[-.]?\d{3}[-.]?\d{4})\b/);
    if (phoneMatch) {
      extractedData.phoneNumber = phoneMatch[1].replace(/[-\.]/g, '');
    }

    // Medicaid ID extraction
    const medicaidMatch = message.match(/medicaid\s*(?:id|number)?\s*:?\s*([a-zA-Z0-9]+)/i);
    if (medicaidMatch) {
      extractedData.medicaidId = medicaidMatch[1];
    }

    // Age extraction
    const ageMatch = message.match(/\b(?:i am|i'm)\s*(\d{1,3})\s*(?:years old|yo)\b/i);
    if (ageMatch) {
      extractedData.age = parseInt(ageMatch[1]);
    }

    // Address extraction (basic)
    const addressMatch = message.match(/\b(\d+\s+[a-zA-Z0-9\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|blvd|boulevard))\b/i);
    if (addressMatch) {
      extractedData.streetAddress = addressMatch[1];
    }

    logger.info('Information extracted from SMS', {
      fieldsExtracted: Object.keys(extractedData),
      extractedData: extractedData
    });

    return extractedData;

  } catch (error) {
    logger.error('Information extraction failed', { error: error.message });
    return {};
  }
}

/**
 * Determine conversation stage based on message content
 */
function determineConversationStage(message, extractedData) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('address') || extractedData.streetAddress || extractedData.zipCode) {
    return 'address';
  }
  
  if (lowerMessage.includes('emergency') || lowerMessage.includes('contact')) {
    return 'emergency_contact';
  }
  
  if (lowerMessage.includes('medical') || lowerMessage.includes('condition') || lowerMessage.includes('medication')) {
    return 'medical';
  }
  
  if (extractedData.firstName || extractedData.lastName || extractedData.medicaidId) {
    return 'intake';
  }

  return 'general';
}

/**
 * Generate AI response using context
 */
async function generateAIResponse({ message, phoneNumber, extractedData, profileResult, mcpContext, logger }) {
  try {
    // This would integrate with Ollama/LLaMA 3.3
    // For now, provide contextual responses based on extracted data

    let response = "Thank you for contacting United Family Caregivers. ";

    if (extractedData.firstName) {
      response += `Nice to meet you, ${extractedData.firstName}! `;
    }

    if (extractedData.zipCode) {
      response += `I see you're in the ${extractedData.zipCode} area. `;
    }

    if (extractedData.medicaidId) {
      response += "I have your Medicaid information. ";
    }

    // Add next steps based on profile completeness
    if (profileResult && profileResult.completionPercentage < 50) {
      response += "I'd like to gather a bit more information to help determine your eligibility for our services. ";
      
      const missing = await new ProfileService(null, logger).getMissingProfileInfo(profileResult.profile.id);
      if (missing.length > 0) {
        const nextField = missing[0];
        response += `Could you please provide your ${nextField.label.toLowerCase()}?`;
      }
    } else if (profileResult && profileResult.completionPercentage >= 80) {
      response += "I have most of your information. Let me check your eligibility and get back to you shortly.";
    } else {
      response += "How can I help you with our home care services today?";
    }

    return response;

  } catch (error) {
    logger.error('AI response generation failed', { error: error.message });
    return "Thank you for contacting United Family Caregivers. How can I help you today?";
  }
}

/**
 * Log SMS interaction for audit and analytics
 */
async function logSMSInteraction({ db, phoneNumber, inboundMessage, outboundMessage, messageId, processingResult, logger }) {
  try {
    await db.query(`
      INSERT INTO chat_messages (
        id, thread_id, sender_type, content, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        (SELECT id FROM chat_threads WHERE phone = $1 LIMIT 1),
        'user',
        $2,
        $3,
        NOW()
      )
    `, [
      phoneNumber,
      inboundMessage,
      JSON.stringify({
        messageId,
        source: 'sms',
        extractedData: processingResult.extractedData || {},
        processingAction: processingResult.action
      })
    ]);

    if (outboundMessage) {
      await db.query(`
        INSERT INTO chat_messages (
          id, thread_id, sender_type, content, metadata, created_at
        ) VALUES (
          gen_random_uuid(),
          (SELECT id FROM chat_threads WHERE phone = $1 LIMIT 1),
          'system',
          $2,
          $3,
          NOW()
        )
      `, [
        phoneNumber,
        outboundMessage,
        JSON.stringify({
          messageId: `reply_${messageId}`,
          source: 'sms_reply',
          replyTo: messageId
        })
      ]);
    }

  } catch (error) {
    logger.error('Failed to log SMS interaction', {
      error: error.message,
      phoneNumber,
      messageId
    });
  }
}

module.exports = router;
