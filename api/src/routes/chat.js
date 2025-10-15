/**
 * Chat API Routes
 * Handles real-time chat with AI brain, data display, and MCP integration
 */

const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const ProfileService = require('../services/profileService');
const OllamaService = require('../services/ollamaService');

const router = express.Router();

/**
 * GET /api/chat/ollama-status
 * Check Ollama AI brain connection status
 */
router.get('/ollama-status', async (req, res) => {
  try {
    const ollamaService = new OllamaService(req.logger);
    
    // Check if Ollama is available
    const isAvailable = await ollamaService.isAvailable();
    const modelInfo = await ollamaService.getModelInfo();
    
    res.json({
      success: true,
      ollama: {
        available: isAvailable,
        baseURL: process.env.OLLAMA_URL || 'http://ollama:11434',
        model: process.env.OLLAMA_MODEL || 'llama3.3:latest',
        modelInfo: modelInfo
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    req.logger.error('Ollama status check failed', { error: error.message });
    
    res.status(500).json({
      success: false,
      error: error.message,
      ollama: {
        available: false,
        baseURL: process.env.OLLAMA_URL || 'http://ollama:11434',
        model: process.env.OLLAMA_MODEL || 'llama3.3:latest'
      }
    });
  }
});

/**
 * POST /api/chat/message
 * Process chat message through AI brain and MCP
 */
router.post('/message',
  [
    body('message')
      .isLength({ min: 1, max: 2000 })
      .withMessage('Message is required and must be under 2000 characters'),
    body('sessionId')
      .notEmpty()
      .withMessage('Session ID is required'),
    body('context')
      .optional()
      .isObject()
      .withMessage('Context must be an object')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { message, sessionId, context = {} } = req.body;

      req.logger.info('Chat message received', {
        sessionId,
        messageLength: message.length,
        context: context
      });

      // Handle test commands in testing phase
      if (process.env.PHASE === 'testing' && message.toLowerCase() === 'test') {
        return res.json({
          success: true,
          messageType: 'test',
          content: 'Here are some sample data displays:',
          actions: [
            {
              type: 'show_profile',
              data: {
                firstName: 'John',
                lastName: 'Smith',
                phone: '+15551234567',
                zipCode: '89101',
                medicaidId: 'NV123456789',
                status: 'verified',
                completionPercentage: 75
              }
            },
            {
              type: 'show_eligibility',
              data: {
                payer: 'Nevada Medicaid',
                program: 'PCS Type 30',
                status: 'active',
                startDate: '2025-01-01',
                endDate: '2025-12-31',
                monthlyHours: 120
              }
            }
          ]
        });
      }

      // Process message through MCP guardrails
      const mcpResponse = await processThroughMCP({
        message,
        sessionId,
        context,
        logger: req.logger
      });

      if (mcpResponse.action === 'block' || mcpResponse.action === 'redirect') {
        return res.json({
          success: true,
          content: mcpResponse.message,
          messageType: 'text',
          escalate: mcpResponse.escalate
        });
      }

      // Initialize Ollama service
      const ollamaService = new OllamaService(req.logger);
      
      // Use Ollama to analyze intent
      const intentType = await ollamaService.analyzeIntent(message);
      req.logger.info('Intent analyzed', { intent: intentType, message: message.substring(0, 50) });

      let response;

      switch (intentType) {
        case 'profile_inquiry':
          response = await handleProfileInquiry(message, sessionId, req.db, req.logger);
          break;
        case 'eligibility_check':
          response = await handleEligibilityCheck(message, sessionId, req.db, req.logger);
          break;
        case 'visit_inquiry':
          response = await handleVisitInquiry(message, sessionId, req.db, req.logger);
          break;
        case 'billing_inquiry':
          response = await handleBillingInquiry(message, sessionId, req.db, req.logger);
          break;
        case 'emergency':
          response = {
            messageType: 'text',
            content: '🚨 **EMERGENCY ALERT** 🚨\n\nIf this is a medical emergency, please call **911 immediately**.\n\nFor urgent care needs, contact your healthcare provider or call our 24/7 line at **833.432.6488**.'
          };
          break;
        case 'general_help':
          response = await handleGeneralHelp(message, mcpResponse.context);
          break;
        default:
          // Use Ollama to generate AI response
          const aiResult = await ollamaService.generateResponse(message, context);
          if (aiResult.success) {
            response = {
              messageType: 'text',
              content: aiResult.response
            };
          } else {
            response = await generateAIResponse(message, mcpResponse.context, req.logger);
          }
      }

      // Log the interaction
      await logChatInteraction({
        sessionId,
        userMessage: message,
        aiResponse: response.content,
        intent: intent.type,
        db: req.db,
        logger: req.logger
      });

      res.json({
        success: true,
        ...response
      });

    } catch (error) {
      req.logger.error('Chat processing failed', {
        error: error.message,
        sessionId: req.body.sessionId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to process message',
        content: 'I\'m having trouble processing your message right now. Please try again or call 833.432.6488 for assistance.'
      });
    }
  }
);

/**
 * Process message through MCP guardrails
 */
async function processThroughMCP({ message, sessionId, context, logger }) {
  try {
    const mcpUrl = process.env.MCP_URL || 'http://mcp_service:8080';
    
    const response = await axios.post(`${mcpUrl}/process`, {
      message,
      context,
      userId: sessionId,
      sessionId
    }, {
      timeout: 5000
    });

    return response.data;
  } catch (error) {
    logger.warn('MCP service unavailable, proceeding without guardrails', { error: error.message });
    return {
      action: 'process',
      message: null,
      context: []
    };
  }
}

/**
 * Analyze user intent from message
 */
function analyzeIntent(message) {
  const lowerMessage = message.toLowerCase();

  // Profile-related keywords
  if (lowerMessage.includes('profile') || lowerMessage.includes('my info') || lowerMessage.includes('personal information')) {
    return { type: 'profile_inquiry', confidence: 0.9 };
  }

  // Eligibility keywords
  if (lowerMessage.includes('eligible') || lowerMessage.includes('qualify') || lowerMessage.includes('medicaid') || lowerMessage.includes('coverage')) {
    return { type: 'eligibility_check', confidence: 0.9 };
  }

  // Visit-related keywords
  if (lowerMessage.includes('visit') || lowerMessage.includes('caregiver') || lowerMessage.includes('appointment') || lowerMessage.includes('schedule')) {
    return { type: 'visit_inquiry', confidence: 0.8 };
  }

  // Billing keywords
  if (lowerMessage.includes('bill') || lowerMessage.includes('payment') || lowerMessage.includes('invoice') || lowerMessage.includes('cost')) {
    return { type: 'billing_inquiry', confidence: 0.8 };
  }

  // Help keywords
  if (lowerMessage.includes('help') || lowerMessage.includes('assistance') || lowerMessage.includes('support')) {
    return { type: 'general_help', confidence: 0.7 };
  }

  return { type: 'general', confidence: 0.5 };
}

/**
 * Handle profile inquiry
 */
async function handleProfileInquiry(message, sessionId, db, logger) {
  try {
    // Try to find user profile by session or phone
    const profileResult = await db.query(`
      SELECT up.*, u.phone 
      FROM user_profiles up
      JOIN users u ON up.user_id = u.id
      WHERE u.phone LIKE '%${sessionId.slice(-10)}%'
      LIMIT 1
    `);

    if (profileResult.rows.length > 0) {
      const profile = profileResult.rows[0];
      
      return {
        messageType: 'data',
        content: 'Here\'s your current profile information:',
        actions: [{
          type: 'show_profile',
          data: {
            firstName: profile.first_name,
            lastName: profile.last_name,
            phone: profile.primary_phone,
            zipCode: profile.zip_code,
            medicaidId: profile.medicaid_id,
            status: profile.verification_status,
            completionPercentage: profile.profile_completion_percentage
          }
        }]
      };
    } else {
      return {
        messageType: 'text',
        content: 'I don\'t have your profile information yet. To get started, could you please provide your name and ZIP code?'
      };
    }
  } catch (error) {
    logger.error('Profile inquiry failed', { error: error.message });
    return {
      messageType: 'text',
      content: 'I\'m having trouble accessing your profile right now. Please try again later.'
    };
  }
}

/**
 * Handle eligibility check
 */
async function handleEligibilityCheck(message, sessionId, db, logger) {
  try {
    // Mock eligibility data for demonstration
    return {
      messageType: 'data',
      content: 'Based on your information, here\'s your eligibility status:',
      actions: [{
        type: 'show_eligibility',
        data: {
          payer: 'Nevada Medicaid',
          program: 'Personal Care Services (PCS)',
          status: 'active',
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          monthlyHours: 120
        }
      }]
    };
  } catch (error) {
    logger.error('Eligibility check failed', { error: error.message });
    return {
      messageType: 'text',
      content: 'I\'m having trouble checking your eligibility right now. Please call 833.432.6488 for assistance.'
    };
  }
}

/**
 * Handle visit inquiry
 */
async function handleVisitInquiry(message, sessionId, db, logger) {
  try {
    return {
      messageType: 'table',
      content: 'Here are your recent visits:',
      tableData: {
        headers: ['Date', 'Caregiver', 'Hours', 'Services', 'Status'],
        rows: [
          ['2025-01-15', 'Mary Johnson', '4.0', 'Personal Care', '<span class="status-badge active">Completed</span>'],
          ['2025-01-14', 'Mary Johnson', '3.5', 'Homemaker', '<span class="status-badge active">Completed</span>'],
          ['2025-01-13', 'Mary Johnson', '4.0', 'Personal Care', '<span class="status-badge pending">Pending</span>']
        ]
      }
    };
  } catch (error) {
    logger.error('Visit inquiry failed', { error: error.message });
    return {
      messageType: 'text',
      content: 'I\'m having trouble accessing your visit information right now.'
    };
  }
}

/**
 * Handle billing inquiry
 */
async function handleBillingInquiry(message, sessionId, db, logger) {
  try {
    return {
      messageType: 'card',
      content: 'Here\'s your current billing summary:',
      cardData: {
        title: 'Billing Summary - January 2025',
        rows: [
          { label: 'Total Hours', value: '48.5' },
          { label: 'Rate per Hour', value: '$18.50' },
          { label: 'Subtotal', value: '$897.25' },
          { label: 'Adjustments', value: '$0.00' },
          { label: 'Total Amount', value: '$897.25' },
          { label: 'Status', value: '<span class="status-badge pending">Processing</span>' }
        ]
      }
    };
  } catch (error) {
    logger.error('Billing inquiry failed', { error: error.message });
    return {
      messageType: 'text',
      content: 'I\'m having trouble accessing your billing information right now.'
    };
  }
}

/**
 * Handle general help
 */
async function handleGeneralHelp(message, context) {
  return {
    messageType: 'text',
    content: `I'm here to help you with United Family Caregivers services! I can assist you with:

• **Profile Information** - View and update your personal details
• **Eligibility Verification** - Check your Medicaid coverage and benefits  
• **Visit Scheduling** - View your care visits and appointments
• **Billing Questions** - Review your billing statements and payments
• **Program Information** - Learn about our PCS services

What would you like to know more about? Or you can ask me specific questions like:
- "Show my profile"
- "Check my eligibility" 
- "What are my recent visits?"
- "What's my current bill?"

For urgent assistance, please call our customer service at **833.432.6488**.`
  };
}

/**
 * Generate AI response using context
 */
async function generateAIResponse(message, context, logger) {
  try {
    // This would integrate with Ollama/LLaMA 3.3
    // For now, provide contextual responses
    
    const responses = [
      "Thank you for contacting United Family Caregivers. How can I help you today?",
      "I'm here to assist you with your home care services. What information do you need?",
      "I can help you with eligibility questions, visit information, and billing. What would you like to know?",
      "Let me help you with that. Could you provide more specific details about what you're looking for?"
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    return {
      messageType: 'text',
      content: randomResponse
    };
  } catch (error) {
    logger.error('AI response generation failed', { error: error.message });
    return {
      messageType: 'text',
      content: 'I\'m here to help! What can I assist you with regarding United Family Caregivers services?'
    };
  }
}

/**
 * Log chat interaction
 */
async function logChatInteraction({ sessionId, userMessage, aiResponse, intent, db, logger }) {
  try {
    await db.query(`
      INSERT INTO chat_messages (
        id, thread_id, sender_type, content, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        'user',
        $2,
        $3,
        NOW()
      ), (
        gen_random_uuid(),
        $1,
        'system',
        $4,
        $5,
        NOW()
      )
    `, [
      sessionId,
      userMessage,
      JSON.stringify({ intent, source: 'web_chat' }),
      typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse),
      JSON.stringify({ intent, source: 'ai_response' })
    ]);
  } catch (error) {
    logger.error('Failed to log chat interaction', { error: error.message });
  }
}

module.exports = router;
