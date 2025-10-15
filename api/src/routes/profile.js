/**
 * Profile Management Routes
 * API endpoints for managing user profiles built from SMS and other interactions
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const ProfileService = require('../services/profileService');
const { requireFeature } = require('../config/flags');
const winston = require('winston');

const router = express.Router();

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

/**
 * GET /api/profile/phone/:phoneNumber
 * Get profile by phone number
 */
router.get('/phone/:phoneNumber', [
  param('phoneNumber')
    .matches(/^\+?1?[0-9]{10}$/)
    .withMessage('Invalid phone number format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { phoneNumber } = req.params;
    const profileService = new ProfileService(req.db, logger);
    
    const profile = await profileService.getProfileByPhone(phoneNumber);
    
    if (!profile) {
      return res.status(404).json({
        error: 'Profile not found',
        message: 'No profile exists for this phone number'
      });
    }

    // Remove sensitive data for API response
    const sanitizedProfile = {
      ...profile,
      // Keep only non-sensitive fields or mask sensitive ones
      medicaid_id: profile.medicaid_id ? '***' + profile.medicaid_id.slice(-4) : null,
      medicare_id: profile.medicare_id ? '***' + profile.medicare_id.slice(-4) : null
    };

    res.json({
      profile: sanitizedProfile,
      completionPercentage: profile.profile_completion_percentage || 0,
      verificationStatus: profile.verification_status || 'unverified'
    });

  } catch (error) {
    logger.error('Profile retrieval failed', {
      error: error.message,
      phoneNumber: req.params.phoneNumber
    });
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve profile'
    });
  }
});

/**
 * POST /api/profile/sms-update
 * Update profile from SMS interaction
 */
router.post('/sms-update', [
  body('phoneNumber')
    .matches(/^\+?1?[0-9]{10}$/)
    .withMessage('Invalid phone number format'),
  body('messageContent')
    .isLength({ min: 1, max: 1600 })
    .withMessage('Message content is required and must be under 1600 characters'),
  body('extractedData')
    .isObject()
    .withMessage('Extracted data must be an object'),
  body('conversationStage')
    .optional()
    .isIn(['intake', 'address', 'emergency_contact', 'medical', 'verification', 'update'])
    .withMessage('Invalid conversation stage')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { phoneNumber, messageContent, extractedData, conversationStage } = req.body;
    const profileService = new ProfileService(req.db, logger);
    
    const result = await profileService.createOrUpdateProfileFromSMS(
      phoneNumber,
      extractedData,
      messageContent,
      conversationStage
    );

    // Generate next questions for conversation flow
    const nextQuestions = await profileService.generateNextQuestions(
      result.profile.id,
      conversationStage
    );

    res.json({
      success: true,
      profile: {
        id: result.profile.id,
        userId: result.user.id,
        completionPercentage: result.completionPercentage,
        verificationStatus: result.profile.verification_status
      },
      nextQuestions,
      fieldsUpdated: Object.keys(extractedData)
    });

  } catch (error) {
    logger.error('SMS profile update failed', {
      error: error.message,
      phoneNumber: req.body.phoneNumber
    });
    
    res.status(500).json({
      error: 'Profile update failed',
      message: 'Failed to update profile from SMS data'
    });
  }
});

/**
 * GET /api/profile/:profileId/missing-info
 * Get missing profile information
 */
router.get('/:profileId/missing-info', [
  param('profileId')
    .isUUID()
    .withMessage('Invalid profile ID format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { profileId } = req.params;
    const profileService = new ProfileService(req.db, logger);
    
    const missingInfo = await profileService.getMissingProfileInfo(profileId);
    const completionPercentage = await profileService.calculateCompletionPercentage(profileId);

    res.json({
      profileId,
      missingFields: missingInfo,
      completionPercentage,
      totalMissing: missingInfo.length
    });

  } catch (error) {
    logger.error('Missing info retrieval failed', {
      error: error.message,
      profileId: req.params.profileId
    });
    
    res.status(500).json({
      error: 'Failed to retrieve missing information',
      message: 'Could not determine missing profile fields'
    });
  }
});

/**
 * GET /api/profile/:profileId/next-questions
 * Get next questions for SMS conversation
 */
router.get('/:profileId/next-questions', [
  param('profileId')
    .isUUID()
    .withMessage('Invalid profile ID format'),
  query('stage')
    .optional()
    .isIn(['intake', 'address', 'emergency_contact', 'medical', 'verification', 'update'])
    .withMessage('Invalid conversation stage')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { profileId } = req.params;
    const { stage = 'intake' } = req.query;
    const profileService = new ProfileService(req.db, logger);
    
    const questions = await profileService.generateNextQuestions(profileId, stage);

    res.json({
      profileId,
      conversationStage: stage,
      nextQuestions: questions
    });

  } catch (error) {
    logger.error('Next questions generation failed', {
      error: error.message,
      profileId: req.params.profileId
    });
    
    res.status(500).json({
      error: 'Failed to generate questions',
      message: 'Could not determine next questions for conversation'
    });
  }
});

