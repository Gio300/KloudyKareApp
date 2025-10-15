// Minimal MCP local server: KB-first answers, API sync queue
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname);
const KB_PATH = path.join(DATA_DIR, 'kb.json');
const QUEUE_PATH = path.join(DATA_DIR, 'queue.json');
const API_BASE = process.env.API_BASE || 'https://api.kloudykare.com/api';

function loadJson(p, fallback){
  try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fallback; }
}
function saveJson(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

const kb = loadJson(KB_PATH, {
  quickRefs: {
    numbers: 'Rep Line: 833.432.6588; Medicaid Interview: 800-525-2395 (Mon–Fri 8–5)'.trim(),
    eligibility: 'Nevada Medicaid + PCS waiver + ADL assessment. Adults 18+ no guardian unless court-appointed.'.trim(),
    intake: '1) Patient name & phone 2) Nevada Medicaid ID 3) PCS waiver status 4) Caregiver info 5) Three-way call setup'.trim()
  },
  faq: [
    {q:'guardianship', a:'Adults 18+ do not need guardians unless court-appointed.'},
    {q:'job disqualify', a:'Having a job does not disqualify PCS services.'},
    {q:'provider select', a:'During interview select NV Care Solutions as provider.'}
  ]
});

const queue = loadJson(QUEUE_PATH, { notes: [] });

function findAnswer(message){
  const m = message.toLowerCase();
  if(m.includes('number') || m.includes('phone')) return {text: kb.quickRefs.numbers, conf:0.8};
  if(m.includes('eligib') || m.includes('waiver') || m.includes('adl')) return {text: kb.quickRefs.eligibility, conf:0.8};
  if(m.includes('intake') || m.includes('steps')) return {text: kb.quickRefs.intake, conf:0.8};
  for(const f of kb.faq){ if(m.includes(f.q)) return {text:f.a, conf:0.7}; }
  return {text:'', conf:0.0};
}

function json(res, code, obj){ res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(obj)); }

function notFound(res){ json(res, 404, {error:'not found'}); }

const server = http.createServer(async (req, res)=>{
  if(req.method==='OPTIONS') return json(res, 200, {});
  if(req.url.startsWith('/mcp/status')){
    return json(res, 200, { online: true, kb_size: (kb.faq?.length||0)+3, queued: queue.notes.length });
  }
  if(req.url.startsWith('/mcp/chat') && req.method==='POST'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      try{
        const {message=''} = JSON.parse(body||'{}');
        const resu = findAnswer(message||'');
        if(resu.conf>0){ return json(res, 200, {response: resu.text, confidence: resu.conf}); }
        return json(res, 200, {response:'', confidence:0});
      }catch(e){ return json(res, 400, {error:'bad json'}); }
    });
    return;
  }
  if(req.url.startsWith('/mcp/notes/save') && req.method==='POST'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      try{
        const note = JSON.parse(body||'{}');
        note.timestamp = new Date().toISOString();
        queue.notes.push(note);
        saveJson(QUEUE_PATH, queue);
        return json(res, 200, {success:true});
      }catch(e){ return json(res, 400, {error:'bad json'}); }
    });
    return;
  }
  return notFound(res);
});

const PORT = process.env.MCP_PORT || 16210;
server.listen(PORT, ()=>{
  console.log('MCP local server listening on', PORT);
});

// Periodic sync of queued items to VPS API (every 3 hours)
async function syncQueue(){
  if(!queue.notes.length) return;
  try{
    const pending = [...queue.notes];
    for(const note of pending){
      const resp = await fetch(`${API_BASE}/notes/save`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(note) });
      if(!resp.ok){ throw new Error('sync failed'); }
      // remove from queue
      queue.notes.shift();
    }
    saveJson(QUEUE_PATH, queue);
    console.log(`[MCP] Synced ${pending.length} notes to VPS`);
  }catch(e){
    console.log('[MCP] Sync error:', e.message);
  }
}
setInterval(syncQueue, 3*60*60*1000); // 3 hours



