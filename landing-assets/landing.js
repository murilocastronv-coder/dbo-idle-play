(() => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav-links');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12 });
    reveals.forEach((item) => observer.observe(item));
  } else {
    reveals.forEach((item) => item.classList.add('is-visible'));
  }

  const navAnchors = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  const sections = navAnchors.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const syncActive = () => {
    const y = window.scrollY + 110;
    let current = '#inicio';
    sections.forEach((section) => { if (section.offsetTop <= y) current = `#${section.id}`; });
    navAnchors.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === current));
  };
  window.addEventListener('scroll', syncActive, { passive: true });
  syncActive();

  const setServerStatus = (online, version = '') => {
    const dots = [document.getElementById('server-dot'), document.getElementById('footer-server-dot')].filter(Boolean);
    dots.forEach((dot) => { dot.classList.remove('online','offline'); dot.classList.add(online ? 'online' : 'offline'); });
    const main = document.getElementById('server-status');
    const footer = document.getElementById('footer-server-status');
    const label = online ? `Servidor online${version ? ` • v${version}` : ''}` : 'Servidor indisponível';
    if (main) main.textContent = label;
    if (footer) footer.textContent = label;
  };

  fetch('/api/version', { cache: 'no-store' })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error('offline')))
    .then((data) => setServerStatus(true, data?.version || ''))
    .catch(() => setServerStatus(false));
})();

  
  // Live counters are supplied by the multiplayer service. Account totals stay
  // unavailable until persistent server-side accounts are implemented.
  fetch('https://dbo-idle-multiplayer-server.onrender.com/api/stats', { cache: 'no-store' })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error('stats offline')))
    .then((data) => {
      const online = document.getElementById('dbo-online-count');
      const accounts = document.getElementById('dbo-account-count');
      if (online) online.textContent = Number.isFinite(data.onlinePlayers) ? String(data.onlinePlayers) : '—';
      if (accounts) accounts.textContent = Number.isFinite(data.totalAccounts) ? String(data.totalAccounts) : 'Em breve';
    })
    .catch(() => {
      const online = document.getElementById('dbo-online-count');
      const accounts = document.getElementById('dbo-account-count');
      if (online) online.textContent = '—';
      if (accounts) accounts.textContent = 'Em breve';
    });
