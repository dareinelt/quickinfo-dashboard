/**
 * quickinfo Management-Board – Frontend (Vanilla JS, ES2020+, keine Abhängigkeiten)
 */
(function () {
  'use strict';

  // ---------- State ----------
  const state = {
    session: null,       // { authenticated, user, csrf, interval, ranges }
    route: { view: 'dashboard', id: null },
    refreshTimer: null,
    renderToken: 0,
    charts: [],
    range: localStorage.getItem('qb.range') || '1h',
    mode: localStorage.getItem('qb.mode') || 'host',
    lastOverview: null,
  };

  // ---------- Utilities ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICONS = {
    logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#151c2c"/><path d="M6 22 L12 14 L17 18 L26 8" fill="none" stroke="#4f8cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="8" r="3" fill="#37d39a"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
    refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>',
    edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z"/></svg>',
    trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.7 8.5h5.6l.7-8.5"/></svg>',
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>',
    x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    warn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5l6 11H2z"/><path d="M8 7v3M8 12.2v.1"/></svg>',
    link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8"/></svg>',
    server: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2.5" width="12" height="4.5" rx="1"/><rect x="2" y="9" width="12" height="4.5" rx="1"/><path d="M5 4.75h.01M5 11.25h.01"/></svg>',
    cube: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 1.8l5.8 3.4v5.6L8 14.2 2.2 10.8V5.2z"/><path d="M2.2 5.2L8 8.5l5.8-3.3M8 8.5v5.7"/></svg>',
    play: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3l8 5-8 5z"/></svg>',
    stop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>',
    restart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>',
  };
  function icon(name) { const s = h('span', { class: 'ico', html: ICONS[name] }); s.style.display = 'inline-flex'; return s; }

  function fmtBytes(b) {
    if (b === null || b === undefined) return '–';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0; let v = Number(b);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toLocaleString('de-DE', { maximumFractionDigits: v >= 100 ? 0 : 1 }) + ' ' + u[i];
  }
  function fmtPct(v, dec = 0) { return v === null || v === undefined ? '–' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: dec, minimumFractionDigits: 0 }) + ' %'; }
  function fmtTemp(v) { return v === null || v === undefined ? '–' : Math.round(v) + ' °C'; }
  function fmtNum(v, dec = 2) { return v === null || v === undefined ? '–' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: dec }); }
  function fmtUptime(s) {
    if (s === null || s === undefined) return '–';
    s = Math.max(0, Math.floor(s));
    const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
    if (d > 0) return d + ' T ' + hh + ' h';
    if (hh > 0) return hh + ' h ' + mm + ' min';
    return mm + ' min';
  }
  function fmtAgo(ts) {
    if (!ts) return 'nie';
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 5) return 'gerade eben';
    if (s < 60) return 'vor ' + s + ' s';
    if (s < 3600) return 'vor ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'vor ' + Math.floor(s / 3600) + ' h';
    return 'vor ' + Math.floor(s / 86400) + ' T';
  }
  function fmtDateTime(ts) {
    if (!ts) return '–';
    return new Date(ts * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // Schwellenwerte → ok | warn | crit
  const THRESH = {
    cpu: [75, 90], gpu: [75, 90], mem: [80, 90], disk: [80, 90], temp: [70, 80], gpu_temp: [75, 85],
  };
  function level(kind, v) {
    if (v === null || v === undefined) return 'none';
    const t = THRESH[kind];
    if (v >= t[1]) return 'crit';
    if (v >= t[0]) return 'warn';
    return 'ok';
  }
  function nodeLevel(n) {
    const s = n.summary;
    const levels = [level('cpu', s.cpu), level('temp', s.temp), level('mem', s.mem_pct), level('disk', s.disk_pct), level('gpu', s.gpu), level('gpu_temp', s.gpu_temp)];
    if (s.services_down > 0) levels.push('crit');
    if (levels.includes('crit')) return 'crit';
    if (levels.includes('warn')) return 'warn';
    return 'ok';
  }

  const STATUS_LABEL = { online: 'Online', offline: 'Offline', unknown: 'Unbekannt', disabled: 'Deaktiviert' };

  // ---------- Toasts ----------
  function toast(msg, kind = 'info', ms = 4000) {
    const box = document.getElementById('toasts');
    const el = h('div', { class: 'toast ' + kind }, msg);
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
  }

  // ---------- API ----------
  async function api(method, path, body) {
    const opts = { method, headers: { 'Accept': 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (method !== 'GET' && state.session && state.session.csrf) opts.headers['X-CSRF-Token'] = state.session.csrf;
    const res = await fetch('/api/' + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = { error: 'Ungültige Serverantwort (' + res.status + ')' }; }
    if (res.status === 401 && path !== 'login' && path !== 'session') {
      state.session = { authenticated: false, csrf: state.session ? state.session.csrf : null };
      render();
      throw new ApiError('Sitzung abgelaufen. Bitte erneut anmelden.', 401, data);
    }
    if (!res.ok) throw new ApiError(data.error || ('HTTP ' + res.status), res.status, data);
    return data;
  }
  class ApiError extends Error { constructor(m, status, data) { super(m); this.status = status; this.data = data || {}; } }

  // ---------- Router ----------
  function parseRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    if (parts[0] === 'node' && parts[1]) return { view: 'detail', id: parseInt(parts[1], 10) };
    if (parts[0] === 'nodes') return { view: 'nodes', id: null };
    if (parts[0] === 'containers') return { view: 'containers', id: null };
    if (parts[0] === 'container' && parts[1] && parts[2]) return { view: 'containerDetail', id: parts[1] + ':' + parts[2] };
    if (parts[0] === 'settings') return { view: 'settings', id: null };
    return { view: 'dashboard', id: null };
  }
  function navigate(hash) { location.hash = hash; }
  function syncModeFromRoute() {
    const v = state.route.view;
    if (v === 'containers' || v === 'containerDetail') state.mode = 'container';
    else if (v === 'dashboard' || v === 'detail' || v === 'nodes') state.mode = 'host';
    localStorage.setItem('qb.mode', state.mode);
  }
  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    localStorage.setItem('qb.mode', mode);
    navigate(mode === 'container' ? '#/containers' : '#/');
  }
  window.addEventListener('hashchange', () => { state.route = parseRoute(); syncModeFromRoute(); render(); });

  // ---------- Shell ----------
  function clearCharts() { for (const c of state.charts) c.destroy(); state.charts = []; }
  function stopRefresh() { if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; } }
  function startRefresh(fn, token) {
    // Verhindert, dass eine langsam ladende, bereits verlassene Ansicht ihren Timer über die aktuelle legt
    if (token !== undefined && token !== state.renderToken) return;
    stopRefresh();
    const ms = Math.max(10, Math.min(60, (state.session && state.session.interval) || 30)) * 1000 / 2;
    state.refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms);
  }

  function shell(content, activeNav) {
    const user = state.session.user || {};
    const mode = state.mode;
    const items = mode === 'container'
      ? [['containers', '#/containers', 'Container']]
      : [['dashboard', '#/', 'Übersicht'], ['nodes', '#/nodes', 'Server']];
    items.push(['settings', '#/settings', 'Einstellungen']);
    return h('div', { class: 'app' },
      h('div', { class: 'layout' },
        h('aside', { class: 'sidebar' },
          h('a', { class: 'brand', href: '#/' }, h('span', { html: ICONS.logo }), h('span', null, 'quickinfo', h('small', null, 'Board'))),
          h('div', { class: 'view-toggle', role: 'tablist', 'aria-label': 'Ansicht' },
            h('button', { role: 'tab', 'aria-selected': mode === 'host', class: mode === 'host' ? 'active' : '', onClick: () => setMode('host') }, icon('server'), h('span', null, 'Hosts')),
            h('button', { role: 'tab', 'aria-selected': mode === 'container', class: mode === 'container' ? 'active' : '', onClick: () => setMode('container') }, icon('cube'), h('span', null, 'Container'))
          ),
          h('div', { class: 'nav-label' }, mode === 'container' ? 'Docker-Inventar' : 'Inventar'),
          h('nav', { class: 'nav' }, items.map(([id, href, label]) => h('a', { href, class: activeNav === id ? 'active' : '' }, label))),
          h('div', { class: 'spacer' }),
          h('div', { class: 'sidebar-foot' },
            h('span', { class: 'status-pill', id: 'collector-pill' }, h('span', { class: 'dot', style: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--text-muted)' } }), h('span', { class: 'text' }, 'Collector')),
            h('div', { class: 'user-row' }, h('span', { class: 'user' }, user.username || ''), h('button', { class: 'btn ghost sm', onClick: logout }, 'Abmelden'))
          )
        ),
        h('main', { class: 'main' }, content)
      )
    );
  }
  function updateCollectorPill(alive) {
    const pill = document.getElementById('collector-pill');
    if (!pill) return;
    pill.querySelector('.dot').style.background = alive ? 'var(--ok)' : 'var(--crit)';
    pill.querySelector('.text').textContent = alive ? 'Collector aktiv' : 'Collector inaktiv';
    pill.title = alive ? 'Der Hintergrund-Collector liefert Daten.' : 'Der Collector hat seit längerem keine Daten geliefert. Läuft der Container qiboard-collector?';
  }

  function render() {
    state.renderToken++;
    clearCharts(); stopRefresh();
    if (!state.session || !state.session.authenticated) { renderLogin(); return; }
    switch (state.route.view) {
      case 'detail': renderDetail(state.route.id); break;
      case 'nodes': renderNodes(); break;
      case 'containers': renderContainers(); break;
      case 'containerDetail': renderContainerDetail(state.route.id); break;
      case 'settings': renderSettings(); break;
      default: renderDashboard();
    }
  }
  function mount(el) { el.id = 'app'; document.getElementById('app').replaceWith(el); return el; }

  // ---------- Login ----------
  function renderLogin(error) {
    const errBox = error ? h('div', { class: 'error-box' }, error) : null;
    const user = h('input', { class: 'input', type: 'text', name: 'username', autocomplete: 'username', required: true, autofocus: true });
    const pass = h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Anmelden');
    const form = h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = 'Anmelden …';
        try {
          const r = await api('POST', 'login', { username: user.value.trim(), password: pass.value });
          state.session = Object.assign({}, state.session, { authenticated: true, user: r.user, csrf: r.csrf });
          await loadSession();
          render();
        } catch (err) {
          renderLogin(err.message);
        }
      }
    },
      errBox,
      h('div', { class: 'field' }, h('label', null, 'Benutzername'), user),
      h('div', { class: 'field' }, h('label', null, 'Passwort'), pass),
      btn
    );
    mount(h('div', { class: 'app' }, h('div', { class: 'login-wrap' }, h('div', { class: 'login' },
      h('div', { class: 'brand' }, h('span', { html: ICONS.logo }), h('span', null, 'quickinfo', h('small', null, 'Board'))),
      form,
      h('p', { class: 'muted', style: { textAlign: 'center', marginTop: '16px', fontSize: '12px' } }, 'Zentrales Management-Board · v' + ((state.session && state.session.version) || ''))
    ))));
    setTimeout(() => user.focus(), 0);
  }

  async function logout() {
    try { await api('POST', 'logout'); } catch (e) { /* ignorieren */ }
    state.session = { authenticated: false };
    await loadSession();
    render();
  }

  // ---------- Dashboard ----------
  function metricBlock(label, valueText, pct, lvl, extra) {
    return h('div', { class: 'metric' },
      h('div', { class: 'row' }, h('span', null, label), h('b', { class: lvl === 'ok' ? '' : lvl }, valueText)),
      h('div', { class: 'bar' }, h('i', { class: lvl === 'none' ? '' : lvl, style: { width: (pct === null ? 0 : Math.max(0, Math.min(100, pct))) + '%' } })),
      extra ? h('div', { class: 'muted', style: { fontSize: '11.5px' } }, extra) : null
    );
  }

  function nodeCard(n) {
    const s = n.summary;
    const lvl = nodeLevel(n);
    const cls = ['node-card', n.status, (n.status === 'online' && lvl !== 'ok') ? 'warn' : ''].join(' ');
    const diskFree = s.disk_pct === null ? null : 100 - s.disk_pct;
    const svcCls = s.services_down > 0 ? 'crit' : (s.services_total > 0 ? 'ok' : '');
    return h('a', { class: cls, href: '#/node/' + n.id },
      h('div', { class: 'node-head' },
        h('div', { class: 'node-title' },
          h('div', { class: 'name' }, n.name),
          h('div', { class: 'host' }, n.hostname || n.url.replace(/^https?:\/\//, ''))
        ),
        h('span', { class: 'status ' + n.status }, h('i', { class: 'dot' }), STATUS_LABEL[n.status] || n.status)
      ),
      h('div', { class: 'metrics' },
        metricBlock('CPU', fmtPct(s.cpu), s.cpu, level('cpu', s.cpu), s.cpu_count ? s.cpu_count + ' Kerne' : null),
        metricBlock('Temperatur', fmtTemp(s.temp), s.temp === null ? null : s.temp, level('temp', s.temp), 'CPU max.'),
        s.gpu_count > 0
          ? metricBlock('GPU', fmtPct(s.gpu), s.gpu, level('gpu', s.gpu), s.gpu_temp !== null ? fmtTemp(s.gpu_temp) : null)
          : metricBlock('RAM', fmtPct(s.mem_pct), s.mem_pct, level('mem', s.mem_pct), s.mem_total ? fmtBytes(s.mem_used) + ' / ' + fmtBytes(s.mem_total) : null),
        metricBlock('Speicher ' + (s.disk_mount || '/'), diskFree === null ? '–' : fmtPct(diskFree) + ' frei', s.disk_pct, level('disk', s.disk_pct), s.disk_total ? fmtBytes(s.disk_available) + ' von ' + fmtBytes(s.disk_total) : null)
      ),
      h('div', { class: 'node-foot' },
        n.status === 'offline' && n.last_error
          ? h('span', { class: 'err', title: n.last_error }, '⚠ ' + n.last_error)
          : h('span', null, 'Uptime ', h('b', { class: 'num', style: { color: 'var(--text-dim)' } }, fmtUptime(n.uptime))),
        h('span', { class: 'svc-badge ' + svcCls, title: 'Überwachte Dienste' },
          s.services_total > 0 ? (s.services_down > 0 ? icon('warn') : icon('check')) : null,
          s.services_total > 0 ? (s.services_down > 0 ? s.services_down + ' von ' + s.services_total + ' Diensten down' : s.services_total + ' Dienste OK') : 'keine Dienste')
      )
    );
  }

  async function renderDashboard() {
    const token = state.renderToken;
    const gridEl = h('div', { class: 'grid' });
    const totalsEl = h('div', { class: 'totals' });
    const refreshInfo = h('span', { class: 'refresh-info' }, h('i', { class: 'dot' }), 'lädt …');
    const content = h('div', null,
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Übersicht'), h('div', { class: 'sub' }, 'Alle verbundenen Bare-Metal-Server auf einen Blick')),
        h('div', { class: 'actions' }, refreshInfo, h('button', { class: 'btn primary', onClick: () => openNodeModal(null, () => load()) }, icon('plus'), 'Server hinzufügen'))
      ),
      totalsEl, gridEl
    );
    mount(shell(content, 'dashboard'));

    async function load() {
      try {
        const d = await api('GET', 'overview');
        state.lastOverview = d;
        updateCollectorPill(d.collector_alive);
        const t = d.totals;
        totalsEl.replaceChildren(
          h('div', { class: 'total' }, h('span', { class: 'label' }, 'Server'), h('span', { class: 'value num' }, t.nodes)),
          h('div', { class: 'total' }, h('span', { class: 'label' }, 'Online'), h('span', { class: 'value num ' + (t.online > 0 ? 'ok' : '') }, t.online)),
          h('div', { class: 'total' }, h('span', { class: 'label' }, 'Offline'), h('span', { class: 'value num ' + (t.offline > 0 ? 'crit' : '') }, t.offline)),
          h('div', { class: 'total' }, h('span', { class: 'label' }, 'Warnungen'), h('span', { class: 'value num ' + (t.warnings > 0 ? 'warn' : '') }, t.warnings)),
          h('div', { class: 'total' }, h('span', { class: 'label' }, 'Dienste down'), h('span', { class: 'value num ' + (t.services_down > 0 ? 'crit' : '') }, t.services_down))
        );
        if (!d.nodes.length) {
          gridEl.replaceChildren(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } },
            h('h3', null, 'Noch keine Server verbunden'),
            h('p', null, 'Füge deine erste quickinfo-Instanz hinzu. Du benötigst nur die IP-Adresse und den API-Schlüssel aus den quickinfo-Einstellungen.'),
            h('button', { class: 'btn primary', onClick: () => openNodeModal(null, () => load()) }, icon('plus'), 'Server hinzufügen')));
        } else {
          gridEl.replaceChildren(...d.nodes.map(nodeCard));
        }
        refreshInfo.className = 'refresh-info';
        refreshInfo.replaceChildren(h('i', { class: 'dot' }), 'Aktualisiert ' + new Date().toLocaleTimeString('de-DE'));
      } catch (e) {
        if (e.status === 401) return;
        refreshInfo.className = 'refresh-info crit';
        refreshInfo.replaceChildren(h('i', { class: 'dot' }), 'Fehler: ' + e.message);
      }
    }
    await load();
    startRefresh(load, token);
  }

  // ---------- Detail ----------
  function kpi(label, value, lvl, sub) {
    return h('div', { class: 'kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value num ' + (lvl && lvl !== 'ok' && lvl !== 'none' ? lvl : '') }, value), sub ? h('div', { class: 'sub' }, sub) : null);
  }

  function chartCard(title, opts, cls) {
    const legend = h('div', { class: 'legend' });
    const wrap = h('div', { class: 'chart-wrap ' + (cls || '') });
    const card = h('div', { class: 'chart-card' }, h('div', { class: 'chart-head' }, h('h3', null, title), legend), wrap);
    const chart = new TimeChart(wrap, Object.assign({ legendEl: legend }, opts));
    state.charts.push(chart);
    return { card, chart };
  }

  async function renderDetail(id) {
    const token = state.renderToken;
    const headEl = h('div', { class: 'detail-head' });
    const kpisEl = h('div', { class: 'kpis' });
    const chartsEl = h('div', { class: 'charts' });
    const lowerEl = h('div', null);
    const rangesEl = h('div', { class: 'ranges' });
    const content = h('div', null, headEl, kpisEl,
      h('div', { class: 'page-head', style: { marginBottom: '12px' } }, h('h1', { style: { fontSize: '16px' } }, 'Verlauf'), h('div', { class: 'actions' }, rangesEl)),
      chartsEl, lowerEl);
    mount(shell(content, 'dashboard'));

    let node = null;
    let charts = null;
    let history = null;

    for (const r of (state.session.ranges || ['1h', '3h', '24h', '3d', '14d'])) {
      rangesEl.appendChild(h('button', { class: r === state.range ? 'active' : '', onClick: () => { state.range = r; localStorage.setItem('qb.range', r); rangesEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.textContent === r)); loadHistory(); } }, r));
    }

    async function loadNode() {
      try {
        node = await api('GET', 'nodes/' + id);
      } catch (e) {
        if (e.status === 401) return;
        headEl.replaceChildren(h('div', null, h('a', { class: 'back', href: '#/' }, icon('back'), 'Zur Übersicht'), h('h1', null, 'Server nicht gefunden')));
        return;
      }
      updateCollectorPill(node.collector_alive);
      renderHead(); renderKpis(); renderLower();
    }

    function renderHead() {
      const info = node.info || {};
      const pollBtn = h('button', { class: 'btn', onClick: async () => {
        pollBtn.disabled = true; pollBtn.replaceChildren(h('span', { class: 'spinner' }), 'Abfrage …');
        try {
          const r = await api('POST', 'nodes/' + id + '/poll');
          toast(r.ok ? 'Node erfolgreich abgefragt (' + r.ms + ' ms)' : 'Abfrage fehlgeschlagen: ' + r.error, r.ok ? 'ok' : 'crit');
          await loadNode(); await loadHistory();
        } catch (e) { toast(e.message, 'crit'); }
        finally { pollBtn.disabled = false; pollBtn.replaceChildren(icon('refresh'), 'Jetzt abfragen'); }
      } }, icon('refresh'), 'Jetzt abfragen');
      headEl.replaceChildren(
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('a', { class: 'back', href: '#/' }, icon('back'), 'Zur Übersicht'),
          h('h1', null, node.name, h('span', { class: 'status ' + node.status }, h('i', { class: 'dot' }), STATUS_LABEL[node.status] || node.status)),
          h('div', { class: 'meta' },
            h('span', null, 'Host ', h('b', null, node.hostname || '–')),
            h('span', null, 'URL ', h('b', { class: 'mono' }, node.url)),
            info.os && info.os.pretty_name ? h('span', null, 'OS ', h('b', null, info.os.pretty_name)) : null,
            info.kernel ? h('span', null, 'Kernel ', h('b', null, info.kernel)) : null,
            info.cpu && info.cpu.model ? h('span', null, 'CPU ', h('b', null, info.cpu.model)) : null,
            info.gpu_model ? h('span', null, 'GPU ', h('b', null, info.gpu_model)) : null,
            h('span', null, 'quickinfo ', h('b', null, info.version || '–')),
            h('span', null, 'Letzte Abfrage ', h('b', null, fmtAgo(node.last_poll)), node.status === 'offline' && node.last_error ? h('span', { style: { color: 'var(--crit)' } }, ' · ' + node.last_error) : null)
          )
        ),
        h('div', { class: 'actions', style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } },
          pollBtn,
          h('button', { class: 'btn', onClick: () => openNodeModal(node, loadNode) }, icon('edit'), 'Bearbeiten')
        )
      );
    }

    function renderKpis() {
      const s = node.summary;
      const snap = node.snapshot || {};
      const diskFree = s.disk_pct === null ? null : 100 - s.disk_pct;
      const load = s.load ? s.load.map(v => fmtNum(v, 2)).join(' · ') : '–';
      kpisEl.replaceChildren(
        kpi('Uptime', fmtUptime(node.uptime), null, snap.stale ? 'Snapshot veraltet' : (node.snapshot_ts ? 'Stand ' + fmtAgo(node.snapshot_ts) : '')),
        kpi('CPU', fmtPct(s.cpu, 1), level('cpu', s.cpu), (s.cpu_count || '–') + ' Kerne · Load ' + load),
        kpi('Temperatur', fmtTemp(s.temp), level('temp', s.temp), (snap.cpu && snap.cpu.sensors ? snap.cpu.sensors.length : 0) + ' Sensoren'),
        s.gpu_count > 0 ? kpi('GPU', fmtPct(s.gpu, 1), level('gpu', s.gpu), s.gpu_count + ' GPU(s) · ' + fmtTemp(s.gpu_temp)) : null,
        kpi('RAM', fmtPct(s.mem_pct, 1), level('mem', s.mem_pct), fmtBytes(s.mem_used) + ' / ' + fmtBytes(s.mem_total)),
        kpi('Speicher ' + (s.disk_mount || '/'), diskFree === null ? '–' : fmtPct(diskFree, 1) + ' frei', level('disk', s.disk_pct), fmtBytes(s.disk_available) + ' von ' + fmtBytes(s.disk_total)),
        kpi('Dienste', s.services_total ? (s.services_total - s.services_down) + ' / ' + s.services_total : '–', s.services_down > 0 ? 'crit' : 'ok', s.services_total === 0 ? 'keine Dienste' : (s.services_down > 0 ? s.services_down + ' ausgefallen' : 'alle aktiv'))
      );
    }

    function buildCharts() {
      chartsEl.replaceChildren();
      charts = {};
      charts.cpu = chartCard('CPU-Auslastung', { unit: '%', min: 0, max: 100, thresholds: [{ value: 90, color: '#ff5c6c' }] });
      charts.temp = chartCard('Temperaturen', { unit: '°C', min: 0, max: null, fixedMax: 90, thresholds: [{ value: 80, color: '#ff5c6c' }], fill: false });
      charts.memdisk = chartCard('Arbeitsspeicher & Speicherplatz', { unit: '%', min: 0, max: 100, thresholds: [{ value: 90, color: '#ff5c6c' }] });
      charts.load = chartCard('Load Average', { unit: '', min: 0, max: null, decimals: 2, fill: false });
      const hasGpu = node && node.summary.gpu_count > 0;
      if (hasGpu) {
        charts.gpu = chartCard('GPU-Auslastung & -Speicher', { unit: '%', min: 0, max: 100 });
        charts.gpuTemp = chartCard('GPU-Temperatur & Leistung', { unit: '', min: 0, max: null, fill: false });
      }
      charts.cores = chartCard('CPU-Kerne', { unit: '%', min: 0, max: 100, fill: false }, 'tall');
      charts.avail = chartCard('Erreichbarkeit & Dienstausfälle', { unit: '', min: 0, max: null, decimals: 0, fill: true });
      for (const k of Object.keys(charts)) chartsEl.appendChild(charts[k].card);
      charts.cores.card.style.gridColumn = '1 / -1';
      charts.avail.card.style.gridColumn = '1 / -1';
    }

    async function loadHistory() {
      try {
        history = await api('GET', 'nodes/' + id + '/history?range=' + encodeURIComponent(state.range));
      } catch (e) { if (e.status !== 401) toast('Verlauf konnte nicht geladen werden: ' + e.message, 'crit'); return; }
      if (!charts) buildCharts();
      const S = history.series;
      const base = { from: history.from, to: history.to, step: history.step };
      const sensorLabel = {};
      if (node && node.snapshot && node.snapshot.cpu && Array.isArray(node.snapshot.cpu.sensors)) {
        for (const t of node.snapshot.cpu.sensors) sensorLabel[t.key] = t.label || t.key;
      }
      const ser = (key, label, color) => S[key] ? [{ key, label, color, points: S[key] }] : [];

      charts.cpu.chart.setData(Object.assign({}, base, { series: ser('cpu.total', 'CPU gesamt', '#4f8cff') }));

      const tempKeys = Object.keys(S).filter(k => k.startsWith('temp.') && k !== 'temp.max').sort();
      const tempSeries = ser('temp.max', 'Maximum', '#ff5c6c');
      tempKeys.forEach((k, i) => tempSeries.push({ key: k, label: sensorLabel[k] || k.slice(5), points: S[k], color: CHART_PALETTE[(i + 4) % CHART_PALETTE.length] }));
      charts.temp.chart.setData(Object.assign({}, base, { series: tempSeries }));

      charts.memdisk.chart.setData(Object.assign({}, base, { series: [...ser('mem.used_pct', 'RAM belegt', '#8b5cf6'), ...ser('disk.used_pct', 'Speicher belegt', '#f5b840')] }));
      charts.load.chart.setData(Object.assign({}, base, { series: [...ser('load.1', 'Load 1 min', '#4f8cff'), ...ser('load.5', 'Load 5 min', '#37d39a'), ...ser('load.15', 'Load 15 min', '#f5b840')] }));

      if (charts.gpu) {
        const gpuIdx = [...new Set(Object.keys(S).filter(k => k.startsWith('gpu.')).map(k => k.split('.')[1]))].sort();
        const gs = [], gt = [];
        gpuIdx.forEach((gi, i) => {
          const c1 = CHART_PALETTE[(i * 2) % CHART_PALETTE.length], c2 = CHART_PALETTE[(i * 2 + 1) % CHART_PALETTE.length];
          gs.push(...ser('gpu.' + gi + '.util', 'GPU ' + gi + ' Auslastung', c1), ...ser('gpu.' + gi + '.mem_pct', 'GPU ' + gi + ' Speicher', c2));
          gt.push(...ser('gpu.' + gi + '.temp', 'GPU ' + gi + ' °C', c1), ...ser('gpu.' + gi + '.power', 'GPU ' + gi + ' W', c2));
        });
        charts.gpu.chart.setData(Object.assign({}, base, { series: gs }));
        charts.gpuTemp.chart.setData(Object.assign({}, base, { series: gt }));
      }

      const coreKeys = Object.keys(S).filter(k => /^cpu\.core\.\d+$/.test(k)).sort((a, b) => +a.split('.')[2] - +b.split('.')[2]);
      charts.cores.chart.setData(Object.assign({}, base, { series: coreKeys.map((k, i) => ({ key: k, label: 'Kern ' + k.split('.')[2], points: S[k], color: CHART_PALETTE[i % CHART_PALETTE.length], width: 1.1 })) }));

      const avail = S.online ? S.online.map(p => [p[0], p[1] === null ? null : Math.round(p[1] * 100)]) : [];
      charts.avail.chart.setData(Object.assign({}, base, { series: [
        { key: 'online', label: 'Erreichbar (%)', color: '#37d39a', points: avail },
        ...ser('services.down', 'Dienste down', '#ff5c6c'),
      ] }));
    }

    function renderLower() {
      const snap = node.snapshot || {};
      const cores = (snap.cpu && snap.cpu.cores) || [];
      const gpus = snap.gpus || [];
      const sensors = (snap.cpu && snap.cpu.sensors) || [];
      const info = node.info || {};

      const coresCard = h('div', { class: 'card' }, h('h3', null, 'CPU-Kerne (aktuell)'),
        cores.length ? h('div', { class: 'cores' }, cores.map((v, i) => h('div', { class: 'core' },
          h('div', { class: 'row' }, h('span', null, 'Kern ' + i), h('b', { class: 'num' }, fmtPct(v))),
          h('div', { class: 'bar' }, h('i', { class: level('cpu', v), style: { width: Math.min(100, v) + '%' } }))
        ))) : h('p', { class: 'muted' }, 'Keine Kern-Daten vorhanden.'));

      const svcCard = h('div', { class: 'card' }, h('h3', null, 'Systemd-Dienste'),
        node.services.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Dienst'), h('th', null, 'Unit'), h('th', null, 'Status'), h('th', { class: 'right' }, 'Verfügbarkeit 24h'))),
          h('tbody', null, node.services.map(s => h('tr', null,
            h('td', null, h('b', null, s.display_name)),
            h('td', { class: 'mono dim' }, s.name),
            h('td', null, h('span', { class: 'svc-state ' + (s.active === true ? 'ok' : s.active === false ? 'crit' : 'unknown') }, h('i', { class: 'dot' }), s.active === true ? 'aktiv' : s.active === false ? 'ausgefallen' : 'unbekannt', s.state ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ' (' + s.state + ')') : null)),
            h('td', { class: 'right num' }, s.uptime_24h === null ? '–' : fmtPct(s.uptime_24h, 1))
          )))
        )) : h('p', { class: 'muted' }, 'Auf dieser Node werden keine Dienste überwacht.'));

      const gpuCard = gpus.length ? h('div', { class: 'card' }, h('h3', null, 'GPU'), h('div', { class: 'gpu-list' }, gpus.map(g => h('div', { class: 'gpu' },
        h('div', { class: 'name' }, '#' + g.index + ' ' + (g.name || 'GPU')),
        h('div', { class: 'metrics' },
          metricBlock('Auslastung', fmtPct(g.utilization), g.utilization, level('gpu', g.utilization)),
          metricBlock('Temperatur', fmtTemp(g.temperature), g.temperature, level('gpu_temp', g.temperature)),
          metricBlock('Speicher', fmtPct(g.memory_pct), g.memory_pct, level('mem', g.memory_pct), g.memory_total_mb ? Math.round(g.memory_used_mb) + ' / ' + Math.round(g.memory_total_mb) + ' MB' : null),
          g.power_w !== null && g.power_w !== undefined ? metricBlock('Leistung', fmtNum(g.power_w, 0) + ' W', null, 'none') : null
        )
      )))) : null;

      const sensorCard = h('div', { class: 'card' }, h('h3', null, 'Temperatursensoren'),
        sensors.length ? h('table', { class: 'table' }, h('tbody', null, sensors.map(t => h('tr', null,
          h('td', null, t.label || t.key), h('td', { class: 'mono dim' }, t.key),
          h('td', { class: 'right num ' + (level('temp', t.value) !== 'ok' ? level('temp', t.value) : '') }, fmtTemp(t.value))
        )))) : h('p', { class: 'muted' }, 'Keine Sensoren gemeldet.'));

      const infoCard = h('div', { class: 'card' }, h('h3', null, 'System'),
        h('dl', { class: 'kv' },
          h('dt', null, 'Hostname'), h('dd', null, node.hostname || '–'),
          h('dt', null, 'Betriebssystem'), h('dd', null, (info.os && (info.os.pretty_name || info.os.name)) || '–'),
          h('dt', null, 'Kernel'), h('dd', null, (info.kernel || '–') + (info.arch ? ' (' + info.arch + ')' : '')),
          h('dt', null, 'CPU'), h('dd', null, (info.cpu && info.cpu.model) || '–', info.cpu && info.cpu.cores ? ' · ' + info.cpu.cores + ' Kerne' : ''),
          h('dt', null, 'GPU'), h('dd', null, info.gpu_model || '–'),
          h('dt', null, 'RAM gesamt'), h('dd', null, fmtBytes(info.memory_total)),
          h('dt', null, 'Dateisystem'), h('dd', null, info.disk ? (info.disk.filesystem || '') + ' auf ' + (info.disk.mount || '/') + ' · ' + fmtBytes(info.disk.total) : '–'),
          h('dt', null, 'Boot-Zeit'), h('dd', null, fmtDateTime(info.boot_time)),
          h('dt', null, 'Zeitzone'), h('dd', null, info.timezone || '–'),
          h('dt', null, 'API-Schlüssel'), h('dd', { class: 'mono' }, node.api_key_prefix + '…'),
          h('dt', null, 'TLS-Prüfung'), h('dd', null, node.verify_tls ? 'aktiv' : 'deaktiviert (Self-Signed)'),
          h('dt', null, 'Fehlversuche'), h('dd', null, String(node.consecutive_failures)),
          h('dt', null, 'Zuletzt gesehen'), h('dd', null, fmtDateTime(node.last_seen))
        ));

      const eventsCard = h('div', { class: 'card' }, h('h3', null, 'Ereignisse'),
        node.events && node.events.length ? h('ul', { class: 'events' }, node.events.map(e => h('li', null,
          h('span', { class: 'ts' }, fmtDateTime(e.ts)), h('span', { class: 'tag ' + e.type }, e.type.replace('_', ' ')), h('span', null, e.message)
        ))) : h('p', { class: 'muted' }, 'Keine Ereignisse aufgezeichnet.'));

      lowerEl.replaceChildren(
        h('div', { class: 'two-col' }, coresCard, svcCard),
        h('div', { class: 'two-col' }, gpuCard || sensorCard, gpuCard ? sensorCard : infoCard),
        gpuCard ? h('div', { class: 'two-col' }, infoCard, eventsCard) : h('div', { class: 'two-col' }, eventsCard)
      );
    }

    await loadNode();
    if (token !== state.renderToken) return;
    if (node) { buildCharts(); await loadHistory(); }
    startRefresh(async () => { await loadNode(); await loadHistory(); }, token);
  }

  // ---------- Node-Verwaltung ----------
  async function renderNodes() {
    const token = state.renderToken;
    const tableEl = h('div', { class: 'card' });
    const content = h('div', null,
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Server verwalten'), h('div', { class: 'sub' }, 'quickinfo-Instanzen koppeln, bearbeiten oder entfernen')),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => openNodeModal(null, load) }, icon('plus'), 'Server hinzufügen'))
      ),
      tableEl
    );
    mount(shell(content, 'nodes'));

    async function load() {
      let d;
      try { d = await api('GET', 'overview'); } catch (e) { if (e.status !== 401) tableEl.replaceChildren(h('p', { class: 'crit' }, e.message)); return; }
      updateCollectorPill(d.collector_alive);
      if (!d.nodes.length) {
        tableEl.replaceChildren(h('div', { class: 'empty' }, h('h3', null, 'Noch keine Server'), h('p', null, 'Füge eine quickinfo-Instanz hinzu, um zu starten.')));
        return;
      }
      tableEl.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'URL'), h('th', null, 'Hostname'), h('th', null, 'Status'), h('th', null, 'Letzte Abfrage'), h('th', null, 'API-Key'), h('th', { class: 'right' }, 'Aktionen'))),
        h('tbody', null, d.nodes.map(n => h('tr', { class: 'clickable', onClick: (e) => { if (!e.target.closest('button')) navigate('#/node/' + n.id); } },
          h('td', null, h('b', null, n.name)),
          h('td', { class: 'mono dim' }, n.url),
          h('td', { class: 'dim' }, n.hostname || '–'),
          h('td', null, h('span', { class: 'status ' + n.status }, h('i', { class: 'dot' }), STATUS_LABEL[n.status] || n.status), n.status === 'offline' && n.last_error ? h('div', { class: 'muted', style: { fontSize: '11.5px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: n.last_error }, n.last_error) : null),
          h('td', { class: 'dim' }, fmtAgo(n.last_poll)),
          h('td', { class: 'mono dim' }, n.api_key_prefix + '…'),
          h('td', null, h('div', { class: 'actions' },
            h('button', { class: 'btn sm', title: 'Verbindung testen', onClick: async (ev) => {
              const b = ev.currentTarget; b.disabled = true;
              try { const r = await api('POST', 'nodes/test', { id: n.id, name: n.name, url: n.url, verify_tls: n.verify_tls }); toast(r.ok ? 'Verbindung OK – ' + (r.info.hostname || '') + ' (' + r.ms + ' ms)' : 'Fehler: ' + r.error, r.ok ? 'ok' : 'crit'); }
              catch (e) { toast(e.message, 'crit'); } finally { b.disabled = false; }
            } }, icon('link'), 'Test'),
            h('button', { class: 'btn sm', onClick: () => openNodeModal(n, load) }, icon('edit'), 'Bearbeiten'),
            h('button', { class: 'btn sm danger', onClick: () => confirmDelete(n, load) }, icon('trash'))
          ))
        )))
      )));
    }
    await load();
    startRefresh(load, token);
  }

  function confirmDelete(n, done) {
    const bg = h('div', { class: 'modal-bg', onClick: (e) => { if (e.target === bg) bg.remove(); } },
      h('div', { class: 'modal', role: 'dialog' },
        h('header', null, h('h2', null, 'Server entfernen'), h('button', { class: 'btn ghost sm close', onClick: () => bg.remove() }, icon('x'))),
        h('div', { class: 'body' }, h('p', null, 'Soll ', h('b', null, n.name), ' wirklich entfernt werden? Alle gesammelten Verlaufsdaten dieser Node werden gelöscht.')),
        h('footer', null,
          h('button', { class: 'btn', onClick: () => bg.remove() }, 'Abbrechen'),
          h('button', { class: 'btn danger', onClick: async (e) => {
            e.currentTarget.disabled = true;
            try { await api('DELETE', 'nodes/' + n.id); toast('Server entfernt', 'ok'); bg.remove(); done && done(); if (state.route.view === 'detail') navigate('#/'); }
            catch (err) { toast(err.message, 'crit'); e.currentTarget.disabled = false; }
          } }, icon('trash'), 'Entfernen')
        )));
    document.body.appendChild(bg);
  }

  function openNodeModal(node, done) {
    const isEdit = !!node;
    const f = {
      name: h('input', { class: 'input', type: 'text', maxlength: 128, placeholder: 'z.B. Webserver Alpha', value: node ? node.name : '' }),
      url: h('input', { class: 'input mono', type: 'text', placeholder: 'z.B. 192.168.1.10 oder https://server.local', value: node ? node.url : '', autocapitalize: 'off', spellcheck: false }),
      api_key: h('input', { class: 'input mono', type: 'password', placeholder: isEdit ? 'unverändert lassen' : 'API-Schlüssel aus quickinfo → Einstellungen → API', autocomplete: 'off', spellcheck: false }),
      verify_tls: h('input', { type: 'checkbox', checked: node ? !!node.verify_tls : false }),
      enabled: h('input', { type: 'checkbox', checked: node ? !!node.enabled : true }),
      force: h('input', { type: 'checkbox' }),
    };
    const errs = { name: h('div', { class: 'error hidden' }), url: h('div', { class: 'error hidden' }), api_key: h('div', { class: 'error hidden' }) };
    const testBox = h('div', { class: 'hidden' });
    const saveBtn = h('button', { class: 'btn primary' }, icon('check'), isEdit ? 'Speichern' : 'Verbinden & speichern');
    const testBtn = h('button', { class: 'btn' }, icon('link'), 'Verbindung testen');

    function showErr(field, msg) { for (const k of Object.keys(errs)) { errs[k].classList.add('hidden'); f[k].classList.remove('invalid'); } if (field && errs[field]) { errs[field].textContent = msg; errs[field].classList.remove('hidden'); f[field].classList.add('invalid'); } }
    function payload() {
      const p = { name: f.name.value.trim(), url: f.url.value.trim(), verify_tls: f.verify_tls.checked, enabled: f.enabled.checked };
      if (f.api_key.value.trim() !== '') p.api_key = f.api_key.value.trim();
      return p;
    }
    function showTest(r) {
      testBox.className = 'test-result ' + (r.ok ? 'ok' : 'crit');
      if (r.ok) {
        const i = r.info || {}; const s = r.status || {};
        testBox.replaceChildren(icon('check'), h('div', null, h('b', null, 'Verbindung erfolgreich (' + r.ms + ' ms)'),
          h('div', { class: 'details' }, 'Host ' + (i.hostname || '–') + ' · quickinfo ' + (i.version || '–') + ' · ' + ((i.os && i.os.pretty_name) || '') + ' · ' + ((i.cpu && i.cpu.cores) || '?') + ' Kerne · ' + ((s.services && s.services.total) || 0) + ' Dienste')));
      } else {
        testBox.replaceChildren(icon('warn'), h('div', null, h('b', null, 'Verbindung fehlgeschlagen'), h('div', { class: 'details' }, r.error || 'Unbekannter Fehler')));
      }
    }

    testBtn.addEventListener('click', async () => {
      const p = payload(); if (isEdit) p.id = node.id;
      testBtn.disabled = true; testBtn.replaceChildren(h('span', { class: 'spinner' }), 'Teste …');
      try { showErr(null); showTest(await api('POST', 'nodes/test', p)); }
      catch (e) { if (e.data && e.data.field) showErr(e.data.field, e.message); else showTest({ ok: false, error: e.message }); }
      finally { testBtn.disabled = false; testBtn.replaceChildren(icon('link'), 'Verbindung testen'); }
    });

    saveBtn.addEventListener('click', async () => {
      const p = payload(); if (f.force.checked) p.force = true;
      saveBtn.disabled = true; saveBtn.replaceChildren(h('span', { class: 'spinner' }), isEdit ? 'Speichern …' : 'Verbinde …');
      try {
        showErr(null);
        const r = isEdit ? await api('PUT', 'nodes/' + node.id, p) : await api('POST', 'nodes', p);
        toast(isEdit ? 'Server aktualisiert' : 'Server "' + r.node.name + '" verbunden', 'ok');
        bg.remove(); done && done();
      } catch (e) {
        if (e.data && e.data.test) { showTest(e.data.test); forceRow.classList.remove('hidden'); }
        else if (e.data && e.data.field) showErr(e.data.field, e.message);
        else toast(e.message, 'crit');
      } finally { saveBtn.disabled = false; saveBtn.replaceChildren(icon('check'), isEdit ? 'Speichern' : 'Verbinden & speichern'); }
    });

    const forceRow = h('label', { class: 'check hidden', style: { marginBottom: '12px' } }, f.force, 'Trotz fehlgeschlagenem Test speichern (Node wird als offline geführt)');

    const bg = h('div', { class: 'modal-bg', onClick: (e) => { if (e.target === bg) bg.remove(); } },
      h('div', { class: 'modal', role: 'dialog' },
        h('header', null, h('h2', null, isEdit ? 'Server bearbeiten' : 'Server hinzufügen'), h('button', { class: 'btn ghost sm close', onClick: () => bg.remove() }, icon('x'))),
        h('form', { class: 'body', onSubmit: (e) => { e.preventDefault(); saveBtn.click(); } },
          h('div', { class: 'field' }, h('label', null, 'Name / Label'), f.name, errs.name),
          h('div', { class: 'field' }, h('label', null, 'IP-Adresse oder Hostname'), f.url, errs.url, h('div', { class: 'hint' }, 'Ohne Schema wird https:// angenommen. Port optional, z.B. 10.0.0.5:8443')),
          h('div', { class: 'field' }, h('label', null, 'API-Schlüssel (Bearer Token)'), f.api_key, errs.api_key, h('div', { class: 'hint' }, 'In quickinfo unter Einstellungen → API & Management-Board erzeugen. Wird verschlüsselt gespeichert.')),
          h('label', { class: 'check', style: { marginBottom: '10px' } }, f.verify_tls, 'TLS-Zertifikat prüfen (bei Self-Signed-Zertifikaten deaktiviert lassen)'),
          isEdit ? h('label', { class: 'check', style: { marginBottom: '14px' } }, f.enabled, 'Überwachung aktiv') : null,
          testBox, forceRow,
          h('button', { type: 'submit', class: 'hidden' })
        ),
        h('footer', null,
          h('span', { class: 'left' }, testBtn),
          h('button', { class: 'btn', onClick: () => bg.remove() }, 'Abbrechen'),
          saveBtn
        )));
    document.body.appendChild(bg);
    setTimeout(() => f.name.focus(), 0);
  }

  // ---------- Container-Ansicht (Docker) ----------
  const CONTAINER_STATE = {
    running: { label: 'Läuft', cls: 'online' },
    exited: { label: 'Beendet', cls: 'offline' },
    paused: { label: 'Pausiert', cls: 'unknown' },
    created: { label: 'Erstellt', cls: 'unknown' },
    restarting: { label: 'Neustart', cls: 'warn' },
    dead: { label: 'Tot', cls: 'offline' },
    removing: { label: 'Wird entfernt', cls: 'unknown' },
  };
  function containerStateInfo(state) {
    return CONTAINER_STATE[state] || { label: state || '–', cls: 'unknown' };
  }
  function formatPorts(p) {
    if (!p) return '–';
    if (Array.isArray(p)) {
      return p.map(x => ((x.host_ip && x.host_ip !== '0.0.0.0') ? x.host_ip + ':' : '') + (x.host_port || x.container || '')).filter(Boolean).join(', ') || '–';
    }
    return String(p);
  }
  function fmtDockerTs(ts) {
    if (!ts) return '–';
    const m = String(ts).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    return m ? m[1].replace('T', ' ') + ' UTC' : String(ts);
  }

  async function renderContainers() {
    const token = state.renderToken;
    const totalsEl = h('div', { class: 'totals' });
    const tableEl = h('div', { class: 'card' });
    const refreshInfo = h('span', { class: 'refresh-info' }, h('i', { class: 'dot' }), 'lädt …');
    const content = h('div', null,
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Container'), h('div', { class: 'sub' }, 'Alle Docker-Container über alle Hosts hinweg')),
        h('div', { class: 'actions' }, refreshInfo)
      ),
      totalsEl, tableEl
    );
    mount(shell(content, 'containers'));

    async function load() {
      let d;
      try { d = await api('GET', 'containers'); }
      catch (e) { if (e.status !== 401) tableEl.replaceChildren(h('p', { class: 'crit' }, e.message)); return; }
      const t = d.totals || {};
      totalsEl.replaceChildren(
        h('div', { class: 'total' }, h('span', { class: 'label' }, 'Docker-Hosts'), h('span', { class: 'value num' }, t.hosts)),
        h('div', { class: 'total' }, h('span', { class: 'label' }, 'Container'), h('span', { class: 'value num' }, t.containers)),
        h('div', { class: 'total' }, h('span', { class: 'label' }, 'Laufend'), h('span', { class: 'value num ok' }, t.running)),
        h('div', { class: 'total' }, h('span', { class: 'label' }, 'Gestoppt'), h('span', { class: 'value num ' + (t.stopped > 0 ? 'warn' : '') }, t.stopped))
      );
      if (!d.containers.length) {
        tableEl.replaceChildren(h('div', { class: 'empty' },
          h('h3', null, 'Keine Container gefunden'),
          h('p', null, 'Auf keiner verbundenen quickinfo-Instanz ist das Docker-Modul aktiv, oder es laufen keine Container. Aktiviere Docker in quickinfo (Einstellungen → Docker) und koppele den Host als Server.')));
        return;
      }
      tableEl.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Image'), h('th', null, 'Status'), h('th', null, 'Host'), h('th', null, 'Ports'), h('th', { class: 'right' }, 'Aktionen'))),
        h('tbody', null, d.containers.map(c => {
          const si = containerStateInfo(c.state);
          const host = c.host || {};
          return h('tr', { class: 'clickable', onClick: (e) => { if (!e.target.closest('button, a')) navigate('#/container/' + c.node_id + '/' + c.container_id); } },
            h('td', null, h('b', null, c.name)),
            h('td', { class: 'mono dim' }, c.image || '–'),
            h('td', null, h('span', { class: 'status ' + si.cls }, h('i', { class: 'dot' }), si.label), c.status ? h('span', { class: 'muted', style: { fontSize: '11.5px', marginLeft: '6px' } }, c.status) : null),
            h('td', null, h('a', { href: '#/node/' + host.id, class: 'dim' }, host.name || host.hostname || ('Host ' + host.id))),
            h('td', { class: 'mono dim' }, formatPorts(c.ports)),
            h('td', null, h('div', { class: 'actions' }, h('button', { class: 'btn sm', title: 'Details', onClick: () => navigate('#/container/' + c.node_id + '/' + c.container_id) }, 'Details')))
          );
        }))
      )));
      refreshInfo.className = 'refresh-info';
      refreshInfo.replaceChildren(h('i', { class: 'dot' }), 'Aktualisiert ' + new Date().toLocaleTimeString('de-DE'));
    }
    await load();
    startRefresh(load, token);
  }

  async function renderContainerDetail(id) {
    const token = state.renderToken;
    const sep = id.indexOf(':');
    const nodeId = id.slice(0, sep);
    const containerId = id.slice(sep + 1);
    const headEl = h('div', { class: 'detail-head' });
    const bodyEl = h('div', null);
    const content = h('div', null, headEl, bodyEl);
    mount(shell(content, 'containers'));

    let d = null;

    function hostPanel() {
      const host = d.host || {};
      return h('aside', { class: 'host-panel' },
        h('h3', null, 'Host'),
        h('div', { class: 'host-card' },
          h('a', { class: 'host-name', href: '#/node/' + host.id }, host.name || host.hostname || ('Node ' + host.id)),
          h('div', { class: 'host-meta' },
            h('span', null, 'Hostname ', h('b', null, host.hostname || '–')),
            h('span', null, 'URL ', h('b', { class: 'mono' }, host.url || '–'))
          ),
          h('span', { class: 'status ' + (host.status || 'unknown') }, h('i', { class: 'dot' }), STATUS_LABEL[host.status] || host.status)
        )
      );
    }

    function renderHead() {
      const si = containerStateInfo(d.state);
      const refreshBtn = h('button', { class: 'btn', onClick: async () => {
        refreshBtn.disabled = true; refreshBtn.replaceChildren(h('span', { class: 'spinner' }), 'Lädt …');
        try { await load(); }
        catch (e) { toast(e.message, 'crit'); }
        finally { refreshBtn.disabled = false; refreshBtn.replaceChildren(icon('refresh'), 'Aktualisieren'); }
      } }, icon('refresh'), 'Aktualisieren');

      const actBtn = (act, label, icn, cls) => {
        const b = h('button', { class: 'btn ' + (cls || ''), onClick: async () => {
          b.disabled = true;
          try {
            const r = await api('POST', 'containers/' + nodeId + '/' + containerId + '/' + act);
            toast(r.ok ? 'Container ' + label.toLowerCase() : 'Aktion fehlgeschlagen: ' + r.error, r.ok ? 'ok' : 'crit');
            if (r.ok) await load();
          } catch (e) { toast(e.message, 'crit'); }
          finally { b.disabled = false; }
        } }, icon(icn), label);
        return b;
      };

      headEl.replaceChildren(
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('a', { class: 'back', href: '#/containers' }, icon('back'), 'Zur Container-Übersicht'),
          h('h1', null, d.name || ('Container ' + containerId), h('span', { class: 'status ' + si.cls }, h('i', { class: 'dot' }), si.label)),
          h('div', { class: 'meta' },
            h('span', null, 'Host ', h('a', { href: '#/node/' + (d.host && d.host.id) }, h('b', null, (d.host && d.host.name) || '–'))),
            h('span', null, 'Image ', h('b', { class: 'mono' }, d.image || '–')),
            d.status ? h('span', null, 'Status ', h('b', null, d.status)) : null
          )
        ),
        h('div', { class: 'actions', style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } },
          refreshBtn,
          actBtn('start', 'Start', 'play'),
          actBtn('stop', 'Stop', 'stop', 'danger'),
          actBtn('restart', 'Neustart', 'restart')
        )
      );
    }

    function renderBody() {
      const detail = d.detail || {};
      const stats = d.stats || {};
      const statKpis = h('div', { class: 'kpis' },
        kpi('CPU', stats.cpu || '–', null, 'Docker-Auslastung'),
        kpi('RAM', stats.memory || '–', null, stats.memory_percent || ''),
        kpi('Netzwerk I/O', stats.network_io || '–'),
        kpi('Block I/O', stats.block_io || '–'),
        kpi('PIDs', stats.pids || '–')
      );

      const infoCard = h('div', { class: 'card' }, h('h3', null, 'Container'),
        h('dl', { class: 'kv' },
          h('dt', null, 'Image'), h('dd', { class: 'mono' }, detail.image || d.image || '–'),
          h('dt', null, 'Befehl'), h('dd', { class: 'mono' }, detail.command || '–'),
          h('dt', null, 'Erstellt'), h('dd', null, fmtDockerTs(detail.created)),
          h('dt', null, 'Status'), h('dd', null, detail.status || d.status || '–'),
          h('dt', null, 'Restart-Policy'), h('dd', null, detail.restart_policy || '–'),
          h('dt', null, 'Compose-Projekt'), h('dd', null, detail.compose_project || '–'),
          h('dt', null, 'Compose-Service'), h('dd', null, detail.compose_service || '–'),
          h('dt', null, 'Notiz'), h('dd', null, detail.note || '–')
        ));

      const ports = Array.isArray(detail.ports) ? detail.ports : [];
      const portsCard = h('div', { class: 'card' }, h('h3', null, 'Ports'),
        ports.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Container'), h('th', null, 'Host-Port'), h('th', null, 'Host-IP'))),
          h('tbody', null, ports.map(p => h('tr', null,
            h('td', { class: 'mono' }, p.container || '–'),
            h('td', { class: 'mono' }, p.host_port || '–'),
            h('td', { class: 'mono dim' }, p.host_ip || '–')
          )))
        )) : h('p', { class: 'muted' }, 'Keine Port-Weiterleitungen.'));

      const mounts = Array.isArray(detail.mounts) ? detail.mounts : [];
      const mountsCard = h('div', { class: 'card' }, h('h3', null, 'Mounts'),
        mounts.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Typ'), h('th', null, 'Quelle'), h('th', null, 'Ziel'), h('th', { class: 'right' }, 'RW'))),
          h('tbody', null, mounts.map(m => h('tr', null,
            h('td', { class: 'dim' }, m.type || '–'),
            h('td', { class: 'mono' }, m.source || m.name || '–'),
            h('td', { class: 'mono' }, m.destination || '–'),
            h('td', { class: 'right' }, m.rw ? 'ja' : 'nein')
          )))
        )) : h('p', { class: 'muted' }, 'Keine Mounts.'));

      const networks = Array.isArray(detail.networks) ? detail.networks : [];
      const networksCard = h('div', { class: 'card' }, h('h3', null, 'Netzwerke'),
        networks.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Netzwerk'), h('th', null, 'IP'), h('th', null, 'Gateway'), h('th', null, 'MAC'))),
          h('tbody', null, networks.map(n => h('tr', null,
            h('td', null, h('b', null, n.name || '–')),
            h('td', { class: 'mono' }, n.ip || '–'),
            h('td', { class: 'mono' }, n.gateway || '–'),
            h('td', { class: 'mono dim' }, n.mac || '–')
          )))
        )) : h('p', { class: 'muted' }, 'Keine Netzwerke.'));

      const labels = detail.labels && typeof detail.labels === 'object' ? detail.labels : {};
      const labelKeys = Object.keys(labels);
      const labelsCard = h('div', { class: 'card' }, h('h3', null, 'Labels'),
        labelKeys.length ? h('dl', { class: 'kv' }, labelKeys.map(k => [h('dt', { class: 'mono' }, k), h('dd', { class: 'mono dim' }, String(labels[k]))]).flat())
        : h('p', { class: 'muted' }, 'Keine Labels.'));

      bodyEl.replaceChildren(
        statKpis,
        h('div', { class: 'container-layout' },
          h('div', { class: 'container-main' }, infoCard, portsCard, mountsCard, networksCard, labelsCard),
          hostPanel()
        )
      );
    }

    async function load() {
      d = await api('GET', 'containers/' + nodeId + '/' + containerId);
      renderHead();
      renderBody();
    }

    try { await load(); }
    catch (e) {
      if (e.status === 401) return;
      headEl.replaceChildren(h('div', null, h('a', { class: 'back', href: '#/containers' }, icon('back'), 'Zur Container-Übersicht'), h('h1', null, 'Container nicht gefunden')));
      bodyEl.replaceChildren(h('p', { class: 'crit' }, e.message));
      return;
    }
  }

  // ---------- Einstellungen ----------
  function renderSettings() {
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
    const rep = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Passwort ändern');
    const form = h('form', { onSubmit: async (e) => {
      e.preventDefault();
      if (nw.value !== rep.value) { toast('Die Passwörter stimmen nicht überein.', 'crit'); return; }
      btn.disabled = true;
      try { await api('POST', 'password', { current: cur.value, new: nw.value }); toast('Passwort geändert', 'ok'); cur.value = nw.value = rep.value = ''; }
      catch (err) { toast(err.message, 'crit'); } finally { btn.disabled = false; }
    } },
      h('div', { class: 'field' }, h('label', null, 'Aktuelles Passwort'), cur),
      h('div', { class: 'field' }, h('label', null, 'Neues Passwort'), nw, h('div', { class: 'hint' }, 'Mindestens 8 Zeichen')),
      h('div', { class: 'field' }, h('label', null, 'Neues Passwort wiederholen'), rep),
      btn);

    const s = state.session;
    const content = h('div', null,
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Einstellungen'), h('div', { class: 'sub' }, 'Zugang und Systeminformationen'))),
      h('div', { class: 'settings-grid' },
        h('div', { class: 'card' }, h('h3', null, 'Passwort ändern'), form),
        h('div', { class: 'card' }, h('h3', null, 'System'),
          h('dl', { class: 'kv' },
            h('dt', null, 'Benutzer'), h('dd', null, s.user.username),
            h('dt', null, 'Letzter Login'), h('dd', null, fmtDateTime(s.user.last_login)),
            h('dt', null, 'Board-Version'), h('dd', null, s.version),
            h('dt', null, 'Abfrageintervall'), h('dd', null, s.interval + ' s (COLLECTOR_INTERVAL)'),
            h('dt', null, 'Zeiträume'), h('dd', null, (s.ranges || []).join(', ')),
            h('dt', null, 'Schwellenwerte'), h('dd', null, 'CPU/GPU ≥ 75/90 % · RAM/Disk ≥ 80/90 % · CPU-Temp ≥ 70/80 °C · GPU-Temp ≥ 75/85 °C')
          ),
          h('p', { class: 'muted', style: { marginTop: '14px', fontSize: '12.5px' } }, 'Kopplung einer neuen quickinfo-Instanz: Auf dem Zielserver unter Einstellungen → API & Management-Board einen API-Schlüssel erzeugen und hier unter „Server“ mit IP/Hostname hinzufügen.')
        )
      ));
    mount(shell(content, 'settings'));
    if (state.lastOverview) updateCollectorPill(state.lastOverview.collector_alive);
  }

  // ---------- Init ----------
  async function loadSession() {
    try {
      const s = await api('GET', 'session');
      state.session = s;
    } catch (e) {
      state.session = { authenticated: false };
      toast('Server nicht erreichbar: ' + e.message, 'crit', 6000);
    }
  }

  (async function init() {
    state.route = parseRoute();
    syncModeFromRoute();
    await loadSession();
    render();
  })();
})();
