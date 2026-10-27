/* ==========================================================================
   Forgotten Lands Wiki — comportamento (V22)
   Compatível com o HTML já gerado: [data-menu], [data-nav], .data-card>header,
   [data-search], [data-filter], [data-search-row], [data-result-count],
   [data-empty]. Nada aqui depende de dados novos.
   ========================================================================== */
(() => {
  'use strict';

  const html = document.documentElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  html.classList.add('js-reveal');

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  /* ---------------------------------------------------------------- menu */
  const menuButton = $('[data-menu]');
  const nav = $('[data-nav]');
  menuButton?.addEventListener('click', () => {
    const open = nav?.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(Boolean(open)));
  });
  document.addEventListener('click', event => {
    if (!nav?.classList.contains('open')) return;
    if (nav.contains(event.target) || menuButton?.contains(event.target)) return;
    nav.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });

  // Marca o link da página atual sem precisar tocar em cada HTML gerado.
  const path = location.pathname.replace(/index\.html$/, '');
  for (const link of $$('nav[data-nav] a')) {
    const href = link.getAttribute('href') || '';
    if (href !== '/' && path.startsWith(href)) link.setAttribute('aria-current', 'page');
  }

  /* ------------------------------------------------- barra fixa + scroll */
  const topbar = $('.wiki-topbar');
  const progress = document.createElement('div');
  progress.className = 'wiki-progress';
  document.body.prepend(progress);

  const toTop = document.createElement('button');
  toTop.type = 'button';
  toTop.className = 'to-top';
  toTop.setAttribute('aria-label', 'Voltar ao topo');
  toTop.textContent = '↑';
  toTop.addEventListener('click', () =>
    scrollTo({top: 0, behavior: reduceMotion ? 'auto' : 'smooth'})
  );
  document.body.append(toTop);

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const top = scrollY;
      const max = Math.max(1, document.body.scrollHeight - innerHeight);
      progress.style.width = `${Math.min(100, (top / max) * 100)}%`;
      topbar?.classList.toggle('scrolled', top > 12);
      toTop.classList.toggle('visible', top > 640);
      ticking = false;
    });
  };
  addEventListener('scroll', onScroll, {passive: true});
  onScroll();

  /* -------------------------------- catálogo de vocações V21.26.4 */
  // O HTML da wiki é pré-gerado. Esta normalização mantém a página correta
  // mesmo quando uma geração anterior deixou aliases duplicados ou fora da
  // ordem de publicação desejada.
  const vocationGrids = $$('.vocation-v2126-grid');
  if (vocationGrids.length) {
    const activeGrid = vocationGrids[0];
    const pendingGrid = vocationGrids[1] || activeGrid;
    const cards = $$('.vocation-card[data-search-row]');
    const canonicalScore = card => {
      const name = $('h3', card)?.textContent.trim() || '';
      if (card.id === 'broly' && name === 'Broly') return 2;
      if (card.id === 'shenron' && name === 'Li Shenron') return 2;
      return 1;
    };
    const unique = new Map();

    for (const card of cards) {
      const previous = unique.get(card.id);
      if (!previous) {
        unique.set(card.id, card);
      } else if (canonicalScore(card) > canonicalScore(previous)) {
        previous.remove();
        unique.set(card.id, card);
      } else {
        card.remove();
      }
    }

    const renameCard = (card, name) => {
      const title = $('h3', card);
      const portrait = $('img.portrait', card);
      if (title) title.textContent = name;
      if (portrait) portrait.alt = name;
      if (card.id === 'broly') {
        card.dataset.searchText = (card.dataset.searchText || '').replace(/\bBrolly\b/g, 'Broly');
      } else if (card.id === 'shenron') {
        card.dataset.searchText = (card.dataset.searchText || '').replace(/^Shenron\b/, 'Li Shenron');
      }
    };

    const categoryOf = card => {
      if (card.classList.contains('pending-card') || $('.category-pending', card)) return 'pending';
      if ($('.category-vip', card)) return 'vip';
      if ($('.category-quest', card)) return 'quest';
      return 'free';
    };
    const rank = {free:0, vip:1, quest:2, pending:3};
    const collator = new Intl.Collator('pt-BR', {sensitivity:'base', numeric:true});
    const ordered = [...unique.values()];

    for (const card of ordered) {
      if (card.id === 'broly') renameCard(card, 'Broly');
      if (card.id === 'shenron') renameCard(card, 'Li Shenron');
      if (card.id === 'champa') {
        card.dataset.searchText = (card.dataset.searchText || '').replace(
          /(Super Reborn 9)\s+(?:\d+\s+){8}\d+/,
          '$1 1309 1310 1311 1370 1371 1372 1373 1343 1313'
        );
      }
    }

    ordered.sort((a, b) => {
      const categoryDifference = rank[categoryOf(a)] - rank[categoryOf(b)];
      if (categoryDifference) return categoryDifference;
      return collator.compare($('h3', a)?.textContent || '', $('h3', b)?.textContent || '');
    });
    for (const card of ordered) {
      (categoryOf(card) === 'pending' ? pendingGrid : activeGrid).append(card);
    }
  }

  for (const node of $$('.hero-mini .kicker, .wiki-footer small')) {
    node.textContent = node.textContent.replace(/21\.26\.3/g, '21.26.4');
  }

  /* -------------------------------------------------------- acordeões */
  // Altura medida na hora da abertura: o conteúdo de uma Hunt varia muito,
  // então um max-height fixo ou cortaria drops ou deixaria a animação lenta.
  const openCard = card => {
    const detail = $('.detail', card);
    if (detail) {
      detail.style.maxHeight = '';
      detail.style.setProperty('--detail-h', `${detail.scrollHeight + 48}px`);
      // Depois da animação o limite sai do caminho: as imagens do card são
      // lazy e crescem depois de abrir, e um max-height fixo cortaria drops.
      detail.addEventListener('transitionend', function done(event) {
        if (event.propertyName !== 'max-height') return;
        detail.removeEventListener('transitionend', done);
        if (card.classList.contains('open')) detail.style.maxHeight = 'none';
      });
    }
    card.classList.add('open');
    revealImages(card);
  };
  const closeCard = card => {
    const detail = $('.detail', card);
    if (detail && detail.style.maxHeight === 'none') {
      detail.style.maxHeight = `${detail.scrollHeight}px`;
      // Força um reflow para o navegador animar a partir da altura real.
      void detail.offsetHeight;
      detail.style.maxHeight = '';
    }
    card.classList.remove('open');
  };

  for (const header of $$('.data-card>header')) {
    const card = header.parentElement;
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');
    const toggle = () => {
      const willOpen = !card.classList.contains('open');
      if (willOpen) openCard(card); else closeCard(card);
      header.setAttribute('aria-expanded', String(willOpen));
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  }

  // Tabelas largas ganham rolagem própria em vez de estourar o card.
  for (const table of $$('.detail > .source-table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.append(table);
  }

  /* ------------------------------------------------------------- busca */
  const input = $('[data-search]');
  const filter = $('[data-filter]');
  const rows = $$('[data-search-row]');
  const counter = $('[data-result-count]');
  const empty = $('[data-empty]');
  const toolbar = $('.toolbar');

  // "vocações" tem que ser achado digitando "vocacoes".
  const normalize = value => String(value || '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  // O texto de busca de cada linha é calculado uma vez só: em páginas como
  // Hunts são centenas de nós, e ler textContent a cada tecla trava.
  const index = rows.map(element => ({
    element,
    text: normalize(element.dataset.searchText || element.textContent || ''),
    kind: element.dataset.filter || ''
  }));

  const params = new URLSearchParams(location.search);
  if (input && params.get('q')) input.value = params.get('q');
  if (filter && params.get('f')) filter.value = params.get('f');

  let lastQuery = null;

  function run(updateUrl = false) {
    const raw = (input?.value || '').trim();
    const terms = normalize(raw).split(/\s+/).filter(Boolean);
    const kind = filter?.value || '';
    let visible = 0;

    for (const entry of index) {
      const matches =
        (!terms.length || terms.every(term => entry.text.includes(term))) &&
        (!kind || kind === entry.kind);
      entry.element.classList.toggle('search-hidden', !matches);
      if (matches) visible += 1;
    }

    // Seções de transformação sem nenhuma forma visível somem junto.
    for (const group of $$('[data-transform-group]')) {
      const anyVisible = $$('[data-search-row]', group)
        .some(row => !row.classList.contains('search-hidden'));
      group.classList.toggle('search-hidden', !anyVisible);
    }

    if (counter) {
      counter.textContent = raw || kind
        ? `${visible} de ${index.length} resultado${visible === 1 ? '' : 's'}`
        : `${index.length} resultado${index.length === 1 ? '' : 's'}`;
    }
    if (empty) empty.style.display = visible ? 'none' : 'block';

    highlight(terms, visible);

    if (updateUrl && raw !== lastQuery) {
      lastQuery = raw;
      const next = new URLSearchParams();
      if (raw) next.set('q', raw);
      if (kind) next.set('f', kind);
      const query = next.toString();
      history.replaceState(null, '', query ? `?${query}` : location.pathname);
    }
  }

  // Destaque só nos títulos das primeiras linhas visíveis: marcar tudo em
  // uma página com 600 cards custa mais do que ajuda.
  const HIGHLIGHT_LIMIT = 60;
  let highlighted = [];
  function highlight(terms, visible) {
    for (const node of highlighted) node.innerHTML = node.dataset.plain;
    highlighted = [];
    if (!terms.length || !visible) return;

    const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
    let used = 0;
    for (const entry of index) {
      if (used >= HIGHLIGHT_LIMIT) break;
      if (entry.element.classList.contains('search-hidden')) continue;
      const title = entry.element.querySelector('h3, h2, b');
      if (!title) continue;
      if (!title.dataset.plain) title.dataset.plain = title.innerHTML;
      const plain = title.textContent;
      // Compara sem acento, mas recorta no texto original.
      const marked = plain.replace(pattern, '<mark>$1</mark>');
      const loose = markLoose(plain, terms);
      title.innerHTML = marked !== plain ? marked : loose;
      if (title.innerHTML !== title.dataset.plain) highlighted.push(title);
      used += 1;
    }
  }

  function markLoose(text, terms) {
    const flat = normalize(text);
    const ranges = [];
    for (const term of terms) {
      let from = flat.indexOf(term);
      while (from !== -1) {
        ranges.push([from, from + term.length]);
        from = flat.indexOf(term, from + term.length);
      }
    }
    if (!ranges.length) return text;
    ranges.sort((a, b) => a[0] - b[0]);
    let out = '';
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start < cursor) continue;
      out += escapeHtml(text.slice(cursor, start)) +
        `<mark>${escapeHtml(text.slice(start, end))}</mark>`;
      cursor = end;
    }
    return out + escapeHtml(text.slice(cursor));
  }

  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapeHtml = value => value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let debounce = 0;
  input?.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => run(true), 130);
  });
  filter?.addEventListener('change', () => run(true));

  /* ------------------------------------------- ações extras da toolbar */
  if (toolbar && $('.data-card')) {
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'toolbar-action';
    expand.textContent = 'Expandir tudo';
    let expanded = false;
    expand.addEventListener('click', () => {
      expanded = !expanded;
      const cards = $$('.data-card').filter(card => !card.classList.contains('search-hidden'));
      for (const card of cards) {
        if (expanded) openCard(card); else closeCard(card);
        $('header', card)?.setAttribute('aria-expanded', String(expanded));
      }
      expand.textContent = expanded ? 'Recolher tudo' : 'Expandir tudo';
    });
    toolbar.append(expand);
  }
  if (toolbar && input) {
    const hint = document.createElement('kbd');
    hint.textContent = '/';
    hint.title = 'Atalho para focar a busca';
    toolbar.append(hint);
  }

  addEventListener('keydown', event => {
    if (event.key === '/' && document.activeElement !== input) {
      event.preventDefault();
      input?.focus();
      input?.select();
    }
    if (event.key === 'Escape' && document.activeElement === input && input.value) {
      input.value = '';
      run(true);
    }
  });

  /* ---------------------------------------------------- entrada suave */
  const revealTargets = $$(
    '.card, .data-card, .transform-section, .stat, .guide-body article, .tutorial-figure'
  );
  for (const element of revealTargets) element.setAttribute('data-reveal', '');

  if ('IntersectionObserver' in window && !reduceMotion) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    }, {rootMargin: '0px 0px -8% 0px', threshold: 0.05});
    for (const element of revealTargets) observer.observe(element);
  } else {
    for (const element of revealTargets) element.classList.add('revealed');
  }

  /* ----------------------------------------------- imagens com fade-in */
  function revealImages(scope = document) {
    for (const image of $$('img[loading="lazy"]', scope)) {
      if (image.complete) image.classList.add('is-loaded');
      else image.addEventListener('load', () => image.classList.add('is-loaded'), {once: true});
      image.addEventListener('error', () => image.classList.add('is-loaded'), {once: true});
    }
  }
  revealImages();

  /* -------------------------------------------- brilho que segue o mouse */
  if (matchMedia('(hover: hover)').matches && !reduceMotion) {
    for (const card of $$('.card')) {
      card.addEventListener('pointermove', event => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - box.left}px`);
        card.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
    }
  }

  /* ------------------------------------------------- índice dos guias */
  const tocLinks = $$('.toc a[href^="#"]');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const sections = tocLinks
      .map(link => document.getElementById(link.getAttribute('href').slice(1)))
      .filter(Boolean);
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of tocLinks) {
          link.classList.toggle(
            'active',
            link.getAttribute('href') === `#${entry.target.id}`
          );
        }
      }
    }, {rootMargin: '-90px 0px -70% 0px'});
    for (const section of sections) spy.observe(section);
  }

  run(false);
})();
