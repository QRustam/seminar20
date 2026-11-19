const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const HTML = path.join(__dirname, 'public', 'index.html');
const COLORS = ['green', 'red', 'yellow'];
const rooms = new Map(); // xona -> { name, question, votes, clients, seen }

function getRoom(name) {
  if (typeof name !== 'string' || !name || name.length > 60) return null;
  let r = rooms.get(name);
  if (!r) { if (rooms.size > 300) return null; r = { name, question: null, votes: {}, clients: new Set(), seen: 0 }; rooms.set(name, r); }
  r.seen = Date.now();
  return r;
}
function snapshot(r) {
  const t = Date.now(), out = [];
  if (r.question) out.push({ room: r.name, type: 'question', payload: r.question, msgId: 'snap_' + t + '_q' });
  Object.entries(r.votes).forEach(([vid, p], i) => out.push({ room: r.name, type: 'vote', voterId: vid, payload: p, msgId: 'snap_' + t + '_' + i }));
  return out;
}
function cleanQuestion(q) {
  if (!q || typeof q.id !== 'string' || typeof q.text !== 'string' || !q.text.trim()) return null;
  return { id: q.id.slice(0, 60), text: q.text.trim().slice(0, 500), timestamp: Date.now() };
}
function send(r, msg) { const d = 'data: ' + JSON.stringify(msg) + '\n\n'; r.clients.forEach(c => c.write(d)); }

setInterval(() => rooms.forEach(r => r.clients.forEach(c => c.write(': ping\n\n'))), 20000);
setInterval(() => rooms.forEach((r, k) => { if (!r.clients.size && Date.now() - r.seen > 12 * 3600e3) rooms.delete(k); }), 3600e3);

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/ping') { res.writeHead(200); return res.end('ok'); }
  if (req.method === 'GET' && (u.pathname === '/events' || u.pathname === '/api/state')) {
    const r = getRoom(u.searchParams.get('room'));
    if (!r) { res.writeHead(400); return res.end('xona nomi noto‘g‘ri'); }
    if (u.pathname === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(snapshot(r))); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': ok\n\n'); snapshot(r).forEach(m => res.write('data: ' + JSON.stringify(m) + '\n\n'));
    r.clients.add(res); req.on('close', () => r.clients.delete(res)); return;
  }
  if (req.method === 'POST' && u.pathname === '/api/msg') {
    const r = getRoom(u.searchParams.get('room'));
    if (!r) { res.writeHead(400); return res.end('xona'); }
    let b = ''; req.on('data', c => { b += c; if (b.length > 2e4) req.destroy(); });
    req.on('end', () => {
      let m; try { m = JSON.parse(b); } catch (e) { res.writeHead(400); return res.end('json'); }
      const out = { room: r.name, type: m.type, msgId: String(m.msgId || ('s_' + Date.now() + Math.random())).slice(0, 80) };
      if (m.type === 'question') {
        const q = cleanQuestion(m.payload); if (!q) { res.writeHead(400); return res.end('savol'); }
        r.question = q; r.votes = {}; out.payload = q;
      } else if (m.type === 'vote') {
        const p = m.payload || {};
        if (!r.question || !COLORS.includes(p.color) || typeof m.voterId !== 'string' || m.voterId.length > 60 || p.qId !== r.question.id) { res.writeHead(409); return res.end('eski savol'); }
        if (Object.keys(r.votes).length > 3000 && !r.votes[m.voterId]) { res.writeHead(429); return res.end('juda ko‘p'); }
        const prev = r.votes[m.voterId], ts = Number(p.ts) || Date.now();
        if (prev && prev.ts > ts) { res.writeHead(200); return res.end('ok'); }
        r.votes[m.voterId] = { color: p.color, name: String(p.name || 'Ishtirokchi').slice(0, 40), qId: p.qId, ts };
        out.voterId = m.voterId; out.payload = r.votes[m.voterId];
      } else if (m.type === 'reset') {
        r.votes = {}; const q = cleanQuestion(m.question); if (q) { r.question = q; out.question = q; }
      } else { res.writeHead(400); return res.end('tur'); }
      send(r, out); res.writeHead(200); res.end('ok');
    });
    return;
  }
  fs.readFile(HTML, (e, d) => { if (e) { res.writeHead(500); return res.end('xato'); } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d); });
}).listen(PORT, () => console.log('Port ' + PORT));
