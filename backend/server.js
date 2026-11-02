'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sqlite3 = require('sqlite3');
const { WebSocketServer, WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const mediaDir = path.join(dataDir, 'media');
const origin = process.env.ALLOWED_ORIGIN || 'https://socraticchat.github.io';
const port = Number(process.env.PORT || 3001);
fs.mkdirSync(mediaDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'chat.sqlite'));
db.run('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, nickname TEXT NOT NULL, text TEXT NOT NULL, media TEXT, created_at TEXT NOT NULL)');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Vary', 'Origin');
  if (req.headers.origin === origin) res.set('Access-Control-Allow-Origin', origin);
  if (req.headers.origin && req.headers.origin !== origin) return res.sendStatus(403);
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }
  next();
});
app.use('/socratic-new-api', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use('/socratic-new-api/media', express.static(mediaDir, { dotfiles: 'deny', index: false, setHeaders(res) { res.set('Content-Security-Policy', "default-src 'none'; sandbox"); } }));
app.get('/socratic-new-api/messages', (req, res) => {
  db.all('SELECT id, nickname, text, media, created_at FROM (SELECT * FROM messages ORDER BY id DESC LIMIT 100) ORDER BY id ASC', (err, rows) => {
    if (err) return res.sendStatus(500);
    res.json(rows);
  });
});
const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' };
function validFile(file) {
  const b = file.buffer;
  if (file.mimetype === 'image/jpeg') return b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (file.mimetype === 'image/png') return b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (file.mimetype === 'image/gif') return ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString());
  if (file.mimetype === 'image/webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  if (file.mimetype === 'video/mp4') return b.subarray(4, 8).toString() === 'ftyp';
  if (file.mimetype === 'video/webm') return b.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  return false;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
app.post('/socratic-new-api/upload', upload.single('file'), (req, res) => {
  if (!req.file || !allowed[req.file.mimetype] || !validFile(req.file)) return res.status(400).json({ error: 'Unsupported file type.' });
  const filename = crypto.randomUUID() + allowed[req.file.mimetype];
  fs.writeFile(path.join(mediaDir, filename), req.file.buffer, { flag: 'wx' }, (err) => {
    if (err) return res.sendStatus(500);
    res.json({ url: `/socratic-new-api/media/${filename}`, type: req.file.mimetype.startsWith('video/') ? 'video' : 'image' });
  });
});
app.get('/socratic-new-api/gifs', async (req, res) => {
  if (!process.env.KLIPY_API_KEY) return res.status(503).json({ error: 'GIF search is not configured.' });
  try {
    const query = String(req.query.q || '').slice(0, 100);
    const endpoint = query ? 'search' : 'trending';
    const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(process.env.KLIPY_API_KEY)}/gifs/${endpoint}`);
    url.searchParams.set('per_page', '20');
    if (query) url.searchParams.set('q', query);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('GIF provider unavailable');
    const data = await response.json();
    res.json(data);
  } catch { res.status(502).json({ error: 'GIF search is unavailable.' }); }
});
app.use((err, req, res, next) => { console.error(err.message); res.status(400).json({ error: 'Request could not be processed.' }); });
const server = app.listen(port, '127.0.0.1', () => console.log(`Socratic New listening on 127.0.0.1:${port}`));
const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/socratic-new-ws' || req.headers.origin !== origin) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws) => {
  let lastMessage = 0;
  ws.on('error', () => {});
  ws.on('message', (raw) => {
    if (Date.now() - lastMessage < 1000) return;
    lastMessage = Date.now();
    let payload;
    try { payload = JSON.parse(raw.toString()); } catch { return; }
    const nickname = typeof payload.nickname === 'string' ? payload.nickname.trim().slice(0, 30) : '';
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 2000) : '';
    let media = null;
    if (payload.media && typeof payload.media.url === 'string' && /^(image|video)$/.test(payload.media.type) && /^\/socratic-new-api\/media\/[a-f0-9-]+\.(jpg|png|gif|webp|mp4|webm)$/.test(payload.media.url)) media = JSON.stringify(payload.media);
    if (payload.media && payload.media.type === 'gif' && typeof payload.media.url === 'string') {
      try { const url = new URL(payload.media.url); if (url.protocol === 'https:' && /(^|\.)klipy\.(com|co)$/.test(url.hostname)) media = JSON.stringify({ type: 'image', url: url.href }); } catch {}
    }
    if (!nickname || (!text && !media)) return;
    const created = new Date().toISOString();
    db.run('INSERT INTO messages (nickname, text, media, created_at) VALUES (?, ?, ?, ?)', [nickname, text, media, created], function (err) {
      if (err) return;
      const message = JSON.stringify({ id: this.lastID, nickname, text, media, created_at: created });
      for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  });
});
