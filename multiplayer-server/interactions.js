// =====================================================================
// Forgotten Lands - interações entre jogadores: Perfil, Trade e PvP.
//
// O progresso de cada personagem vive no próprio cliente (e no banco via
// /api). Aqui o servidor só faz a ponte entre os dois jogadores:
//   - Perfil: cada cliente publica um "cartão" (nível, roupa, equipamento,
//     vitórias...) e o servidor entrega a quem pedir.
//   - Trade: convite -> ofertas -> os dois confirmam -> o servidor pede aos
//     dois clientes para conferir se ainda têm os itens e espaço -> só então
//     manda cada lado aplicar a troca. Se um dos lados falhar, nada muda.
//   - PvP: duelo 1x1 simulado aqui, com os atributos que cada cliente envia
//     ao desafiar/aceitar (vida, Ki, ataque, magias). Movimento, alvo,
//     ataque básico automático, magias, cura e cooldowns rodam no servidor.
// =====================================================================
const crypto = require('crypto');

const INVITE_MS = 30000;
const TRADE_MAX_ITEMS = 12;
const PVP_WIDTH = 16;
const PVP_HEIGHT = 10;
const PVP_COUNTDOWN_MS = 4000;
const PVP_MAX_MS = 5 * 60 * 1000;
const PVP_TICK_MS = 100;
const PVP_DAMAGE_FACTOR = 0.6; // PvP mais longo que PvE: ninguém morre num golpe

const num = (value, min, max, fallback = min) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const text = (value, max = 40) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

