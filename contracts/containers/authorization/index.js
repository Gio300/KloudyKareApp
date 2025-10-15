const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', contract: 'authorization_flow_v1' });
});

app.post('/execute', (req, res) => {
  res.json({
    success: true,
    contract: 'authorization_flow_v1',
    result: 'Authorization contract executed successfully'
  });
});

app.listen(PORT, () => {
  console.log(`Authorization contract container running on port ${PORT}`);
});
