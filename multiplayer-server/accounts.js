// =====================================================================
// Forgotten Lands - contas e personagens.
//
// Com DATABASE_URL definido, tudo vai para o PostgreSQL (tabelas fl_*).
// Sem ele (ex.: rodando no PC para jogar na Wi-Fi de casa), os dados
// ficam em multiplayer-server/data/accounts.json.
//
// Senhas: scrypt com salt. Sessões: token aleatório entregue ao cliente;
// no banco fica só o hash SHA-256 dele.
// =====================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const SESSION_DAYS = 30;
const MAX_CHARACTERS = 10;
const NICKNAME_PATTERN = /^[A-Za-z ]+$/;
const EMAIL_PATTERN = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/;
const ID_PATTERN = /^[\w-]{8,64}$/;

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
function normalizeNickname(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}
function validateNickname(value) {
  const nickname = normalizeNickname(value);
  if (nickname.length < 3 || nickname.length > 16) return { ok: false, message: 'O nickname deve ter entre 3 e 16 caracteres.' };
  if (!NICKNAME_PATTERN.test(nickname)) return { ok: false, message: 'Use somente letras sem acentos e espaços.' };
  return { ok: true, nickname };
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------------------------------------------------------------------
// Armazenamento: PostgreSQL
// ---------------------------------------------------------------------
function createPostgresStore(connectionString) {
  const { Pool } = require('pg');
  // Sem SSL para localhost e para a URL interna da Render (host sem domínio,
  // ex.: @dpg-xxxx-a/db); a URL externa (*.render.com) exige SSL.
  const local = /@(?:localhost|127\.0\.0\.1|[\w-]+)(?::\d+)?\//.test(connectionString);
  const pool = new Pool({
    connectionString,
    max: 5,
    ssl: process.env.PGSSL === 'off' || local ? false : { rejectUnauthorized: false }
  });
  const q = (text, params) => pool.query(text, params);
  return {
    kind: 'postgres',
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS fl_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
      )`);
      await q(`CREATE TABLE IF NOT EXISTS fl_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES fl_accounts(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL
      )`);
      await q(`CREATE TABLE IF NOT EXISTS fl_characters (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES fl_accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL UNIQUE,
        level INTEGER NOT NULL DEFAULT 1,
        state JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await q('CREATE INDEX IF NOT EXISTS fl_characters_account ON fl_characters(account_id)');
      await q('DELETE FROM fl_sessions WHERE expires_at < now()');
    },
    async createAccount(id, email, passwordHash) {
      try {
        await q('INSERT INTO fl_accounts (id, email, password_hash) VALUES ($1, $2, $3)', [id, email, passwordHash]);
      } catch (error) {
        if (error.code === '23505') throw new HttpError(409, 'Já existe uma conta com este e-mail.');
        throw error;
      }
    },
    async findAccountByEmail(email) {
      const { rows } = await q('SELECT id, email, password_hash FROM fl_accounts WHERE email = $1', [email]);
      return rows[0] ? { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash } : null;
    },
    async getAccount(id) {
      const { rows } = await q('SELECT id, email FROM fl_accounts WHERE id = $1', [id]);
      return rows[0] || null;
    },
    async touchLogin(id) {
      await q('UPDATE fl_accounts SET last_login_at = now() WHERE id = $1', [id]);
    },
    async createSession(tokenHash, accountId, expiresAt) {
      await q('INSERT INTO fl_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, accountId, new Date(expiresAt)]);
    },
    async sessionAccountId(tokenHash) {
      const { rows } = await q('SELECT account_id FROM fl_sessions WHERE token_hash = $1 AND expires_at > now()', [tokenHash]);
      return rows[0]?.account_id || null;
    },
    async deleteSession(tokenHash) {
      await q('DELETE FROM fl_sessions WHERE token_hash = $1', [tokenHash]);
    },
    async listCharacters(accountId) {
      const { rows } = await q('SELECT state FROM fl_characters WHERE account_id = $1 ORDER BY created_at', [accountId]);
      return rows.map(row => row.state);
    },
    async countCharacters(accountId) {
      const { rows } = await q('SELECT count(*)::int AS n FROM fl_characters WHERE account_id = $1', [accountId]);
      return rows[0].n;
    },
    async characterExists(id) {
      const { rows } = await q('SELECT 1 FROM fl_characters WHERE id = $1', [id]);
      return rows.length > 0;
    },
    async insertCharacter(accountId, id, name, state) {
      try {
        await q(
          'INSERT INTO fl_characters (id, account_id, name, name_lower, level, state) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, accountId, name, name.toLowerCase(), Number(state.profile?.level || 1), state]
        );
      } catch (error) {
        if (error.code === '23505') throw new HttpError(409, 'Já existe um personagem com esse nickname.');
        throw error;
      }
    },
    async getCharacter(accountId, id) {
      const { rows } = await q('SELECT name, state FROM fl_characters WHERE id = $1 AND account_id = $2', [id, accountId]);
      return rows[0] || null;
    },
    async updateCharacter(accountId, id, state) {
      const { rowCount } = await q(
        'UPDATE fl_characters SET state = $3, level = $4, updated_at = now() WHERE id = $1 AND account_id = $2',
        [id, accountId, state, Number(state.profile?.level || 1)]
      );
      return rowCount > 0;
    },
    async deleteCharacter(accountId, id) {
      const { rowCount } = await q('DELETE FROM fl_characters WHERE id = $1 AND account_id = $2', [id, accountId]);
      return rowCount > 0;
    },
    async stats() {
      const { rows } = await q('SELECT (SELECT count(*) FROM fl_accounts)::int AS accounts, (SELECT count(*) FROM fl_characters)::int AS characters');
      return rows[0];
    },
    async ranking(limit) {
      const { rows } = await q('SELECT name, level, state->\'profile\'->>\'characterId\' AS "characterId" FROM fl_characters ORDER BY level DESC, updated_at ASC LIMIT $1', [limit]);
      return rows;
    }
  };
}

// ---------------------------------------------------------------------
// Armazenamento: arquivo JSON (sem banco configurado)
// ---------------------------------------------------------------------
function createFileStore(file) {
  let data = { accounts: {}, sessions: {}, characters: {} };
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    }, 300);
  };
  const chars = accountId => Object.values(data.characters).filter(c => c.accountId === accountId);
  return {
    kind: 'file',
    async init() {
      try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
      const now = Date.now();
      for (const [key, session] of Object.entries(data.sessions)) if (session.expiresAt < now) delete data.sessions[key];
    },
    async createAccount(id, email, passwordHash) {
      if (Object.values(data.accounts).some(a => a.email === email)) throw new HttpError(409, 'Já existe uma conta com este e-mail.');
      data.accounts[id] = { id, email, passwordHash, createdAt: Date.now() };
      save();
    },
    async findAccountByEmail(email) {
      return Object.values(data.accounts).find(a => a.email === email) || null;
    },
    async getAccount(id) {
      const a = data.accounts[id];
      return a ? { id: a.id, email: a.email } : null;
    },
    async touchLogin(id) {
      if (data.accounts[id]) { data.accounts[id].lastLoginAt = Date.now(); save(); }
    },
    async createSession(tokenHash, accountId, expiresAt) {
      data.sessions[tokenHash] = { accountId, expiresAt };
      save();
    },
    async sessionAccountId(tokenHash) {
      const s = data.sessions[tokenHash];
      return s && s.expiresAt > Date.now() ? s.accountId : null;
    },
    async deleteSession(tokenHash) {
      delete data.sessions[tokenHash];
      save();
    },
    async listCharacters(accountId) {
      return chars(accountId).sort((a, b) => a.createdAt - b.createdAt).map(c => c.state);
    },
    async countCharacters(accountId) {
      return chars(accountId).length;
    },
    async characterExists(id) {
      return Boolean(data.characters[id]);
    },
    async insertCharacter(accountId, id, name, state) {
      if (Object.values(data.characters).some(c => c.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, 'Já existe um personagem com esse nickname.');
      }
      data.characters[id] = { id, accountId, name, state, createdAt: Date.now(), updatedAt: Date.now() };
      save();
    },
    async getCharacter(accountId, id) {
      const c = data.characters[id];
      return c && c.accountId === accountId ? { name: c.name, state: c.state } : null;
    },
    async updateCharacter(accountId, id, state) {
      const c = data.characters[id];
      if (!c || c.accountId !== accountId) return false;
      c.state = state; c.updatedAt = Date.now();
      save();
      return true;
    },
    async deleteCharacter(accountId, id) {
      const c = data.characters[id];
      if (!c || c.accountId !== accountId) return false;
      delete data.characters[id];
      save();
      return true;
    },
    async stats() {
      return { accounts: Object.keys(data.accounts).length, characters: Object.keys(data.characters).length };
    },
    async ranking(limit) {
      return Object.values(data.characters)
        .map(c => ({ name: c.name, level: Number(c.state?.profile?.level || 1), characterId: c.state?.profile?.characterId || '' }))
        .sort((a, b) => b.level - a.level)
        .slice(0, limit);
    }
  };
}

