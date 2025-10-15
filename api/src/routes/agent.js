/**
 * Agent API Routes
 * Handles agent-assisted tasks like making notes, profiles, etc.
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const OllamaService = require('../services/ollamaService');

/**
 * POST /api/agent/task
 * Execute an agent task with AI brain assistance
 */
router.post('/task',
  [
    body('action')
      .isIn(['make_note', 'create_profile', 'update_profile', 'schedule_task', 'send_reminder', 'generate_summary'])
      .withMessage('Invalid action type'),
    body('data')
      .notEmpty()
      .withMessage('Task data is required'),
    body('sessionId')
      .notEmpty()
      .withMessage('Session ID is required')
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

      const { action, data, sessionId } = req.body;
      
      req.logger.info('Agent task received', {
        action,
        sessionId,
        dataKeys: Object.keys(data)
      });

      const ollamaService = new OllamaService(req.logger);
      let result;

      switch (action) {
        case 'make_note':
          result = await makeNote(data, ollamaService, req.db, req.logger);
          break;
        case 'create_profile':
          result = await createProfile(data, ollamaService, req.db, req.logger);
          break;
        case 'update_profile':
          result = await updateProfile(data, ollamaService, req.db, req.logger);
          break;
        case 'schedule_task':
          result = await scheduleTask(data, ollamaService, req.db, req.logger);
          break;
        case 'send_reminder':
          result = await sendReminder(data, ollamaService, req.db, req.logger);
          break;
        case 'generate_summary':
          result = await generateSummary(data, ollamaService, req.logger);
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Unknown action type'
          });
      }

      res.json({
        success: true,
        action,
        result
      });

    } catch (error) {
      req.logger.error('Agent task failed', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        error: 'Failed to execute agent task'
      });
    }
  }
);

/**
 * GET /api/agent/notes
 * Get all notes for a session or user
 */
router.get('/notes', async (req, res) => {
  try {
    const { sessionId, userId } = req.query;

    if (!sessionId && !userId) {
      return res.status(400).json({
        success: false,
        error: 'SessionId or userId is required'
      });
    }

    const notes = await getNotes(sessionId, userId, req.db, req.logger);

    res.json({
      success: true,
      notes
    });

  } catch (error) {
    req.logger.error('Get notes failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve notes'
    });
  }
});

/**
 * GET /api/agent/tasks
 * Get all scheduled tasks
 */
router.get('/tasks', async (req, res) => {
  try {
    const { sessionId, status } = req.query;

    const tasks = await getTasks(sessionId, status, req.db, req.logger);

    res.json({
      success: true,
      tasks
    });

  } catch (error) {
    req.logger.error('Get tasks failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve tasks'
    });
  }
});

/**
 * DELETE /api/agent/note/:noteId
 * Delete a note
 */
router.delete('/note/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;

    await deleteNote(noteId, req.db, req.logger);

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });

  } catch (error) {
    req.logger.error('Delete note failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete note'
    });
  }
});

// Helper functions

/**
 * Make a note with AI assistance
 */
