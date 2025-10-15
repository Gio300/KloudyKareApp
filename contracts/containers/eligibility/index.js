const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', contract: 'eligibility_intake_v1' });
});

app.post('/execute', (req, res) => {
  // Mock eligibility contract execution
  res.json({
    success: true,
    contract: 'eligibility_intake_v1',
    result: 'Contract executed successfully'
  });
});

app.listen(PORT, () => {
  console.log(`Eligibility contract container running on port ${PORT}`);
});
