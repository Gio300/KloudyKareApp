/**
 * User Profile Service
 * Manages user profiles built from SMS interactions and other data sources
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

class ProfileService {
  constructor(dbPool, logger) {
    this.db = dbPool;
    this.logger = logger;
  }

  /**
   * Create or update user profile from SMS data
   */
  async createOrUpdateProfileFromSMS(phoneNumber, extractedData, messageContent, conversationStage = 'intake') {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Find or create user
      let user = await this.findUserByPhone(phoneNumber);
      if (!user) {
        user = await this.createUser(phoneNumber);
      }
      
      // Find or create profile
      let profile = await this.findProfileByUserId(user.id);
      if (!profile) {
        profile = await this.createProfile(user.id, phoneNumber);
      }
      
      // Update profile with extracted data
      const updatedProfile = await this.updateProfileData(profile.id, extractedData);
      
      // Log SMS interaction
      await this.logSMSInteraction({
        userId: user.id,
        profileId: profile.id,
        phoneNumber,
        messageContent,
        extractedData,
        conversationStage
      });
      
      // Update profile completion and quality scores
      await this.updateProfileMetrics(profile.id);
      
      await client.query('COMMIT');
      
      this.logger.info('Profile updated from SMS', {
        userId: user.id,
        profileId: profile.id,
        phone: phoneNumber,
        fieldsUpdated: Object.keys(extractedData)
      });
      
      return {
        user,
        profile: updatedProfile,
        completionPercentage: await this.calculateCompletionPercentage(profile.id)
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Profile update from SMS failed', {
        error: error.message,
        phone: phoneNumber
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Find user by phone number
   */
  async findUserByPhone(phoneNumber) {
    const result = await this.db.query(
      'SELECT * FROM users WHERE phone = $1',
      [phoneNumber]
    );
    return result.rows[0] || null;
  }

  /**
   * Create new user
   */
  async createUser(phoneNumber, name = null) {
    const userId = uuidv4();
    const result = await this.db.query(`
      INSERT INTO users (id, phone, name, role)
      VALUES ($1, $2, $3, 'client')
      RETURNING *
    `, [userId, phoneNumber, name]);
    
    return result.rows[0];
  }

  /**
   * Find profile by user ID
   */
  async findProfileByUserId(userId) {
    const result = await this.db.query(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Create new profile
   */
  async createProfile(userId, phoneNumber) {
    const profileId = uuidv4();
    const result = await this.db.query(`
      INSERT INTO user_profiles (
        id, user_id, primary_phone, information_source, created_via
      ) VALUES ($1, $2, $3, 'sms', 'sms')
      RETURNING *
    `, [profileId, userId, phoneNumber]);
    
    return result.rows[0];
  }

  /**
   * Update profile data with extracted information
   */
  async updateProfileData(profileId, extractedData) {
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    // Map extracted data to profile fields
    const fieldMapping = {
      firstName: 'first_name',
      lastName: 'last_name',
      middleName: 'middle_name',
      preferredName: 'preferred_name',
      dateOfBirth: 'date_of_birth',
      age: 'age',
      gender: 'gender',
      email: 'email_address',
      streetAddress: 'street_address',
      apartmentUnit: 'apartment_unit',
      city: 'city',
      state: 'state',
      zipCode: 'zip_code',
      county: 'county',
      medicaidId: 'medicaid_id',
      medicareId: 'medicare_id',
      insuranceProvider: 'insurance_provider',
      emergencyContact1Name: 'emergency_contact_1_name',
      emergencyContact1Phone: 'emergency_contact_1_phone',
      emergencyContact1Relationship: 'emergency_contact_1_relationship',
      primaryCarePhysician: 'primary_care_physician',
      medicalConditions: 'medical_conditions',
      medications: 'medications',
      allergies: 'allergies',
      mobilityNeeds: 'mobility_needs',
      dietaryRestrictions: 'dietary_restrictions',
      preferredCaregiverGender: 'preferred_caregiver_gender',
      languagePreference: 'language_preference',
      serviceLocation: 'service_location'
    };

    // Build update query
    Object.keys(extractedData).forEach(key => {
      const dbField = fieldMapping[key];
      if (dbField && extractedData[key] !== null && extractedData[key] !== undefined) {
        updateFields.push(`${dbField} = $${paramCount}`);
        
        // Handle array fields
        if (Array.isArray(extractedData[key])) {
          updateValues.push(extractedData[key]);
        } else {
          updateValues.push(extractedData[key]);
        }
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      // No fields to update, just return current profile
      const result = await this.db.query(
        'SELECT * FROM user_profiles WHERE id = $1',
        [profileId]
      );
      return result.rows[0];
    }

    // Add updated timestamp
    updateFields.push(`updated_at = NOW()`);
    updateFields.push(`last_updated_via_sms = NOW()`);
    updateFields.push(`sms_conversation_count = sms_conversation_count + 1`);

    const query = `
      UPDATE user_profiles 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    updateValues.push(profileId);

    const result = await this.db.query(query, updateValues);
    return result.rows[0];
  }

  /**
   * Log SMS interaction for profile building
   */
  async logSMSInteraction(data) {
    const {
      userId,
      profileId,
      phoneNumber,
      messageContent,
      extractedData,
      conversationStage,
      confidenceScores = {},
      nextQuestions = []
    } = data;

    await this.db.query(`
      INSERT INTO sms_profile_interactions (
        id, user_id, profile_id, phone_number, message_content, 
        message_direction, extracted_data, confidence_scores,
        conversation_stage, next_questions, processing_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'processed')
    `, [
      uuidv4(),
      userId,
      profileId,
      phoneNumber,
      messageContent,
      'inbound',
      JSON.stringify(extractedData),
      JSON.stringify(confidenceScores),
      conversationStage,
      nextQuestions
    ]);
  }

  /**
   * Calculate profile completion percentage
   */
  async calculateCompletionPercentage(profileId) {
    const result = await this.db.query(
      'SELECT * FROM user_profiles WHERE id = $1',
      [profileId]
    );

    if (!result.rows[0]) return 0;

    const profile = result.rows[0];
    
    // Define required and optional fields with weights
    const requiredFields = [
      'first_name', 'last_name', 'primary_phone', 'zip_code'
    ];
    
    const importantFields = [
      'date_of_birth', 'street_address', 'city', 'state', 
      'emergency_contact_1_name', 'emergency_contact_1_phone'
    ];
    
    const optionalFields = [
      'middle_name', 'preferred_name', 'email_address', 'gender',
      'secondary_phone', 'apartment_unit', 'county', 'medicaid_id',
      'medicare_id', 'primary_care_physician'
    ];

    let score = 0;
    let maxScore = 0;

    // Required fields (40% weight)
    requiredFields.forEach(field => {
      maxScore += 40;
      if (profile[field] && profile[field].toString().trim()) {
        score += 40;
      }
    });

    // Important fields (30% weight)
    importantFields.forEach(field => {
      maxScore += 30;
      if (profile[field] && profile[field].toString().trim()) {
        score += 30;
      }
    });

    // Optional fields (10% weight each)
    optionalFields.forEach(field => {
      maxScore += 10;
      if (profile[field] && profile[field].toString().trim()) {
        score += 10;
      }
    });

    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

    // Update the profile with completion percentage
    await this.db.query(
      'UPDATE user_profiles SET profile_completion_percentage = $1 WHERE id = $2',
      [percentage, profileId]
    );

    return percentage;
  }

  /**
   * Update profile quality metrics
   */
  async updateProfileMetrics(profileId) {
    const completionPercentage = await this.calculateCompletionPercentage(profileId);
    
    // Calculate data quality score based on validation status
    const validationResult = await this.db.query(`
      SELECT 
        COUNT(*) as total_fields,
        COUNT(CASE WHEN validation_status = 'valid' THEN 1 END) as valid_fields,
        COUNT(CASE WHEN validation_status = 'needs_verification' THEN 1 END) as needs_verification
      FROM profile_field_validations 
      WHERE profile_id = $1
    `, [profileId]);

    let dataQualityScore = 50; // Base score
    
    if (validationResult.rows[0].total_fields > 0) {
      const validRatio = validationResult.rows[0].valid_fields / validationResult.rows[0].total_fields;
      dataQualityScore = Math.round(validRatio * 100);
    }

    // Determine verification status
    let verificationStatus = 'unverified';
    if (completionPercentage >= 80 && dataQualityScore >= 80) {
      verificationStatus = 'verified';
    } else if (completionPercentage >= 50 || dataQualityScore >= 60) {
      verificationStatus = 'partial';
    }

    await this.db.query(`
      UPDATE user_profiles 
      SET 
        data_quality_score = $1,
        verification_status = $2,
        last_interaction_date = NOW()
      WHERE id = $3
    `, [dataQualityScore, verificationStatus, profileId]);

    return { completionPercentage, dataQualityScore, verificationStatus };
  }

  /**
   * Get profile by phone number
   */
  async getProfileByPhone(phoneNumber) {
    const result = await this.db.query(`
      SELECT 
        u.*,
        p.*,
        u.id as user_id,
        p.id as profile_id
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE u.phone = $1 OR p.primary_phone = $1
    `, [phoneNumber]);

    return result.rows[0] || null;
  }

  /**
   * Get missing profile information
   */
  async getMissingProfileInfo(profileId) {
    const result = await this.db.query(
      'SELECT * FROM user_profiles WHERE id = $1',
      [profileId]
    );

    if (!result.rows[0]) return [];

    const profile = result.rows[0];
    const missing = [];

    const requiredFields = [
      { field: 'first_name', label: 'First Name' },
      { field: 'last_name', label: 'Last Name' },
      { field: 'date_of_birth', label: 'Date of Birth' },
      { field: 'street_address', label: 'Street Address' },
      { field: 'city', label: 'City' },
      { field: 'state', label: 'State' },
      { field: 'zip_code', label: 'ZIP Code' },
      { field: 'emergency_contact_1_name', label: 'Emergency Contact Name' },
      { field: 'emergency_contact_1_phone', label: 'Emergency Contact Phone' }
    ];

    requiredFields.forEach(({ field, label }) => {
      if (!profile[field] || !profile[field].toString().trim()) {
        missing.push({
          field,
          label,
          priority: 'high'
        });
      }
    });

    return missing;
  }

  /**
   * Generate next questions for SMS conversation
   */
  async generateNextQuestions(profileId, conversationStage = 'intake') {
    const missing = await this.getMissingProfileInfo(profileId);
    const questions = [];

    if (missing.length === 0) {
      return ["Thank you! Your profile is complete. Is there anything you'd like to update?"];
    }

    // Prioritize questions based on conversation stage
    switch (conversationStage) {
      case 'intake':
        if (missing.find(m => m.field === 'first_name')) {
          questions.push("What's your first name?");
        } else if (missing.find(m => m.field === 'last_name')) {
          questions.push("What's your last name?");
        } else if (missing.find(m => m.field === 'date_of_birth')) {
          questions.push("What's your date of birth? (MM/DD/YYYY)");
        }
        break;

      case 'address':
        if (missing.find(m => m.field === 'street_address')) {
          questions.push("What's your street address?");
        } else if (missing.find(m => m.field === 'city')) {
          questions.push("What city do you live in?");
        } else if (missing.find(m => m.field === 'zip_code')) {
          questions.push("What's your ZIP code?");
        }
        break;

      case 'emergency_contact':
        if (missing.find(m => m.field === 'emergency_contact_1_name')) {
          questions.push("Who should we contact in case of emergency?");
        } else if (missing.find(m => m.field === 'emergency_contact_1_phone')) {
          questions.push("What's their phone number?");
        }
        break;

      default:
        // Ask for the first missing high-priority item
        if (missing.length > 0) {
          const next = missing[0];
          questions.push(`Could you provide your ${next.label.toLowerCase()}?`);
        }
    }

    return questions.length > 0 ? questions : ["Thank you for the information!"];
  }
}

module.exports = ProfileService;