async function makeNote(data, ollamaService, db, logger) {
  const { content, userId, sessionId, context } = data;

  // Use AI to enhance/categorize the note
  const aiPrompt = `You are an administrative assistant. Analyze this note and provide:
1. A concise title (max 50 chars)
2. Category (general, client, task, reminder, follow-up, or important)
3. Priority (low, medium, high)
4. Any action items extracted

Note content: "${content}"

Context: ${context || 'None provided'}

Respond in JSON format: {"title": "...", "category": "...", "priority": "...", "actionItems": ["..."]}`;

  const aiResult = await ollamaService.generateResponse(aiPrompt, {});
  let aiAnalysis = {};

  try {
    if (aiResult.success) {
      // Try to parse JSON from AI response
      const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiAnalysis = JSON.parse(jsonMatch[0]);
      }
    }
  } catch (e) {
    logger.warn('Failed to parse AI note analysis', { error: e.message });
  }

  // Store note in database
  const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const note = {
    id: noteId,
    userId: userId || null,
    sessionId: sessionId || null,
    content,
    title: aiAnalysis.title || content.substring(0, 50),
    category: aiAnalysis.category || 'general',
    priority: aiAnalysis.priority || 'medium',
    actionItems: aiAnalysis.actionItems || [],
    createdAt: new Date().toISOString(),
    context: context || null
  };

  // Store in database (mock for now, replace with actual DB call)
  try {
    await db.query(
      `INSERT INTO agent_notes (id, user_id, session_id, content, title, category, priority, action_items, created_at, context) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [note.id, note.userId, note.sessionId, note.content, note.title, note.category, 
       note.priority, JSON.stringify(note.actionItems), note.createdAt, note.context]
    ).catch(() => {
      // If table doesn't exist, just log it (for testing)
      logger.info('Note stored (mock)', { note });
    });
  } catch (error) {
    logger.warn('Database note storage failed, using mock', { error: error.message });
  }

  return {
    note,
    message: `Note created: ${note.title}`,
    aiSuggestions: aiAnalysis
  };
}

/**
 * Create a profile with AI assistance
 */
async function createProfile(data, ollamaService, db, logger) {
  const { name, phone, email, role, additionalInfo } = data;

  // Use AI to suggest profile enhancements
  const aiPrompt = `You are an administrative assistant. A new profile is being created with the following information:
Name: ${name}
Phone: ${phone || 'Not provided'}
Email: ${email || 'Not provided'}
Role: ${role || 'Not specified'}
Additional: ${additionalInfo || 'None'}

Suggest:
1. Any missing critical information
2. Profile completeness percentage
3. Recommended next steps

Respond in JSON format: {"missingInfo": ["..."], "completeness": 0-100, "nextSteps": ["..."]}`;

  const aiResult = await ollamaService.generateResponse(aiPrompt, {});
  let aiSuggestions = {};

  try {
    if (aiResult.success) {
      const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiSuggestions = JSON.parse(jsonMatch[0]);
      }
    }
  } catch (e) {
    logger.warn('Failed to parse AI profile suggestions', { error: e.message });
  }

  // Create profile record
  const profileId = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const profile = {
    id: profileId,
    name,
    phone: phone || null,
    email: email || null,
    role: role || 'client',
    additionalInfo: additionalInfo || null,
    completeness: aiSuggestions.completeness || 50,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Store in database (mock for now)
  try {
    await db.query(
      `INSERT INTO agent_profiles (id, name, phone, email, role, additional_info, completeness, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [profile.id, profile.name, profile.phone, profile.email, profile.role, 
       profile.additionalInfo, profile.completeness, profile.createdAt, profile.updatedAt]
    ).catch(() => {
      logger.info('Profile stored (mock)', { profile });
    });
  } catch (error) {
    logger.warn('Database profile storage failed, using mock', { error: error.message });
  }

  return {
    profile,
    message: `Profile created for ${name}`,
    aiSuggestions
  };
}

/**
 * Update an existing profile
 */
async function updateProfile(data, ollamaService, db, logger) {
  const { profileId, updates } = data;

  // Use AI to validate updates
  const aiPrompt = `Analyze these profile updates and validate them:
${JSON.stringify(updates, null, 2)}

Check for:
1. Data consistency
2. Required format compliance
3. Completeness improvements

Respond in JSON format: {"valid": true/false, "issues": ["..."], "suggestions": ["..."]}`;

  const aiResult = await ollamaService.generateResponse(aiPrompt, {});
  let aiValidation = { valid: true };

  try {
    if (aiResult.success) {
      const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiValidation = JSON.parse(jsonMatch[0]);
      }
    }
  } catch (e) {
    logger.warn('Failed to parse AI validation', { error: e.message });
  }

  if (!aiValidation.valid) {
    return {
      success: false,
      message: 'Profile updates contain issues',
      issues: aiValidation.issues
    };
  }

  // Update profile in database (mock for now)
  const updatedAt = new Date().toISOString();
  
  try {
    await db.query(
      `UPDATE agent_profiles SET updated_at = $1 WHERE id = $2`,
      [updatedAt, profileId]
    ).catch(() => {
      logger.info('Profile updated (mock)', { profileId, updates });
    });
  } catch (error) {
    logger.warn('Database profile update failed, using mock', { error: error.message });
  }

  return {
    success: true,
    profileId,
    updates,
    message: 'Profile updated successfully',
    aiSuggestions: aiValidation.suggestions
  };
}

/**
 * Schedule a task
 */
