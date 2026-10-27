// =====================================================================
// Forgotten Lands - Servidor do jogo.
//
// Faz três coisas:
//   1. Serve o próprio jogo (landing, /play/ e wiki). Assim basta abrir
//      http://IP-DO-PC:10000/play/ em dois celulares na mesma rede para
//      jogar junto, sem precisar do GitHub Pages.
//   2. Contas e personagens salvos no banco (rotas /api, ver accounts.js).
//   3. WebSocket em /ws: presença na cidade (quem está online, posição,
//      direção e roupa), chat global da cidade e lista de jogadores.
//
// =====================================================================
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const WebSocket = require('ws');
const { createAccountsRouter } = require('./accounts');

const PORT = Number(process.env.PORT || 10000);
const ROOT = path.resolve(__dirname, '..');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 300);
const MAX_ROOM_PLAYERS = Number(process.env.MAX_ROOM_PLAYERS || 150);
const PRESENCE_INTERVAL_MS = 100;
const CHAT_COOLDOWN_MS = 700;
const MESSAGES_PER_SECOND = 25;
const CHAT_HISTORY = 40;
const DEFAULT_ROOM = 'earth';

const players = new Map(); // connectionId -> player
const rooms = new Map(); // roomId -> {dirty, chat: []}
const startedAt = Date.now();

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, onlinePlayers: joinedCount() }));
app.get('/api/stats', (_req, res) => res.json({
  onlinePlayers: joinedCount(),
  rooms: [...rooms.keys()].map(id => ({ id, players: roomMembers(id).length })),
  uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
}));
app.get('/api/online', (_req, res) => res.json({
  players: [...players.values()]
    .filter(p => p.joined)
    .map(p => ({ name: p.name, level: p.level, room: p.room, activity: p.activity }))
}));

// Contas e personagens (PostgreSQL quando DATABASE_URL existir).
const accounts = createAccountsRouter();
app.use('/api', accounts.router);

// Nada de expor o código do servidor, dependências ou metadados do git.
const BLOCKED = /^\/(?:dbo-idle-play\/)?(?:multiplayer-server|node_modules|\.git|package(?:-lock)?\.json)(?:\/|$)/i;
app.use((req, res, next) => (BLOCKED.test(req.path) ? res.sendStatus(404) : next()));

const staticOptions = {
  dotfiles: 'ignore',
  index: ['index.html'],
  setHeaders(res, file) {
    // HTML sempre revalida; arte e catálogos podem ficar em cache.
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  }
};
// A landing e a wiki usam caminhos absolutos /dbo-idle-play/... (GitHub Pages),
// então o mesmo conteúdo é servido nos dois prefixos.
app.use('/dbo-idle-play', express.static(ROOT, staticOptions));
app.use(express.static(ROOT, staticOptions));

// ---------------------------------------------------------------------
// Salas e presença
// ---------------------------------------------------------------------
function joinedCount() {
  let count = 0;
  for (const p of players.values()) if (p.joined) count++;
  return count;
}
function roomState(id) {
  if (!rooms.has(id)) rooms.set(id, { dirty: true, chat: [] });
  return rooms.get(id);
}
function roomMembers(id) {
  return [...players.values()].filter(p => p.joined && p.room === id);
}
function markDirty(id) {
  if (id) roomState(id).dirty = true;
}
function publicPlayer(p) {
  return {
    profileId: p.profileId,
    name: p.name,
    level: p.level,
    characterId: p.characterId,
    formId: p.formId,
    sprite: p.sprite,
    outfitId: p.outfitId,
    x: p.x, y: p.y, z: p.z,
    direction: p.direction,
    activity: p.activity,
    zoneName: p.zoneName
  };
}