/**
 * GET /api/profile/:profileId/sms-history
 * Get SMS interaction history for profile
 */
router.get('/:profileId/sms-history', [
  param('profileId')
    .isUUID()
    .withMessage('Invalid profile ID format'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { profileId } = req.params;
    const { limit = 20 } = req.query;

    const result = await req.db.query(`
      SELECT 
        id,
        phone_number,
        message_direction,
        conversation_stage,
        processing_status,
        created_at,
        processed_at,
        next_questions
      FROM sms_profile_interactions 
      WHERE profile_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `, [profileId, limit]);

    res.json({
      profileId,
      interactions: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    logger.error('SMS history retrieval failed', {
      error: error.message,
      profileId: req.params.profileId
    });
    
    res.status(500).json({
      error: 'Failed to retrieve SMS history',
      message: 'Could not load SMS interaction history'
    });
  }
});

/**
 * PUT /api/profile/:profileId
 * Update profile data directly (for agent use)
 */
router.put('/:profileId', [
  param('profileId')
    .isUUID()
    .withMessage('Invalid profile ID format'),
  body('updates')
    .isObject()
    .withMessage('Updates must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { profileId } = req.params;
    const { updates } = req.body;
    const profileService = new ProfileService(req.db, logger);

    // Update the profile
    const updatedProfile = await profileService.updateProfileData(profileId, updates);
    
    // Update metrics
    const metrics = await profileService.updateProfileMetrics(profileId);

    res.json({
      success: true,
      profile: updatedProfile,
      metrics,
      fieldsUpdated: Object.keys(updates)
    });

  } catch (error) {
    logger.error('Profile update failed', {
      error: error.message,
      profileId: req.params.profileId
    });
    
    res.status(500).json({
      error: 'Profile update failed',
      message: 'Could not update profile'
    });
  }
});

/**
 * GET /api/profile/stats
 * Get profile statistics (for admin/reporting)
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await req.db.query(`
      SELECT 
        COUNT(*) as total_profiles,
        COUNT(CASE WHEN verification_status = 'verified' THEN 1 END) as verified_profiles,
        COUNT(CASE WHEN verification_status = 'partial' THEN 1 END) as partial_profiles,
        COUNT(CASE WHEN verification_status = 'unverified' THEN 1 END) as unverified_profiles,
        AVG(profile_completion_percentage) as avg_completion,
        AVG(data_quality_score) as avg_quality_score,
        COUNT(CASE WHEN created_via = 'sms' THEN 1 END) as sms_created_profiles
      FROM user_profiles
      WHERE profile_status = 'active'
    `);

    const smsStats = await req.db.query(`
      SELECT 
        COUNT(*) as total_interactions,
        COUNT(DISTINCT profile_id) as profiles_with_sms,
        AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_processing_time
      FROM sms_profile_interactions
      WHERE processing_status = 'processed'
      AND created_at > NOW() - INTERVAL '30 days'
    `);

    res.json({
      profiles: stats.rows[0],
      sms_interactions: smsStats.rows[0],
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Profile stats retrieval failed', {
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to retrieve statistics',
      message: 'Could not load profile statistics'
    });
  }
});

/**
 * GET /api/admin/users
 * Get all users (admin endpoint)
 */
router.get('/admin/users', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.role, u.created_at,
        CASE WHEN up.profile_status = 'active' THEN 'active' ELSE 'inactive' END as status
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      ORDER BY u.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Failed to fetch users for admin:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /api/admin/users
 * Create new user (admin endpoint)
 */
router.post('/admin/users', async (req, res) => {
  try {
    const { name, email, phone, role, password, status } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Hash password
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userResult = await req.db.query(`
      INSERT INTO users (name, email, phone, role, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id, name, email, phone, role, created_at
    `, [name, email, phone, role || 'client']);

    const user = userResult.rows[0];

    // Create user profile
    await req.db.query(`
      INSERT INTO user_profiles (
        user_id, first_name, last_name, email_address, primary_phone, 
        profile_status, verification_status, created_via
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      user.id, 
      name.split(' ')[0], 
      name.split(' ').slice(1).join(' '),
      email, 
      phone,
      status || 'active',
      'unverified',
      'admin'
    ]);

    // Log user creation
    await req.db.query(`
      INSERT INTO audit_log (user_id, action, resource_type, resource_id, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [req.user?.id || '00000000-0000-0000-0000-000000000001', 'user_created', 'user', user.id, req.ip, req.get('User-Agent')]);

    res.json({ success: true, user });

    req.logger.info('User created by admin', { 
      user_id: user.id, 
      user_name: name 
    });

  } catch (error) {
    req.logger.error('Failed to create user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

module.exports = router;
