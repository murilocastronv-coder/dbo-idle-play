const SERVER_URL = 'wss://dbo-idle-multiplayer-server.onrender.com/ws';

let socket = null;
let retryTimer = null;
let stopped = false;
let currentState = null;
const roster = new Map();

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function getLevel(state) {
  return Number(state?.progression?.level ?? state?.character?.level ?? state?.level ?? 1) || 1;
}
function renderRoster(list) {
  list.replaceChildren();
  const title = make('div', 'dbo-mp-title', '🌐 MULTIPLAYER · ' + roster.size + ' online');
  list.append(title);
  const players = make('div', 'dbo-mp-players');
  for (const p of roster.values()) {
    players.append(make('div', 'dbo-mp-player', '● ' + p.name + ' · Nv. ' + (p.level || 1)));
  }
  if (!roster.size) players.append(make('div', 'dbo-mp-muted', 'Você está no mundo. Aguardando outros jogadores…'));
  list.append(players);
}
function showPanel() {
  let panel = document.getElementById('dbo-multiplayer-panel');
  if (panel) return panel;
  panel = make('section', 'dbo-mp-panel');
  panel.id = 'dbo-multiplayer-panel';
  const rosterEl = make('div', 'dbo-mp-roster');
  rosterEl.id = 'dbo-mp-roster';
  const status = make('div', 'dbo-mp-status', 'Conectando ao servidor…');
  status.id = 'dbo-mp-status';
  const chatLog = make('div', 'dbo-mp-chat-log');
  chatLog.id = 'dbo-mp-chat-log';
  const form = make('form', 'dbo-mp-chat-form');
  const input = make('input', 'dbo-mp-chat-input');
  input.maxLength = 240;
  input.placeholder = 'Mensagem para o mundo…';
  input.setAttribute('aria-label', 'Mensagem para o mundo');
  const send = make('button', 'dbo-mp-send', 'Enviar');
  send.type = 'submit';
  form.append(input, send);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'chat', text }));
    input.value = '';
  });
  panel.append(rosterEl, status, chatLog, form);
  document.body.append(panel);
  renderRoster(rosterEl);
  return panel;
}
function status(text) {
  const el = document.getElementById('dbo-mp-status');
  if (el) el.textContent = text;
}
function chatLine(text) {
  const log = document.getElementById('dbo-mp-chat-log');
  if (!log) return;
  log.append(make('div', 'dbo-mp-chat-line', text));
  while (log.children.length > 30) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}
function handleMessage(msg) {
  if (msg.type === 'welcome') {
    const state = currentState || {};
    socket?.send(JSON.stringify({
      type: 'join',
      name: state.profile?.name || 'Guerreiro',
      level: getLevel(state),
      className: state.profile?.characterId || 'Warrior',
      room: 'world-1'
    }));
    status('Conectado ao mundo · chat ativo');
  } else if (msg.type === 'room:joined') {
    roster.clear();
    for (const p of (msg.players || [])) roster.set(p.id, p);
    renderRoster(document.getElementById('dbo-mp-roster'));
  } else if (msg.type === 'player:joined' || msg.type === 'player:updated') {
    if (msg.player) roster.set(msg.player.id, msg.player);
    renderRoster(document.getElementById('dbo-mp-roster'));
  } else if (msg.type === 'player:left') {
    roster.delete(msg.id);
    renderRoster(document.getElementById('dbo-mp-roster'));
  } else if (msg.type === 'chat') {
    chatLine((msg.name || 'Jogador') + ': ' + msg.text);
  } else if (msg.type === 'error') {
    status('Servidor: ' + (msg.message || 'erro'));
  }
}
function connect() {
  if (stopped) return;
  try {
    socket = new WebSocket(SERVER_URL);
    socket.addEventListener('open', () => status('Conectado · entrando no mundo…'));
    socket.addEventListener('message', event => {
      try { handleMessage(JSON.parse(event.data)); } catch {}
    });
    socket.addEventListener('close', () => {
      status('Desconectado · tentando reconectar…');
      if (!stopped) retryTimer = setTimeout(connect, 4000);
    });
    socket.addEventListener('error', () => status('Conexão instável · reconectando…'));
  } catch {
    status('Não foi possível conectar ao servidor.');
    if (!stopped) retryTimer = setTimeout(connect, 5000);
  }
}
export function startMultiplayer(state) {
  stopMultiplayer();
  stopped = false;
  currentState = state;
  roster.clear();
  showPanel();
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
  document.getElementById('dbo-multiplayer-panel')?.remove();
  roster.clear();
}
