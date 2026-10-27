// =====================================================================
// Forgotten Lands - idiomas (Português / English).
//
// O jogo é escrito em português e redesenha a tela o tempo todo com
// innerHTML. Em vez de espalhar t('...') por milhares de linhas, esta
// camada observa o DOM e traduz cada texto (e placeholder/title/alt) que
// aparece, usando dictionary-en.js. Voltar para PT restaura o original.
//
// O idioma fica em localStorage ('fl-lang') e é o mesmo da página inicial.
// =====================================================================
import { EN, PATTERNS_EN, AREAS_EN } from './dictionary-en.js?v=22.8.0';

const STORAGE_KEY = 'fl-lang';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'NOSCRIPT']);
const original = new WeakMap(); // nó de texto -> texto em PT
const written = new WeakMap(); // nó de texto -> último texto que escrevemos
const originalAttr = new WeakMap(); // elemento -> {attr: texto PT}

function detectLanguage() {
  try {
    const fromQuery = new URL(location.href).searchParams.get('lang');
    if (fromQuery === 'pt' || fromQuery === 'en') {
      localStorage.setItem(STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'pt' || saved === 'en') return saved;
  } catch {}
  return /^pt\b/i.test(navigator.language || '') ? 'pt' : 'en';
}

let lang = detectLanguage();
export function getLanguage() { return lang; }

function translatePhrase(phrase) {
  let out = EN[phrase];
  if (out !== undefined) return out;
  for (const [re, rep] of PATTERNS_EN) {
    if (re.test(phrase)) return phrase.replace(re, rep);
  }
  // Nome de área de caça, inclusive a versão VIP ("Bosque dos Dinos VIP").
  const vip = / VIP$/.test(phrase);
  const area = AREAS_EN[vip ? phrase.slice(0, -4) : phrase];
  if (area !== undefined) return vip ? `${area} VIP` : area;
  return undefined;
}

const cache = new Map();
export function translate(text) {
  if (lang === 'pt' || !text) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const result = translateUncached(text);
  if (cache.size > 5000) cache.clear();
  cache.set(text, result);
  return result;
}

function translateUncached(text) {
  const trimmed = text.trim();
  if (!trimmed || !/[A-Za-zÀ-ú]/.test(trimmed)) return text;
  // Templates quebram linha no meio da frase; para achar no dicionário,
  // os espaços internos viram um só.
  const phrase = trimmed.replace(/\s+/g, ' ');
  let out = translatePhrase(phrase);
  // "Bosque dos Dinos · Dino", "Lv 10 · Vegeta"...: traduz parte por parte.
  if (out === undefined && phrase.includes(' · ')) {
    const parts = phrase.split(' · ');
    const translated = parts.map(part => translatePhrase(part) ?? part);
    if (translated.some((part, i) => part !== parts[i])) out = translated.join(' · ');
  }
  if (out === undefined) return text;
  const start = text.indexOf(trimmed);
  return text.slice(0, start) + out + text.slice(start + trimmed.length);
}

function translateTextNode(node) {
  const current = node.data;
  if (written.get(node) === current) return;
  // O jogo escreveu algo novo neste nó: isso passa a ser o original.
  original.set(node, current);
  const next = translate(current);
  if (next !== current) {
    written.set(node, next);
    node.data = next;
  } else {
    written.delete(node);
  }
}

function translateAttributes(el) {
  let saved = originalAttr.get(el);
  for (const attr of ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const value = el.getAttribute(attr);
    if (saved && saved[`w:${attr}`] === value) continue;
    if (!saved) { saved = {}; originalAttr.set(el, saved); }
    saved[attr] = value;
    const next = translate(value);
    if (next !== value) {
      saved[`w:${attr}`] = next;
      el.setAttribute(attr, next);
    }
  }
}

function walk(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!SKIP.has(root.parentNode?.nodeName)) translateTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (SKIP.has(root.nodeName)) return;
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) return SKIP.has(node.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
    else translateAttributes(node);
    node = walker.nextNode();
  }
}

// Volta tudo para o texto original (português).
function restore(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const pt = original.get(node);
      if (pt !== undefined && written.get(node) === node.data) node.data = pt;
      written.delete(node);
    } else {
      const saved = originalAttr.get(node);
      if (saved) {
        for (const attr of ATTRS) {
          if (saved[attr] !== undefined && saved[`w:${attr}`] === node.getAttribute(attr)) node.setAttribute(attr, saved[attr]);
        }
        originalAttr.delete(node);
      }
    }
    node = walker.nextNode();
  }
}

