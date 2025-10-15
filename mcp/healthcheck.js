/**
 * Health Check Script for MCP Container
 * Used by Docker HEALTHCHECK to verify MCP service is running properly
 */

const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 8080,
  path: '/health',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  if (res.statusCode === 200) {
    console.log('MCP health check passed');
    process.exit(0);
  } else {
    console.log(`MCP health check failed with status: ${res.statusCode}`);
    process.exit(1);
  }
});

req.on('error', (err) => {
  console.log(`MCP health check failed with error: ${err.message}`);
  process.exit(1);
});

req.on('timeout', () => {
  console.log('MCP health check timed out');
  req.destroy();
  process.exit(1);
});

req.end();
