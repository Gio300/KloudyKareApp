const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', contract: 'sandata_sync_v1' });
});

app.post('/execute', (req, res) => {
  res.json({
    success: true,
    contract: 'sandata_sync_v1',
    result: 'Sandata contract executed successfully'
  });
});

app.listen(PORT, () => {
  console.log(`Sandata contract container running on port ${PORT}`);
});