function safeText(value, max = 20) {
  return String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function safeAsset(value) {
  // Só caminhos relativos do próprio jogo: impede apontar sprite para fora.
  const text = String(value ?? '').trim().slice(0, 200);
  return /^\.?\/?[\w\-./]+$/.test(text) && !text.includes('..') ? text : '';
}
function safeInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(roomId, data, exceptId = null) {
  const payload = JSON.stringify(data);
  for (const p of players.values()) {
    if (p.joined && p.room === roomId && p.id !== exceptId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(payload);
    }
  }
}
function systemMessage(roomId, text) {
  broadcast(roomId, { type: 'server-log', channel: 'server', text, at: Date.now() });
}

function applyProfile(player, profile = {}) {
  player.profileId = safeText(profile.id || player.profileId || player.id, 64) || player.id;
  player.name = safeText(profile.name, 20) || player.name;
  player.level = safeInt(profile.level, 1, 100000, player.level);
  player.characterId = safeText(profile.characterId, 40) || player.characterId;
  player.formId = safeText(profile.formId, 40);
  const sprite = safeAsset(profile.sprite);
  if (sprite) player.sprite = sprite;
  if (profile.outfitId != null) player.outfitId = safeText(profile.outfitId, 64) || null;
}
function applyPosition(player, pos = {}) {
  player.x = safeInt(pos.x, 0, 65535, player.x);
  player.y = safeInt(pos.y, 0, 65535, player.y);
  player.z = safeInt(pos.z, 0, 15, player.z);
  player.direction = safeInt(pos.direction, 0, 3, player.direction);
}

function joinRoom(player, requestedRoom) {
  const room = safeText(requestedRoom || DEFAULT_ROOM, 32) || DEFAULT_ROOM;
  if (roomMembers(room).filter(p => p.id !== player.id).length >= MAX_ROOM_PLAYERS) {
    send(player.ws, { type: 'error', message: 'A cidade está cheia. Tente de novo em instantes.' });
    return false;
  }
  if (player.joined && player.room !== room) markDirty(player.room);
  player.room = room;
  const firstJoin = !player.joined;
  player.joined = true;
  markDirty(room);
  const state = roomState(room);
  send(player.ws, {
    type: 'room-joined',
    room,
    profileId: player.profileId,
    online: joinedCount(),
    players: roomMembers(room).filter(p => p.id !== player.id).map(publicPlayer),
    chat: state.chat
  });
  if (firstJoin) systemMessage(room, `${player.name} entrou na cidade.`);
  return true;
}

function leave(player) {
  if (!players.has(player.id)) return;
  players.delete(player.id);
  if (player.joined) {
    markDirty(player.room);
    systemMessage(player.room, `${player.name} saiu.`);
  }
}

// Envia a lista de presença de cada sala que mudou. Agrupar a cada 100 ms
// mantém o tráfego baixo mesmo com muita gente andando ao mesmo tempo.
setInterval(() => {
  for (const [id, state] of rooms) {
    if (!state.dirty) continue;
    state.dirty = false;
    const members = roomMembers(id);
    if (!members.length) {
      if (!state.chat.length) rooms.delete(id);
      continue;
    }
    broadcast(id, {
      type: 'presence',
      room: id,
      online: joinedCount(),
      players: members.map(publicPlayer),
      serverTime: Date.now()
    });
  }
}, PRESENCE_INTERVAL_MS);

// ---------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 });

const handlers = {
  join(player, msg) {
    applyProfile(player, msg.profile || msg);
    if (msg.position) applyPosition(player, msg.position);
    if (msg.activity) player.activity = safeText(msg.activity, 24) || 'world';
    // Mesmo personagem aberto em outra aba/aparelho: a conexão antiga sai.
    for (const other of players.values()) {
      if (other.id !== player.id && other.joined && other.profileId === player.profileId) {
        send(other.ws, { type: 'error', message: 'Este personagem foi aberto em outro lugar.' });
        other.ws.close(4409, 'duplicate');
        leave(other);
      }
    }
    joinRoom(player, msg.room);
  },
  move(player, msg) {
    if (!player.joined) return;
    applyPosition(player, msg);
    markDirty(player.room);
  },
  appearance(player, msg) {
    if (!player.joined) return;
    applyProfile(player, { ...msg.appearance, id: player.profileId, name: player.name });
    markDirty(player.room);
  },
  activity(player, msg) {
    if (!player.joined) return;
    player.activity = safeText(msg.activity, 24) || 'world';
    player.zoneName = safeText(msg.zoneName, 40);
    markDirty(player.room);
  },
  chat(player, msg, now) {
    if (!player.joined) return;
    const text = safeText(msg.text, 240);
    if (!text) return;
    if (now - player.lastChatAt < CHAT_COOLDOWN_MS) {
      send(player.ws, { type: 'server-log', channel: 'server', text: 'Calma! Espere um pouco para mandar outra mensagem.', at: now });
      return;
    }
    player.lastChatAt = now;
    if (text === '/online' || text === '/quem') {
      const names = roomMembers(player.room).map(p => `${p.name} (Lv ${p.level})`).join(', ');
      send(player.ws, { type: 'server-log', channel: 'server', text: `Online na cidade: ${names}`, at: now });
      return;
    }
    if (text.startsWith('/')) {
      send(player.ws, { type: 'server-log', channel: 'server', text: 'Comandos: /online', at: now });
      return;
    }
    const message = {
      id: crypto.randomUUID(),
      author: player.name,
      profileId: player.profileId,
      level: player.level,
      text,
      at: now
    };
    const state = roomState(player.room);
    state.chat.push(message);
    if (state.chat.length > CHAT_HISTORY) state.chat.splice(0, state.chat.length - CHAT_HISTORY);
    broadcast(player.room, { type: 'chat', message });
  },
  ping(player, msg, now) {
    send(player.ws, { type: 'pong', at: now, echo: msg.at, online: joinedCount() });
  }
};

wss.on('connection', ws => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { type: 'error', message: 'Servidor cheio.' });
    ws.close(4503, 'full');
    return;
  }
  const id = crypto.randomUUID();
  const player = {
    id, ws, joined: false, room: null, profileId: id,
    name: 'Guerreiro', level: 1, characterId: '', formId: '', sprite: '', outfitId: null,
    x: 0, y: 0, z: 7, direction: 2, activity: 'world', zoneName: '',
    lastChatAt: 0, windowStart: Date.now(), windowCount: 0, alive: true
  };
  players.set(id, player);
  send(ws, { type: 'welcome', protocol: 2, serverTime: Date.now(), online: joinedCount() });

  ws.on('pong', () => { player.alive = true; });
  ws.on('message', raw => {
    const now = Date.now();
    if (now - player.windowStart >= 1000) { player.windowStart = now; player.windowCount = 0; }
    if (++player.windowCount > MESSAGES_PER_SECOND) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const handler = msg && typeof msg.type === 'string' && Object.hasOwn(handlers, msg.type) ? handlers[msg.type] : null;
    if (handler) handler(player, msg, now);
  });
  ws.on('close', () => leave(player));
  ws.on('error', () => {});
});

// Derruba conexões mortas (celular que perdeu sinal sem fechar o socket).
setInterval(() => {
  for (const player of players.values()) {
    if (!player.alive) { player.ws.terminate(); leave(player); continue; }
    player.alive = false;
    try { player.ws.ping(); } catch {}
  }
}, 20000);

server.on('upgrade', (req, socket, head) => {
  const pathname = String(req.url || '').split('?')[0];
  if (pathname !== '/ws' && pathname !== '/dbo-idle-play/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Forgotten Lands rodando na porta ${PORT}`);
  console.log(`  Neste PC:              http://localhost:${PORT}/play/`);
  for (const ip of lanAddresses()) {
    console.log(`  Celular (mesma Wi-Fi): http://${ip}:${PORT}/play/`);
  }
});
