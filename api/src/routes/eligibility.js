const express = require('express');
const router = express.Router();

// Ensure table exists helper
async function ensureEligibilityTable(db) {
  const createSql = `
    CREATE TABLE IF NOT EXISTS profile_eligibility (
      phone TEXT PRIMARY KEY,
      eligibility_type TEXT, -- fee_for_service | mco
      mco_name TEXT,
      has_transportation INTEGER, -- 0/1
      transportation_provider TEXT,
      intake_source TEXT, -- sms | voice | web
      eligibility_notes TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `;
  await db.query(createSql, []);
}

// Upsert eligibility
router.post('/upsert', async (req, res) => {
  try {
    const {
      phone,
      eligibility_type,
      mco_name,
      has_transportation,
      transportation_provider,
      intake_source = 'voice',
      eligibility_notes
    } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    await ensureEligibilityTable(req.db);

    // INSERT OR REPLACE (SQLite upsert by PRIMARY KEY)
    const sql = `
      INSERT OR REPLACE INTO profile_eligibility (
        phone, eligibility_type, mco_name, has_transportation, transportation_provider, intake_source, eligibility_notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'));
    `;
    await req.db.query(sql, [
      phone,
      eligibility_type || null,
      mco_name || null,
      has_transportation ? 1 : 0,
      transportation_provider || null,
      intake_source,
      eligibility_notes || null,
    ]);

    res.json({ success: true });
  } catch (error) {
    req.logger && req.logger.error('eligibility upsert failed', { error: error.message });
    res.status(500).json({ error: 'failed to upsert eligibility' });
  }
});

// Get by phone
router.get('/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    await ensureEligibilityTable(req.db);
    const rows = await req.db.query('SELECT * FROM profile_eligibility WHERE phone = ?;', [phone]);
    res.json((rows && rows.rows && rows.rows[0]) || null);
  } catch (error) {
    req.logger && req.logger.error('eligibility get failed', { error: error.message });
    res.status(500).json({ error: 'failed to get eligibility' });
  }
});

module.exports = router;


