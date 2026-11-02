const API = 'https://api-nexus.scholarnavigator.top';
const $ = (id) => document.getElementById(id);
let nickname = '';
let socket;
let pendingFile = null;
let reconnect;
let searchTimer;
const seen = new Set();

function notice(text) { $('notice').textContent = text; }
function render(message) {
  if (seen.has(message.id)) return;
  seen.add(message.id);
  const row = document.createElement('article');
  row.className = 'message';
  const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = message.nickname.slice(0, 1).toUpperCase();
  const content = document.createElement('div'); content.className = 'content';
  const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = message.nickname;
  const time = document.createElement('time'); time.textContent = new Date(message.created_at).toLocaleString(); meta.append(time); content.append(meta);
  if (message.text) { const body = document.createElement('p'); body.className = 'body'; body.textContent = message.text; content.append(body); }
  if (message.media) {
    try {
      const media = typeof message.media === 'string' ? JSON.parse(message.media) : message.media;
      const url = new URL(media.url, API);
      if ((url.origin === API && url.pathname.startsWith('/socratic-new-api/media/')) || (url.protocol === 'https:' && /(^|\.)klipy\.(com|co)$/.test(url.hostname))) {
        const element = document.createElement(media.type === 'video' ? 'video' : 'img'); element.src = url.href; if (media.type === 'video') element.controls = true; else element.alt = 'Shared media'; content.append(element);
      }
    } catch {}
  }
  row.append(avatar, content); $('messages').append(row); $('messages').scrollTop = $('messages').scrollHeight;
}
async function history() {
  try { const response = await fetch(`${API}/socratic-new-api/messages`); if (!response.ok) throw Error(); const messages = await response.json(); $('messages').replaceChildren(); seen.clear(); messages.forEach(render); } catch { notice('Could not load chat history.'); }
}
function connect() {
  if (!nickname) return;
  $('status').textContent = 'Connecting…';
  socket = new WebSocket('wss://api-nexus.scholarnavigator.top/socratic-new-ws');
  socket.onopen = () => { $('status').textContent = '● Connected'; notice(''); history(); };
  socket.onmessage = (event) => { try { render(JSON.parse(event.data)); } catch {} };
  socket.onclose = () => { $('status').textContent = 'Disconnected'; if (nickname) reconnect = setTimeout(connect, 3000); };
}
$('join').addEventListener('submit', (event) => { event.preventDefault(); nickname = $('nickname').value.trim(); if (!nickname) return; $('entry').hidden = true; $('chat').hidden = false; connect(); });
$('change').addEventListener('click', () => { nickname = ''; clearTimeout(reconnect); if (socket) socket.close(); $('chat').hidden = true; $('entry').hidden = false; $('status').textContent = 'Choose a nickname'; });
$('file').addEventListener('change', () => { pendingFile = $('file').files[0] || null; $('attachment').hidden = !pendingFile; $('attachment').textContent = pendingFile ? `Attached: ${pendingFile.name} (select another file to replace)` : ''; });
for (const emoji of ['😀', '😂', '😊', '😍', '🥰', '😎', '🤔', '😭', '😅', '🙃', '🥳', '🤝', '👍', '👋', '❤️', '🔥', '✨', '🎉', '💯', '🙏', '💀', '👀', '💪', '🌟']) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'tool'; button.textContent = emoji; button.onclick = () => { $('text').setRangeText(emoji, $('text').selectionStart, $('text').selectionEnd, 'end'); $('emoji-picker').hidden = true; $('text').focus(); }; $('emojis').append(button);
}
$('emoji').addEventListener('click', () => { $('picker').hidden = true; $('emoji-picker').hidden = !$('emoji-picker').hidden; });
$('composer').addEventListener('submit', async (event) => {
  event.preventDefault(); const text = $('text').value.trim(); if (!text && !pendingFile) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return notice('Not connected. Your message was not sent.');
  $('send').disabled = true;
  try {
    let media = null;
    if (pendingFile) { const form = new FormData(); form.append('file', pendingFile); const response = await fetch(`${API}/socratic-new-api/upload`, { method: 'POST', body: form }); if (!response.ok) throw Error('Upload failed. Files must be supported images or videos under 20 MB.'); media = await response.json(); }
    if (socket.readyState !== WebSocket.OPEN) throw Error('Connection lost. Your message was not sent.');
    socket.send(JSON.stringify({ nickname, text, media })); $('text').value = ''; pendingFile = null; $('file').value = ''; $('attachment').hidden = true; notice('');
  } catch (error) { notice(error.message); } finally { $('send').disabled = false; }
});
function findUrl(value) {
  if (typeof value === 'string') { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\.)klipy\.(com|co)$/.test(u.hostname) ? value : ''; } catch { return ''; } }
  if (!value || typeof value !== 'object') return '';
  for (const key of ['gif', 'original', 'hd', 'sd', 'url', ...Object.keys(value)]) { const found = findUrl(value[key]); if (found) return found; } return '';
}
async function gifs() {
  $('gifs').textContent = 'Loading…';
  try {
    const response = await fetch(`${API}/socratic-new-api/gifs?q=${encodeURIComponent($('gif-search').value)}`); if (!response.ok) throw Error();
    const data = await response.json(); const items = data.results || data.data?.data || data.data || []; $('gifs').replaceChildren();
    for (const item of items) { const url = findUrl(item.file || item); if (!url) continue; const button = document.createElement('button'); button.type = 'button'; const image = document.createElement('img'); image.src = url; image.alt = item.title || 'GIF'; button.append(image); button.onclick = () => { if (socket?.readyState !== WebSocket.OPEN) return notice('Not connected.'); socket.send(JSON.stringify({ nickname, text: '', media: { type: 'gif', url } })); $('picker').hidden = true; }; $('gifs').append(button); }
    if (!$('gifs').children.length) $('gifs').textContent = 'No GIFs found.';
  } catch { $('gifs').textContent = 'GIF search is unavailable.'; }
}
$('gif').onclick = () => { $('picker').hidden = !$('picker').hidden; if (!$('picker').hidden) gifs(); };
$('close-picker').onclick = () => { $('picker').hidden = true; };
$('gif-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(gifs, 400); };
