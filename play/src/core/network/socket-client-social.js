// =====================================================================
// Forgotten Lands - SocketClient social (multiplayer da cidade).
//
// O progresso continua 100% no navegador, então `connected` fica SEMPRE
// false: todo o app.js segue usando a lógica local de hunt, forja, loja...
// O que passa pela rede é só a parte social:
//   - presença na cidade (posição, direção, roupa, nível e atividade);
//   - chat da cidade;
//   - balões de fala em cima dos jogadores.
//
// Servidor usado (em ordem):
//   1. ?server=wss://host/ws na URL (fica salvo para as próximas visitas;
//      ?server=off desliga o multiplayer);
//   2. o que estiver salvo no navegador;
//   3. se o jogo foi aberto pelo próprio servidor (ex.: http://192.168.0.10:10000/play/),
//      o mesmo endereço em /ws;
//   4. o servidor público padrão.
// =====================================================================
const DEFAULT_REMOTE = 'wss://dbo-idle-multiplayer-server.onrender.com/ws';
const STORAGE_KEY = 'dbo-multiplayer-server';
// O jogo só fala com o próprio endereço quando foi aberto pelo servidor:
// o host público dele, localhost ou um IP (PC na Wi-Fi de casa). Qualquer
// outro domínio (forgotten-lands.world, GitHub Pages, static site...) só
// serve arquivos e usa o servidor público.
const SERVER_HOSTS = /^(?:dbo-idle-multiplayer-server\.onrender\.com|localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:]+\])$/i;
function servedByGameServer() {
  return SERVER_HOSTS.test(location.hostname) || location.hostname.endsWith('.local');
}
const STEP_MS = 220;
const SPEECH_MS = 6000;
const PING_MS = 15000;

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export function resolveServerUrl() {
  const fromQuery = new URL(location.href).searchParams.get('server');
  if (fromQuery) {
    if (fromQuery === 'off') { writeStorage(STORAGE_KEY, 'off'); return null; }
    if (fromQuery === 'auto') writeStorage(STORAGE_KEY, null);
    else if (/^wss?:\/\//i.test(fromQuery)) { writeStorage(STORAGE_KEY, fromQuery); return fromQuery; }
  }
  const saved = readStorage(STORAGE_KEY);
  if (saved === 'off') return null;
  if (saved && /^wss?:\/\//i.test(saved)) return saved;
  if (location.protocol === 'file:') return null;
  if (!servedByGameServer()) return DEFAULT_REMOTE;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

// Base HTTP das rotas /api (contas e personagens). Segue o mesmo servidor do
// WebSocket, mas continua ativa com ?server=off (que só desliga a cidade).
export function resolveApiBase() {
  const saved = readStorage(STORAGE_KEY);
  const fromQuery = new URL(location.href).searchParams.get('server');
  const ws = [fromQuery, saved].find(value => value && /^wss?:\/\//i.test(value));
  const target = ws || (servedByGameServer() ? null : DEFAULT_REMOTE);
  if (!target) return '';
  return target.replace(/^ws/i, 'http').replace(/\/ws\/?$/, '');
}

// Jogador remoto. Posição e animação são getters: o renderer copia o ator a
// cada quadro (`{...player}`), então a interpolação entre tiles sai de graça.
function createRemote(data) {
  const remote = { _data: {}, _fromX: 0, _fromY: 0, _toX: 0, _toY: 0, _moveAt: 0, _speech: '', _speechAt: 0 };
  const view = {};
  for (const key of ['profileId', 'name', 'level', 'characterId', 'formId', 'sprite', 'outfitId', 'z', 'direction', 'activity', 'zoneName']) {
    Object.defineProperty(view, key, { enumerable: true, get: () => remote._data[key] });
  }
  Object.defineProperties(view, {
    x: { enumerable: true, get: () => lerp(remote._fromX, remote._toX, stepProgress(remote)) },
    y: { enumerable: true, get: () => lerp(remote._fromY, remote._toY, stepProgress(remote)) },
    moving: { enumerable: true, get: () => Date.now() - remote._moveAt < STEP_MS + 60 },
    speech: { enumerable: true, get: () => (Date.now() - remote._speechAt < SPEECH_MS ? remote._speech : '') }
  });
  remote.view = view;
  remote._fromX = remote._toX = Number(data.x) || 0;
  remote._fromY = remote._toY = Number(data.y) || 0;
  remote._data = { ...data };
  return remote;
}
function stepProgress(remote) {
  return Math.max(0, Math.min(1, (Date.now() - remote._moveAt) / STEP_MS));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function updateRemote(remote, data) {
  const x = Number(data.x) || 0;
  const y = Number(data.y) || 0;
  const changedFloor = Number(data.z) !== Number(remote._data.z);
  if (x !== remote._toX || y !== remote._toY) {
    const far = Math.abs(x - remote._toX) > 2 || Math.abs(y - remote._toY) > 2;
    if (far || changedFloor) {
      // Teleporte: aparece direto no destino, sem deslizar pela cidade.
      remote._fromX = x; remote._fromY = y; remote._moveAt = 0;
    } else {
      const t = stepProgress(remote);
      remote._fromX = lerp(remote._fromX, remote._toX, t);
      remote._fromY = lerp(remote._fromY, remote._toY, t);
      remote._moveAt = Date.now();
    }
    remote._toX = x; remote._toY = y;
  }
  remote._data = { ...data };
}

export class SocketClient {
  constructor(handlers = {}) {
    this.handlers = handlers || {};
    // Autoridade de jogo: sempre local nesta build.
    this.connected = false;
    this.offline = true;
    // Camada social (cidade compartilhada).
    this.social = false;
    this.url = null;
    this.ws = null;
    this.profile = null;
    this.remotes = new Map();
    this.seenChat = new Set();
    this.last = { position: '', activity: '', appearance: '' };
    this.pending = { position: null, activity: null, appearance: null };
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.reconnectAttempt = 0;
    this.manualClose = false;
    this.online = 0;
  }

  connect(profile = {}) {
    this.profile = { ...profile };
    this.handlers.onPresence?.([]);
    this.url = resolveServerUrl();
    if (!this.url || typeof WebSocket === 'undefined') {
      this.status('offline');
      return this;
    }
    this.manualClose = false;
    this.open();
    return this;
  }

  status(value) {
    this.handlers.onSocialStatus?.(value);
  }

  open() {
    if (this.manualClose) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.social = true;
      this.reconnectAttempt = 0;
      this.raw({
        type: 'join',
        room: 'earth',
        profile: { ...this.profile, ...(this.pending.appearance || {}) },
        position: this.pending.position || this.profile.position || null,
        activity: this.pending.activity?.activity || 'world'
      });
      if (this.pending.activity) this.raw({ type: 'activity', ...this.pending.activity });
      this.status('online');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.raw({ type: 'ping', at: Date.now() }), PING_MS);
    });
    ws.addEventListener('message', event => {
      if (this.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this.handle(msg);
    });
    ws.addEventListener('close', event => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.social = false;
      clearInterval(this.pingTimer);
      this.remotes.clear();
      this.handlers.onPresence?.([]);
      // 4409: o mesmo personagem entrou em outro aparelho. Não brigar por ele.
      if (this.manualClose || event.code === 4409) {
        this.status('offline');
        return;
      }
      this.status('reconnecting');
      this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {});
  }

  scheduleReconnect() {
    if (this.manualClose || this.reconnectTimer) return;
    const delay = Math.min(20000, 1500 * 2 ** Math.min(4, this.reconnectAttempt++));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  handle(msg) {
    switch (msg.type) {
      case 'room-joined':
        this.online = Number(msg.online || 0);
        this.ingest(msg.players || []);
        for (const message of msg.chat || []) this.deliverChat(message, false);
        break;
      case 'presence':
        this.online = Number(msg.online || 0);
        this.ingest(msg.players || []);
        break;
      case 'chat':
        this.deliverChat(msg.message || {}, true);
        break;
      case 'server-log':
        this.handlers.onServerLog?.(msg);
        break;
      case 'error':
        if (msg.message) this.handlers.onServerLog?.({ channel: 'server', text: msg.message, at: Date.now() });
        break;
      case 'pong':
        this.online = Number(msg.online || this.online);
        break;
      default:
        break;
    }
  }

  ingest(list) {
    const ownId = String(this.profile?.id || '');
    const seen = new Set();
    for (const data of list) {
      const id = String(data?.profileId || '');
      if (!id || id === ownId) continue;
      seen.add(id);
      const existing = this.remotes.get(id);
      if (existing) updateRemote(existing, data);
      else this.remotes.set(id, createRemote(data));
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remotes.delete(id);
    this.handlers.onPresence?.([...this.remotes.values()].map(remote => remote.view));
  }

  deliverChat(message, speak) {
    const id = String(message.id || '');
    if (!id || this.seenChat.has(id)) return;
    this.seenChat.add(id);
    if (this.seenChat.size > 500) this.seenChat = new Set([...this.seenChat].slice(-250));
    const remote = this.remotes.get(String(message.profileId || ''));
    if (speak && remote) {
      remote._speech = String(message.text || '').slice(0, 80);
      remote._speechAt = Date.now();
    }
    this.handlers.onChat?.({
      id,
      author: String(message.author || 'Jogador'),
      text: String(message.text || ''),
      at: Number(message.at || Date.now()),
      profileId: message.profileId || null
    });
  }

  raw(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  // Envia só o que mudou. Pode ser chamado a cada render sem custo de rede.
  syncLocal({ position, activity, zoneName, appearance } = {}) {
    if (position) this.sendPosition(position.x, position.y, position.z, position.direction);
    if (activity) this.sendActivity(activity, zoneName);
    if (appearance) this.sendAppearance(appearance);
  }

  sendPosition(x, y, z = 7, direction = 2) {
    const position = { x: Number(x), y: Number(y), z: Number(z), direction: Number(direction ?? 2) };
    if (![position.x, position.y, position.z].every(Number.isFinite)) return;
    this.pending.position = position;
    const signature = `${position.x},${position.y},${position.z},${position.direction}`;
    if (signature === this.last.position || !this.social) return;
    if (this.raw({ type: 'move', ...position })) this.last.position = signature;
  }

  sendActivity(activity = 'world', zoneName = '') {
    this.pending.activity = { activity: String(activity), zoneName: String(zoneName || '') };
    const signature = `${activity}|${zoneName || ''}`;
    if (signature === this.last.activity || !this.social) return;
    if (this.raw({ type: 'activity', ...this.pending.activity })) this.last.activity = signature;
  }

  sendAppearance(appearance = {}) {
    this.pending.appearance = { ...(this.pending.appearance || {}), ...appearance };
    const signature = JSON.stringify(this.pending.appearance);
    if (signature === this.last.appearance || !this.social) return;
    if (this.raw({ type: 'appearance', appearance: this.pending.appearance })) this.last.appearance = signature;
  }

  sendChat(text) {
    return this.raw({ type: 'chat', text: String(text || '').slice(0, 240) });
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.social = false;
    try { ws?.close(1000, 'bye'); } catch {}
  }

  // Sistemas que dependiam do servidor autoritativo original: inertes.
  send() {}
  dropGround() {}
  pickupGround() {}
  sendGameAction() {}
  sendPartyAction() {}
  sendTradeAction() {}
  sendPvpAction() {}
  sendGuildBossTaunt() {}
  sendClientLayout() {}
  sendClientPreferences() {}
  requestCharacterProfile() {}
  requestCharacterExit() { return Promise.resolve({ ok: true, offline: true }); }
}
