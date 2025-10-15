/**
 * Knowledge Base Routes
 * API endpoints for managing knowledge base and RAG functionality
 */

const express = require('express');
const multer = require('multer');
const { body, query, validationResult } = require('express-validator');
const { requireFeature } = require('../config/flags');
const fs = require('fs-extra');
const path = require('path');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/kb/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.txt', '.docx', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, TXT, DOCX, MD'));
    }
  }
});

/**
 * GET /api/kb/search
 * Search knowledge base using semantic similarity
 */
router.get('/search',
  requireFeature('FEATURE_KB_RAG'),
  [
    query('q')
      .isLength({ min: 3, max: 500 })
      .withMessage('Query must be between 3 and 500 characters'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 20 })
      .withMessage('Limit must be between 1 and 20'),
    query('category')
      .optional()
      .isIn(['policy', 'workflow', 'faq', 'regulations', 'procedures'])
      .withMessage('Invalid category')
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

      const { q: query, limit = 6, category } = req.query;

      // Generate embedding for the query (mock implementation)
      const queryEmbedding = await generateEmbedding(query);

      // Build search query
      let searchQuery = `
        SELECT 
          id, title, content, tags, source_type, source_url,
          1 - (embedding <=> $1) as similarity_score
        FROM kb_documents 
        WHERE 1 - (embedding <=> $1) > 0.7
      `;
      
      const queryParams = [JSON.stringify(queryEmbedding)];
      let paramCount = 2;

      if (category) {
        searchQuery += ` AND source_type = $${paramCount}`;
        queryParams.push(category);
        paramCount++;
      }

      searchQuery += ` ORDER BY embedding <=> $1 LIMIT $${paramCount}`;
      queryParams.push(limit);

      const result = await req.db.query(searchQuery, queryParams);

      // Format results
      const documents = result.rows.map(row => ({
        id: row.id,
        title: row.title,
        content: row.content.length > 300 ? row.content.substring(0, 300) + '...' : row.content,
        tags: row.tags || [],
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        similarityScore: parseFloat(row.similarity_score).toFixed(3)
      }));

      req.logger.info('KB search performed', {
        query,
        resultsCount: documents.length,
        category
      });

      res.json({
        query,
        results: documents,
        totalResults: documents.length,
        searchTime: Date.now() - req.startTime || 0
      });

    } catch (error) {
      req.logger.error('KB search failed', {
        error: error.message,
        query: req.query.q
      });

      res.status(500).json({
        error: 'Search failed',
        message: 'Could not perform knowledge base search'
      });
    }
  }
);

/**
 * POST /api/kb/upload
 * Upload and process documents for knowledge base
 */
router.post('/upload',
  requireFeature('FEATURE_KB_RAG'),
  upload.single('document'),
  [
    body('title')
      .isLength({ min: 1, max: 500 })
      .withMessage('Title is required and must be under 500 characters'),
    body('category')
      .isIn(['policy', 'workflow', 'faq', 'regulations', 'procedures'])
      .withMessage('Valid category is required'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array')
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

      if (!req.file) {
        return res.status(400).json({
          error: 'Document file is required'
        });
      }

      const { title, category, tags = [] } = req.body;
      const file = req.file;

      // Extract text from uploaded file
      const extractedText = await extractTextFromFile(file);

      if (!extractedText || extractedText.length < 50) {
        return res.status(400).json({
          error: 'Could not extract sufficient text from document'
        });
      }

      // Generate embedding for the document
      const embedding = await generateEmbedding(extractedText);

      // Store in database
      const result = await req.db.query(`
        INSERT INTO kb_documents (
          id, title, content, tags, source_type, source_url, embedding
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6
        ) RETURNING id, title, source_type
      `, [
        title,
        extractedText,
        tags,
        category,
        file.originalname,
        JSON.stringify(embedding)
      ]);

      // Clean up uploaded file
      await fs.remove(file.path);

      req.logger.info('Document uploaded to KB', {
        documentId: result.rows[0].id,
        title,
        category,
        contentLength: extractedText.length
      });

      res.json({
        success: true,
        document: result.rows[0],
        contentLength: extractedText.length,
        embeddingGenerated: true
      });

    } catch (error) {
      // Clean up file on error
      if (req.file) {
        await fs.remove(req.file.path).catch(() => {});
      }

      req.logger.error('Document upload failed', {
        error: error.message,
        filename: req.file?.originalname
      });

      res.status(500).json({
        error: 'Document upload failed',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/kb/documents
 * List knowledge base documents
 */
router.get('/documents',
  requireFeature('FEATURE_KB_RAG'),
  [
    query('category')
      .optional()
      .isIn(['policy', 'workflow', 'faq', 'regulations', 'procedures'])
      .withMessage('Invalid category'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be non-negative')
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

      const { category, limit = 20, offset = 0 } = req.query;

      let query = `
        SELECT 
          id, title, tags, source_type, source_url, 
          LENGTH(content) as content_length,
          created_at, updated_at
        FROM kb_documents
      `;
      
      const queryParams = [];
      let paramCount = 1;

      if (category) {
        query += ` WHERE source_type = $${paramCount}`;
        queryParams.push(category);
        paramCount++;
      }

      query += ` ORDER BY updated_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      queryParams.push(limit, offset);

      const result = await req.db.query(query, queryParams);

      // Get total count
      let countQuery = 'SELECT COUNT(*) FROM kb_documents';
      const countParams = [];
      
      if (category) {
        countQuery += ' WHERE source_type = $1';
        countParams.push(category);
      }

      const countResult = await req.db.query(countQuery, countParams);
      const totalCount = parseInt(countResult.rows[0].count);

      res.json({
        documents: result.rows,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: totalCount,
          hasMore: (parseInt(offset) + parseInt(limit)) < totalCount
        }
      });

    } catch (error) {
      req.logger.error('Failed to list KB documents', {
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to retrieve documents'
      });
    }
  }
);

/**
 * DELETE /api/kb/documents/:id
 * Delete a knowledge base document
 */
router.delete('/documents/:id',
  requireFeature('FEATURE_KB_RAG'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await req.db.query(
        'DELETE FROM kb_documents WHERE id = $1 RETURNING title',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Document not found'
        });
      }

      req.logger.info('KB document deleted', {
        documentId: id,
        title: result.rows[0].title
      });

      res.json({
        success: true,
        deletedDocument: result.rows[0]
      });

    } catch (error) {
      req.logger.error('Failed to delete KB document', {
        error: error.message,
        documentId: req.params.id
      });

      res.status(500).json({
        error: 'Failed to delete document'
      });
    }
  }
);

/**
 * Extract text from uploaded file
 */
async function extractTextFromFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  
  try {
    switch (ext) {
      case '.txt':
      case '.md':
        return await fs.readFile(file.path, 'utf8');
      
      case '.pdf':
        // Would integrate with PDF parsing library
        return await fs.readFile(file.path, 'utf8'); // Placeholder
      
      case '.docx':
        // Would integrate with DOCX parsing library
        return await fs.readFile(file.path, 'utf8'); // Placeholder
      
      default:
        throw new Error('Unsupported file type');
    }
  } catch (error) {
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}

/**
 * Generate embedding for text (mock implementation)
 */
async function generateEmbedding(text) {
  // This would integrate with your embedding service
  // For now, return a mock embedding vector
  return new Array(1536).fill(0).map(() => Math.random() - 0.5);
}

module.exports = router;
