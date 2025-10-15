const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const yaml = require('yaml');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const redis = require('redis');
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const app = express();
const MCP_PORT = process.env.MCP_PORT || 8080;
const CHAT_PORT = process.env.CHAT_PORT || 7012;
const PHASE = process.env.PHASE || 'testing';

// Ollama configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
const MODEL_NAME = 'llama3.3:latest';

// Initialize logger
const logger = winston.createLogger({
  level: PHASE === 'testing' ? 'debug' : PHASE === 'live' ? 'warn' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/mcp-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/mcp-combined.log' })
  ]
});

// Initialize Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Initialize PostgreSQL client
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL
});

// Load MCP policy configuration
let mcpPolicy;
try {
  const policyPath = path.join(__dirname, 'policy.yaml');
  const policyContent = fs.readFileSync(policyPath, 'utf8');
  mcpPolicy = yaml.parse(policyContent);
  logger.info('MCP policy loaded successfully', { version: mcpPolicy.version });
} catch (error) {
  logger.error('Failed to load MCP policy', { error: error.message });
  process.exit(1);
}

// Middleware - disable CSP for development
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// PHI Detection and Redaction
const phiPatterns = [
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, // Credit card
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
  /\b\d{10,11}\b/g, // Phone numbers
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // Dates
];

function detectPHI(text) {
  const detected = [];
  phiPatterns.forEach((pattern, index) => {
    const matches = text.match(pattern);
    if (matches) {
      detected.push({
        type: ['ssn', 'credit_card', 'email', 'phone', 'date'][index],
        matches: matches
      });
    }
  });
  return detected;
}

function redactPHI(text, mode = 'mask_partial') {
  let redacted = text;
  
  if (mode === 'mask_partial') {
    // SSN: XXX-XX-1234
    redacted = redacted.replace(/\b(\d{3})-(\d{2})-(\d{4})\b/g, 'XXX-XX-$3');
    // Phone: XXX-XXX-1234
    redacted = redacted.replace(/\b(\d{3})-?(\d{3})-?(\d{4})\b/g, 'XXX-XXX-$3');
    // Email: j***@example.com
    redacted = redacted.replace(/\b([A-Za-z])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b/g, '$1***@$2');
  } else if (mode === 'full_redact') {
    phiPatterns.forEach(pattern => {
      redacted = redacted.replace(pattern, '[REDACTED]');
    });
  }
  
  return redacted;
}

// Content Classification
function classifyContent(message) {
  const lowerMessage = message.toLowerCase();
  
  // Check for emergency keywords
  const emergencyKeywords = mcpPolicy.emergency_handling.keywords;
  const isEmergency = emergencyKeywords.some(keyword => 
    lowerMessage.includes(keyword.toLowerCase())
  );
  
  if (isEmergency) {
    return {
      category: 'emergency',
      action: 'immediate_redirect',
      priority: 'critical'
    };
  }
  
  // Check for strict blocks
  const strictBlocks = mcpPolicy.strict_blocks;
  const hasStrictBlock = strictBlocks.some(block => 
    lowerMessage.includes(block.toLowerCase())
  );
  
  if (hasStrictBlock) {
    return {
      category: 'blocked',
      action: 'strict_block',
      priority: 'high'
    };
  }
  
  // Check for soft blocks
  const softBlocks = mcpPolicy.soft_blocks;
  const hasSoftBlock = softBlocks.some(block => 
    lowerMessage.includes(block.toLowerCase())
  );
  
  if (hasSoftBlock) {
    return {
      category: 'soft_block',
      action: 'brief_redirect',
      priority: 'medium'
    };
  }
  
  // Check if within allowed domains
  const allowedDomains = [
    ...Object.values(mcpPolicy.allowed_domains.primary_services),
    ...Object.values(mcpPolicy.allowed_domains.administrative),
    ...Object.values(mcpPolicy.allowed_domains.informational)
  ];
  
  const isAllowed = allowedDomains.some(domain => 
    lowerMessage.includes(domain.toLowerCase())
  );
  
  return {
    category: isAllowed ? 'allowed' : 'unknown',
    action: isAllowed ? 'process' : 'brief_redirect',
    priority: 'low'
  };
}

