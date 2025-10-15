/**
 * Kloudy Kare API Server
 * Main entry point for the healthcare management API
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const sqlite3 = require('sqlite3');
const redis = require('redis');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Import configuration
const { getPort, getDatabaseUrl, getRedisUrl, getLogLevel, getCorsConfig } = require('./src/config/phase');
const { getFeatureFlags, getClientFeatureConfig } = require('./src/config/flags');

// Import routes
const profileRoutes = require('./src/routes/profile');
const twilioRoutes = require('./src/routes/twilio');
const voiceRoutes = require('./src/routes/voice');
const kbRoutes = require('./src/routes/kb');
const eligibilityRoutes = require('./src/routes/eligibility');
const authzRoutes = require('./src/routes/authorization');
const billingRoutes = require('./src/routes/billing');
const sandataRoutes = require('./src/routes/sandata');
const chatRoutes = require('./src/routes/chat');
const sshRoutes = require('./src/routes/ssh');
const agentRoutes = require('./src/routes/agent');

// Import services
const ProfileService = require('./src/services/profileService');

require('dotenv').config();

const app = express();
const PORT = getPort();

// Initialize logger
const logger = winston.createLogger({
  level: getLogLevel(),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/api-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/api-combined.log' })
  ]
});

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize database connection
let pgPool;
const databaseUrl = getDatabaseUrl();

if (databaseUrl.startsWith('sqlite:')) {
  // Use SQLite for local testing
  const dbPath = databaseUrl.replace('sqlite:', '');
  const dbConnection = new sqlite3.Database(dbPath);
  
  // Mock PostgreSQL Pool interface for SQLite
  pgPool = {
    query: (text, params) => {
      return new Promise((resolve, reject) => {
        // Convert PostgreSQL queries to SQLite (basic conversion)
        let sqliteQuery = text
          .replace(/\$(\d+)/g, '?') // Convert $1, $2 to ?
          .replace(/gen_random_uuid\(\)/g, "hex(randomblob(16))")
          .replace(/NOW\(\)/g, "datetime('now')")
          .replace(/TIMESTAMP WITH TIME ZONE/g, "TEXT");
        
        dbConnection.all(sqliteQuery, params || [], (err, rows) => {
          if (err) reject(err);
          else resolve({ rows: rows || [] });
        });
      });
    },
    end: () => dbConnection.close()
  };
  
  logger.info('Using SQLite database for local testing');
} else {
  // Use PostgreSQL
  pgPool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

// Initialize Redis client (mock for local testing)
const redisClient = {
  connect: () => Promise.resolve(),
  ping: () => Promise.resolve('PONG'),
  quit: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  set: () => Promise.resolve('OK'),
  del: () => Promise.resolve(1)
};

// Database connection middleware
app.use((req, res, next) => {
  req.db = pgPool;
  req.redis = redisClient;
  req.logger = logger;
  next();
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
const corsConfig = getCorsConfig();
if (corsConfig.enabled) {
  app.use(cors({
    origin: corsConfig.origin,
    credentials: true
  }));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP',
    retryAfter: '15 minutes'
  }
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info('API Request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await pgPool.query('SELECT NOW()');
    
    // Check Redis connection
    await redisClient.ping();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      phase: process.env.PHASE || 'testing',
      version: '1.0.0',
      services: {
        database: 'connected',
        redis: 'connected',
        mcp: 'available'
      }
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Configuration endpoint
app.get('/api/config/features', (req, res) => {
  try {
    const config = getClientFeatureConfig();
    res.json(config);
  } catch (error) {
    logger.error('Feature config retrieval failed', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve feature configuration'
    });
  }
});

// API Routes
app.use('/api/profile', profileRoutes);
app.use('/api/twilio', twilioRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/kb', kbRoutes);
app.use('/api/eligibility', eligibilityRoutes);
app.use('/api/auth', authzRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/sandata', sandataRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ssh', sshRoutes);
app.use('/api/agent', agentRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Kloudy Kare API',
    version: '1.0.0',
    phase: process.env.PHASE || 'testing',
    description: 'Healthcare Management API for United Family Caregivers',
    endpoints: {
      health: '/health',
      features: '/api/config/features',
      profile: '/api/profile/*',
      twilio: '/api/twilio/*',
      voice: '/api/voice/*',
      kb: '/api/kb/*',
      eligibility: '/api/eligibility/*',
      auth: '/api/auth/*',
      billing: '/api/billing/*',
      sandata: '/api/sandata/*',
      chat: '/api/chat/*',
      ssh: '/api/ssh/*',
      agent: '/api/agent/*'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    method: req.method,
    path: req.originalUrl,
    availableEndpoints: [
      'GET /health',
      'GET /api/config/features',
      'GET /api/profile/phone/:phoneNumber',
      'POST /api/profile/sms-update',
      'POST /api/twilio/webhook',
      'GET /api/kb/search',
      'POST /api/chat/message',
      'GET /api/ssh/test',
      'POST /api/ssh/execute'
    ]
  });
});

// Global error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled API error', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.url,
    ip: req.ip
  });

  res.status(error.status || 500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    requestId: req.id
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  
  try {
    await pgPool.end();
    await redisClient.quit();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  
  try {
    await pgPool.end();
    await redisClient.quit();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
});

// Start server
async function startServer() {
  try {
    // Test database connection
    if (databaseUrl.startsWith('sqlite:')) {
      logger.info('SQLite database initialized for local testing');
    } else {
      await pgPool.query('SELECT NOW()');
      logger.info('Database connected successfully');
    }

    // Mock Redis connection
    await redisClient.connect();
    logger.info('Redis mock connected successfully');

    // Start HTTP server - bind to all interfaces for VPS access
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Kloudy Kare API server running on 0.0.0.0:${PORT}`, {
        phase: process.env.PHASE || 'testing',
        environment: process.env.NODE_ENV || 'development',
        features: Object.keys(getFeatureFlags()).filter(key => getFeatureFlags()[key])
      });
    });

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();