const observer = new MutationObserver(mutations => {
  if (lang === 'pt') return;
  for (const m of mutations) {
    if (m.type === 'characterData') {
      if (!SKIP.has(m.target.parentNode?.nodeName)) translateTextNode(m.target);
    } else if (m.type === 'attributes') {
      translateAttributes(m.target);
    } else {
      m.addedNodes.forEach(walk);
    }
  }
});

// Textos desenhados no canvas (arena da hunt, mapa) não estão no DOM: o
// fillText/measureText passa pela mesma tradução.
for (const proto of [globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype]) {
  if (!proto) continue;
  for (const name of ['fillText', 'strokeText', 'measureText']) {
    const native = proto[name];
    proto[name] = function (text, ...rest) {
      return native.call(this, typeof text === 'string' && lang !== 'pt' ? translate(text) : text, ...rest);
    };
  }
}

// confirm/alert/prompt do jogo também saem no idioma escolhido.
for (const name of ['alert', 'confirm', 'prompt']) {
  const native = window[name]?.bind(window);
  if (native) window[name] = (message, ...rest) => native(translate(String(message ?? '')), ...rest);
}

const listeners = new Set();
export function onLanguageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setLanguage(next) {
  if (next !== 'pt' && next !== 'en') return;
  try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  if (next === lang) return;
  lang = next;
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  if (lang === 'pt') restore(document.body);
  else walk(document.body);
  syncSwitches();
  listeners.forEach(fn => { try { fn(lang); } catch {} });
}

// ---------------------------------------------------------------------
// Seletor PT | EN
// ---------------------------------------------------------------------
const SWITCH_CSS = `
.fl-lang-switch{display:inline-flex;gap:2px;padding:2px;border-radius:999px;background:#0b1220cc;border:1px solid #ffffff26;font:700 11px/1 system-ui,sans-serif;vertical-align:middle}
.fl-lang-switch button{all:unset;cursor:pointer;padding:5px 8px;border-radius:999px;color:#9fb0cc;letter-spacing:.5px}
.fl-lang-switch button[aria-pressed="true"]{background:linear-gradient(180deg,#ffdf8e,#f5c35b);color:#2b1500}
.fl-lang-floating{position:fixed;top:10px;right:10px;z-index:9999}
.client-logo .fl-lang-switch{margin-left:10px}
.account-panel .fl-lang-switch,.character-panel .fl-lang-switch{position:absolute;top:14px;right:14px}
.account-panel,.character-panel{position:relative}`;

function makeSwitch() {
  const box = document.createElement('div');
  box.className = 'fl-lang-switch';
  box.setAttribute('role', 'group');
  box.dataset.flLang = '1';
  for (const [code, label] of [['pt', 'PT'], ['en', 'EN']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.lang = code;
    b.textContent = label;
    b.setAttribute('aria-pressed', String(lang === code));
    b.addEventListener('click', event => { event.stopPropagation(); setLanguage(code); });
    box.appendChild(b);
  }
  return box;
}
function syncSwitches() {
  document.querySelectorAll('[data-fl-lang] button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}

// Coloca o seletor no topo do jogo ou no painel de login/personagens. As
// telas são refeitas a cada render, então isso roda de novo quando somem.
function placeSwitch() {
  const host = document.querySelector('.client-logo') || document.querySelector('.account-panel, .character-panel');
  const floating = document.querySelector('.fl-lang-floating');
  if (host) {
    floating?.remove();
    if (!host.querySelector('[data-fl-lang]')) host.appendChild(makeSwitch());
  } else if (!floating) {
    const wrap = makeSwitch();
    wrap.classList.add('fl-lang-floating');
    document.body.appendChild(wrap);
  }
}

export function startI18n() {
  const style = document.createElement('style');
  style.textContent = SWITCH_CSS;
  document.head.appendChild(style);
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  if (lang === 'en') {
    walk(document.body);
    document.title = translate(document.title);
  }
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ATTRS
  });
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; placeSwitch(); });
  }).observe(document.body, { childList: true, subtree: true });
  placeSwitch();
}
