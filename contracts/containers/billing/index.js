const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', contract: 'billing_rules_v1' });
});

app.post('/execute', (req, res) => {
  res.json({
    success: true,
    contract: 'billing_rules_v1',
    result: 'Billing contract executed successfully'
  });
});

app.listen(PORT, () => {
  console.log(`Billing contract container running on port ${PORT}`);
});