// Knowledge Base Integration
async function getKBContext(query, topK = 6) {
  try {
    const embedding = await generateEmbedding(query);
    
    const result = await pgPool.query(`
      SELECT id, title, content, tags, source_type, 
             1 - (embedding <=> $1) as similarity
      FROM kb_documents 
      WHERE 1 - (embedding <=> $1) > $2
      ORDER BY embedding <=> $1
      LIMIT $3
    `, [JSON.stringify(embedding), mcpPolicy.knowledge_base.retrieval.similarity_threshold, topK]);
    
    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content.substring(0, 500) + '...',
      tags: row.tags,
      source_type: row.source_type,
      similarity: row.similarity
    }));
  } catch (error) {
    logger.error('KB context retrieval failed', { error: error.message });
    return [];
  }
}

async function generateEmbedding(text) {
  // This would integrate with your embedding service
  // For now, return a mock embedding
  return new Array(1536).fill(0).map(() => Math.random());
}

// Main MCP Processing Endpoint
app.post('/process', async (req, res) => {
  const startTime = Date.now();
  const { message, context, userId, sessionId } = req.body;
  
  try {
    logger.info('Processing MCP request', { 
      userId, 
      sessionId, 
      messageLength: message?.length 
    });
    
    // Validate input
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid message format',
        code: 'INVALID_INPUT'
      });
    }
    
    // PHI Detection
    const phiDetected = detectPHI(message);
    if (phiDetected.length > 0) {
      logger.warn('PHI detected in message', { 
        userId, 
        sessionId, 
        phiTypes: phiDetected.map(p => p.type) 
      });
    }
    
    // Content Classification
    const classification = classifyContent(message);
    
    // Handle different classifications
    let response = {};
    
    switch (classification.action) {
      case 'immediate_redirect':
        response = {
          action: 'redirect',
          message: mcpPolicy.emergency_handling.response,
          escalate: true,
          priority: 'critical'
        };
        break;
        
      case 'strict_block':
        response = {
          action: 'block',
          message: "I can't provide that type of information. I can help you with eligibility questions, service information, and scheduling assistance. For medical concerns, please contact your healthcare provider.",
          escalate: false,
          priority: 'high'
        };
        break;
        
      case 'brief_redirect':
        response = {
          action: 'redirect',
          message: "I focus on helping with United Family Caregivers services. I can assist with eligibility, scheduling, and service questions. How can I help you with your care needs?",
          escalate: false,
          priority: 'medium'
        };
        break;
        
      case 'process':
        // Get KB context
        const kbContext = await getKBContext(message);
        
        // Prepare for AI processing
        response = {
          action: 'process',
          context: kbContext,
          guidelines: mcpPolicy.ai_model_config.response_guidelines,
          systemPrompt: mcpPolicy.ai_model_config.system_prompt,
          temperature: mcpPolicy.ai_model_config.temperature,
          maxTokens: mcpPolicy.ai_model_config.max_tokens
        };
        break;
        
      default:
        response = {
          action: 'redirect',
          message: "I'm not sure how to help with that. I can assist with eligibility questions, service information, and scheduling. What would you like to know about our services?",
          escalate: false,
          priority: 'low'
        };
    }
    
    // Log the interaction
    await logInteraction({
      userId,
      sessionId,
      message: redactPHI(message, mcpPolicy.privacy_protection.phi_redaction),
      classification,
      response: response.action,
      phiDetected: phiDetected.length > 0,
      processingTime: Date.now() - startTime
    });
    
    res.json({
      ...response,
      metadata: {
        processingTime: Date.now() - startTime,
        policyVersion: mcpPolicy.version,
        phase: PHASE,
        phiDetected: phiDetected.length > 0
      }
    });
    
  } catch (error) {
    logger.error('MCP processing error', { 
      error: error.message, 
      stack: error.stack,
      userId,
      sessionId
    });
    
    res.status(500).json({
      error: 'Internal processing error',
      code: 'PROCESSING_ERROR',
      message: 'Please try again or contact support if the issue persists.'
    });
  }
});

