/**
 * Billing and Invoice Management Routes
 * Handles billing calculations, invoice generation, and payment processing
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { requireFeature } = require('../config/flags');

const router = express.Router();

/**
 * POST /api/billing/calculate
 * Calculate billing for visits and services
 */
router.post('/calculate',
  requireFeature('FEATURE_BILLING_DRAFTS'),
  [
    body('clientId')
      .isUUID()
      .withMessage('Valid client ID is required'),
    body('billingPeriod')
      .isObject()
      .withMessage('Billing period is required'),
    body('billingPeriod.startDate')
      .isISO8601()
      .withMessage('Valid start date is required'),
    body('billingPeriod.endDate')
      .isISO8601()
      .withMessage('Valid end date is required')
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

      const { clientId, billingPeriod, rateOverride } = req.body;

      // Get client information and eligibility
      const clientResult = await req.db.query(`
        SELECT 
          up.*,
          c.eligibility_status,
          c.eligibility_data
        FROM user_profiles up
        LEFT JOIN clients c ON up.user_id = c.id
        WHERE up.user_id = $1
      `, [clientId]);

      if (clientResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Client not found'
        });
      }

      const client = clientResult.rows[0];

      // Get visits for the billing period
      const visitsResult = await req.db.query(`
        SELECT *
        FROM visits
        WHERE client_id = $1
          AND visit_date >= $2
          AND visit_date <= $3
          AND status = 'approved'
        ORDER BY visit_date, start_time
      `, [clientId, billingPeriod.startDate, billingPeriod.endDate]);

      const visits = visitsResult.rows;

      if (visits.length === 0) {
        return res.json({
          success: true,
          billingSummary: {
            clientId,
            billingPeriod,
            totalAmount: 0,
            billableHours: 0,
            visitCount: 0,
            message: 'No billable visits found for this period'
          }
        });
      }

      // Calculate billing using the billing rules
      const billingCalculation = await calculateBilling({
        client,
        visits,
        billingPeriod,
        rateOverride,
        db: req.db,
        logger: req.logger
      });

      req.logger.info('Billing calculated', {
        clientId,
        billingPeriod,
        totalAmount: billingCalculation.totalAmount,
        visitCount: visits.length
      });

      res.json({
        success: true,
        billingSummary: billingCalculation,
        calculatedAt: new Date().toISOString()
      });

    } catch (error) {
      req.logger.error('Billing calculation failed', {
        error: error.message,
        clientId: req.body.clientId
      });

      res.status(500).json({
        error: 'Billing calculation failed',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/billing/generate-invoice
 * Generate PDF invoice for billing period
 */
router.post('/generate-invoice',
  requireFeature('FEATURE_BILLING_DRAFTS'),
  [
    body('billingData')
      .isObject()
      .withMessage('Billing data is required'),
    body('template')
      .optional()
      .isIn(['standard', 'detailed', 'medicaid'])
      .withMessage('Invalid template type')
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

      const { billingData, template = 'standard', includeAttachments = false } = req.body;

      // Generate PDF invoice
      const invoiceResult = await generatePDFInvoice({
        billingData,
        template,
        includeAttachments,
        logger: req.logger
      });

      if (!invoiceResult.success) {
        return res.status(500).json({
          error: 'Invoice generation failed',
          message: invoiceResult.error
        });
      }

      // Store invoice record in database
      const invoiceRecord = await req.db.query(`
        INSERT INTO invoices (
          id, client_id, billing_period_start, billing_period_end,
          total_amount, pdf_path, status, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, 'generated', NOW()
        ) RETURNING id, pdf_path
      `, [
        billingData.clientId,
        billingData.billingPeriod.startDate,
        billingData.billingPeriod.endDate,
        billingData.totalAmount,
        invoiceResult.pdfPath
      ]);

      req.logger.info('Invoice generated', {
        invoiceId: invoiceRecord.rows[0].id,
        clientId: billingData.clientId,
        totalAmount: billingData.totalAmount
      });

      res.json({
        success: true,
        invoiceId: invoiceRecord.rows[0].id,
        pdfPath: invoiceResult.pdfPath,
        downloadUrl: `/api/billing/download-invoice/${invoiceRecord.rows[0].id}`,
        generatedAt: new Date().toISOString()
      });

    } catch (error) {
      req.logger.error('Invoice generation failed', {
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to generate invoice',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/billing/download-invoice/:invoiceId
 * Download generated invoice PDF
 */
router.get('/download-invoice/:invoiceId',
  requireFeature('FEATURE_BILLING_DRAFTS'),
  [
    param('invoiceId')
      .isUUID()
      .withMessage('Valid invoice ID is required')
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

      const { invoiceId } = req.params;

      // Get invoice record
      const invoiceResult = await req.db.query(
        'SELECT pdf_path, client_id, total_amount FROM invoices WHERE id = $1',
        [invoiceId]
      );

      if (invoiceResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Invoice not found'
        });
      }

      const invoice = invoiceResult.rows[0];
      const fs = require('fs');
      const path = require('path');

      // Check if PDF file exists
      const pdfPath = path.join(__dirname, '../../../', invoice.pdf_path);
      if (!fs.existsSync(pdfPath)) {
        return res.status(404).json({
          error: 'Invoice PDF not found'
        });
      }

      // Set headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice_${invoiceId}.pdf"`);

      // Stream PDF file
      const fileStream = fs.createReadStream(pdfPath);
      fileStream.pipe(res);

      req.logger.info('Invoice downloaded', {
        invoiceId,
        clientId: invoice.client_id
      });

    } catch (error) {
      req.logger.error('Invoice download failed', {
        error: error.message,
        invoiceId: req.params.invoiceId
      });

      res.status(500).json({
        error: 'Failed to download invoice',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/billing/invoices
 * List invoices with filtering and pagination
 */
router.get('/invoices',
  requireFeature('FEATURE_BILLING_DRAFTS'),
  [
    query('clientId')
      .optional()
      .isUUID()
      .withMessage('Invalid client ID'),
    query('status')
      .optional()
      .isIn(['generated', 'sent', 'paid', 'overdue', 'cancelled'])
      .withMessage('Invalid status'),
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

      const { clientId, status, limit = 20, offset = 0 } = req.query;

      // Build query
      let query = `
        SELECT 
          i.id, i.client_id, i.billing_period_start, i.billing_period_end,
          i.total_amount, i.status, i.created_at,
          up.first_name, up.last_name
        FROM invoices i
        LEFT JOIN user_profiles up ON i.client_id = up.user_id
        WHERE 1=1
      `;
      
      const queryParams = [];
      let paramCount = 1;

      if (clientId) {
        query += ` AND i.client_id = $${paramCount}`;
        queryParams.push(clientId);
        paramCount++;
      }

      if (status) {
        query += ` AND i.status = $${paramCount}`;
        queryParams.push(status);
        paramCount++;
      }

      query += ` ORDER BY i.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      queryParams.push(limit, offset);

      const result = await req.db.query(query, queryParams);

      // Get total count
      let countQuery = 'SELECT COUNT(*) FROM invoices WHERE 1=1';
      const countParams = [];
      let countParamCount = 1;

      if (clientId) {
        countQuery += ` AND client_id = $${countParamCount}`;
        countParams.push(clientId);
        countParamCount++;
      }

      if (status) {
        countQuery += ` AND status = $${countParamCount}`;
        countParams.push(status);
      }

      const countResult = await req.db.query(countQuery, countParams);
      const totalCount = parseInt(countResult.rows[0].count);

      const invoices = result.rows.map(row => ({
        id: row.id,
        clientId: row.client_id,
        clientName: `${row.first_name} ${row.last_name}`,
        billingPeriod: {
          startDate: row.billing_period_start,
          endDate: row.billing_period_end
        },
        totalAmount: parseFloat(row.total_amount),
        status: row.status,
        createdAt: row.created_at,
        downloadUrl: `/api/billing/download-invoice/${row.id}`
      }));

      res.json({
        invoices,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: totalCount,
          hasMore: (parseInt(offset) + parseInt(limit)) < totalCount
        }
      });

    } catch (error) {
      req.logger.error('Invoice list retrieval failed', {
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to retrieve invoices'
      });
    }
  }
);

/**
 * Calculate billing based on visits and rates
 */
async function calculateBilling({ client, visits, billingPeriod, rateOverride, db, logger }) {
  try {
    // Get rate schedule based on client's payer
    const eligibilityData = client.eligibility_data || {};
    const payer = eligibilityData.payer || 'private_pay';
    
    // Default rate schedules
    const rateSchedules = {
      nevada_medicaid_pcs: {
        baseRate: 18.50,
        overtimeMultiplier: 1.5,
        holidayMultiplier: 2.0,
        minimumVisitHours: 1.0,
        maximumDailyHours: 8.0
      },
      private_pay: {
        baseRate: 25.00,
        overtimeMultiplier: 1.5,
        holidayMultiplier: 1.5,
        minimumVisitHours: 2.0,
        maximumDailyHours: 12.0
      }
    };

    const rateSchedule = rateSchedules[payer] || rateSchedules.private_pay;
    const effectiveRate = rateOverride?.baseRate || rateSchedule.baseRate;

    let totalAmount = 0;
    let totalHours = 0;
    const serviceBreakdown = [];
    const adjustments = [];

    // Process each visit
    for (const visit of visits) {
      const startTime = new Date(visit.start_time);
      const endTime = new Date(visit.end_time);
      const visitHours = (endTime - startTime) / (1000 * 60 * 60); // Convert to hours

      // Apply minimum visit hours
      const billableHours = Math.max(visitHours, rateSchedule.minimumVisitHours);
      
      // Calculate base amount
      let visitAmount = billableHours * effectiveRate;

      // Check for holiday rates (simplified)
      const visitDate = new Date(visit.visit_date);
      const isHoliday = isHolidayDate(visitDate);
      if (isHoliday) {
        visitAmount *= rateSchedule.holidayMultiplier;
        adjustments.push({
          type: 'holiday_rate',
          description: 'Holiday rate applied',
          amount: visitAmount - (billableHours * effectiveRate),
          visitId: visit.id
        });
      }

      totalAmount += visitAmount;
      totalHours += billableHours;

      serviceBreakdown.push({
        visitId: visit.id,
        visitDate: visit.visit_date,
        hours: billableHours,
        rate: effectiveRate,
        amount: visitAmount,
        services: visit.services || []
      });
    }

    // Apply any additional adjustments
    // Travel time, mileage, etc. would be calculated here

    // Calculate tax (if applicable)
    const taxRate = 0.0; // Nevada typically doesn't tax healthcare services
    const taxAmount = totalAmount * taxRate;
    const netAmount = totalAmount + taxAmount;

    return {
      clientId: client.user_id,
      clientName: `${client.first_name} ${client.last_name}`,
      billingPeriod,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      billableHours: parseFloat(totalHours.toFixed(2)),
      ratePerHour: effectiveRate,
      serviceBreakdown,
      adjustments,
      taxAmount: parseFloat(taxAmount.toFixed(2)),
      netAmount: parseFloat(netAmount.toFixed(2)),
      visitCount: visits.length,
      rateDetails: {
        baseRate: effectiveRate,
        schedule: payer,
        modifiers: rateOverride ? ['custom_rate'] : []
      }
    };

  } catch (error) {
    logger.error('Billing calculation error', { error: error.message });
    throw error;
  }
}

/**
 * Generate PDF invoice (mock implementation)
 */
async function generatePDFInvoice({ billingData, template, includeAttachments, logger }) {
  try {
    // This would integrate with PDF generation library (pdf-lib, puppeteer, etc.)
    const invoiceId = require('uuid').v4();
    const pdfPath = `uploads/invoices/${invoiceId}.pdf`;
    
    // Mock PDF generation
    logger.info('PDF invoice generated', { 
      invoiceId, 
      pdfPath, 
      template,
      totalAmount: billingData.totalAmount 
    });
    
    return {
      success: true,
      pdfPath,
      invoiceId
    };
  } catch (error) {
    logger.error('PDF invoice generation failed', { error: error.message });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check if date is a holiday (simplified implementation)
 */
function isHolidayDate(date) {
  const holidays = [
    '01-01', // New Year's Day
    '07-04', // Independence Day
    '12-25'  // Christmas Day
  ];
  
  const monthDay = `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  return holidays.includes(monthDay);
}

module.exports = router;