function attachInteractions({ players, send }) {
  const trades = new Map(); // tradeId -> trade
  const duels = new Map(); // duelId -> duel
  const tradeInvites = new Map(); // targetConn -> {fromConn, expiresAt}
  const pvpInvites = new Map(); // targetConn -> {fromConn, wager, sheet, expiresAt}

  const byProfile = profileId => [...players.values()].find(p => p.joined && p.profileId === String(profileId)) || null;
  const busy = p => Boolean(p.tradeId || p.duelId);

  // ------------------------------------------------------------------
  // Perfil
  // ------------------------------------------------------------------
  function sanitizeCard(card = {}) {
    const equipment = {};
    for (const [slot, id] of Object.entries(card.equipment || {}).slice(0, 16)) {
      if (id) equipment[text(slot, 20)] = text(id, 60);
    }
    const equipmentMeta = {};
    for (const [slot, meta] of Object.entries(card.equipmentMeta || {}).slice(0, 16)) {
      if (meta && typeof meta === 'object') equipmentMeta[text(slot, 20)] = { rarity: text(meta.rarity, 20) };
    }
    return {
      name: text(card.name, 20),
      characterId: text(card.characterId, 40),
      formId: text(card.formId, 40),
      vocationSourceId: num(card.vocationSourceId, 0, 1e6, 0),
      level: num(card.level, 1, 100000, 1),
      sprite: text(card.sprite, 200),
      profileIcon: text(card.profileIcon || 'default', 40),
      profileBorder: text(card.profileBorder || 'default', 40),
      alliance: card.alliance?.name ? { name: text(card.alliance.name, 30), tag: text(card.alliance.tag, 8), role: text(card.alliance.role, 12) } : null,
      tournamentsWon: num(card.tournamentsWon, 0, 1e6, 0),
      pvpWins: num(card.pvpWins, 0, 1e9, 0),
      pvpLosses: num(card.pvpLosses, 0, 1e9, 0),
      bestiaryPoints: num(card.bestiaryPoints, 0, 1e9, 0),
      bossBestiaryPoints: num(card.bossBestiaryPoints, 0, 1e9, 0),
      equipment,
      equipmentMeta
    };
  }

  // ------------------------------------------------------------------
  // Trade
  // ------------------------------------------------------------------
  function sanitizeOffer(offer = {}) {
    const items = (Array.isArray(offer.items) ? offer.items : []).slice(0, TRADE_MAX_ITEMS).map(row => ({
      key: text(row.key, 80),
      itemId: text(row.itemId, 60),
      rarity: text(row.rarity || 'common', 20),
      instanceId: row.instanceId ? text(row.instanceId, 80) : null,
      quantity: Math.floor(num(row.quantity, 1, 1e6, 1))
    })).filter(row => row.key && row.itemId);
    return { items, zeni: Math.floor(num(offer.zeni, 0, 1e13, 0)), pp: Math.floor(num(offer.pp, 0, 1e9, 0)) };
  }
  function tradeView(trade, conn) {
    const own = trade.a === conn ? 'a' : 'b';
    const other = own === 'a' ? 'b' : 'a';
    const partner = players.get(trade[other]);
    return {
      id: trade.id,
      partnerId: partner?.profileId || '',
      partnerName: partner?.name || 'Jogador',
      ownOffer: trade.offers[own],
      partnerOffer: trade.offers[other],
      ownConfirmed: trade.confirmed[own],
      partnerConfirmed: trade.confirmed[other]
    };
  }
  function pushTrade(trade) {
    for (const conn of [trade.a, trade.b]) {
      const p = players.get(conn);
      if (p) send(p.ws, { type: 'trade-state', trade: tradeView(trade, conn) });
    }
  }
  function endTrade(trade, event, message) {
    trades.delete(trade.id);
    for (const conn of [trade.a, trade.b]) {
      const p = players.get(conn);
      if (!p) continue;
      p.tradeId = null;
      send(p.ws, { type: 'trade-event', event, message });
    }
  }
  function tradeOf(player) {
    return player.tradeId ? trades.get(player.tradeId) : null;
  }

  function tradeAction(player, action, payload = {}) {
    const now = Date.now();
    const trade = tradeOf(player);
    if (action === 'invite') {
      const target = byProfile(payload.characterId);
      if (!target || target === player) return send(player.ws, { type: 'trade-event', event: 'error', message: 'Jogador não está online na cidade.' });
      if (busy(player) || busy(target)) return send(player.ws, { type: 'trade-event', event: 'error', message: 'Um dos jogadores já está em Trade ou PvP.' });
      tradeInvites.set(target.id, { fromConn: player.id, expiresAt: now + INVITE_MS });
      send(target.ws, { type: 'trade-invite', fromId: player.profileId, fromName: player.name, expiresAt: now + INVITE_MS });
      return send(player.ws, { type: 'trade-event', event: 'invited', message: `Convite de Trade enviado para ${target.name}.` });
    }
    if (action === 'accept' || action === 'decline') {
      const invite = tradeInvites.get(player.id);
      tradeInvites.delete(player.id);
      const from = invite && invite.expiresAt > now ? players.get(invite.fromConn) : null;
      if (!from) return send(player.ws, { type: 'trade-event', event: 'expired', message: 'O convite de Trade expirou.' });
      if (action === 'decline') {
        send(player.ws, { type: 'trade-event', event: 'declined', message: 'Convite recusado.' });
        return send(from.ws, { type: 'trade-event', event: 'declined', message: `${player.name} recusou o Trade.` });
      }
      if (busy(player) || busy(from)) return send(player.ws, { type: 'trade-event', event: 'error', message: 'Um dos jogadores já está em Trade ou PvP.' });
      const created = {
        id: crypto.randomUUID(), a: from.id, b: player.id, phase: 'open',
        offers: { a: sanitizeOffer(), b: sanitizeOffer() },
        confirmed: { a: false, b: false }, verified: { a: null, b: null }
      };
      trades.set(created.id, created);
      from.tradeId = player.tradeId = created.id;
      return pushTrade(created);
    }
    if (!trade) return;
    const side = trade.a === player.id ? 'a' : 'b';
    if (action === 'cancel') return endTrade(trade, 'cancelled', `${player.name} cancelou o Trade.`);
    if (action === 'offer' && trade.phase === 'open') {
      trade.offers[side] = sanitizeOffer(payload.offer);
      trade.confirmed.a = trade.confirmed.b = false;
      return pushTrade(trade);
    }
    if (action === 'confirm' && trade.phase === 'open') {
      trade.confirmed[side] = true;
      pushTrade(trade);
      if (trade.confirmed.a && trade.confirmed.b) {
        // Fase 2: cada cliente confere se ainda tem o que ofereceu e se cabe o que vai receber.
        trade.phase = 'verifying';
        for (const s of ['a', 'b']) {
          const p = players.get(trade[s]);
          const other = s === 'a' ? 'b' : 'a';
          if (p) send(p.ws, { type: 'trade-verify', tradeId: trade.id, give: trade.offers[s], receive: trade.offers[other] });
        }
        trade.verifyTimer = setTimeout(() => {
          if (trades.has(trade.id)) endTrade(trade, 'cancelled', 'O Trade não foi confirmado a tempo.');
        }, 10000);
      }
      return;
    }
    if (action === 'verified' && trade.phase === 'verifying' && payload.tradeId === trade.id) {
      if (!payload.ok) {
        clearTimeout(trade.verifyTimer);
        return endTrade(trade, 'cancelled', payload.message ? text(payload.message, 160) : 'Um dos jogadores não tem mais os itens ou não tem espaço.');
      }
      trade.verified[side] = true;
      if (trade.verified.a && trade.verified.b) {
        clearTimeout(trade.verifyTimer);
        trades.delete(trade.id);
        for (const s of ['a', 'b']) {
          const p = players.get(trade[s]);
          const other = s === 'a' ? 'b' : 'a';
          const partner = players.get(trade[other]);
          if (!p) continue;
          p.tradeId = null;
          send(p.ws, { type: 'trade-complete', tradeId: trade.id, give: trade.offers[s], receive: trade.offers[other], partnerName: partner?.name || 'Jogador' });
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // PvP
  // ------------------------------------------------------------------
  function sanitizeSheet(sheet = {}, player) {
    const spells = {};
    for (const s of (Array.isArray(sheet.spells) ? sheet.spells : []).slice(0, 10)) {
      const id = text(s.id, 60);
      if (!id) continue;
      spells[id] = {
        id,
        name: text(s.name, 40),
        kind: ['attack', 'healing', 'buff', 'speed'].includes(s.kind) ? s.kind : 'attack',
        value: num(s.value, 0, 1e12, 0),
        kiCost: num(s.kiCost, 0, 1e12, 0),
        cooldownMs: num(s.cooldownMs, 500, 600000, 1000),
        range: num(s.range, 1, 10, 5),
        durationMs: num(s.durationMs, 0, 120000, 10000)
      };
    }
    const maxHp = num(sheet.maxHp, 1, 1e12, 100);
    const maxKi = num(sheet.maxKi, 1, 1e12, 100);
    return {
      name: player.name,
      level: player.level,
      sprite: text(sheet.sprite || player.sprite, 200),
      maxHp, maxKi,
      attack: num(sheet.attack, 1, 1e12, 10),
      attackInterval: num(sheet.attackInterval, 300, 5000, 1200),
      criticalChance: num(sheet.criticalChance, 0, 0.75, 0.05),
      attackRange: Math.round(num(sheet.attackRange, 1, 6, 1)),
      kiRegen: num(sheet.kiRegen, 0, 1e12, maxKi * 0.02),
      spells
    };
  }
  function sanitizeWager(currency, amount) {
    const c = ['zeni', 'premium'].includes(currency) ? currency : 'none';
    const a = c === 'none' ? 0 : Math.floor(num(amount, 0, 1e13, 0));
    return { currency: a > 0 ? c : 'none', amount: a, pot: a * 2 };
  }
  function fighter(conn, sheet, x) {
    const p = players.get(conn);
    return {
      conn, id: p.profileId, sheet, name: sheet.name, level: sheet.level, sprite: sheet.sprite,
      x, y: Math.floor(PVP_HEIGHT / 2), hp: sheet.maxHp, maxHp: sheet.maxHp, ki: sheet.maxKi, maxKi: sheet.maxKi,
      targetId: null, cooldowns: {}, basicAttackReadyAt: 0, lastMoveAt: 0, buffs: []
    };
  }
  function duelView(duel, conn) {
    const own = duel.fighters.find(f => f.conn === conn);
    return {
      id: duel.id, ownId: own?.id, startsAt: duel.startsAt, serverTime: Date.now(),
      width: PVP_WIDTH, height: PVP_HEIGHT, wager: duel.wager,
      players: duel.fighters.map(f => ({
        id: f.id, name: f.name, level: f.level, sprite: f.sprite, x: f.x, y: f.y,
        hp: Math.max(0, Math.round(f.hp)), maxHp: Math.round(f.maxHp), ki: Math.round(f.ki), maxKi: Math.round(f.maxKi),
        targetId: f.targetId, cooldowns: f.cooldowns, basicAttackReadyAt: f.basicAttackReadyAt,
        basicAttackRange: f.sheet.attackRange,
        buffs: f.buffs.map(b => ({ kind: b.kind, name: b.name, expiresAt: b.expiresAt }))
      }))
    };
  }
  function pushDuel(duel) {
    duel.dirty = false;
    for (const f of duel.fighters) {
      const p = players.get(f.conn);
      if (p) send(p.ws, { type: 'pvp-state', duel: duelView(duel, f.conn), serverTime: Date.now() });
    }
  }
  function duelEvent(duel, event, message, extra = {}) {
    for (const f of duel.fighters) {
      const p = players.get(f.conn);
      if (p) send(p.ws, { type: 'pvp-event', event, message, ...extra });
    }
  }
  function endDuel(duel, winner, reason) {
    if (!duels.has(duel.id)) return;
    duels.delete(duel.id);
    clearInterval(duel.timer);
    for (const f of duel.fighters) {
      const p = players.get(f.conn);
      if (!p) continue;
      p.duelId = null;
      const won = winner ? f === winner : null;
      send(p.ws, {
        type: 'pvp-result', won, reason, wager: duel.wager,
        opponentName: duel.fighters.find(o => o !== f)?.name || ''
      });
    }
  }
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const buffActive = (f, kind, now) => f.buffs.some(b => b.kind === kind && b.expiresAt > now);
  function hit(duel, attacker, target, base, label, now) {
    const critical = Math.random() < attacker.sheet.criticalChance;
    const buff = buffActive(attacker, 'buff', now) ? 1.25 : 1;
    const damage = Math.max(1, Math.floor(base * PVP_DAMAGE_FACTOR * buff * (0.9 + Math.random() * 0.2) * (critical ? 1.65 : 1)));
    target.hp -= damage;
    duelEvent(duel, 'hit', '', { attackerId: attacker.id, targetId: target.id, damage, critical, label });
    if (target.hp <= 0) endDuel(duel, attacker, `${attacker.name} venceu ${target.name}.`);
  }
  function tickDuel(duel) {
    const now = Date.now();
    if (now < duel.startsAt) return;
    if (now - duel.startsAt > PVP_MAX_MS) {
      const [a, b] = duel.fighters;
      const pa = a.hp / a.maxHp, pb = b.hp / b.maxHp;
      return endDuel(duel, pa === pb ? null : pa > pb ? a : b, 'Tempo esgotado: vence quem tem mais vida.');
    }
    for (const f of duel.fighters) {
      f.ki = Math.min(f.maxKi, f.ki + f.sheet.kiRegen * PVP_TICK_MS / 1000);
      f.buffs = f.buffs.filter(b => b.expiresAt > now);
      const target = duel.fighters.find(o => o.id === f.targetId);
      if (target && dist(f, target) <= f.sheet.attackRange && now >= f.basicAttackReadyAt) {
        f.basicAttackReadyAt = now + f.sheet.attackInterval;
        hit(duel, f, target, f.sheet.attack, 'basic', now);
        if (!duels.has(duel.id)) return;
      }
    }
    duel.dirty = true;
    if (now - (duel.lastPush || 0) >= 200) { duel.lastPush = now; pushDuel(duel); }
  }
  function startDuel(challenger, cSheet, accepter, aSheet, wager) {
    const duel = {
      id: crypto.randomUUID(), wager, startsAt: Date.now() + PVP_COUNTDOWN_MS,
      fighters: [fighter(challenger.id, cSheet, 2), fighter(accepter.id, aSheet, PVP_WIDTH - 3)]
    };
    // Cada um já começa mirando o outro: no celular não precisa achar o inimigo para atacar.
    duel.fighters[0].targetId = duel.fighters[1].id;
    duel.fighters[1].targetId = duel.fighters[0].id;
    duels.set(duel.id, duel);
    challenger.duelId = accepter.duelId = duel.id;
    duel.timer = setInterval(() => tickDuel(duel), PVP_TICK_MS);
    pushDuel(duel);
  }
  function duelOf(player) {
    return player.duelId ? duels.get(player.duelId) : null;
  }

  function pvpAction(player, action, payload = {}) {
    const now = Date.now();
    const duel = duelOf(player);
    if (action === 'status') {
      return send(player.ws, { type: 'pvp-state', duel: duel ? duelView(duel, player.id) : null, serverTime: now });
    }
    if (action === 'challenge') {
      const target = byProfile(payload.characterId);
      if (!target || target === player) return send(player.ws, { type: 'pvp-event', event: 'error', message: 'Jogador não está online na cidade.' });
      if (busy(player) || busy(target)) return send(player.ws, { type: 'pvp-event', event: 'error', message: 'Um dos jogadores já está em Trade ou PvP.' });
      if (target.activity && target.activity !== 'world') return send(player.ws, { type: 'pvp-event', event: 'error', message: `${target.name} está ocupado fora do PZ.` });
      const wager = sanitizeWager(payload.wagerCurrency ?? payload.currency, payload.wagerAmount ?? payload.amount);
      pvpInvites.set(target.id, { fromConn: player.id, wager, sheet: sanitizeSheet(payload.sheet, player), expiresAt: now + INVITE_MS });
      send(target.ws, { type: 'pvp-invite', fromId: player.profileId, fromName: player.name, fromLevel: player.level, wager, expiresAt: now + INVITE_MS });
      return send(player.ws, { type: 'pvp-event', event: 'sent', message: `Desafio enviado para ${target.name}. Aguardando resposta...` });
    }
    if (action === 'accept' || action === 'decline') {
      const invite = pvpInvites.get(player.id);
      pvpInvites.delete(player.id);
      const from = invite && invite.expiresAt > now ? players.get(invite.fromConn) : null;
      if (!from) return send(player.ws, { type: 'pvp-event', event: 'expired', message: 'O desafio PvP expirou.' });
      if (action === 'decline') {
        send(player.ws, { type: 'pvp-event', event: 'declined', message: 'Desafio recusado.' });
        return send(from.ws, { type: 'pvp-event', event: 'declined', message: `${player.name} recusou o duelo.` });
      }
      if (busy(player) || busy(from)) return send(player.ws, { type: 'pvp-event', event: 'error', message: 'Um dos jogadores já está em Trade ou PvP.' });
      return startDuel(from, invite.sheet, player, sanitizeSheet(payload.sheet, player), invite.wager);
    }
    if (!duel) return;
    const me = duel.fighters.find(f => f.conn === player.id);
    const enemy = duel.fighters.find(f => f !== me);
    if (action === 'forfeit') return endDuel(duel, enemy, `${me.name} abandonou o duelo.`);
    if (now < duel.startsAt) return;
    if (action === 'move') {
      const step = buffActive(me, 'speed', now) ? 110 : 220;
      if (now - me.lastMoveAt < step) return;
      const dx = Math.sign(num(payload.dx, -1, 1, 0)), dy = Math.sign(num(payload.dy, -1, 1, 0));
      const nx = Math.max(0, Math.min(PVP_WIDTH - 1, me.x + dx));
      const ny = Math.max(0, Math.min(PVP_HEIGHT - 1, me.y + dy));
      if (nx === enemy.x && ny === enemy.y) return;
      me.x = nx; me.y = ny; me.lastMoveAt = now;
      return pushDuel(duel);
    }
    if (action === 'target') {
      me.targetId = String(payload.targetId || '') === enemy.id ? enemy.id : null;
      return pushDuel(duel);
    }
    if (action === 'cast') {
      const spell = me.sheet.spells[text(payload.spellId, 60)];
      if (!spell) return send(player.ws, { type: 'pvp-event', event: 'error', message: 'Magia indisponível no duelo.' });
      if (Number(me.cooldowns[spell.id] || 0) > now) return;
      if (me.ki < spell.kiCost) return send(player.ws, { type: 'pvp-event', event: 'error', message: 'Ki insuficiente.' });
      if (spell.kind === 'attack') {
        if (me.targetId !== enemy.id) return send(player.ws, { type: 'pvp-event', event: 'error', message: 'Selecione o inimigo como target primeiro.' });
        if (dist(me, enemy) > spell.range) return send(player.ws, { type: 'pvp-event', event: 'error', message: 'O alvo está fora do alcance.' });
      }
      me.ki -= spell.kiCost;
      me.cooldowns[spell.id] = now + spell.cooldownMs;
      if (spell.kind === 'attack') hit(duel, me, enemy, spell.value || me.sheet.attack * 2, spell.name, now);
      else if (spell.kind === 'healing') {
        const healed = Math.min(me.maxHp - me.hp, Math.max(1, spell.value));
        me.hp += healed;
        duelEvent(duel, 'heal', '', { targetId: me.id, value: Math.round(healed) });
      } else {
        me.buffs = me.buffs.filter(b => b.kind !== spell.kind);
        me.buffs.push({ kind: spell.kind, name: spell.name, expiresAt: now + Math.max(3000, spell.durationMs) });
      }
      if (duels.has(duel.id)) pushDuel(duel);
    }
  }

  // ------------------------------------------------------------------
  // Mensagens e saída de jogador
  // ------------------------------------------------------------------
  const handlers = {
    'profile-card'(player, msg) {
      player.card = sanitizeCard(msg.profile);
    },
    'profile-request'(player, msg) {
      const target = byProfile(msg.characterId);
      if (!target || !target.card) {
        return send(player.ws, { type: 'character-profile', ok: false, message: 'Jogador não está online agora.' });
      }
      send(player.ws, { type: 'character-profile', ok: true, profile: { ...target.card, id: target.profileId, name: target.name, level: target.level, isSelf: false } });
    },
    'trade-action'(player, msg) {
      tradeAction(player, text(msg.action, 20), msg.payload || {});
    },
    'pvp-action'(player, msg) {
      pvpAction(player, text(msg.action, 20), msg.payload || {});
    }
  };

  function onLeave(player) {
    tradeInvites.delete(player.id);
    pvpInvites.delete(player.id);
    const trade = tradeOf(player);
    if (trade) {
      clearTimeout(trade.verifyTimer);
      endTrade(trade, 'cancelled', `${player.name} saiu do jogo. Trade cancelado.`);
    }
    const duel = duelOf(player);
    if (duel) {
      const enemy = duel.fighters.find(f => f.conn !== player.id);
      endDuel(duel, enemy, `${player.name} desconectou. Vitória por abandono.`);
    }
  }

  return { handlers, onLeave };
}

module.exports = { attachInteractions };