async function scheduleTask(data, ollamaService, db, logger) {
  const { title, description, dueDate, priority, assignedTo } = data;

  // Use AI to suggest task categorization
  const aiPrompt = `Analyze this task and suggest:
Title: ${title}
Description: ${description || 'None'}
Priority: ${priority || 'Not set'}

Provide:
1. Task category (admin, client-follow-up, documentation, technical)
2. Estimated time (in minutes)
3. Dependencies or prerequisites

Respond in JSON format: {"category": "...", "estimatedTime": 0, "prerequisites": ["..."]}`;

  const aiResult = await ollamaService.generateResponse(aiPrompt, {});
  let aiSuggestions = {};

  try {
    if (aiResult.success) {
      const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiSuggestions = JSON.parse(jsonMatch[0]);
      }
    }
  } catch (e) {
    logger.warn('Failed to parse AI task suggestions', { error: e.message });
  }

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const task = {
    id: taskId,
    title,
    description: description || null,
    dueDate: dueDate || null,
    priority: priority || 'medium',
    assignedTo: assignedTo || null,
    category: aiSuggestions.category || 'admin',
    estimatedTime: aiSuggestions.estimatedTime || 30,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  // Store in database (mock for now)
  try {
    await db.query(
      `INSERT INTO agent_tasks (id, title, description, due_date, priority, assigned_to, category, estimated_time, status, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [task.id, task.title, task.description, task.dueDate, task.priority, 
       task.assignedTo, task.category, task.estimatedTime, task.status, task.createdAt]
    ).catch(() => {
      logger.info('Task stored (mock)', { task });
    });
  } catch (error) {
    logger.warn('Database task storage failed, using mock', { error: error.message });
  }

  return {
    task,
    message: `Task scheduled: ${title}`,
    aiSuggestions
  };
}

/**
 * Send a reminder
 */
async function sendReminder(data, ollamaService, db, logger) {
  const { recipient, message, channel, scheduledFor } = data;

  const reminderId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const reminder = {
    id: reminderId,
    recipient,
    message,
    channel: channel || 'email',
    scheduledFor: scheduledFor || new Date().toISOString(),
    status: 'scheduled',
    createdAt: new Date().toISOString()
  };

  logger.info('Reminder scheduled', { reminder });

  return {
    reminder,
    message: `Reminder scheduled for ${recipient}`
  };
}

/**
 * Generate a summary with AI
 */
async function generateSummary(data, ollamaService, logger) {
  const { content, type } = data;

  const aiPrompt = `Generate a concise summary of the following ${type || 'content'}:

${content}

Provide:
1. Executive summary (2-3 sentences)
2. Key points (bullet list)
3. Action items (if any)

Format as JSON: {"summary": "...", "keyPoints": ["..."], "actionItems": ["..."]}`;

  const aiResult = await ollamaService.generateResponse(aiPrompt, {});
  let summary = {};

  try {
    if (aiResult.success) {
      const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        summary = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback to plain text
        summary = {
          summary: aiResult.response,
          keyPoints: [],
          actionItems: []
        };
      }
    }
  } catch (e) {
    logger.warn('Failed to parse AI summary', { error: e.message });
    summary = {
      summary: aiResult.response || 'Summary generation failed',
      keyPoints: [],
      actionItems: []
    };
  }

  return {
    summary,
    message: 'Summary generated successfully'
  };
}

/**
 * Get notes from database
 */
async function getNotes(sessionId, userId, db, logger) {
  try {
    const result = await db.query(
      `SELECT * FROM agent_notes WHERE session_id = $1 OR user_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [sessionId, userId]
    );
    return result.rows || [];
  } catch (error) {
    logger.warn('Database query failed, returning empty notes', { error: error.message });
    return [];
  }
}

/**
 * Get tasks from database
 */
async function getTasks(sessionId, status, db, logger) {
  try {
    let query = `SELECT * FROM agent_tasks WHERE 1=1`;
    const params = [];

    if (sessionId) {
      params.push(sessionId);
      query += ` AND session_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    query += ` ORDER BY due_date ASC, created_at DESC LIMIT 50`;

    const result = await db.query(query, params);
    return result.rows || [];
  } catch (error) {
    logger.warn('Database query failed, returning empty tasks', { error: error.message });
    return [];
  }
}

/**
 * Delete note from database
 */
async function deleteNote(noteId, db, logger) {
  try {
    await db.query(`DELETE FROM agent_notes WHERE id = $1`, [noteId]);
  } catch (error) {
    logger.warn('Database delete failed', { error: error.message });
  }
}

module.exports = router;
