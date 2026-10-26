const SERVER_URL = 'wss://dbo-idle-multiplayer-server.onrender.com/ws';

let socket = null;
let retryTimer = null;
let stopped = false;
let currentState = null;
let playerId = null;
const listeners = new Set();

function getLevel(state) {
  return Number(state?.progression?.level ?? state?.character?.level ?? state?.level ?? 1) || 1;
}
function getName(state) {
  return String(state?.profile?.name || state?.character?.name || 'Guerreiro').slice(0, 20);
}
function emit(type, data) {
  for (const fn of listeners) {
    try { fn({ type, ...data }); } catch {}
  }
}
function handleMessage(msg) {
  if (msg.type === 'welcome') {
    playerId = msg.playerId;
    const state = currentState || {};
    socket?.send(JSON.stringify({
      type: 'join',
      name: getName(state),
      level: getLevel(state),
      className: state.profile?.characterId || 'Warrior',
      room: 'earth-city'
    }));
    emit('connected', { playerId });
  } else if (msg.type === 'room:joined') {
    playerId = msg.playerId || playerId;
    emit('world-snapshot', { room: msg.room, players: msg.players || [], playerId });
  } else if (msg.type === 'player:joined' || msg.type === 'player:updated') {
    emit(msg.type, { player: msg.player });
  } else if (msg.type === 'player:left') {
    emit('player:left', { id: msg.id });
  } else if (msg.type === 'chat') {
    emit('chat', { id: msg.id, name: msg.name, text: msg.text, at: msg.at });
  }
}
function connect() {
  if (stopped) return;
  try {
    socket = new WebSocket(SERVER_URL);
    socket.addEventListener('message', event => {
      try { handleMessage(JSON.parse(event.data)); } catch {}
    });
    socket.addEventListener('close', () => {
      emit('disconnected', {});
      if (!stopped) retryTimer = setTimeout(connect, 4000);
    });
    socket.addEventListener('error', () => emit('connection-error', {}));
  } catch {
    if (!stopped) retryTimer = setTimeout(connect, 5000);
  }
}
export function onMultiplayerEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function sendPlayerUpdate(position = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const message = { type: 'player:update' };
  for (const key of ['x', 'y', 'z']) {
    if (Number.isFinite(position[key])) message[key] = position[key];
  }
  if (Number.isFinite(position.level)) message.level = position.level;
  socket.send(JSON.stringify(message));
}
export function sendWorldChat(text) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: 'chat', text: String(text || '').slice(0, 240) }));
  return true;
}
export function startMultiplayer(state) {
  stopMultiplayer();
  stopped = false;
  currentState = state;
  connect();
}
export function stopMultiplayer() {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (socket) {
    socket.onclose = null;
    try { socket.close(); } catch {}
  }
  socket = null;
  playerId = null;
}
