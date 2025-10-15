/**
 * Phase Configuration
 * Manages deployment phases: testing, onlinetest, live
 */

const PHASE = 'testing'; // Simplified - no phase gates

const PHASE_CONFIG = {
  testing: {
    name: 'testing',
    ports: {
      api: 4430,
      ui: 8717
    },
    database: {
      host: 'postgres',
      port: 5432,
      database: 'kloudy_db',
      user: 'kloudy_user',
      password: 'kloudy_test_pass'
    },
    redis: {
      url: 'redis://redis:6379'
    },
    logging: {
      level: 'debug',
      enableAudit: true
    },
    features: {
      mockData: true,
      strictValidation: false,
      detailedErrors: true
    },
    security: {
      cors: true,
      allowedOrigins: ['http://localhost:8080', 'http://localhost:4430']
    }
  },
  
  onlinetest: {
    name: 'onlinetest',
    ports: {
      api: 7110,
      ui: 7178
    },
    database: {
      host: 'postgres',
      port: 5432,
      database: 'kloudy_db',
      user: 'kloudy_user',
      password: process.env.POSTGRES_PASSWORD_ONLINETEST || 'kloudy_online_pass'
    },
    redis: {
      url: 'redis://redis:6379'
    },
    logging: {
      level: 'info',
      enableAudit: true
    },
    features: {
      mockData: false,
      strictValidation: true,
      detailedErrors: false
    },
    security: {
      cors: true,
      allowedOrigins: ['http://localhost:7178']
    }
  },
  
  live: {
    name: 'live',
    ports: {
      api: 8080,
      ui: 3000
    },
    database: {
      host: 'postgres',
      port: 5432,
      database: 'kloudy_db',
      user: 'kloudy_user',
      password: process.env.POSTGRES_PASSWORD_LIVE
    },
    redis: {
      url: 'redis://redis:6379'
    },
    logging: {
      level: 'warn',
      enableAudit: true
    },
    features: {
      mockData: false,
      strictValidation: true,
      detailedErrors: false
    },
    security: {
      cors: false,
      allowedOrigins: ['https://kloudy.ai', 'https://admin.kloudy.ai']
    }
  }
};

const getCurrentPhase = () => PHASE;
const getPhaseConfig = (phase = PHASE) => PHASE_CONFIG[phase];
const isLive = () => PHASE === 'live';
const isTesting = () => PHASE === 'testing';
const isOnlineTest = () => PHASE === 'onlinetest';

// Port management
const getPort = () => {
  return process.env.PORT || 3000;
};

// Database URL construction - simplified
const getDatabaseUrl = () => {
  return process.env.DATABASE_URL || 'sqlite:./kloudy_testing.db';
};

// Redis URL - simplified
const getRedisUrl = () => {
  return process.env.REDIS_URL || 'redis://localhost:6379';
};

// Logging configuration - simplified
const getLogLevel = () => {
  return 'debug';
};

// CORS configuration - simplified
const getCorsConfig = () => {
  return {
    enabled: true,
    origin: ['http://localhost:8717', 'http://localhost:8913', 'http://localhost:3000', 'http://127.0.0.1:8717', 'http://127.0.0.1:8913', 'http://127.0.0.1:3000']
  };
};

// Feature flags based on phase
const getPhaseFeatures = () => {
  const config = getPhaseConfig();
  return config.features;
};

module.exports = {
  PHASE,
  PHASE_CONFIG,
  getCurrentPhase,
  getPhaseConfig,
  isLive,
  isTesting,
  isOnlineTest,
  getPort,
  getDatabaseUrl,
  getRedisUrl,
  getLogLevel,
  getCorsConfig,
  getPhaseFeatures
};
