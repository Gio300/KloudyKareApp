/**
 * Feature Flags Configuration
 * Controls which features are enabled in each phase
 */

const { getCurrentPhase } = require('./phase');

// Base feature flags - can be overridden by environment variables
const BASE_FLAGS = {
  // Core Features (enabled in testing phase)
  FEATURE_TWILIO_SMS: true,
  FEATURE_AGENT_MIRROR: true,
  FEATURE_KB_RAG: true,
  FEATURE_MCP_GUARDRAILS: true,
  FEATURE_SANDATA_READ: true,
  FEATURE_AUTHORIZATION_WIZARD: true,
  FEATURE_BILLING_DRAFTS: true,
  
  // Advanced Features (disabled by default, enabled in higher phases)
  FEATURE_SANDATA_WRITE: false,
  FEATURE_CLIENT_PORTAL: false,
  FEATURE_TEAM_CHAT: false,
  FEATURE_EMAIL_SYSTEM: false,
  FEATURE_CARE_MANAGEMENT: false,
  FEATURE_VOICE_CALL_SUPPORT: false,
  FEATURE_NOTIFICATIONS: false,
  FEATURE_PROGRAM_INFO_PAGE: false,
  FEATURE_INSTALL_APP: false,
  
  // Development Features
  FEATURE_DEV_LOGIN: false,
  FEATURE_DEBUG_LOGGING: false,
  FEATURE_MOCK_SERVICES: false
};

// Phase-specific overrides
const PHASE_OVERRIDES = {
  testing: {
    FEATURE_DEV_LOGIN: true,
    FEATURE_DEBUG_LOGGING: true,
    FEATURE_MOCK_SERVICES: true,
    // Keep most features enabled for testing
  },
  
  onlinetest: {
    FEATURE_SANDATA_WRITE: true,
    FEATURE_DEV_LOGIN: false,
    FEATURE_DEBUG_LOGGING: false,
    FEATURE_MOCK_SERVICES: false,
    // Enable more features for online testing
  },
  
  live: {
    // Enable all approved features in live
    FEATURE_SANDATA_WRITE: true,
    FEATURE_CLIENT_PORTAL: true,
    FEATURE_TEAM_CHAT: true,
    FEATURE_EMAIL_SYSTEM: true,
    FEATURE_CARE_MANAGEMENT: true,
    FEATURE_VOICE_CALL_SUPPORT: true,
    FEATURE_NOTIFICATIONS: true,
    FEATURE_PROGRAM_INFO_PAGE: true,
    FEATURE_INSTALL_APP: true,
    
    // Disable development features
    FEATURE_DEV_LOGIN: false,
    FEATURE_DEBUG_LOGGING: false,
    FEATURE_MOCK_SERVICES: false
  }
};

/**
 * Get the current feature flags based on phase and environment variables
 */
function getFeatureFlags() {
  const currentPhase = getCurrentPhase();
  const phaseOverrides = PHASE_OVERRIDES[currentPhase] || {};
  
  // Start with base flags
  let flags = { ...BASE_FLAGS };
  
  // Apply phase-specific overrides
  flags = { ...flags, ...phaseOverrides };
  
  // Apply environment variable overrides
  Object.keys(flags).forEach(key => {
    if (process.env[key] !== undefined) {
      flags[key] = process.env[key] === 'true';
    }
  });
  
  return flags;
}

/**
 * Check if a specific feature is enabled
 */
function isFeatureEnabled(featureName) {
  const flags = getFeatureFlags();
  return flags[featureName] === true;
}

/**
 * Get features that should show "Coming Soon" badge
 */
function getComingSoonFeatures() {
  const flags = getFeatureFlags();
  const comingSoon = [];
  
  Object.keys(flags).forEach(key => {
    if (!flags[key] && key.startsWith('FEATURE_')) {
      // Convert flag name to readable feature name
      const featureName = key
        .replace('FEATURE_', '')
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      
      comingSoon.push({
        key,
        name: featureName,
        enabled: false
      });
    }
  });
  
  return comingSoon;
}

/**
 * Get enabled features for UI rendering
 */
function getEnabledFeatures() {
  const flags = getFeatureFlags();
  const enabled = [];
  
  Object.keys(flags).forEach(key => {
    if (flags[key] && key.startsWith('FEATURE_')) {
      const featureName = key
        .replace('FEATURE_', '')
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      
      enabled.push({
        key,
        name: featureName,
        enabled: true
      });
    }
  });
  
  return enabled;
}

/**
 * Feature flag middleware for Express routes
 */
function requireFeature(featureName) {
  return (req, res, next) => {
    if (!isFeatureEnabled(featureName)) {
      return res.status(404).json({
        error: 'Feature not available',
        feature: featureName,
        message: 'This feature is not enabled in the current phase'
      });
    }
    next();
  };
}

/**
 * Get feature configuration for client-side use
 */
function getClientFeatureConfig() {
  const flags = getFeatureFlags();
  const currentPhase = getCurrentPhase();
  
  return {
    phase: currentPhase,
    features: flags,
    enabled: getEnabledFeatures().map(f => f.key),
    comingSoon: getComingSoonFeatures().map(f => f.key)
  };
}

module.exports = {
  BASE_FLAGS,
  PHASE_OVERRIDES,
  getFeatureFlags,
  isFeatureEnabled,
  getComingSoonFeatures,
  getEnabledFeatures,
  requireFeature,
  getClientFeatureConfig
};
