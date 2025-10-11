/**
 * Production SSH Terminal Server for kloudykare.com
 * Enhanced security and production features
 */

const express = require('express');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
        },
    },
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP',
        retryAfter: '15 minutes'
    }
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// CORS headers for production
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://ssh.kloudykare.com');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// No-cache for HTML
app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path === '/') {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
    }
    next();
});

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const ip = req.ip || req.connection.remoteAddress;
    console.log(`[${timestamp}] ${req.method} ${req.url} - ${ip}`);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'KloudyKare SSH Terminal',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'production'
    });
});

// SSH Terminal Management for kloudykare.com
app.get('/api/ssh/status', async (req, res) => {
    try {
        // Test SSH connection to kloudykare.com
        exec('ssh -o ConnectTimeout=10 -o BatchMode=yes -i /home/kloudykare/.ssh/KloudyKare kloudykare@kloudykare.com "echo SSH_TEST_SUCCESS"', 
            (sshError, sshStdout, sshStderr) => {
                res.json({
                    sshAvailable: !sshError,
                    sshTest: sshError ? sshError.message : 'SSH connection to kloudykare.com successful',
                    sshOutput: sshStdout ? sshStdout.trim() : '',
                    sshError: sshStderr ? sshStderr.trim() : '',
                    host: 'kloudykare.com',
                    username: 'kloudykare',
                    keyPath: '/home/kloudykare/.ssh/KloudyKare',
                    timestamp: new Date().toISOString()
                });
            });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Execute SSH command on kloudykare.com
app.post('/api/ssh/execute', async (req, res) => {
    try {
        const { command } = req.body;
        
        if (!command) {
            return res.status(400).json({ error: 'Command is required' });
        }

        // Security: Sanitize command input
        const sanitizedCommand = command.replace(/[;&|`$(){}[\]\\]/g, '');
        
        if (sanitizedCommand !== command) {
            return res.status(400).json({ 
                error: 'Command contains invalid characters',
                sanitized: sanitizedCommand
            });
        }

        // Security: Block dangerous commands
        const dangerousCommands = ['rm -rf', 'mkfs', 'dd if=', 'shutdown', 'reboot', 'halt', 'init 0', 'init 6'];
        const isDangerous = dangerousCommands.some(dangerous => 
            command.toLowerCase().includes(dangerous.toLowerCase())
        );
        
        if (isDangerous) {
            return res.status(403).json({ 
                error: 'Command blocked for security reasons',
                command: command
            });
        }

        exec(`ssh -o ConnectTimeout=10 -o BatchMode=yes -i /home/kloudykare/.ssh/KloudyKare kloudykare@kloudykare.com "${sanitizedCommand.replace(/"/g, '\\"')}"`, 
            { timeout: 30000 }, 
            (error, stdout, stderr) => {
                res.json({
                    success: !error,
                    command: sanitizedCommand,
                    exitCode: error ? error.code : 0,
                    stdout: stdout || '',
                    stderr: stderr || '',
                    error: error ? error.message : null,
                    host: 'kloudykare.com',
                    timestamp: new Date().toISOString()
                });
            }
        );
    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get kloudykare.com server status
app.get('/api/ssh/kloudy/status', async (req, res) => {
    try {
        exec('ssh -o ConnectTimeout=10 -o BatchMode=yes -i /home/kloudykare/.ssh/KloudyKare kloudykare@kloudykare.com "uptime && df -h && free -m"', 
            { timeout: 15000 }, 
            (error, stdout, stderr) => {
                res.json({
                    success: !error,
                    status: stdout || '',
                    error: error ? error.message : null,
                    host: 'kloudykare.com',
                    timestamp: new Date().toISOString()
                });
            }
        );
    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// List files on kloudykare.com server
app.get('/api/ssh/kloudy/files', async (req, res) => {
    try {
        const { path = '.' } = req.query;
        
        // Security: Sanitize path input
        const sanitizedPath = path.replace(/[;&|`$(){}[\]\\]/g, '');
        
        exec(`ssh -o ConnectTimeout=10 -o BatchMode=yes -i /home/kloudykare/.ssh/KloudyKare kloudykare@kloudykare.com "ls -la ${sanitizedPath}"`, 
            { timeout: 15000 }, 
            (error, stdout, stderr) => {
                res.json({
                    success: !error,
                    path: sanitizedPath,
                    files: stdout || '',
                    error: error ? error.message : null,
                    host: 'kloudykare.com',
                    timestamp: new Date().toISOString()
                });
            }
        );
    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Serve main pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'ssh-terminal.html'));
});

app.get('/ssh-terminal.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'ssh-terminal.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        method: req.method,
        path: req.originalUrl,
        availableEndpoints: [
            'GET /health',
            'GET /api/ssh/status',
            'POST /api/ssh/execute',
            'GET /api/ssh/kloudy/status',
            'GET /api/ssh/kloudy/files',
            'GET /ssh-terminal.html'
        ]
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log('🔧 KloudyKare SSH Terminal Server');
    console.log('==================================');
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📁 Serving from: ${__dirname}`);
    console.log(`🔒 Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🎯 SSH Terminal: https://ssh.kloudykare.com`);
    console.log('==================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});
