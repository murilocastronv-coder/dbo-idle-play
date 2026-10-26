const express = require('express');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const app = express();
app.disable('x-powered-by');
app.get('/', (_req, res) => res.json({
  name: 'DBO Idle Multiplayer Server',
  status: 'online',
  websocket: '/ws',
  onlinePlayers: players.size
}));
app.get('/health', (_req, res) => res.json({ ok: true, onlinePlayers: players.size }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 });
const PORT = Number(process.env.PORT || 10000);
const players = new Map();
const rooms = new Map();
const MAX_NAME = 20;
const MAX_ROOM = 32;

function safeText(value, max = MAX_NAME) {
  return String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
}
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function roomPlayers(room) {
  return [...players.values()].filter(p => p.room === room).map(({ id, name, level, x, y, z, className }) => ({
    id, name, level, x, y, z, className
  }));
}
function broadcastRoom(room, data, exceptId) {
  for (const [id, player] of players) {
    if (player.room === room && id !== exceptId) send(player.ws, data);
  }
}
function joinRoom(ws, player, requestedRoom) {
  const room = safeText(requestedRoom || 'world-1', MAX_ROOM) || 'world-1';
  if (player.room) broadcastRoom(player.room, { type: 'player:left', id: player.id });
  player.room = room;
  send(ws, { type: 'room:joined', room, playerId: player.id, players: roomPlayers(room) });
  broadcastRoom(room, { type: 'player:joined', player: {
    id: player.id, name: player.name, level: player.level, x: player.x, y: player.y, z: player.z, className: player.className
  } }, player.id);
}
wss.on('connection', (ws) => {
  const id = crypto.randomUUID();
  const player = {
    id, ws, name: 'Guerreiro', room: null, level: 1, x: 0, y: 0, z: 0,
    className: 'Warrior', lastMessageAt: 0, isAlive: true
  };
  players.set(id, player);
  send(ws, { type: 'welcome', playerId: id, serverTime: Date.now(), protocol: 1 });
  joinRoom(ws, player, 'world-1');

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - player.lastMessageAt < 30) return;
    player.lastMessageAt = now;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'JSON inválido' }); }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      player.name = safeText(msg.name || player.name) || 'Guerreiro';
      player.level = Math.max(1, Math.min(10000, Number.parseInt(msg.level, 10) || 1));
      player.className = safeText(msg.className || 'Warrior', 24);
      joinRoom(ws, player, msg.room);
      return;
    }
    if (msg.type === 'player:update') {
      for (const key of ['x', 'y', 'z']) {
        if (Number.isFinite(msg[key])) player[key] = Math.max(-100000, Math.min(100000, msg[key]));
      }
      if (Number.isFinite(msg.level)) player.level = Math.max(1, Math.min(10000, Math.floor(msg.level)));
      if (typeof msg.isAlive === 'boolean') player.isAlive = msg.isAlive;
      broadcastRoom(player.room, { type: 'player:updated', player: {
        id, name: player.name, level: player.level, x: player.x, y: player.y, z: player.z,
        className: player.className, isAlive: player.isAlive
      } }, id);
      return;
    }
    if (msg.type === 'chat') {
      const text = safeText(msg.text, 240);
      if (!text) return;
      broadcastRoom(player.room, { type: 'chat', id, name: player.name, text, at: now });
      send(ws, { type: 'chat:sent', at: now });
      return;
    }
    if (msg.type === 'ping') send(ws, { type: 'pong', at: now });
  });

  ws.on('close', () => {
    const current = players.get(id);
    if (current) {
      if (current.room) broadcastRoom(current.room, { type: 'player:left', id });
      players.delete(id);
    }
  });
  ws.on('error', () => {});
});

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('DBO Idle multiplayer server listening on port ' + PORT);
});