// Logging function
async function logInteraction(data) {
  try {
    await pgPool.query(`
      INSERT INTO mcp_conversations 
      (user_id, session_id, message_hash, classification, response_action, phi_detected, processing_time, policy_version, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [
      data.userId,
      data.sessionId,
      require('crypto').createHash('sha256').update(data.message).digest('hex'),
      JSON.stringify(data.classification),
      data.response,
      data.phiDetected,
      data.processingTime,
      mcpPolicy.version
    ]);
  } catch (error) {
    logger.error('Failed to log interaction', { error: error.message });
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    phase: PHASE,
    policyVersion: mcpPolicy.version,
    timestamp: new Date().toISOString()
  });
});

// Policy info endpoint
app.get('/policy', (req, res) => {
  res.json({
    version: mcpPolicy.version,
    effectiveDate: mcpPolicy.effective_date,
    allowedDomains: mcpPolicy.allowed_domains,
    phase: PHASE
  });
});

// Chat endpoint that integrates MCP + Ollama
app.post('/api/chat/message', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    logger.info('Chat message received', { sessionId, messageLength: message?.length });
    
    // Process through MCP guardrails
    const mcpResult = await processThroughMCP(message, sessionId);
    
    if (mcpResult.action === 'block' || mcpResult.action === 'redirect') {
      return res.json({
        success: true,
        content: mcpResult.message,
        messageType: 'text'
      });
    }
    
    // Generate response using Ollama
    const aiResponse = await generateOllamaResponse(message, mcpResult.context);
    
    res.json({
      success: true,
      content: aiResponse.content,
      messageType: 'text',
      model: MODEL_NAME
    });
    
  } catch (error) {
    logger.error('Chat processing failed', { error: error.message });
    res.status(500).json({
      success: false,
      content: 'I\'m having trouble processing your message. Please try again or call 833.432.6488.'
    });
  }
});

// Generate response using your local Ollama
async function generateOllamaResponse(message, context = []) {
  try {
    const systemPrompt = `You are an AI assistant for United Family Caregivers, a Nevada-licensed home care provider.

NEVADA MEDICAID PCS KNOWLEDGE:
- Personal Care Services (PCS) Type 30 provider
- Services: personal care, homemaker, companion care, respite care  
- Eligibility requires Nevada Medicaid + ADL assessment
- Common services: bathing, dressing, meal prep, light housekeeping, medication reminders
- Prior authorization required from Nevada DHCFP

COMPANY INFO:
- NV Care Solutions Inc dba United Family Caregivers
- Phone: 833.432.6488
- Nevada statewide coverage

STRICT LIMITATIONS:
- NO medical advice or diagnosis
- NO emergency handling (direct to 911)
- NO other clients' information
- Stay focused on United Family Caregivers services

Keep responses helpful, professional, and under 200 words.`;

    const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: MODEL_NAME,
      prompt: message,
      system: systemPrompt,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 250
      }
    }, { timeout: 30000 });

    if (response.data && response.data.response) {
      return {
        success: true,
        content: response.data.response.trim()
      };
    } else {
      throw new Error('Invalid Ollama response');
    }

  } catch (error) {
    logger.error('Ollama generation failed', { error: error.message });
    return {
      success: false,
      content: 'I\'m having trouble connecting to our AI brain. For assistance, please call 833.432.6488.'
    };
  }
}

// Process message through MCP logic
async function processThroughMCP(message, sessionId) {
  // Use existing MCP processing logic
  const classification = classifyContent(message);
  
  switch (classification.action) {
    case 'immediate_redirect':
      return {
        action: 'redirect',
        message: mcpPolicy.emergency_handling.response
      };
    case 'strict_block':
      return {
        action: 'block', 
        message: "I can't provide that type of information. I can help with eligibility, services, and scheduling for United Family Caregivers."
      };
    default:
      return {
        action: 'process',
        context: []
      };
  }
}

// Serve frontend
app.use(express.static('/app/public'));

// Start server
async function startServer() {
  try {
    // Test Ollama connection
    const ollamaResponse = await axios.get(`${OLLAMA_URL}/api/tags`);
    const models = ollamaResponse.data.models || [];
    const llamaModel = models.find(model => model.name.includes('llama3.3'));
    
    if (llamaModel) {
      logger.info('✅ Connected to LLaMA 3.3', { 
        model: llamaModel.name,
        size: `${(llamaModel.size / 1024 / 1024 / 1024).toFixed(1)}GB`
      });
    } else {
      logger.warn('⚠️ LLaMA 3.3 not found in Ollama');
    }
    
    app.listen(CHAT_PORT, () => {
      logger.info(`🚀 Kloudy Kare MCP Hub running`, {
        chatPort: CHAT_PORT,
        mcpPort: MCP_PORT,
        ollama: OLLAMA_URL,
        model: MODEL_NAME,
        phase: PHASE
      });
      
      logger.info(`🌐 Frontend: http://localhost:${CHAT_PORT}`);
      logger.info(`🤖 AI Brain: Connected to ${OLLAMA_URL}`);
    });
    
  } catch (error) {
    logger.error('Failed to start MCP hub', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  await redisClient.quit();
  await pgPool.end();
  process.exit(0);
});

startServer();