// ---------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------
function createAccountsRouter() {
  const store = process.env.DATABASE_URL
    ? createPostgresStore(process.env.DATABASE_URL)
    : createFileStore(process.env.ACCOUNTS_FILE || path.join(__dirname, 'data', 'accounts.json'));
  let ready = store.init().then(() => {
    console.log(`Contas: armazenamento ${store.kind === 'postgres' ? 'PostgreSQL' : 'arquivo local'} pronto.`);
  }).catch(error => {
    console.error('Contas: falha ao iniciar o banco:', error.message);
    ready = null;
    throw error;
  });

  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));
  router.use(async (_req, _res, next) => {
    try {
      if (!ready) ready = store.init();
      await ready;
      next();
    } catch (error) {
      ready = null;
      next(new HttpError(503, 'Banco de dados indisponível. Tente de novo em instantes.'));
    }
  });

  // Limite simples contra força bruta em login/cadastro.
  const attempts = new Map();
  function throttle(req) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = attempts.get(key) || { count: 0, resetAt: now + 60000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
    entry.count++;
    attempts.set(key, entry);
    if (attempts.size > 5000) for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
    if (entry.count > 15) throw new HttpError(429, 'Muitas tentativas. Espere um minuto.');
  }

  async function issueSession(accountId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await store.createSession(sha256(token), accountId, Date.now() + SESSION_DAYS * 86400000);
    return token;
  }
  function bearer(req) {
    const header = String(req.headers.authorization || '');
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  }
  async function requireAccount(req) {
    const token = bearer(req);
    const accountId = token ? await store.sessionAccountId(sha256(token)) : null;
    if (!accountId) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    return accountId;
  }
  async function accountPayload(accountId) {
    const account = await store.getAccount(accountId);
    if (!account) throw new HttpError(401, 'Conta não encontrada.');
    const characters = await store.listCharacters(accountId);
    const unlocked = new Set();
    for (const c of characters) for (const v of c?.profile?.unlockedVocations || []) unlocked.add(v);
    return {
      id: account.id,
      email: account.email,
      characters,
      activeCharacterId: characters[0]?.profile?.id || null,
      unlockedVocations: [...unlocked]
    };
  }
  function cleanState(state, id, name) {
    if (!state || typeof state !== 'object' || !state.profile || typeof state.profile !== 'object') {
      throw new HttpError(400, 'Personagem inválido.');
    }
    state.profile.id = id;
    state.profile.name = name;
    return state;
  }
  async function addCharacter(accountId, rawState, rawName) {
    if (await store.countCharacters(accountId) >= MAX_CHARACTERS) throw new HttpError(400, `A conta já possui ${MAX_CHARACTERS} personagens.`);
    const validation = validateNickname(rawName ?? rawState?.profile?.name);
    if (!validation.ok) throw new HttpError(400, validation.message);
    let id = String(rawState?.profile?.id || '');
    if (!ID_PATTERN.test(id) || await store.characterExists(id)) id = crypto.randomUUID();
    const state = cleanState(rawState, id, validation.nickname);
    await store.insertCharacter(accountId, id, validation.nickname, state);
    return state;
  }
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  router.post('/auth/register/request-code', route(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
    if (await store.findAccountByEmail(email)) throw new HttpError(409, 'Já existe uma conta com este e-mail.');
    // Ainda não há envio de e-mail: o passo existe para manter o fluxo do cliente.
    res.json({ email, expiresInSeconds: 0, message: 'Digite qualquer código de 6 dígitos (ex.: 000000) e escolha sua senha.' });
  }));

  router.post('/auth/register', route(async (req, res) => {
    throttle(req);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
    if (password.length < 8 || password.length > 128) throw new HttpError(400, 'A senha deve ter entre 8 e 128 caracteres.');
    const id = crypto.randomUUID();
    await store.createAccount(id, email, hashPassword(password));
    const token = await issueSession(id);
    res.status(201).json({ token, account: await accountPayload(id) });
  }));

  router.post('/auth/login', route(async (req, res) => {
    throttle(req);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const account = await store.findAccountByEmail(email);
    if (!account || !verifyPassword(password, account.passwordHash)) throw new HttpError(401, 'E-mail ou senha inválidos.');
    await store.touchLogin(account.id);
    const token = await issueSession(account.id);
    res.json({ token, account: await accountPayload(account.id) });
  }));

  // Sem e-mail não dá para provar que a conta é sua; trocar senha por
  // "qualquer código" deixaria qualquer um sequestrar contas.
  router.post(['/auth/password/request-code', '/auth/password/reset'], (_req, _res, next) => {
    next(new HttpError(501, 'Recuperação de senha ainda não está disponível. Fale com o administrador do servidor.'));
  });

  router.post('/auth/logout', route(async (req, res) => {
    const token = bearer(req);
    if (token) await store.deleteSession(sha256(token));
    res.json({ ok: true });
  }));

  router.get('/account', route(async (req, res) => {
    res.json({ account: await accountPayload(await requireAccount(req)) });
  }));

  // Traz para o banco os personagens que estavam salvos só no navegador.
  router.post('/account/import-local', route(async (req, res) => {
    const accountId = await requireAccount(req);
    const imported = [];
    const skipped = [];
    for (const state of (Array.isArray(req.body?.characters) ? req.body.characters : []).slice(0, MAX_CHARACTERS)) {
      try {
        imported.push((await addCharacter(accountId, state)).profile.id);
      } catch (error) {
        skipped.push({ name: String(state?.profile?.name || ''), reason: error.message });
      }
    }
    res.json({ imported, skipped, account: await accountPayload(accountId) });
  }));

  router.post('/characters', route(async (req, res) => {
    const accountId = await requireAccount(req);
    const state = await addCharacter(accountId, req.body?.state, req.body?.name);
    res.status(201).json({ state });
  }));

  router.put('/characters/:id/state', route(async (req, res) => {
    const accountId = await requireAccount(req);
    const id = String(req.params.id);
    const current = await store.getCharacter(accountId, id);
    if (!current) throw new HttpError(404, 'Personagem não encontrado.');
    const state = cleanState(req.body?.state, id, current.name);
    await store.updateCharacter(accountId, id, state);
    res.json({ ok: true });
  }));

  router.delete('/characters/:id', route(async (req, res) => {
    const accountId = await requireAccount(req);
    if (!await store.deleteCharacter(accountId, String(req.params.id))) throw new HttpError(404, 'Personagem não encontrado.');
    res.json({ ok: true });
  }));

  router.get('/ranking', route(async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    res.json({ players: await store.ranking(limit) });
  }));

  router.get('/accounts/stats', route(async (_req, res) => {
    res.json({ storage: store.kind, ...(await store.stats()) });
  }));

  // eslint-disable-next-line no-unused-vars
  router.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (!error.status) console.error('Contas:', error);
    res.status(status).json({ message: status >= 500 && !error.status ? 'Erro interno do servidor.' : error.message });
  });

  return { router, store };
}

module.exports = { createAccountsRouter };
