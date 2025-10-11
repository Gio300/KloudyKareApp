const express = require('express');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8717;

// In-memory notes store keyed by profileId (placeholder until API)
const profileNotes = new Map();

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Simple authentication endpoint
app.post('/api/auth/login', (req, res) => {
    const { identifier, password, captcha } = req.body;
    
    // Simple captcha check
    if (captcha.a + captcha.b !== captcha.answer) {
        return res.status(400).json({ error: 'Invalid captcha' });
    }
    
    // Simple hardcoded credentials for testing
    if ((identifier === 'johnny' || identifier === 'johnny@alorosai.com') && password === '@Waken19142025') {
        res.json({
            success: true,
            role: 'admin',
            user: {
                id: 'johnny',
                name: 'Johnny Alorosai',
                email: 'johnny@alorosai.com'
            }
        });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// No-cache for HTML
app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path === '/' ) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
    }
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'United Family Caregivers Rep Dashboard',
        timestamp: new Date().toISOString(),
        directory: __dirname
    });
});

// Notes endpoints (placeholder)
app.post('/api/notes/save', (req, res) => {
    const { profileId = 'demo-profile', text, by = 'Agent' } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });
    const list = profileNotes.get(profileId) || [];
    const note = { id: 'n'+Date.now(), text, by, at: new Date().toISOString() };
    list.push(note);
    profileNotes.set(profileId, list);
    res.json({ success: true, note });
});

app.get('/api/notes/list', (req, res) => {
    const profileId = req.query.profileId || 'demo-profile';
    res.json({ success: true, notes: profileNotes.get(profileId) || [] });
});

// Chat proxy through MCP Hub
app.post('/api/chat', async (req, res) => {
    try {
        console.log('🤖 Chat request received:', req.body);
        
        // Try MCP Hub first (containerized)
        const mcpUrl = process.env.MCP_URL || 'http://localhost:7012';
        
        try {
            const response = await axios.post(`${mcpUrl}/api/chat/message`, {
                message: req.body.message,
                sessionId: req.body.sessionId || 'agent-session',
                context: req.body.context || {}
            }, {
                timeout: 60000
            });

            console.log('✅ MCP response received');
            res.json({ 
                response: response.data.content || response.data.response,
                model: 'llama3.3:latest (via MCP)'
            });
        } catch (mcpError) {
            console.warn('⚠️ MCP unavailable, falling back to direct Ollama');
            
            // Fallback to direct Ollama (local development)
            const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
            const response = await axios.post(`${ollamaUrl}/api/generate`, {
                model: 'llama3.3:latest',
                prompt: req.body.message,
                stream: false,
                options: {
                    num_predict: 150,
                    temperature: 0.7,
                    top_p: 0.9,
                    top_k: 40,
                    num_thread: 8
                }
            }, {
                timeout: 60000
            });

            console.log('✅ Ollama response received (direct)');
            res.json({ 
                response: response.data.response,
                model: 'llama3.3:latest (direct)'
            });
        }
    } catch (error) {
        console.error('❌ Chat error:', error.message);
        res.status(500).json({ 
            error: 'AI service unavailable',
            details: error.message
        });
    }
});

// Check Ollama status
app.get('/api/ollama/status', async (req, res) => {
    try {
        const response = await axios.get('http://127.0.0.1:11434/api/tags', {
            timeout: 5000,
            family: 4
        });
        
        const models = response.data.models || [];
        const llama33 = models.find(m => m.name.includes('llama3.3'));
        
        res.json({
            connected: true,
            model: llama33 ? llama33.name : 'llama3.3:latest',
            size: llama33 ? llama33.size : 'Unknown'
        });
    } catch (error) {
        res.status(503).json({
            connected: false,
            error: error.message
        });
    }
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

        exec(`ssh -o ConnectTimeout=10 -o BatchMode=yes -i /home/kloudykare/.ssh/KloudyKare kloudykare@kloudykare.com "${command.replace(/"/g, '\\"')}"`, 
            { timeout: 30000 }, 
            (error, stdout, stderr) => {
                res.json({
                    success: !error,
                    command,
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
        
        exec(`ssh -o ConnectTimeout=10 -o BatchMode=yes -i /home/kloudykare/.ssh/KloudyKare kloudykare@kloudykare.com "ls -la ${path}"`, 
            { timeout: 15000 }, 
            (error, stdout, stderr) => {
                res.json({
                    success: !error,
                    path,
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
    res.sendFile(path.join(__dirname, 'rep-assistant.html'));
});

app.get('/rep-assistant.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'rep-assistant.html'));
});

app.get('/kloudy-simple.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'kloudy-simple.html'));
});

app.get('/ssh-terminal.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'ssh-terminal.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('🎧 United Family Caregivers Rep Dashboard');
    console.log('==========================================');
    console.log(`🌐 Server running on: http://localhost:${PORT}`);
    console.log(`📁 Serving from: ${__dirname}`);
    console.log(`🎯 Rep Dashboard: http://localhost:${PORT}/rep-assistant.html`);
    console.log(`💬 Simple Chat: http://localhost:${PORT}/kloudy-simple.html`);
    console.log(`🔧 SSH Terminal: http://localhost:${PORT}/ssh-terminal.html`);
    console.log(`🌍 Online Access: http://kloudykare.com/ssh-terminal.html`);
    console.log('==========================================');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    process.exit(0);
});
