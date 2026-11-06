/*
 * AlcanSee Command Center: primeira interface ligada à API (/api/v1).
 * Sem framework: o DOM é montado com textContent (nada vindo da API vira HTML).
 * O token fica no sessionStorage da aba e some ao fechar; validade de 24 h na API.
 * Toda informação mostra a origem: cadastro sintético, fonte simulada ou fonte real.
 */
(function () {
  'use strict';
  // Item vazio nunca vira o texto "null" na tela.
  for (const metodo of ['replaceChildren', 'append']) {
    const original = Element.prototype[metodo];
    Element.prototype[metodo] = function (...itens) { return original.apply(this, itens.filter((x) => x !== null && x !== undefined && x !== false)); };
  }

  const API = '/api/v1/';
  const view = document.getElementById('view');
  let me = null;
  let sources = null;
  // Senha provisória digitada no login, guardada só na memória da página até a troca obrigatória (nunca em storage).
  let provisional = null;

  // ---------- utilidades ----------
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const token = () => sessionStorage.getItem('cc_token');
  function toast(msg, err) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 5000);
  }
  async function api(method, path, body, headers) {
    const res = await fetch(API + path, {
      method, headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, token() ? { Authorization: 'Bearer ' + token() } : {}, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== 'auth/login') { logout(); throw new Error('Sessão expirada: entre de novo.'); }
    if (!res.ok) {
      const e = json.error || {};
      const fields = e.fields ? ' ' + Object.values(e.fields).flat().join(' ') : '';
      const err = new Error((e.message || 'Erro ' + res.status) + fields);
      err.status = res.status; err.code = e.code; throw err;
    }
    return json;
  }
  const can = (perm) => !!me && me.permissions.some((g) => (g.permission || g.code) === perm);
  const fmt = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'sem data';
  const fmtDay = (d) => d ? d.split('-').reverse().join('/') : 'sem data';
  const STATE = { ONBOARDING: 'Onboarding', ACTIVE: 'Ativa', NOTICE_GIVEN: 'Aviso prévio', CHURNED: 'Encerrada', PAUSED: 'Pausada', ARCHIVED: 'Arquivada' };
  const ROLE = { DIRECTOR: 'direção', HEAD: 'head', MANAGER: 'gestor', CS: 'CS', TECH_ADMIN: 'admin técnico' };
  const FRESH = { FRESH: ['em dia', 'b-ok'], STALE: ['desatualizada', 'b-warn'], FAILED: ['última leitura falhou', 'b-bad'], NEVER: ['nunca lida', 'b-warn'], NOT_CONFIGURED: ['desligada', ''] };
  const SEV = { CRITICAL: 'crítico', HIGH: 'alto', MEDIUM: 'médio', LOW: 'baixo' };
  const SRC = { INTERNAL_RULES: 'regras internas', NOTION: 'Notion', META_ADS: 'Meta Ads', WHATSAPP_GROUP: 'WhatsApp', MEETING_RECORDER: 'gravador de reuniões', COMMAND_CENTER: 'Command Center' };
  const COVER = { COMPLETE: 'completa', PARTIAL: 'parcial', NONE: 'sem cobertura', UNKNOWN: 'desconhecida' };
  const brl = (v) => v === null || v === undefined ? 'sem valor' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const MODEL = { MONTHLY: 'mensal', UPFRONT: 'antecipado', MIXED: 'misto' };
  const RISK_REASON = { PERFORMANCE: 'desempenho', PERCEPTION: 'percepção de valor', RELATIONSHIP: 'relacionamento', ONBOARDING_EXPECTATION: 'expectativa do onboarding',
    CLIENT_EXECUTION: 'execução da cliente', FINANCIAL: 'financeiro', CONTRACTUAL: 'contratual', OUTSIDE_ICP: 'fora do perfil ideal', UNKNOWN: 'motivo não identificado' };
  const badge = (text, cls) => h('span', { class: 'badge ' + (cls || '') }, text);
  function modeBadge(mode, source) {
    if (mode === 'REAL') return badge((source || 'Fonte') + ' real', 'b-real');
    if (mode === 'FAKE') return badge((source || 'Fonte') + ' simulada (dados fictícios)', 'b-fake');
    if (mode === 'SNAPSHOT') return badge((source || 'Fonte') + ' real (retrato salvo)', 'b-real');
    return badge((source || 'Fonte') + ' desligada');
  }
  function originBadges(client) {
    const out = [];
    if (client.origin && client.origin.synthetic) out.push(badge('Cadastro sintético (demonstração)', 'b-synth'));
    for (const s of (client.origin ? client.origin.linked_sources : [])) {
      const mode = sources ? (sources.find((x) => x.source === s) || {}).mode : null;
      out.push(mode ? modeBadge(mode, SRC[s] || s) : badge('Ligada a ' + (SRC[s] || s), 'b-real'));
    }
    if (!out.length) out.push(badge('Cadastro manual'));
    return out;
  }
  const card = (title, ...body) => h('section', { class: 'card' }, h('h2', {}, title), ...body);
  const empty = (msg) => h('p', { class: 'empty' }, msg);
  // Cartão recolhido: o detalhe fica a um clique.
  const foldCard = (title, ...body) => h('section', { class: 'card fold-card' }, h('details', {}, h('summary', {}, h('span', { class: 'h2like' }, title)), ...body));
  // Seletor de lista: uma lista por vez. Lista vazia fica apagada; se a escolhida esvaziar, passa para a primeira com conteúdo.
  function listPicker(items, current, onPick) {
    return h('div', { class: 'picker', role: 'tablist' }, items.map(([id, label, n]) => h('button', { type: 'button', role: 'tab', class: 'pick-t' + (id === current ? ' on' : '') + (n ? '' : ' calm'), 'aria-selected': String(id === current), disabled: n ? null : true,
      onclick: () => onPick(id) }, h('span', { class: 'lbl' }, label), h('span', { class: 'num' }, String(n)))));
  }
  const pickValid = (items, current) => { if (items.some(([id, , n]) => id === current && n)) return current; const first = items.find(([, , n]) => n); return first ? first[0] : ''; };
  function field(labelText, input) { return h('div', {}, h('label', {}, labelText), input); }

  // ---------- sessão ----------
  function logout() {
    const t = token();
    sessionStorage.removeItem('cc_token'); me = null; sources = null; provisional = null;
    if (t) fetch(API + 'auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).catch(() => {});
    document.getElementById('top').hidden = true;
    document.getElementById('demo-bar').hidden = true;
    location.hash = '#/login';
  }
  document.getElementById('logout').addEventListener('click', logout);

  // ---------- tema ----------
  const themeBtn = document.getElementById('theme-toggle');
  function showTheme() { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Tema claro' : 'Tema escuro'; }
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('cc_theme', next); } catch (e) { /* vale só nesta página */ }
    showTheme();
  });
  showTheme();

  // ---------- busca geral ----------
  let clientsCache = null;
  async function clientsList() {
    if (clientsCache) return clientsCache;
    try { clientsCache = (await api('GET', 'clients?per_page=100&exclude_lifecycle_state=CHURNED')).data; } catch (e) { return []; }
    return clientsCache;
  }
  const noAccent = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function openSearch() {
    if (!me || document.querySelector('dialog[open]')) return;
    const input = h('input', { type: 'search', placeholder: 'Buscar cliente ou tela', 'aria-label': 'Buscar cliente ou tela' });
    const results = h('div', { class: 'results' });
    const dlg = h('dialog', { class: 'modal search' }, input, results);
    const close = () => { dlg.close(); dlg.remove(); };
    const pages = [...document.querySelectorAll('[data-nav]')].filter((a) => !a.hidden).map((a) => ({ name: a.firstChild.textContent.trim(), href: a.getAttribute('href'), note: 'Tela' }));
    let clients = [];
    const draw = () => {
      const q = noAccent(input.value.trim());
      const found = clients.filter((c) => noAccent(c.trade_name).includes(q)).map((c) => ({ name: c.trade_name, href: '#/cliente/' + c.id, note: c.manager ? c.manager.display_name : 'Cliente' }));
      const list = q ? found.concat(pages.filter((x) => noAccent(x.name).includes(q))).slice(0, 8) : pages;
      results.replaceChildren(...(list.length ? list.map((x, i) => h('a', { href: x.href, class: q && i === 0 ? 'first' : '', onclick: close }, h('span', {}, x.name), h('small', {}, x.note)))
        : [h('div', { class: 'none' }, 'Nada encontrado.')]));
    };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const a = results.querySelector('a'); if (a) a.click(); } });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
    draw();
    clients = await clientsList();
    if (dlg.open) draw();
  }
  document.getElementById('quick-search').addEventListener('click', openSearch);
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } });

  // ---------- criar: um botão para o que se faz no dia a dia ----------
  function openCreate() {
    const dlg = modal('O que você quer fazer?', [
      can('renewals.read') ? h('button', { type: 'button', class: 'choice', onclick: () => { closeDlg(); openNewReceipt(); } }, h('b', {}, 'Novo recebimento'), h('span', {}, 'Cobrança de uma cliente, com valor e vencimento')) : null,
      h('button', { type: 'button', class: 'choice', onclick: () => { closeDlg(); openNewClient(); } }, h('b', {}, 'Cadastrar cliente nova'), h('span', {}, 'Loja, contato, gestor e contrato')),
      h('button', { type: 'button', class: 'choice', onclick: () => { closeDlg(); openNewTask(); } }, h('b', {}, 'Nova tarefa'), h('span', {}, 'Tarefa de uma cliente, com responsável e prazo')),
      h('button', { type: 'button', class: 'choice', onclick: () => { closeDlg(); openOffboard(); } }, h('b', {}, 'Dar baixa em cliente'), h('span', {}, 'Aviso prévio ou encerramento')),
    ].filter(Boolean), []);
    const closeDlg = () => { dlg.close(); dlg.remove(); };
  }
  document.getElementById('quick-new').addEventListener('click', () => { if (me) openCreate(); });

  async function openNewTask() {
    const [clients, people] = await Promise.all([clientsList(), team()]);
    const title = h('input', { maxlength: 200, placeholder: 'O que precisa ser feito', 'aria-label': 'Tarefa' });
    const due = h('input', { type: 'date', value: todaySP(), 'aria-label': 'Prazo' });
    const client = h('select', { 'aria-label': 'Cliente' }, h('option', { value: '' }, 'Escolha a cliente'), clients.map((c) => h('option', { value: c.id }, c.trade_name)));
    const owner = h('select', { 'aria-label': 'Responsável' }, people.map((p) => h('option', { value: p.id, selected: p.id === me.id || null }, p.display_name)));
    modal('Nova tarefa', h('div', { class: 'form-grid' }, h('div', { class: 'full' }, field('O que precisa ser feito', title)), h('div', { class: 'full' }, field('Cliente', client)), field('Prazo', due), field('Responsável', owner)),
      [['Salvar', async () => {
        const t = title.value.trim();
        if (t.length < 3) { toast('Escreva a tarefa.', true); return false; }
        if (!client.value) { toast('Escolha a cliente.', true); return false; }
        if (!due.value) { toast('Escolha o prazo.', true); return false; }
        try {
          await api('POST', 'work-items', { client_id: Number(client.value), kind: 'TASK', title: t, description: null, owner_user_id: Number(owner.value), due_at: isoLocal(due.value, '18:00'), origin: 'MANUAL' });
          toast('Tarefa criada.');
        } catch (e) { toast(e.message, true); return false; }
      }]]);
    title.focus();
  }

  // Cadastro de cliente nova: o desenho da tela. A gravação depende de uma rota nova no servidor.
  async function openNewClient() {
    const [people, squads] = await Promise.all([team(), squadsList()]);
    const name = h('input', { maxlength: 200, placeholder: 'Nome da loja', 'aria-label': 'Loja' });
    modal('Cadastrar cliente nova', [h('span', { class: 'soon' }, 'Simulação: ainda não grava'),
      h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, field('Loja', name)),
        field('Contato', h('input', { maxlength: 200, 'aria-label': 'Contato' })),
        field('Entrada', h('input', { type: 'date', value: todaySP(), 'aria-label': 'Entrada' })),
        field('Squad', h('select', { 'aria-label': 'Squad' }, squads.map((q) => h('option', { value: q.id }, q.name)))),
        field('Gestor', h('select', { 'aria-label': 'Gestor' }, people.map((p) => h('option', { value: p.id }, p.display_name)))),
        field('Contrato', h('input', { placeholder: 'Ex.: 3 meses', 'aria-label': 'Contrato' })),
        field('Mensalidade', h('input', { inputmode: 'decimal', placeholder: 'R$', 'aria-label': 'Mensalidade' })))],
      [['Salvar e criar recebimento', () => {
        const n = name.value.trim();
        if (n.length < 2) { toast('Escreva o nome da loja.', true); return false; }
        toast('Simulação: o cadastro precisa de uma rota nova no servidor.');
        setTimeout(() => openNewReceipt(n), 0);
      }]]);
    name.focus();
  }

  // Dar baixa: a função já existe na ficha. Aqui só leva direto até ela.
  let pendingEdit = false;
  function openPendingEdit() {
    if (!pendingEdit) return;
    pendingEdit = false;
    const btn = [...view.querySelectorAll('button')].find((b) => b.textContent === 'Editar ficha');
    if (btn) { btn.click(); btn.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else toast('Seu acesso não permite alterar a situação desta cliente.', true);
  }
  async function openOffboard() {
    const clients = await clientsList();
    const pick = h('select', { 'aria-label': 'Cliente' }, clients.map((c) => h('option', { value: c.id }, c.trade_name)));
    modal('Dar baixa em cliente', [field('Cliente', pick), h('p', { class: 'small muted' }, 'Abre a ficha da cliente em "Situação", para registrar aviso prévio ou encerramento com o motivo.')],
      [['Continuar', () => {
        if (!pick.value) { toast('Nenhuma cliente disponível.', true); return false; }
        pendingEdit = true;
        const next = '#/cliente/' + pick.value;
        if (location.hash === next) route(); else location.hash = next;
      }]]);
  }
  // Leitura sob demanda de todas as fontes: cada fonte roda na hora, em sequência, e a tela recarrega com o dado novo.
  document.getElementById('refresh').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Atualizando...';
    try {
      const j = (await api('POST', 'sync/all', undefined, { 'Idempotency-Key': 'ui-all-' + Date.now() })).data;
      const kids = j.children || [];
      const bad = kids.filter((c) => c.status === 'FAILED');
      const busy = kids.filter((c) => c.status === 'SKIPPED');
      toast(bad.length ? 'Falhou: ' + bad.map((c) => c.source).join(', ') + '. As outras fontes foram lidas.'
        : 'Fontes lidas agora' + (busy.length ? ' (' + busy.map((c) => c.source).join(', ') + ' já estava em leitura)' : '') + '.', bad.length > 0);
      try { sources = (await api('GET', 'integrations/status')).data.sources; } catch (e) { /* mantém o anterior */ }
      await route();
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
    btn.textContent = 'Atualizar dados';
  });

  async function loadMe() {
    me = (await api('GET', 'auth/me')).data;
    document.getElementById('me-name').textContent = me.username + ' · ' + me.roles.map((r) => ROLE[r] || r).join(', ');
    document.getElementById('top').hidden = false;
    document.getElementById('demo-bar').hidden = !/\.demo(\.|$)/.test(me.username);
    document.querySelector('[data-nav="conciliacao"]').hidden = !can('reconciliation.read');
    document.querySelector('[data-nav="hoje"]').hidden = !can('radar.read');
    document.querySelector('[data-nav="painel"]').hidden = !can('reports.read');
    document.querySelector('[data-nav="vencimentos"]').hidden = !can('renewals.read');
    document.querySelector('[data-nav="comercial"]').hidden = !can('sales.read');
    document.querySelector('[data-nav="pendencias"]').hidden = !can('work.read');
    document.querySelector('[data-nav="daily"]').hidden = !can('work.read');
    const navMeet = document.querySelector('[data-nav="reunioes"]');
    if (navMeet) navMeet.hidden = !can('meetings.read') && !can('clients.read');
    document.querySelector('[data-nav="1a1"]').hidden = !can('people.read');
    document.querySelector('[data-nav="fontes"]').hidden = !can('integrations.read');
    document.getElementById('refresh').hidden = !can('sync.run');
    refreshQueueCount();
    if (can('integrations.read')) {
      try { sources = (await api('GET', 'integrations/status')).data.sources; } catch (e) { sources = null; }
    }
    refreshInbox();
  }
  async function refreshInbox() {
    try {
      const n = (await api('GET', 'users/me/notifications')).data.unread;
      const el = document.getElementById('inbox-count');
      el.textContent = n; el.hidden = n === 0;
    } catch (e) { /* caixa indisponível não derruba a tela */ }
  }

  function renderLogin() {
    document.getElementById('top').hidden = true;
    const user = h('input', { name: 'username', autocomplete: 'username', required: true });
    const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const form = h('form', { class: 'card login', onsubmit: async (ev) => {
      ev.preventDefault();
      try {
        const r = await api('POST', 'auth/login', { username: user.value.trim(), password: pass.value, device_label: 'interface-web' });
        sessionStorage.setItem('cc_token', r.data.access_token);
        await loadMe();
        provisional = me.must_change_password ? pass.value : null;
        location.hash = me.must_change_password ? '#/senha' : home();
      } catch (e) { toast(e.message, true); }
    } },
    h('img', { class: 'login-logo', src: 'assets/logo-alcansee.png', alt: 'AlcanSee Digital' }), h('h1', {}, 'Entrar'), h('p', { class: 'sub' }, 'Use seu login individual.'),
    field('Usuário', user), field('Senha', pass), h('div', { style: 'margin-top:16px' }, h('button', { type: 'submit' }, 'Entrar')));
    view.replaceChildren(form);
    user.focus();
  }

  // ---------- painel geral ----------
  // Gráficos em SVG à mão: marca fina, ponta arredondada só no lado do dado, valor em tinta de texto e cor só na marca.
  const NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, String(v));
    }
    for (const c of kids.flat()) { if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
    return el;
  }
  const tipEl = h('div', { class: 'tip', role: 'tooltip' });
  tipEl.hidden = true;
  document.body.append(tipEl);
  function tip(e, title, rows) {
    tipEl.replaceChildren(h('b', {}, title), ...rows.map(([k, v]) => h('div', { class: 'r' }, h('span', {}, k), h('span', {}, v))));
    tipEl.hidden = false;
    tipEl.style.left = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8) + 'px';
    tipEl.style.top = Math.min(e.clientY + 14, innerHeight - tipEl.offsetHeight - 8) + 'px';
  }
  const untip = () => { tipEl.hidden = true; };
  const nf = (n, d) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const pct = (r, d) => r === null || r === undefined ? 'sem base' : nf(r * 100, d === undefined ? 1 : d) + '%';
  const brl0 = (v) => 'R$ ' + nf(v || 0);
  const brl2 = (v) => v === null || v === undefined ? 'sem conversa' : 'R$ ' + nf(v, 2);
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mLabel = (ym) => MONTHS[Number(ym.slice(5)) - 1] + (ym.slice(5) === '01' ? '/' + ym.slice(2, 4) : '');
  const dLabel = (d) => d.slice(8) + '/' + d.slice(5, 7);
  function relTime(iso) {
    if (!iso) return 'nunca lida';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? 'agora' : m < 60 ? 'há ' + m + ' min' : m < 1440 ? 'há ' + Math.round(m / 60) + 'h' : 'há ' + Math.round(m / 1440) + ' dia(s)';
  }
  function delta(cur, prev, lowerIsBetter) {
    if (cur === null || prev === null || cur === undefined || prev === undefined || prev === 0) return null;
    const r = (cur - prev) / prev;
    const cls = Math.abs(r) < 0.02 || lowerIsBetter === null ? 'flat' : (lowerIsBetter ? r < 0 : r > 0) ? 'good' : 'bad';
    return h('span', { class: 'delta ' + cls }, (r > 0 ? '▲ ' : r < 0 ? '▼ ' : '') + nf(Math.abs(r * 100)) + '% vs 7 dias antes');
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
  }
  // Barra com ponta arredondada só no lado do dado (a base fica reta, ancorada no eixo).
  function barPath(x, y0, w, len, up) {
    if (len <= 0) return null;
    const r = Math.min(4, len, w / 2);
    const y = up ? y0 - len : y0 + len;
    const k = up ? 1 : -1;
    return `M${x},${y0}V${y + k * r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + k * r}V${y0}Z`;
  }

  function chartFlow(hist, onPick, picked) {
    const W = 660, H = 236, L = 30, R = 6, T = 10, B = 44;
    const cw = (W - L - R) / hist.length;
    const max = niceMax(Math.max(...hist.map((x) => Math.max(x.entries, x.exits))));
    const mid = T + (H - T - B) / 2;
    const sc = (H - T - B) / 2 / max;
    const bw = Math.min(20, cw * 0.42);
    const grid = [max, max / 2, 0, -max / 2, -max].map((v) => s('g', {},
      s('line', { class: 'gl', x1: L, x2: W - R, y1: mid - v * sc, y2: mid - v * sc, 'stroke-dasharray': v === 0 ? null : '2 4' }),
      s('text', { x: L - 8, y: mid - v * sc + 4, 'text-anchor': 'end' }, nf(Math.abs(v)))));
    const cols = hist.map((m, i) => {
      const x = L + i * cw + (cw - bw) / 2;
      return s('g', { class: 'col pickable' + (picked === m.month ? ' picked' : ''), role: 'button', tabindex: 0, 'aria-label': 'Abrir ' + MONTHS_LONG[Number(m.month.slice(5)) - 1],
        onclick: () => { untip(); if (onPick) onPick(m.month); }, onkeydown: (e) => { if (e.key === 'Enter' && onPick) onPick(m.month); },
        onmousemove: (e) => tip(e, MONTHS_LONG[Number(m.month.slice(5)) - 1] + ' de ' + m.month.slice(0, 4) + (m.in_progress ? ' (em andamento)' : ''),
        [['Base no início', nf(m.base_start)], ['Entradas', nf(m.entries)], ['Saídas', nf(m.exits)], ['Churn', pct(m.churn_rate)], ['', 'clique para abrir o mês']]), onmouseleave: untip },
      s('rect', { class: 'bg', x: L + i * cw, y: T, width: cw, height: H - T - 8, rx: 6 }),
      s('path', { d: barPath(x, mid - 1, bw, m.entries * sc, true), fill: 'var(--series-1)', opacity: m.in_progress ? 0.55 : 1 }),
      s('path', { d: barPath(x, mid + 1, bw, m.exits * sc, false), fill: 'var(--series-2)', opacity: m.in_progress ? 0.55 : 1 }),
      s('text', { x: L + i * cw + cw / 2, y: H - B + 18, 'text-anchor': 'middle' }, mLabel(m.month)),
      s('text', { x: L + i * cw + cw / 2, y: H - B + 34, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--ink-2)' }, pct(m.churn_rate, 0)));
    });
    return s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Entradas e saídas de clientes por mês, últimos 12 meses' }, grid,
      s('text', { x: L - 8, y: H - B + 34, 'text-anchor': 'end', style: 'font-size:10px' }, 'churn'), cols);
  }

  function chartDaily(points, split) {
    const W = 660, H = 190, L = 52, R = 10, T = 12, B = 26;
    const every = Math.max(2, Math.ceil(points.length / 8));
    const max = niceMax(Math.max(...points.map((p) => p.spend)));
    const x = (i) => L + (points.length === 1 ? 0 : i * (W - L - R) / (points.length - 1));
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const line = points.map((p, i) => (i ? 'L' : 'M') + x(i) + ',' + y(p.spend)).join('');
    const area = line + `L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
    const cross = s('line', { x1: 0, x2: 0, y1: T, y2: H - B, stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0 });
    const dot = s('circle', { r: 4.5, fill: 'var(--series-1)', stroke: 'var(--panel)', 'stroke-width': 2, opacity: 0 });
    const step = (W - L - R) / Math.max(1, points.length - 1);
    const hits = points.map((p, i) => s('rect', { class: 'hit', x: x(i) - step / 2, y: T, width: step, height: H - T - B,
      onmousemove: (e) => { cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1); dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.spend)); dot.setAttribute('opacity', 1);
        tip(e, dLabel(p.day), [['Investimento', brl0(p.spend)], ['Conversas', nf(p.conversations)]]); },
      onmouseleave: () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); untip(); } }));
    // Divisa entre o período anterior e o escolhido (aba ADS).
    const divide = split ? s('g', {}, s('line', { x1: x(split - 0.5), x2: x(split - 0.5), y1: T, y2: H - B, stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.6 }),
      s('text', { x: x(split - 0.5) - 6, y: T + 10, 'text-anchor': 'end' }, 'anterior'), s('text', { x: x(split - 0.5) + 6, y: T + 10, 'text-anchor': 'start' }, 'período')) : null;
    return s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Investimento diário na Meta, ' + points.length + ' dias' },
      s('defs', {}, s('linearGradient', { id: 'gsp', x1: 0, x2: 0, y1: 0, y2: 1 }, s('stop', { offset: '0%', 'stop-color': '#0aa2c0', 'stop-opacity': 0.28 }), s('stop', { offset: '100%', 'stop-color': '#0aa2c0', 'stop-opacity': 0 }))),
      [max, max / 2, 0].map((v) => s('g', {}, s('line', { class: 'gl', x1: L, x2: W - R, y1: y(v), y2: y(v), 'stroke-dasharray': v ? '2 4' : null }),
        s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, v ? nf(v / 1000, v % 1000 ? 1 : 0) + ' mil' : '0'))),
      points.map((p, i) => ((points.length - 1 - i) % every === 0) ? s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, dLabel(p.day)) : null),
      divide, s('path', { d: area, fill: 'url(#gsp)' }), s('path', { d: line, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      cross, dot, hits);
  }

  function chartColumns(items, opts) {
    const W = opts.w || 660, H = opts.h || 120, L = 34, R = 6, T = 8, B = 22;
    const max = niceMax(Math.max(...items.map((p) => p.v)));
    const cw = (W - L - R) / items.length;
    const bw = Math.min(opts.bw || 18, cw * 0.6);
    const base = H - B;
    return s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label },
      [max, 0].map((v) => s('g', {}, s('line', { class: 'gl', x1: L, x2: W - R, y1: base - v / max * (H - T - B), y2: base - v / max * (H - T - B), 'stroke-dasharray': v ? '2 4' : null }),
        s('text', { x: L - 8, y: base - v / max * (H - T - B) + 4, 'text-anchor': 'end' }, nf(v)))),
      items.map((p, i) => s('g', { class: 'col', onmousemove: (e) => tip(e, p.title, p.rows), onmouseleave: untip },
        s('rect', { class: 'bg', x: L + i * cw, y: T, width: cw, height: H - T - 4, rx: 5 }),
        s('path', { d: barPath(L + i * cw + (cw - bw) / 2, base, bw, p.v / max * (H - T - B), true), fill: opts.color || 'var(--series-1)', opacity: p.dim ? 0.5 : 1 }),
        p.label ? s('text', { x: L + i * cw + cw / 2, y: H - 6, 'text-anchor': 'middle' }, p.label) : null)));
  }

  function hbars(items, fmtN) {
    const max = Math.max(1, ...items.map((i) => i.count));
    return h('div', { class: 'hbars' }, items.map((i) => h('div', { class: 'hbar', title: i.label + ': ' + i.count },
      h('span', { class: 't' }, i.tone ? h('i', { class: 'tone ' + i.tone }) : null, i.label),
      h('span', { class: 'track' }, h('span', { class: 'fill', style: 'width:' + (i.count / max * 100) + '%' })),
      h('span', { class: 'n' }, fmtN ? fmtN(i.count) : nf(i.count)))));
  }
  const goClient = (id) => { if (id) location.hash = '#/cliente/' + id; };
  // Lista longa abre com as primeiras e um botão para o resto: o painel fica curto e nada some.
  function collapsible(tag, cls, items, n, render) {
    const list = h(tag, { class: cls });
    const btn = h('button', { type: 'button', class: 'linkbtn more' });
    let open = false;
    const draw = () => { list.replaceChildren(...(open ? items : items.slice(0, n)).map(render)); btn.textContent = open ? 'Mostrar menos' : 'Ver todas (' + items.length + ')'; };
    btn.addEventListener('click', () => { open = !open; draw(); });
    draw();
    return h('div', {}, list, items.length > n ? btn : null);
  }
  const panel = (span, title, hint, ...body) => h('section', { class: 'card span-' + span }, h('h2', {}, title), hint ? h('p', { class: 'hint' }, hint) : null, ...body);
  const daysChip = (d) => d < 0 ? ['venceu há ' + -d + 'd', 'bad'] : d === 0 ? ['vence hoje', 'bad'] : ['em ' + d + 'd', d <= 7 ? 'warn' : 'info'];

  function monthDetail(m, close) {
    let sq = '';
    const box = h('section', { class: 'card span-12 month' });
    const label = MONTHS_LONG[Number(m.month.slice(5)) - 1] + ' de ' + m.month.slice(0, 4);
    const squads = [...new Set(m.entered.concat(m.left).map((x) => x.squad || 'sem squad'))].sort();
    const months = (d) => d === null ? 'sem data de entrada' : d < 31 ? d + ' dia(s) de casa' : nf(d / 30.44, 1) + ' meses de casa';
    const draw = () => {
      const f = (x) => !sq || (x.squad || 'sem squad') === sq;
      const ent = m.entered.filter(f);
      const out = m.left.filter(f);
      const count = (list, key, empty) => { const c = {}; list.forEach((x) => { const k = x[key] || empty; c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })); };
      const life = out.map((x) => x.lifetime_days).filter((x) => x !== null).sort((a, b) => a - b);
      const med = life.length ? life[Math.floor(life.length / 2)] : null;
      const row = (x, left) => h('li', { class: x.client_id ? 'click' : '', onclick: () => goClient(x.client_id) },
        h('span', {}, h('b', {}, x.name), h('div', { class: 'small muted' }, [x.manager || 'sem gestor', x.squad, left ? months(x.lifetime_days) : (x.term ? 'contrato ' + x.term.toLowerCase() : null)].filter(Boolean).join(' · '))),
        left ? h('span', { class: 'v' }, h('span', { class: 'badge ' + (x.reason ? 'tag-orange' : 'tag-gray') }, x.reason || 'sem motivo'), h('div', { class: 'small muted', style: 'text-align:right' }, fmtDay(x.date))) : null);
      box.replaceChildren(
        h('div', { class: 'row' }, h('h2', { style: 'margin:0' }, label), m.in_progress ? h('span', { class: 'badge tag-yellow' }, 'em andamento') : null, h('span', { class: 'spacer' }),
          squads.length > 1 ? h('div', { class: 'seg' }, ['', ...squads].map((q) => h('button', { type: 'button', class: q === sq ? 'on' : '', onclick: () => { sq = q; draw(); } }, q || 'Todas'))) : null,
          h('button', { type: 'button', class: 'ghost', onclick: close }, 'Fechar')),
        h('div', { class: 'stat-row', style: 'margin-top:14px' },
          h('div', {}, h('div', { class: 'lbl' }, 'base no início'), h('div', { class: 'big' }, nf(m.base_start))),
          h('div', {}, h('div', { class: 'lbl' }, 'entraram'), h('div', { class: 'big' }, nf(ent.length))),
          h('div', {}, h('div', { class: 'lbl' }, 'saíram'), h('div', { class: 'big' }, nf(out.length))),
          h('div', {}, h('div', { class: 'lbl' }, 'churn'), h('div', { class: 'big' }, pct(m.churn_rate))),
          h('div', {}, h('div', { class: 'lbl' }, 'quem saiu ficou, na mediana'), h('div', { class: 'big' }, med === null ? 'sem dado' : nf(med / 30.44, 1) + ' m'))),
        h('div', { class: 'grid' },
          h('div', { class: 'span-6' }, h('p', { class: 'hint' }, 'Saíram (' + out.length + ')'), out.length ? collapsible('ul', 'mini', out, 10, (x) => row(x, true)) : h('p', { class: 'empty' }, 'Ninguém saiu.')),
          h('div', { class: 'span-6' }, h('p', { class: 'hint' }, 'Entraram (' + ent.length + ')'), ent.length ? collapsible('ul', 'mini', ent, 10, (x) => row(x, false)) : h('p', { class: 'empty' }, 'Ninguém entrou.'))),
        out.length ? h('div', { class: 'grid', style: 'margin-top:16px' },
          h('div', { class: 'span-6' }, h('p', { class: 'hint' }, 'Saídas por motivo'), hbars(count(out, 'reason', 'Sem motivo no Notion'))),
          h('div', { class: 'span-6' }, h('p', { class: 'hint' }, 'Saídas por gestor'), hbars(count(out, 'manager', 'Sem gestor')))) : null);
    };
    draw();
    return box;
  }

  let ovSquad = (() => { try { return sessionStorage.getItem('cc_ov_squad') || ''; } catch (e) { return ''; } })();
  async function renderOverview() {
    const [res, st, rnRaw] = await Promise.all([api('GET', 'reports/overview' + (ovSquad ? '?squad_id=' + ovSquad : '')), can('integrations.read') ? api('GET', 'integrations/status').catch(() => null) : null,
      can('renewals.read') ? api('GET', 'renewals/operation' + (ovSquad ? '?squad_id=' + ovSquad : '')).catch(() => null) : null]);
    const rn = rnRaw ? { data: applyRnSim(rnRaw.data) } : null;
    const d = res.data;
    if (st) sources = st.data.sources;
    const k = d.kpis;
    const month = d.history[d.history.length - 1];
    const hs = d.history_scope || {};
    const agencyNote = '';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Recorte' }, [{ id: '', name: 'Agência' }].concat(d.squads).map((q) =>
      h('button', { class: String(q.id) === ovSquad ? 'on' : '', onclick: () => { ovSquad = String(q.id); try { sessionStorage.setItem('cc_ov_squad', ovSquad); } catch (e) { /* sem armazenamento */ } renderOverview(); } }, q.name)));
    const fresh = h('div', { class: 'fresh' }, (sources || []).filter((x) => x.mode !== 'DISABLED').map((x) =>
      h('span', { class: x.freshness === 'FRESH' ? '' : x.freshness === 'FAILED' ? 'bad' : 'stale', title: (FRESH[x.freshness] || [x.freshness])[0] }, x.label.replace(/ \(leitura\)/, '') + ' · ' + relTime(x.last_success_at))));

    const kpi = (lbl, val, ...det) => h('div', { class: 'kpi' }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val' }, val), h('div', { class: 'det' }, ...det));
    // Primeira tela: três números, cada um leva à tela do assunto.
    const kpiGo = (href, lbl, val, det) => h('a', { class: 'kpi', href }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val' }, val), h('div', { class: 'det' }, det));
    const kpis = h('div', { class: 'kpis' },
      kpiGo('#/carteira', 'Clientes ativas', nf(k.active), '+' + k.entries_month + ' entraram · −' + k.exits_month + ' saíram'),
      kpi('Churn do mês' + agencyNote, pct(k.churn_month), k.exits_month + ' de ' + k.base_start_month + ' clientes'),
      kpiGo('#/hoje', 'Em risco de sair', nf(k.at_risk), 'aviso prévio, risco e críticas'));
    const mediaKpis = h('div', { class: 'kpis' },
      kpi('Investimento Meta · 7 dias', brl0(k.spend_7d), delta(k.spend_7d, k.spend_prev_7d, null) || ''),
      kpi('Conversas · 7 dias', nf(k.conv_7d), delta(k.conv_7d, k.conv_prev_7d, false) || ''),
      kpi('Custo por conversa', brl2(k.cpc_7d), delta(k.cpc_7d, k.cpc_prev_7d, true) || 'só campanhas de conversa'));
    // Uma linha só sobre a atualização dos dados; o detalhe por fonte fica na seção "Qualidade dos dados".
    const liveSources = (sources || []).filter((x) => x.mode !== 'DISABLED');
    const lateSources = liveSources.filter((x) => x.freshness !== 'FRESH');
    const lastRead = liveSources.map((x) => x.last_success_at).filter(Boolean).sort().pop();
    const dataStatus = !liveSources.length ? null : lateSources.length
      ? h('a', { class: 'status warn', href: '#/fontes' }, lateSources.length + (lateSources.length > 1 ? ' fontes com atraso' : ' fonte com atraso'))
      : h('span', { class: 'status' }, 'Dados em dia · ' + relTime(lastRead));

    // Entradas, saídas e motivos
    const er = d.exit_reasons;
    // Clique no mês: abre o período logo abaixo (quem entrou, quem saiu, por quê, com quem).
    const monthBox = h('div', { class: 'grid', id: 'month-detail' });
    const chartBox = h('div');
    const pickMonth = (m) => {
      const same = monthBox.dataset.month === m;
      monthBox.dataset.month = same ? '' : m;
      chartBox.replaceChildren(chartFlow(d.history, pickMonth, same ? null : m));
      monthBox.replaceChildren(...(same ? [] : [monthDetail(d.history.find((x) => x.month === m), () => pickMonth(m))]));
      if (!same) monthBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    chartBox.append(chartFlow(d.history, pickMonth, null));
    const flow = panel(8, 'Entradas e saídas de clientes', 'Notion, últimos 12 meses, ' + (hs.squad ? hs.squad + (hs.exits_without_squad ? ' (' + hs.exits_without_squad + ' saídas da agência sem squad registrada ficam fora)' : '') : 'agência inteira')
      + '. Passe o mouse para ver os números; clique no mês para abrir quem entrou e quem saiu.',
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--series-1)' }), 'Entradas'), h('span', {}, h('i', { style: 'background:var(--series-2)' }), 'Saídas'),
        h('span', {}, 'mês atual mais claro: em andamento')), chartBox);
    const reasons = panel(4, 'Por que saem', 'Motivo registrado no Notion, 12 meses.',
      er.items.length ? hbars(er.items.map((i) => ({ label: i.reason, count: i.count }))) : h('p', { class: 'empty' }, 'Nenhum motivo registrado.'),
      h('div', { class: 'gap' }, (er.exits - er.with_reason) + ' das ' + er.exits + ' saídas estão sem motivo no Notion: o ranking é só do que foi preenchido.'),
      er.lifetime_median_days !== null ? h('p', { class: 'small muted', style: 'margin:12px 0 0' }, 'Quem saiu ficou, na mediana, ' + nf(er.lifetime_median_days / 30.44, 1) + ' meses.') : null);

    // Prioridade e jornada
    const att = panel(12, 'Clientes que pedem atenção', 'Sinais da operação, para gestores e heads acompanharem.',
      d.attention.length ? collapsible('ul', 'att', d.attention, 5, (a) => h('li', { class: a.client_id ? 'click' : '', tabindex: a.client_id ? 0 : null, title: 'Prioridade ' + a.score + (a.journey ? ' · ' + a.journey : ''), onclick: () => goClient(a.client_id),
        onkeydown: (e) => { if (e.key === 'Enter') goClient(a.client_id); } },
        h('span', { class: 'tone ' + (a.score >= 5 ? 'bad' : 'warn') }),
        h('div', {}, h('b', {}, a.name), h('div', { class: 'who' }, a.manager || 'sem gestor'),
          h('div', { class: 'chips' }, a.reasons.slice(0, 2).map((r) => h('span', { class: 'chip ' + r.tone }, r.label)), a.reasons.length > 2 ? h('span', { class: 'chip' }, '+' + (a.reasons.length - 2)) : null)))) : h('p', { class: 'empty' }, 'Nada pedindo ação agora.'));
    const journey = panel(4, 'Jornada da carteira', 'Coluna do quadro no Notion.', hbars(d.journey));

    // Operação Renova do mês (base Vencimentos do Notion)
    let renova = null;
    let renovaShort = null;
    if (rn) {
      const rd = rn.data; const rk = rd.kpis;
      const late = rd.rows.filter((r) => r.overdue);
      const soon = rd.rows.filter((r) => !r.overdue && ['A vencer', 'A confirmar'].includes(r.situation) && r.days !== null && r.days <= 7);
      const line = (r) => h('li', { class: r.client_id ? 'click' : '', onclick: () => goClient(r.client_id) },
        h('span', {}, h('b', {}, r.name), h('div', { class: 'small muted' }, (r.manager || 'sem gestor') + (r.risk ? ' · risco ' + r.risk.toLowerCase() : ''))),
        h('span', { class: 'v' }, (rd.shows_amounts && r.amount !== null ? brl0(r.amount) + ' · ' : '') + (r.days < 0 ? 'há ' + -r.days + 'd' : r.days === 0 ? 'hoje' : 'em ' + r.days + 'd')));
      const paidShare = rk.total ? rk.paid / rk.total * 100 : 0;
      const dueToday = rd.rows.filter((r) => !r.overdue && r.days === 0 && ['A vencer', 'A confirmar'].includes(r.situation)).length;
      renovaShort = h('a', { class: 'card span-12 renova-card', href: '#/vencimentos' },
        h('div', { class: 'renova-main' }, h('h2', {}, 'Recebimentos de ' + MONTHS_LONG[Number(rd.month.slice(5)) - 1]),
          h('div', { style: 'margin-bottom:10px' }, h('span', { class: 'big' }, rk.paid + ' de ' + rk.total), h('span', { class: 'muted' }, ' recebidos')),
          h('div', { class: 'track' }, h('div', { class: 'fill', style: 'width:' + paidShare + '%' }))),
        h('div', { class: 'stat-row renova-stats' },
          h('div', {}, h('div', { class: 'lbl' }, 'em atraso'), h('div', { class: 'big' }, nf(rk.overdue))),
          h('div', {}, h('div', { class: 'lbl' }, 'vencem hoje'), h('div', { class: 'big' }, nf(dueToday)))),
        h('span', { class: 'go' }, 'Abrir recebimentos →'));
      renova = panel(12, 'Operação Renova · ' + MONTHS_LONG[Number(rd.month.slice(5)) - 1], 'Base Vencimentos do Notion. Detalhe na aba Operação Renova.',
        h('div', { class: 'stat-row' },
          h('div', {}, h('div', { class: 'lbl' }, 'recebidos'), h('div', { class: 'big' }, rk.paid + ' de ' + rk.total), rd.shows_amounts ? h('div', { class: 'small muted' }, brl0(rk.amount_paid) + ' de ' + brl0(rk.amount_total)) : null),
          h('div', {}, h('div', { class: 'lbl' }, 'em aberto'), h('div', { class: 'big' }, nf(rk.open)), rd.shows_amounts ? h('div', { class: 'small muted' }, brl0(rk.amount_open)) : null),
          h('div', {}, h('div', { class: 'lbl' }, 'vencidos'), h('div', { class: 'big' }, nf(rk.overdue))),
          h('div', {}, h('div', { class: 'lbl' }, 'vencem em 7 dias'), h('div', { class: 'big' }, nf(rk.due_7d))),
          h('div', {}, h('div', { class: 'lbl' }, 'risco alto'), h('div', { class: 'big' }, nf(rk.high_risk)))),
        h('div', { class: 'grid' },
          h('div', { class: 'span-6' }, h('p', { class: 'hint' }, 'Vencidos'), late.length ? collapsible('ul', 'mini', late, 6, line) : h('p', { class: 'empty' }, 'Nenhum vencido.')),
          h('div', { class: 'span-6' }, h('p', { class: 'hint' }, 'Vencem nos próximos 7 dias'), soon.length ? collapsible('ul', 'mini', soon, 6, line) : h('p', { class: 'empty' }, 'Nada vencendo na semana.'))));
    }

    // Gestores
    const sum = d.managers.reduce((a, m) => { for (const f of ['active', 'at_risk', 'attention', 'spend_7d', 'conv_7d', 'waiting', 'no_delivery', 'low_balance', 'meetings_30d']) a[f] = (a[f] || 0) + m[f]; return a; }, {});
    const cell = (v, f) => h('td', { class: 'num' + (!v ? ' zero' : '') }, f ? f(v) : nf(v));
    const mgr = panel(12, 'Carteira por gestor', 'Meta nos últimos 7 dias, só contas ligadas à carteira ativa; esperando resposta = grupo com a cliente aguardando há ' + nf(d.relationship.waiting_threshold_h) + 'h ou mais; reuniões = clientes com reunião gravada ligada nos últimos 30 dias.',
      h('button', { type: 'button', class: 'linkbtn', style: 'margin-bottom:8px', onclick: (e) => { const all = e.currentTarget.parentElement.querySelector('.mgr-tbl').classList.toggle('all'); e.currentTarget.textContent = all ? 'Ver menos colunas' : 'Ver todas as colunas'; } }, 'Ver todas as colunas'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl mgr-tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Gestor'), h('th', {}, 'Squad'), ...['Carteira', 'Em risco', 'Pedem ação', 'Investimento', 'Conversas', 'Custo/conv.', 'Esperando', 'Sem entrega', 'Saldo baixo', 'Com reunião'].map((t) => h('th', { class: 'num' }, t)))),
        h('tbody', {}, d.managers.map((m) => h('tr', {}, h('td', {}, h('b', {}, m.name), m.unlinked ? h('div', { class: 'small muted' }, m.unlinked + ' sem ficha ligada') : null), h('td', { class: 'muted' }, m.squad || 'sem squad'),
          cell(m.active), cell(m.at_risk), cell(m.attention), cell(m.spend_7d, brl0), cell(m.conv_7d), h('td', { class: 'num' + (m.cpc_7d === null ? ' zero' : '') }, m.cpc_7d === null ? 'sem' : brl2(m.cpc_7d)),
          cell(m.waiting), cell(m.no_delivery), cell(m.low_balance), cell(m.meetings_30d))),
        h('tr', { class: 'sum' }, h('td', {}, 'Total'), h('td', {}), cell(sum.active), cell(sum.at_risk), cell(sum.attention), cell(sum.spend_7d, brl0), cell(sum.conv_7d), h('td', { class: 'num' }, brl2(k.cpc_7d)),
          cell(sum.waiting), cell(sum.no_delivery), cell(sum.low_balance), cell(sum.meetings_30d))))));

    // Mídia
    const md = d.media;
    const media = panel(8, 'Investimento e conversas na Meta', 'Últimos 14 dias fechados (o dia de hoje a Meta ainda não fechou).',
      h('div', { class: 'stat-row' },
        h('div', {}, h('div', { class: 'lbl' }, 'clientes investindo'), h('div', { class: 'big' }, nf(md.clients_with_spend))),
        h('div', {}, h('div', { class: 'lbl' }, 'com campanha sem entrega'), h('div', { class: 'big' }, nf(md.no_delivery))),
        h('div', {}, h('div', { class: 'lbl' }, 'com saldo pré-pago baixo'), h('div', { class: 'big' }, nf(md.low_balance)))),
      chartDaily(md.daily),
      h('p', { class: 'hint', style: 'margin:14px 0 4px' }, 'Conversas por dia'),
      chartColumns(md.daily.map((p) => ({ v: p.conversations, title: dLabel(p.day), rows: [['Conversas', nf(p.conversations)], ['Investimento', brl0(p.spend)]] })), { label: 'Conversas por dia', h: 100, color: 'var(--series-1)' }),
      md.outside_spend_7d ? h('div', { class: 'gap' }, brl0(md.outside_spend_7d) + ' investidos na semana em contas sem cliente ativa ligada (ex-cliente, conta própria ou vínculo pendente na Conciliação) ficam fora destes números.') : null);
    const mrow = (val) => (r) => h('li', { class: r.client_id ? 'click' : '', onclick: () => goClient(r.client_id) },
      h('span', {}, h('b', {}, r.name), h('div', { class: 'small muted' }, r.manager || 'sem gestor')), h('span', { class: 'v' }, val(r)));
    const mlist = (items, val, n) => collapsible('ul', 'mini', items, n || 6, mrow(val));
    const media2 = panel(4, 'Onde olhar na mídia', 'Custo por conversa acima de ' + brl2(md.expensive_threshold) + ' na semana (só campanhas de conversa).',
      md.expensive.length ? mlist(md.expensive, (r) => brl2(r.cpc_7d), 4) : h('p', { class: 'empty' }, 'Ninguém acima da régua.'),
      h('h2', { style: 'margin-top:18px' }, 'Maiores investimentos'), mlist(md.top, (r) => brl0(r.spend_7d), 4));

    // Relacionamento
    const rl = d.relationship;
    const wa = panel(4, 'Grupos de WhatsApp', 'Grupos ligados à carteira ativa, no estado que o ouvinte do Mac grava a cada 30 minutos.',
      h('div', { class: 'stat-row' }, h('div', {}, h('div', { class: 'lbl' }, 'esperando resposta'), h('div', { class: 'big' }, nf(rl.waiting_count))),
        h('div', {}, h('div', { class: 'lbl' }, 'em silêncio há 7+ dias'), h('div', { class: 'big' }, nf(rl.silent_7d)))),
      rl.waiting.length ? mlist(rl.waiting, (w) => w.hours >= 48 ? 'há ' + Math.floor(w.hours / 24) + ' dias' : 'há ' + Math.round(w.hours) + 'h') : h('p', { class: 'empty' }, 'Ninguém esperando.'),
      rl.waiting_unlinked ? h('div', { class: 'gap' }, rl.waiting_unlinked + ' grupo(s) sem cliente ligada também esperando: ficam fora da conta até a Conciliação dizer de quem são.') : null);
    const sig = panel(4, 'Sinais nos grupos', 'Classificados nos últimos 14 dias, grupos da carteira ativa.',
      rl.signals_14d.length ? hbars(rl.signals_14d.map((x) => ({ label: x.label, count: x.count, tone: ['risco_de_saida', 'insatisfacao'].includes(x.kind) ? 'bad' : x.kind === 'feedback_positivo' ? 'ok' : 'warn' })).sort((a, b) => b.count - a.count))
        : h('p', { class: 'empty' }, 'Nenhum sinal no período.'));
    const meet = panel(4, 'Reuniões com cliente', nf(rl.meetings_30d) + ' gravadas nos últimos 30 dias (internas fora).',
      chartColumns(rl.meetings_weekly.map((w) => ({ v: w.count, dim: w.in_progress, label: dLabel(w.week), title: 'Semana de ' + dLabel(w.week) + (w.in_progress ? ' (em andamento)' : ''), rows: [['Reuniões', nf(w.count)]] })), { label: 'Reuniões por semana', w: 360, h: 150, bw: 22 }));

    // Contratos
    const ct = d.contracts;
    const ten = panel(4, 'Tempo de casa', ct.tenure_median_days === null ? 'Sem data de entrada.' : 'Mediana de ' + nf(ct.tenure_median_days / 30.44, 1) + ' meses na carteira ativa.', hbars(ct.tenure_buckets));
    const terms = panel(4, 'Prazo de contrato', 'Campo do Notion.', hbars(ct.terms));
    const cyc = panel(12, 'Ciclos vencendo', 'De 7 dias atrás até 30 dias à frente. ' + ct.cycle_end_known + ' de ' + k.active + ' clientes têm fim de ciclo no Notion.',
      ct.cycles.length ? collapsible('ul', 'mini', ct.cycles, 8, (c) => { const [t, tone] = daysChip(c.days); return h('li', { class: c.client_id ? 'click' : '', onclick: () => goClient(c.client_id) },
        h('span', {}, h('b', {}, c.name), h('div', { class: 'small muted' }, (c.manager || 'sem gestor') + ' · ' + fmtDay(c.cycle_end))), h('span', { class: 'chip ' + tone }, t)); })
        : h('p', { class: 'empty' }, 'Nenhum ciclo no período.'));

    // Cobertura
    const cv = d.coverage;
    const covItem = (lbl, n, note) => h('div', {}, h('div', { class: 'row' }, h('span', { class: 'small' }, lbl), h('span', { class: 'spacer' }), h('b', { class: 'small' }, n + ' de ' + cv.active)),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: 'width:' + (cv.active ? n / cv.active * 100 : 0) + '%' })), h('div', { class: 'small muted' }, note));
    const cov = panel(12, 'Cobertura dos dados', 'Quanto da carteira ativa cada fonte enxerga. Onde falta vínculo, o número acima fica parcial; o vínculo se resolve na Conciliação.',
      h('div', { class: 'cov' },
        covItem('Ficha ligada ao Notion', cv.linked, 'sem ficha: fica fora do cruzamento'),
        covItem('Conta de anúncio ligada', cv.meta, 'mídia e custo por conversa'),
        covItem('Grupo de WhatsApp ligado', cv.whatsapp, 'espera, silêncio e sinais'),
        covItem('Reunião gravada ligada', cv.meetings, 'só estas entram em "sem reunião"'),
        covItem('Data de entrada no Notion', cv.entry_date, 'tempo de casa e histórico')));

    // Seção recolhida: o detalhe continua todo aqui, mas só aparece quando é pedido.
    const fold = (title, desc, ...body) => h('details', { class: 'fold' },
      h('summary', {}, h('span', {}, h('span', { class: 'h2like' }, title), h('span', { class: 'fold-desc' }, desc))), ...body);
    view.replaceChildren(h('div', { class: 'ov' },
      h('div', { class: 'ov-head' }, h('div', {}, h('h1', {}, 'Visão geral'), h('p', { class: 'sub', style: 'margin:0' }, d.squad ? d.squad.name : 'Agência inteira', dataStatus ? ' · ' : '', dataStatus)),
        h('span', { class: 'spacer' }), seg),
      kpis,
      renovaShort ? h('div', { class: 'grid' }, renovaShort) : null,
      h('h2', { class: 'fold-title' }, 'Para analisar com calma'),
      fold('Operação', 'Clientes com sinais de risco nos grupos, mídia e reuniões', h('div', { class: 'grid' }, att)),
      fold('Clientes', 'Entradas, saídas, motivos e jornada', h('div', { class: 'grid' }, flow, reasons), monthBox, h('div', { class: 'grid' }, journey, ten, terms)),
      fold('Renovações e ciclos', 'Vencidas, a vencer e ciclos terminando', renova ? h('div', { class: 'grid' }, renova) : null, h('div', { class: 'grid' }, cyc)),
      fold('Gestores', 'Carteira e riscos de cada gestor', h('div', { class: 'grid' }, mgr)),
      fold('Mídia', 'Investimento e conversas na Meta', mediaKpis, h('div', { class: 'grid' }, media, media2)),
      fold('Relacionamento', 'WhatsApp, sinais e reuniões', h('div', { class: 'grid' }, wa, sig, meet)),
      fold('Qualidade dos dados', 'Atualização e cobertura das fontes', fresh, h('div', { class: 'grid' }, cov))));
  }

  // ---------- carteira ----------
  const tenure = (days) => days === null || days === undefined ? 'sem data de entrada' : days < 31 ? days + ' dia(s) de casa' : Math.floor(days / 30.44) + ' mês(es) de casa';
  const VIEW_KEY = 'cc_carteira_view';
  function portfolioView() { try { return sessionStorage.getItem(VIEW_KEY) || 'quadro'; } catch (e) { return 'quadro'; } }
  function viewSwitch(current) {
    const b = (key, label) => h('button', { class: current === key ? 'on' : '', onclick: () => { try { sessionStorage.setItem(VIEW_KEY, key); } catch (e) { /* sem armazenamento */ } renderPortfolio(); } }, label);
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Modo de exibição' }, b('quadro', 'Quadro'), b('lista', 'Lista'));
  }

  async function renderPortfolio() {
    if (portfolioView() === 'quadro') return renderBoard();
    return renderList();
  }

  // Filtro do quadro: fica guardado enquanto a página está aberta (arrastar um cartão redesenha sem perder o recorte).
  const bf = { q: '', squad: '', manager: '', term: '', tenure: '', cycle: false, unlinked: false,
    active() { return !!(this.q || this.squad || this.manager || this.term || this.tenure || this.cycle || this.unlinked); },
    clear() { Object.assign(this, { q: '', squad: '', manager: '', term: '', tenure: '', cycle: false, unlinked: false }); } };
  const TENURE = [['', 'Tempo de casa'], ['0-30', 'Até 30 dias'], ['31-90', '1 a 3 meses'], ['91-182', '3 a 6 meses'], ['183-364', '6 a 12 meses'], ['365-99999', 'Mais de 1 ano']];
  const gestorOf = (c) => c.client && c.client.manager ? c.client.manager.display_name : (c.managers_in_notion[0] || 'Sem gestor');
  const cycleDays = (c) => c.cycle_end ? Math.round((new Date(c.cycle_end + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00')) / 86400000) : null;
  function cycleChip(c) {
    const d = cycleDays(c);
    if (d === null || d < -7 || d > 30) return null;
    const [t, tone] = daysChip(d);
    return h('div', { class: 'chips' }, h('span', { class: 'chip ' + tone }, 'ciclo ' + t));
  }
  function boardMatches(c) {
    const q = bf.q.trim().toLowerCase();
    const d = cycleDays(c);
    const [lo, hi] = bf.tenure ? bf.tenure.split('-').map(Number) : [null, null];
    return (!bf.squad || (c.client && c.client.squad && String(c.client.squad.id) === bf.squad))
      && (!bf.manager || gestorOf(c) === bf.manager)
      && (!bf.term || (c.contract_term || 'Sem prazo') === bf.term)
      && (!bf.tenure || (c.tenure_days !== null && c.tenure_days >= lo && c.tenure_days <= hi))
      && (!bf.cycle || (d !== null && d >= -7 && d <= 30))
      && (!bf.unlinked || !c.client)
      && (!q || c.name.toLowerCase().includes(q) || gestorOf(c).toLowerCase().includes(q) || (c.contact || '').toLowerCase().includes(q));
  }
  function boardToolbar(cards, redraw) {
    const squads = [...new Map(cards.filter((c) => c.client && c.client.squad).map((c) => [String(c.client.squad.id), c.client.squad.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const managers = [...new Set(cards.map(gestorOf))].sort((a, b) => a.localeCompare(b));
    const terms = [...new Set(cards.map((c) => c.contract_term || 'Sem prazo'))].sort();
    const el = h('div', { class: 'toolbar', role: 'search' });
    const count = h('span', { class: 'count' });
    let moreFilters = !!(bf.manager || bf.term || bf.tenure || bf.cycle || bf.unlinked);
    function build() {
      const search = h('input', { type: 'search', placeholder: 'Buscar loja, gestor ou contato', 'aria-label': 'Buscar', value: bf.q,
        oninput: (e) => { bf.q = e.target.value; redraw(); syncClear(); } });
      const sel = (key, first, opts) => h('select', { class: bf[key] ? 'on' : '', 'aria-label': first, onchange: (e) => { bf[key] = e.target.value; build(); redraw(); } },
        h('option', { value: '' }, first), opts.map(([v, t]) => h('option', { value: v, selected: bf[key] === v ? true : null }, t)));
      const tog = (key, label) => h('button', { type: 'button', class: 'tog' + (bf[key] ? ' on' : ''), 'aria-pressed': String(!!bf[key]), onclick: () => { bf[key] = !bf[key]; build(); redraw(); } }, label);
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Squad' }, [['', 'Todas']].concat(squads).map(([id, name]) =>
        h('button', { type: 'button', class: bf.squad === id ? 'on' : '', onclick: () => { bf.squad = id; build(); redraw(); } }, name)));
      const moreBtn = h('button', { type: 'button', class: 'tog' + (moreFilters ? ' on' : ''), 'aria-expanded': String(moreFilters), onclick: () => { moreFilters = !moreFilters; build(); } }, 'Filtros');
      el.replaceChildren(search, seg, moreBtn, h('span', { class: 'spacer' }), count, clear);
      if (moreFilters) el.append(h('div', { class: 'toolbar-more' }, sel('manager', 'Gestor', managers.map((m) => [m, m])), sel('term', 'Contrato', terms.map((t) => [t, t])),
        sel('tenure', 'Tempo de casa', TENURE.slice(1)), tog('cycle', 'Ciclo vence em 30 dias'), tog('unlinked', 'Sem ficha')));
      syncClear();
    }
    const clear = h('button', { type: 'button', class: 'linkbtn', onclick: () => { bf.clear(); build(); redraw(); } }, 'Limpar filtros');
    const syncClear = () => { clear.hidden = !bf.active(); };
    build();
    return { el, count: (n, total) => { count.textContent = n === total ? total + ' clientes' : n + ' de ' + total; } };
  }

  async function renderBoard() {
    const r = (await api('GET', 'clients/board')).data;
    const cardsAll = r.columns.flatMap((c) => c.clients);
    const board = h('div', { class: 'board' });
    const tb = boardToolbar(cardsAll, () => draw());
    const f = FRESH[r.source.freshness] || [r.source.freshness, ''];
    // Estado local das colunas: arrastar move o cartão na hora e volta se o Notion recusar.
    const cols = new Map(r.columns.map((c) => [c.label, c.clients.slice()]));
    const order = r.journeys.filter((j) => cols.has(j)).concat([...cols.keys()].filter((k) => !r.journeys.includes(k)));
    let dragging = null;

    async function move(card, from, to) {
      cols.set(from, cols.get(from).filter((c) => c !== card));
      if (!cols.has(to)) { cols.set(to, []); if (!order.includes(to)) order.splice(r.journeys.indexOf(to), 0, to); }
      cols.get(to).push(card);
      draw();
      try {
        await api('POST', 'clients/board/move', { notion_id: card.notion_id, journey: to });
        toast((card.client ? card.client.trade_name : card.name) + ' foi para ' + to + ' (gravado no Notion).');
      } catch (e) {
        cols.set(to, cols.get(to).filter((c) => c !== card));
        cols.get(from).push(card);
        draw();
        toast(e.message, true);
      }
    }
    const matches = (c) => boardMatches(c);
    function cardEl(c, col) {
      const gestor = c.client && c.client.manager ? c.client.manager.display_name : (c.managers_in_notion.join(', ') || 'sem gestor');
      const el = h('div', { class: 'kcard' + (c.can_move ? ' movable' : '') + (c.client ? '' : ' unlinked'), tabindex: 0, draggable: c.can_move ? 'true' : null,
        title: [tenure(c.tenure_days), c.contract_term ? 'contrato ' + c.contract_term.toLowerCase() : null, c.can_move ? 'arraste para mudar a jornada' : null].filter(Boolean).join(' · '),
        onclick: () => { if (c.client) location.hash = '#/cliente/' + c.client.id; },
        onkeydown: (e) => { if (e.key === 'Enter' && c.client) location.hash = '#/cliente/' + c.client.id; },
        ondragstart: (e) => { dragging = { card: c, from: col }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.notion_id); el.classList.add('dragging'); },
        ondragend: () => { el.classList.remove('dragging'); document.querySelectorAll('.col.over').forEach((x) => x.classList.remove('over')); } },
      h('b', {}, c.name),
      h('div', { class: 'small muted' }, gestor),
      cycleChip(c),
      c.client ? null : h('div', { class: 'small' }, badge('sem ficha: está na Conciliação', 'b-warn')));
      return el;
    }
    function draw() {
      tb.count(cardsAll.filter(matches).length, cardsAll.length);
      // Com o quadro arrastável, todas as colunas da Jornada aparecem para poder soltar em qualquer uma; vazia fica pequena.
      // Com filtro ligado, coluna vazia some: o quadro mostra só onde está o que se procura.
      const labels = r.move.enabled ? r.journeys.concat(order.filter((k) => !r.journeys.includes(k))) : order;
      board.replaceChildren(...labels.filter((label) => !bf.active() || (cols.get(label) || []).some(matches)).map((label) => {
        const cards = (cols.get(label) || []).filter(matches);
        const colEl = h('section', { class: 'col' + (cards.length ? '' : ' empty'),
          ondragover: (e) => { if (dragging && dragging.from !== label) { e.preventDefault(); colEl.classList.add('over'); } },
          ondragleave: () => colEl.classList.remove('over'),
          ondrop: (e) => { e.preventDefault(); colEl.classList.remove('over'); if (dragging && dragging.from !== label) { const d = dragging; dragging = null; move(d.card, d.from, label); } } },
        h('h3', {}, label, h('span', { class: 'badge' }, String(cards.length))),
        ...cards.map((c) => cardEl(c, label)));
        return colEl;
      }));
    }
    draw();
    view.replaceChildren(
      h('div', { class: 'row' }, h('h1', {}, 'Carteira'), h('span', { class: 'spacer' }), r.source.freshness !== 'FRESH' ? badge('Dados: ' + f[0], f[1]) : null, viewSwitch('quadro')),
      h('p', { class: 'sub' }, cardsAll.length + ' clientes ativas.' + (r.move.enabled ? ' Arraste o cartão para mudar a jornada.' : ' ' + r.move.reason)),
      tb.el, board);
  }

  let listChurned = false;
  async function renderList() {
    const r = await api('GET', listChurned ? 'clients?per_page=100&lifecycle_state=CHURNED' : 'clients?per_page=100&exclude_lifecycle_state=CHURNED');
    const search = h('input', { placeholder: 'Buscar cliente', 'aria-label': 'Buscar cliente' });
    const body = h('tbody');
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      body.replaceChildren(...r.data.filter((c) => c.trade_name.toLowerCase().includes(q)).map((c) => h('tr', { class: 'click', tabindex: 0,
        onclick: () => { location.hash = '#/cliente/' + c.id; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = '#/cliente/' + c.id; } },
      h('td', {}, h('b', {}, c.trade_name)), h('td', {}, STATE[c.lifecycle_state.code] || c.lifecycle_state.code),
      h('td', {}, c.squad ? c.squad.name : 'sem squad'), h('td', {}, c.manager ? c.manager.display_name : 'sem gestor'))));
      if (!body.children.length) body.append(h('tr', {}, h('td', { colspan: 4, class: 'empty' }, 'Nenhuma cliente visível com esse nome.')));
    };
    search.addEventListener('input', draw);
    draw();
    view.replaceChildren(
      h('div', { class: 'row' }, h('h1', {}, 'Carteira'), h('span', { class: 'spacer' }), viewSwitch('lista')),
      h('p', { class: 'sub' }, r.meta.pagination.total + (listChurned ? ' cliente(s) com contrato encerrado (só consulta da ficha). ' : ' cliente(s) com contrato em andamento. As encerradas ficam fora da carteira; a ficha delas continua. '),
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); listChurned = !listChurned; renderList(); } }, listChurned ? 'Voltar para a carteira' : 'Ver as encerradas')),
      h('div', { class: 'card' }, h('div', { class: 'row', style: 'margin-bottom:12px' }, search),
        h('table', {}, h('thead', {}, h('tr', {}, ['Cliente', 'Situação', 'Squad', 'Gestor'].map((t) => h('th', {}, t)))), body)));
  }

  // ---------- ficha ----------
  // Ficha como página do Notion: propriedades no topo, faixa com o estado de cada fonte e abas para o detalhe.
  const STATE_TAG = { ONBOARDING: 'tag-blue', ACTIVE: 'tag-green', NOTICE_GIVEN: 'tag-red', CHURNED: 'tag-gray', PAUSED: 'tag-yellow', ARCHIVED: 'tag-gray' };
  const JOURNEY_TAG = (j) => !j ? 'tag-gray' : /aviso|risco|cr[ií]tic/i.test(j) ? 'tag-red' : /aten/i.test(j) ? 'tag-yellow' : /inativ/i.test(j) ? 'tag-gray' : /novo|onboard/i.test(j) ? 'tag-blue' : 'tag-green';
  const TABS = [['resumo', 'Resumo'], ['tarefas', 'Tarefas'], ['midia', 'ADS'], ['whatsapp', 'WhatsApp'], ['reunioes', 'Reuniões'], ['notas', 'Notas'], ['historico', 'Histórico']];
  async function renderClient(id) {
    const client = (await api('GET', 'clients/' + id)).data;
    const [src, media, issues, renova] = await Promise.all([
      api('GET', 'clients/' + id + '/source-records').then((r) => r.data).catch(() => null),
      api('GET', 'media/clients/' + id + '/summary').then((r) => r.data).catch(() => null),
      api('GET', 'issues?client_id=' + id + '&per_page=50').then((r) => r.data).catch(() => []),
      can('renewals.read') ? api('GET', 'renewals/operation').then((r) => r.data).catch(() => null) : null]);
    const nfN = (src && src.records[0]) ? src.records[0].fields : {};
    // A ficha é a fonte (DT-177): o que está na ficha vale; o Notion só aparece onde a ficha ainda está vazia.
    const pf = client.profile || {};
    const pick = (a, b) => (a !== null && a !== undefined && a !== '') ? a : b;
    const nf0 = Object.assign({}, nfN, { contact: pick(pf.contact_name, nfN.contact), contract_term: pick(pf.contract_term, nfN.contract_term),
      entry_date: pick(pf.entry_on, nfN.entry_date), cycle_end: pick(pf.cycle_end_on, nfN.cycle_end), journey: pick(pf.journey, nfN.journey) });
    const rerender = () => renderClient(id);
    const rn = renova ? renova.rows.find((r) => r.client_id === id) : null;
    const groups = src ? src.whatsapp || [] : [];
    const meetings = src ? src.meetings || [] : [];
    const days = (d) => d ? Math.round((new Date(d + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00')) / 86400000) : null;
    const tenureDays = nf0.entry_date ? -days(nf0.entry_date) : null;
    const prop = (label, ...val) => h('div', { class: 'prop' }, h('div', { class: 'plabel' }, label), h('div', { class: 'pval' }, ...(val.filter((v) => v !== null && v !== undefined && v !== '').length ? val : [h('span', { class: 'muted' }, 'vazio')])));
    const cyc = days(nf0.cycle_end);
    const props = h('div', { class: 'props' },
      prop('Situação', h('span', { class: 'badge ' + (STATE_TAG[client.lifecycle_state.code] || '') }, STATE[client.lifecycle_state.code] || client.lifecycle_state.code)),
      prop('Jornada', nf0.journey ? h('span', { class: 'badge ' + JOURNEY_TAG(nf0.journey) }, nf0.journey) : null),
      prop('Squad', client.squad ? client.squad.name : null),
      prop('Gestor', client.manager ? client.manager.display_name : null),
      prop('Contato', nf0.contact || null),
      prop('Entrada', nf0.entry_date ? fmtDay(nf0.entry_date) : (client.lifecycle_start_at ? fmtDay(client.lifecycle_start_at) : null), tenureDays !== null ? h('span', { class: 'muted' }, ' · ' + tenure(tenureDays)) : null),
      prop('Contrato', nf0.contract_term || null),
      prop('Fim do ciclo', nf0.cycle_end ? fmtDay(nf0.cycle_end) : null, cyc !== null && cyc >= -7 && cyc <= 30 ? h('span', { class: 'badge ' + daysChip(cyc)[1].replace('bad', 'tag-red').replace('warn', 'tag-yellow').replace('info', 'tag-blue'), style: 'margin-left:6px' }, daysChip(cyc)[0]) : null),
      rn ? prop('Renova', fmtDay(rn.due_date), h('span', { class: 'badge ' + (SIT[rn.situation] || ''), style: 'margin-left:6px' }, rn.situation), rn.amount !== null ? h('span', { class: 'muted' }, ' · ' + brl2(rn.amount)) : null) : null,
      nf0.exit_date ? prop('Saída', fmtDay(nf0.exit_date), nf0.exit_reason ? h('span', { class: 'muted' }, ' · ' + nf0.exit_reason) : null) : null);

    // No topo, só o essencial; o resto do cadastro fica em "Mais informações".
    const propKids = [...props.children];
    const propMain = h('div', { class: 'props props-main' }, [0, 1, 3, 7].map((i) => propKids[i]));
    const moreProps = h('details', { class: 'more-props' }, h('summary', { class: 'small' }, 'Mais informações'), props);
    // Faixa: o estado de cada fonte num relance.
    const t = media && media.totals_by_currency ? media.totals_by_currency[0] : null;
    const acc = media && media.current_accounts ? media.current_accounts[0] : null;
    const fund = acc && acc.funding ? (FUND[acc.funding.status] || [String(acc.funding.status || '').toLowerCase(), '']) : null;
    const g = groups[0];
    const gst = g ? (WA_STATE[g.state] || [g.state || 'sem estado', '']) : null;
    const lastMeet = meetings[0];
    const openIssues = issues.filter((i) => !['VERIFIED_RESOLVED', 'FALSE_POSITIVE'].includes(i.state));
    const tile = (lbl, big, sub, tab) => h('button', { type: 'button', class: 'tile', onclick: () => showTab(tab) }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'tbig' }, big), h('div', { class: 'small muted' }, sub || ''));
    const strip = h('div', { class: 'tiles' },
      tile('ADS · ' + (media && media.window ? 'desde ' + fmtDay(media.window.from) : 'Meta'), t && t.spend !== null ? brl0(Number(t.spend)) : 'sem conta',
        t ? (t.conversations ? nf(t.conversations) + ' conversas · ' + brl2(Number(t.spend) / t.conversations) + ' cada' : 'sem conversa no período') + (fund ? ' · ' + fund[0] : '') : 'nenhuma conta de anúncio ligada', 'midia'),
      tile('WhatsApp', g ? gst[0] : 'sem grupo', g ? (g.waiting_hours ? 'esperando há ' + Math.round(g.waiting_hours) + 'h · ' : '') + (g.signals.length ? g.signals.length + ' sinal(is)' : 'sem sinais') : 'nenhum grupo ligado', 'whatsapp'),
      tile('Reuniões', lastMeet ? fmtDay(lastMeet.started_at.slice(0, 10)) : 'nenhuma', lastMeet ? 'última · ' + meetings.length + ' gravada(s)' : 'nenhuma reunião ligada', 'reunioes'),
      tile('Alertas abertos', nf(openIssues.length), openIssues.length ? openIssues.slice(0, 2).map((i) => SEV[i.severity] || i.severity).join(', ') : 'nada aberto', 'resumo'));

    const panes = {};
    const tabsBar = h('div', { class: 'tabs', role: 'tablist' });
    let current = (() => { try { return sessionStorage.getItem('cc_ficha_tab') || 'resumo'; } catch (e) { return 'resumo'; } })();
    function showTab(k) {
      current = k;
      try { sessionStorage.setItem('cc_ficha_tab', k); } catch (e) { /* sem armazenamento */ }
      tabsBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
      Object.entries(panes).forEach(([key, el]) => { el.hidden = key !== k; });
    }
    const counts = { midia: media && media.current_accounts ? media.current_accounts.length : 0, whatsapp: groups.length, reunioes: meetings.length, resumo: openIssues.length };
    TABS.forEach(([k, label]) => {
      tabsBar.append(h('button', { type: 'button', role: 'tab', 'data-tab': k, onclick: () => showTab(k) }, label, counts[k] ? h('span', { class: 'tcount' }, String(counts[k])) : null));
      panes[k] = h('div', { class: 'pane', role: 'tabpanel' });
    });
    const fresh = client.lifecycle_state.code === 'ONBOARDING' || /onboard|novo/i.test(nf0.journey || '') || (tenureDays !== null && tenureDays <= 45);
    const brief = briefingCard(client, rerender);
    panes.resumo.append(...[fresh ? brief : null, h('div', { id: 'oneonone' }), h('div', { id: 'issues' }), fresh ? null : brief, h('div', { id: 'source' })].filter(Boolean));
    panes.tarefas.append(h('div', { id: 'tasks' }), h('div', { id: 'requests' }));
    panes.midia.append(h('div', { id: 'media' }));
    panes.whatsapp.append(h('div', { id: 'whatsapp' }));
    panes.reunioes.append(h('div', { id: 'meetings' }));
    panes.notas.append(h('div', { id: 'notes' }));
    panes.historico.append(h('div', { id: 'timeline' }));

    const editSlot = h('div');
    const canEdit = ['UPDATE', 'CHANGE_LIFECYCLE', 'TRANSFER'].some((a) => client.allowed_actions.includes(a));
    const editBtn = canEdit ? h('button', { type: 'button', class: 'ghost', onclick: async () => {
      if (editSlot.childNodes.length) { editSlot.replaceChildren(); editBtn.textContent = 'Editar ficha'; return; }
      editBtn.textContent = 'Fechar edição';
      editSlot.replaceChildren(await editProfile(client, nf0, rerender));
    } }, 'Editar ficha') : null;
    view.replaceChildren(
      h('div', { class: 'crumbs' }, h('a', { href: '#/carteira' }, 'Carteira'), h('span', {}, ' / '), h('span', {}, client.trade_name)),
      h('div', { class: 'row', style: 'align-items:flex-end;gap:10px' }, h('h1', { style: 'margin:0' }, client.trade_name), h('span', { class: 'spacer' }), editBtn,
        nf0.url ? h('a', { class: 'small', href: nf0.url, target: '_blank', rel: 'noopener' }, 'Abrir no Notion ↗') : null),
      propMain, moreProps, editSlot, tabsBar, ...Object.values(panes));
    showTab(TABS.some(([k]) => k === current) ? current : 'resumo');
    await Promise.all([sourceCard(client), mediaCard(client), issuesCard(client), requestsCard(client), notesCard(client), timelineCard(client), oneOnOneCard(client), tasksCard(client)]);
  }
  const slot = (id, node) => { const s = document.getElementById(id); if (s) s.replaceChildren(node); };

  async function sourceCard(client) {
    let r;
    try { r = (await api('GET', 'clients/' + client.id + '/source-records')).data; } catch (e) { slot('source', card('Cadastro no Notion', empty(e.message))); return; }
    whatsappCard(r.whatsapp || []);
    meetingsCard(r.meetings || [], r.meetings_source, client);
    if (!r.records.length) {
      slot('source', foldCard('Dados de origem', empty('Nenhuma fonte ligada a esta cliente. ' + (client.origin.synthetic ? 'É um cadastro sintético de demonstração.' : 'Cadastro feito à mão no Command Center.'))));
      return;
    }
    slot('source', foldCard('Dados de origem', ...r.records.map((rec) => {
      const f = FRESH[rec.freshness] || [rec.freshness, ''];
      return h('div', {},
        h('div', { class: 'row' }, modeBadge(rec.source_mode, rec.source === 'NOTION' ? 'Notion' : rec.source), badge(f[0], f[1]),
          rec.missing_since ? badge('sumiu da fonte em ' + fmt(rec.missing_since), 'b-bad') : null),
        h('dl', { class: 'kv', style: 'margin-top:10px' },
          h('dt', {}, 'Nome'), h('dd', {}, rec.fields.name || 'sem dado'),
          h('dt', {}, 'Status'), h('dd', {}, [rec.fields.status, rec.fields.journey].filter(Boolean).join(' / ') || 'sem dado'),
          h('dt', {}, 'Gestor na fonte'), h('dd', {}, rec.fields.manager || 'sem dado'),
          h('dt', {}, 'Entrada'), h('dd', {}, fmtDay(rec.fields.entry_date)),
          h('dt', {}, 'Saída'), h('dd', {}, rec.fields.exit_date ? fmtDay(rec.fields.exit_date) + (rec.fields.exit_reason ? ' (' + rec.fields.exit_reason + ')' : '') : 'sem data'),
          h('dt', {}, 'Lido por último'), h('dd', {}, fmt(rec.last_seen_at)),
          h('dt', {}, 'Editado na fonte'), h('dd', {}, fmt(rec.source_edited_at))),
        rec.divergences.length ? h('div', {}, h('p', { class: 'small', style: 'margin:12px 0 4px' }, h('b', {}, 'Divergências (nada é corrigido sozinho):')),
          ...rec.divergences.map((d) => h('div', { class: 'diverge small' }, h('b', {}, d.field === 'state' ? 'Situação' : d.field === 'manager' ? 'Gestor' : 'Nome'), ': fonte ',
            d.source_value ? (STATE[d.source_value] || d.source_value) : 'indefinida', ', Command Center ', d.current_value ? (STATE[d.current_value] || d.current_value) : 'sem dado', '. ', d.note)))
          : h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Fonte e Command Center concordam nos campos comparados.'));
    })));
  }

  const WA_STATE = { 'cliente esperando': ['cliente esperando a agência', 'b-bad'], 'última é nossa': ['última mensagem é da agência', 'b-ok'], 'sem mensagem desde a entrada do ouvinte': ['sem mensagem desde que o ouvinte entrou', 'b-warn'] };
  const WA_SIGNAL = { insatisfacao: 'insatisfação', pedido_pendente: 'pedido pendente', risco_de_saida: 'risco de saída', feedback_positivo: 'retorno positivo',
    dinheiro_parado: 'saldo ou pagamento parado', promessa_da_cliente: 'promessa da cliente', sem_resposta: 'sem resposta' };
  function whatsappCard(groups) {
    if (!groups.length) { slot('whatsapp', card('WhatsApp', empty('Nenhum grupo de WhatsApp ligado a esta cliente.'))); return; }
    slot('whatsapp', card('Grupo de WhatsApp', h('p', { class: 'small muted' }, 'Estado calculado pelo ouvinte e sinais classificados. O texto das conversas não entra aqui, só um trecho curto como prova.'),
      ...groups.map((g) => {
        const f = FRESH[g.freshness] || [g.freshness, ''];
        const st = WA_STATE[g.state] || [g.state || 'sem estado', ''];
        return h('div', { style: 'margin-top:10px' },
          h('div', { class: 'row' }, h('b', {}, g.group), h('span', { class: 'spacer' }), modeBadge(g.source_mode, 'WhatsApp'), badge(f[0], f[1]),
            g.missing_since ? badge('sumiu da leitura em ' + fmt(g.missing_since), 'b-bad') : null),
          h('dl', { class: 'kv', style: 'margin-top:8px' },
            h('dt', {}, 'Estado'), h('dd', {}, badge(st[0], st[1]), g.asked_again ? ' cobrou de novo' : ''),
            h('dt', {}, 'Esperando há'), h('dd', {}, g.waiting_hours === null ? 'sem dado' : g.waiting_hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' h'),
            h('dt', {}, 'Última conversa'), h('dd', {}, g.silence_days === null ? 'sem dado' : 'há ' + g.silence_days.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' dia(s)'),
            h('dt', {}, 'Mensagens lidas'), h('dd', {}, g.messages === null ? 'sem dado' : String(g.messages)),
            h('dt', {}, 'Lido em'), h('dd', {}, fmt(g.observed_at))),
          g.signals.length ? h('div', {}, h('p', { class: 'small', style: 'margin:10px 0 4px' }, h('b', {}, 'Sinais no histórico')),
            ...g.signals.map((x) => h('div', { class: 'diverge small' }, h('b', {}, WA_SIGNAL[x.type] || x.type), ' · ', fmt(x.occurred_at), x.awaiting_our_reply ? ' · aguardando nossa resposta' : '',
              h('div', { class: 'muted' }, x.excerpt))))
            : h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Nenhum sinal classificado no histórico lido.'));
      })));
  }

  const FUND = { LOW: ['saldo baixo', 'b-bad'], OK: ['saldo ok', 'b-ok'], NOT_APPLICABLE: ['cartão (pós-pago)', ''], UNKNOWN: ['saldo sem leitura', 'b-warn'], UNKNOWN_RUNWAY: ['sem gasto recente para estimar', ''] };
  // ADS da ficha: semana fechada contra a anterior, série dos 14 dias, contas e saldo, campanhas e criativos com a régua da casa.
  const OBJECTIVE = { OUTCOME_ENGAGEMENT: 'Engajamento / mensagem', MESSAGES: 'Mensagens', OUTCOME_SALES: 'Vendas', OUTCOME_TRAFFIC: 'Tráfego', OUTCOME_AWARENESS: 'Reconhecimento',
    OUTCOME_LEADS: 'Cadastros', LINK_CLICKS: 'Cliques no link', POST_ENGAGEMENT: 'Engajamento no post' };
  const AD_STATUS = { ACTIVE: ['ativo', 'tag-green'], PAUSED: ['pausado', 'tag-gray'], NOT_ACTIVE: ['fora do ar', 'tag-gray'], CAMPAIGN_PAUSED: ['campanha pausada', 'tag-gray'],
    ADSET_PAUSED: ['conjunto pausado', 'tag-gray'], WITH_ISSUES: ['com problema', 'tag-red'], IN_PROCESS: ['em análise', 'tag-yellow'], DISAPPROVED: ['reprovado', 'tag-red'] };
  const cpcTag = (v, isMsg) => v === null || v === undefined || !isMsg ? h('span', { class: 'muted' }, isMsg ? 'sem conversa' : 'não é de conversa')
    : h('span', { class: 'badge ' + (v <= 3 ? 'tag-green' : v > 7 ? 'tag-red' : 'tag-gray') }, brl2(v) + (v <= 3 ? ' · campeão' : v > 7 ? ' · acima da régua' : ''));
  // Período da aba ADS (DT-180): atalhos e datas livres, lembrado na sessão. Hoje nunca entra.
  let adsPeriod = (() => { try { return JSON.parse(sessionStorage.getItem('cc_ads_period') || 'null') || { preset: '7' }; } catch (e) { return { preset: '7' }; } })();
  function adsRange(p) {
    const y = addDays(todaySP(), -1);
    if (p.preset === 'custom' && p.from && p.to) return { from: p.from, to: p.to };
    if (p.preset === 'mes') { const f = todaySP().slice(0, 8) + '01'; return f <= y ? { from: f, to: y } : adsRange({ preset: 'mesant' }); }
    if (p.preset === 'mesant') { const last = addDays(todaySP().slice(0, 8) + '01', -1); return { from: last.slice(0, 8) + '01', to: last }; }
    const n = Number(p.preset) || 7;
    return { from: addDays(y, 1 - n), to: y };
  }
  function adsPeriodBar(client) {
    const set = (p) => { adsPeriod = p; try { sessionStorage.setItem('cc_ads_period', JSON.stringify(p)); } catch (e) { /* sem armazenamento */ } mediaCard(client); };
    const cur = adsRange(adsPeriod);
    const from = h('input', { type: 'date', value: cur.from, max: addDays(todaySP(), -1), 'aria-label': 'De' });
    const to = h('input', { type: 'date', value: cur.to, max: addDays(todaySP(), -1), 'aria-label': 'Até' });
    const apply = () => { if (!from.value || !to.value || from.value > to.value) { toast('Escolha um início antes do fim.', true); return; } set({ preset: 'custom', from: from.value, to: to.value }); };
    return h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin:4px 0 12px' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Período' }, [['7', '7 dias'], ['14', '14 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['mesant', 'Mês passado']].map(([k, t]) =>
        h('button', { type: 'button', class: adsPeriod.preset === k ? 'on' : '', onclick: () => set({ preset: k }) }, t))),
      h('span', { class: 'row small', style: 'gap:6px' }, from, h('span', { class: 'muted' }, 'até'), to,
        h('button', { type: 'button', class: adsPeriod.preset === 'custom' ? '' : 'ghost', onclick: apply }, 'Aplicar')));
  }
  async function mediaCard(client) {
    let r;
    const range = adsRange(adsPeriod);
    try { r = (await api('GET', 'media/clients/' + client.id + '/ads?from=' + range.from + '&to=' + range.to)).data; } catch (e) { slot('media', card('ADS', empty(e.message === 'Ação não permitida para o seu perfil.' ? 'Sem acesso aos anúncios desta cliente.' : e.message))); return; }
    if (!r.accounts.length) { slot('media', card('ADS', empty('Nenhuma conta de anúncio ligada a esta cliente. Se ela tem conta, ligue em Vínculos pendentes.'))); return; }
    const w = r.week; const p = r.previous_week;
    const kpi = (lbl, val, cur, prev, lower) => h('div', { class: 'kpi' }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val', style: 'font-size:22px' }, val), h('div', { class: 'det' }, delta(cur, prev, lower) || ''));
    const kpis = h('div', { class: 'kpis' },
      kpi('Investimento', brl0(w.spend), w.spend, p.spend, null),
      kpi('Conversas', nf(w.conversations), w.conversations, p.conversations, false),
      kpi('Custo por conversa', w.cost_per_conversation === null ? 'sem dado' : brl2(w.cost_per_conversation), w.cost_per_conversation, p.cost_per_conversation, true));
    const kpisMore = h('div', { class: 'kpis' },
      kpi('CTR', w.ctr === null ? 'sem dado' : nf(w.ctr, 2) + '%', w.ctr, p.ctr, false),
      kpi('CPM', w.cpm === null ? 'sem dado' : brl2(w.cpm), w.cpm, p.cpm, true),
      kpi('Custo por clique', w.cpc === null ? 'sem dado' : brl2(w.cpc), w.cpc, p.cpc, true));
    const accounts = h('ul', { class: 'mini' }, r.accounts.map((a) => {
      const f = a.funding || {};
      const fb = FUND[f.status] || [f.status ? String(f.status).toLowerCase() : 'saldo sem leitura', ''];
      return h('li', {}, h('span', {}, h('b', {}, a.name), h('div', { class: 'small muted' }, a.external_id)),
        h('span', { class: 'v' }, h('span', { class: 'badge ' + fb[1].replace('b-bad', 'tag-red').replace('b-ok', 'tag-green').replace('b-warn', 'tag-yellow') }, fb[0]),
          f.prepaid_available ? h('div', { class: 'small muted', style: 'text-align:right' }, 'disponível ' + brl(f.prepaid_available) + (f.runway_days !== null && f.runway_days !== undefined ? ' · dura ≈ ' + Math.floor(f.runway_days) + ' dia(s)' : '')) : null));
    }));
    const th = (t, num) => h('th', { class: num ? 'num' : '' }, t);
    const deltaSmall = (cur, prev) => prev ? h('div', { class: 'small muted' }, (cur >= prev ? '▲ ' : '▼ ') + nf(Math.abs((cur - prev) / prev * 100)) + '%') : null;
    const campaigns = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, th('Campanha'), th('Investimento', 1), th('Conversas', 1), th('Custo por conversa'), th('CTR', 1), th('CPM', 1), th('Anúncios ativos', 1), th('Última entrega'))),
      h('tbody', {}, r.campaigns.map((c) => { const st = AD_STATUS[c.status] || [String(c.status || '').toLowerCase(), '']; return h('tr', {},
        h('td', {}, h('b', {}, c.name), h('div', { class: 'small muted' }, (OBJECTIVE[c.objective] || c.objective || 'objetivo não lido') + ' · ', h('span', { class: 'badge ' + st[1] }, st[0]))),
        h('td', { class: 'num' }, brl0(c.spend), deltaSmall(c.spend, c.spend_prev)), h('td', { class: 'num' }, nf(c.conversations)), h('td', {}, cpcTag(c.cost_per_conversation, c.message_objective)),
        h('td', { class: 'num' }, c.ctr === null ? 'sem' : nf(c.ctr, 2) + '%'), h('td', { class: 'num' }, c.cpm === null ? 'sem' : brl2(c.cpm)),
        h('td', { class: 'num' }, nf(c.active_ads)), h('td', { class: 'small muted' }, c.last_delivery ? fmtDay(c.last_delivery) : 'sem entrega')); }))));
    const creativeRow = (a) => { const st = AD_STATUS[a.status] || [String(a.status || '').toLowerCase(), '']; return h('tr', {},
      h('td', {}, h('b', {}, a.name), h('div', { class: 'small muted' }, [a.campaign, a.adset].filter(Boolean).join(' · ')), h('span', { class: 'badge ' + st[1] }, st[0])),
      h('td', { class: 'num' }, brl0(a.spend), deltaSmall(a.spend, a.spend_prev)), h('td', { class: 'num' }, nf(a.conversations)), h('td', {}, cpcTag(a.cost_per_conversation, a.message_objective)),
      h('td', { class: 'num' }, a.ctr === null ? 'sem' : nf(a.ctr, 2) + '%'),
      h('td', { class: 'num' }, a.frequency_7d === null ? 'sem' : h('span', { class: a.frequency_7d > 3 ? 'badge tag-orange' : '' }, nf(a.frequency_7d, 1) + (a.frequency_7d > 3 ? ' · cansando' : ''))),
      h('td', { class: 'num' }, a.reach_7d === null ? 'sem' : nf(a.reach_7d)), h('td', { class: 'num' }, nf(a.days_delivered))); };
    const cBody = h('tbody');
    const cMore = h('button', { type: 'button', class: 'linkbtn more' });
    let cOpen = false;
    const cDraw = () => { cBody.replaceChildren(...(cOpen ? r.creatives : r.creatives.slice(0, 12)).map(creativeRow)); cMore.textContent = cOpen ? 'Mostrar menos' : 'Ver todos (' + r.creatives.length + ')'; };
    cMore.addEventListener('click', () => { cOpen = !cOpen; cDraw(); });
    cDraw();
    const creatives = r.creatives.length ? h('div', {}, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, th('Criativo'), th('Investimento', 1), th('Conversas', 1), th('Custo por conversa'), th('CTR', 1), th('Frequência', 1), th('Alcance', 1), th('Dias no ar', 1))), cBody)),
      r.creatives.length > 12 ? cMore : null)
      : empty(r.creatives_read ? 'Nenhum criativo com entrega no período nem no anterior.' : 'Os números por criativo entram na próxima leitura da Meta.');
    const W = r.window;
    const period = fmtDay(W.week_from) + ' a ' + fmtDay(W.to);
    const win = 'De ' + period + ' (' + W.days + (W.days === 1 ? ' dia' : ' dias') + ') contra ' + fmtDay(W.from) + ' a ' + fmtDay(W.previous_to) + '. O dia de hoje não entra: a Meta ainda está fechando.';
    slot('media', h('div', {},
      h('section', { class: 'card' }, h('h2', {}, 'ADS'), adsPeriodBar(client), h('p', { class: 'hint' }, period), kpis, h('details', { class: 'more' }, h('summary', { class: 'small' }, 'Ver CTR, CPM e custo por clique'), kpisMore),
        h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--series-1)' }), 'Investimento por dia, o período anterior e o escolhido (' + r.daily.length + ' dias)')), chartDaily(r.daily, W.days),
        h('p', { class: 'hint', style: 'margin:12px 0 4px' }, 'Conversas por dia'),
        chartColumns(r.daily.map((x, i) => ({ v: x.conversations, dim: i < W.days, title: dLabel(x.day) + (i < W.days ? ' (anterior)' : ''), rows: [['Conversas', nf(x.conversations)], ['Investimento', brl0(x.spend)], ['Cliques', nf(x.clicks)]] })), { label: 'Conversas por dia', h: 100 })),
      foldCard('Criativos · ' + r.creatives.length,
        h('p', { class: 'hint' }, period + ', do que mais gastou para o que menos gastou. Abaixo de R$ 3 por conversa é campeão; acima de R$ 7 passou da régua; frequência acima de 3 é público cansando.' + (W.days !== 7 || !W.default ? ' Frequência e alcance são sempre dos últimos 7 dias (é como a Meta entrega).' : '')), creatives),
      foldCard('Campanhas · ' + r.campaigns.length, h('p', { class: 'hint' }, period + '. Custo por conversa só nas campanhas de conversa.'), campaigns),
      foldCard('Contas e saldo', accounts)));
  }

  function meetingsCard(list, src, client) {
    if (!list.length) { slot('meetings', card('Reuniões gravadas', empty('Nenhuma reunião gravada ligada a esta cliente.'))); return; }
    const f = FRESH[(src || {}).freshness] || ['', ''];
    slot('meetings', card('Reuniões gravadas',
      h('div', { class: 'row small' }, modeBadge((src || {}).mode, 'MeetGeek'), f[0] ? badge(f[0], f[1]) : null),
      h('p', { class: 'small muted' }, 'Resumo e próximos passos do gravador. A transcrição não entra. Os próximos passos são o que foi dito na call: um clique em "virar tarefa" cria a tarefa na ficha.'),
      ...list.map((m, i) => h('details', { open: i === 0 || null, style: 'margin-top:10px' },
        h('summary', {}, h('b', {}, fmt(m.started_at)), ' · ', m.title || 'Reunião sem título'),
        client && can('reconciliation.read') ? h('div', { style: 'margin-top:4px' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => reclassifyMeeting(m, client.trade_name, () => renderClient(client.id)) }, 'Não é desta cliente?')) : null,
        m.participants.length ? h('p', { class: 'small muted' }, 'Participantes: ' + m.participants.join(', ')) : null,
        h('p', { class: 'small' }, m.summary || 'Sem resumo do gravador.'),
        m.next_steps.length ? h('div', {}, h('p', { class: 'small', style: 'margin:6px 0 2px' }, h('b', {}, 'Próximos passos ditos na call')),
          h('ul', { class: 'small' }, ...m.next_steps.map((st) => h('li', {}, st, client && can('work.write') ? h('button', { type: 'button', class: 'linkbtn', style: 'margin-left:6px', onclick: async (ev) => {
            const li = ev.currentTarget.parentElement;
            li.append(await taskComposer(client, () => { tasksCard(client); timelineCard(client); }, { title: st.slice(0, 200), origin: 'MEETING' }));
            ev.currentTarget.remove();
          } }, 'virar tarefa') : null)))) : null))));
  }

  async function issuesCard(client) {
    let r;
    try { r = await api('GET', 'issues?client_id=' + client.id + '&per_page=50'); } catch (e) { slot('issues', card('Alertas e recomendações', empty(e.message))); return; }
    const detail = h('div');
    const list = r.data.length ? r.data.map((i) => {
      const el = h('div', { class: 'issue', tabindex: 0, onclick: () => { document.querySelectorAll('.issue').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); recommendation(i.id, detail, client); } },
        h('div', { class: 'row' }, h('span', { class: 'badge ' + (SEV_TAG[i.severity] || '') }, SEV[i.severity] || i.severity), h('span', {}, i.sentence), h('span', { class: 'spacer' }),
          h('span', { class: 'badge ' + ((ISTATE[i.state] || [])[1] || '') }, (ISTATE[i.state] || [i.state.toLowerCase()])[0])),
        h('div', { class: 'small muted' }, 'Visto pela primeira vez em ' + fmt(i.first_seen_at) + ' · último sinal ' + fmt(i.last_seen_at)));
      return el;
    }) : [empty('Nenhum alerta aberto para esta cliente no seu acesso.')];
    slot('issues', card('Alertas e recomendações', ...list, detail));
  }

  async function recommendation(episodeId, box, client) {
    box.replaceChildren(empty('Carregando a recomendação...'));
    let v;
    try { v = (await api('GET', 'issues/' + episodeId + '/recommendations')).data; } catch (e) { box.replaceChildren(empty(e.message)); return; }
    const rec = v.recommendation;
    if (!rec) { box.replaceChildren(empty('Sem recomendação para este alerta.')); return; }
    const approval = rec.rule.approval.status === 'APPROVED' ? badge('regra aprovada pela direção', 'b-ok') : badge('regra em proposta (não aprovada)', 'b-warn');
    const parts = [
      h('div', { class: 'row' }, h('b', {}, 'Recomendação'), badge(rec.status), approval, h('span', { class: 'small muted' }, rec.rule.code + ' · ' + rec.rule.version)),
      h('p', {}, rec.problem_statement),
      h('div', { class: 'box' }, h('b', { class: 'small' }, 'O que está comprovado'),
        h('ul', { class: 'small' }, rec.diagnosis.map((d) => h('li', {}, d.statement, h('span', { class: 'muted' }, ' (fonte ' + (SRC[d.source] || d.source) + ', ' + fmt(d.observed_at) + ')'))))),
      rec.hypotheses.length ? h('div', { class: 'box' }, h('b', { class: 'small' }, 'Hipóteses (não são fatos)'),
        h('ul', { class: 'small' }, rec.hypotheses.map((x) => h('li', {}, x.statement, h('span', { class: 'muted' }, ' Confirmar: ' + x.confirm_with))))) : null,
      rec.missing_data.length ? h('div', { class: 'box' }, h('b', { class: 'small' }, 'O que falta saber'),
        h('ul', { class: 'small' }, rec.missing_data.map((m) => h('li', {}, m.item, h('span', { class: 'muted' }, ' ' + m.why))))) : null,
      h('div', { class: 'box' }, h('b', { class: 'small' }, 'Ações propostas'),
        h('ul', { class: 'small' }, rec.actions.map((a) => h('li', {}, h('b', {}, a.title), ' · ' + (ROLE[a.responsible_role] || a.responsible_role) + ' · ' + a.due_in_days + ' dia(s) · prova: ' + a.expected_proof)))),
    ];
    if (rec.allowed_actions.includes('ACCEPT')) {
      parts.push(h('div', { class: 'row' },
        h('button', { onclick: async () => {
          try {
            await api('POST', 'recommendations/' + rec.id + '/accept', { version: rec.version, actions: rec.actions.map((a) => ({ code: a.code })) }, { 'Idempotency-Key': 'ui-aceite-' + rec.id + '-' + rec.version });
            toast('Recomendação aceita: as ações viraram pendências com prova.'); recommendation(episodeId, box, client); timelineCard(client);
          } catch (e) { toast(e.message, true); }
        } }, 'Aceitar e criar o plano'),
        h('button', { class: 'ghost', onclick: async () => {
          const reason = prompt('Por que esta recomendação não se aplica? (10 caracteres ou mais)');
          if (!reason) return;
          try { await api('POST', 'recommendations/' + rec.id + '/reject', { version: rec.version, reason }); toast('Recomendação recusada com motivo.'); recommendation(episodeId, box, client); timelineCard(client); } catch (e) { toast(e.message, true); }
        } }, 'Recusar com motivo')));
    }
    if (v.plan) {
      const p = v.plan;
      parts.push(h('div', { class: 'box' }, h('div', { class: 'row' }, h('b', {}, 'Plano de ação'), badge(p.status), h('span', { class: 'small muted' }, p.progress.closed + ' de ' + p.progress.total + ' encerrada(s) · dono ' + p.owner.display_name)),
        h('ul', { class: 'small' }, p.work_items.map((w) => h('li', {}, w.title, ' · ', h('span', { class: 'muted' }, w.owner.display_name + ' · ' + w.state + ' · prazo ' + fmt(w.due_at))))),
        p.outcome ? h('p', { class: 'small' }, 'Resultado: ' + p.outcome.value + ' (' + p.outcome.reviewed_by.display_name + ')') : null));
    }
    box.replaceChildren(h('div', { style: 'margin-top:12px' }, ...parts));
  }

  async function notesCard(client) {
    let r;
    try { r = await api('GET', 'clients/' + client.id + '/notes?per_page=50'); } catch (e) { slot('notes', card('Notas da equipe', empty(e.message))); return; }
    const VIS = { TEAM: 'Equipe da cliente', CS: 'Equipe e CS', DIRECTION: 'Só direção' };
    const body = h('textarea', { 'aria-label': 'Nota', maxlength: 5000 });
    const vis = h('select', { 'aria-label': 'Quem pode ler' }, Object.entries(VIS).map(([k, t]) => h('option', { value: k }, t)));
    const form = can('notes.write') ? h('form', { onsubmit: async (ev) => {
      ev.preventDefault();
      try { await api('POST', 'clients/' + client.id + '/notes', { body: body.value, visibility: vis.value }); toast('Nota registrada.'); notesCard(client); timelineCard(client); } catch (e) { toast(e.message, true); }
    } }, field('Nova nota', body), h('div', { class: 'row', style: 'margin-top:8px' }, vis, h('button', { type: 'submit' }, 'Registrar nota'))) : null;
    slot('notes', card('Notas da equipe',
      h('ul', { class: 'list' }, r.data.length ? r.data.map((n) => h('li', {}, h('div', { class: 'row small' }, h('b', {}, n.author.display_name),
        h('span', { class: 'muted' }, n.author_context.roles.map((x) => ROLE[x] || x).join(', ') + ' · ' + fmt(n.created_at)), badge(VIS[n.visibility]), n.is_current ? null : badge('corrigida', 'b-warn')),
        h('div', {}, n.body))) : [empty('Nenhuma nota ainda.')]), form));
  }

  async function requestsCard(client) {
    let r;
    try { r = await api('GET', 'work-items?client_id=' + client.id + '&kind=REQUEST&include_closed=1&per_page=50'); } catch (e) { slot('requests', card('Cobranças e pedidos', empty(e.message))); return; }
    const ACC = { PENDING: ['aguardando aceite', 'b-warn'], ACCEPTED: ['aceita', 'b-ok'], DECLINED: ['recusada', 'b-bad'], NOT_APPLICABLE: ['', ''] };
    const TARGET = { CLIENT: 'cliente', THIRD_PARTY: 'terceiro', HEAD: 'head', MANAGER: 'gestor', CS: 'CS', DIRECTION: 'direção' };
    const CHANNEL = { WHATSAPP: 'WhatsApp', MEETING: 'reunião', PHONE: 'ligação', EMAIL: 'e-mail', INTERNAL: 'conversa interna', OTHER: 'outro' };
    const items = r.data.map((w) => {
      const acc = ACC[w.request.acceptance];
      const mine = w.owner.id === me.id && w.request.acceptance === 'PENDING';
      return h('li', {}, h('div', { class: 'row' }, h('b', {}, w.title), acc[0] ? badge(acc[0], acc[1]) : null, badge(w.state)),
        h('div', { class: 'small muted' }, (w.request.target === 'CLIENT' || w.request.target === 'THIRD_PARTY' ? (w.request.target === 'CLIENT' ? 'Cobrando da cliente' : 'Cobrando de terceiro') + ' · quem cobra: ' + w.owner.display_name : 'Pedido por ' + w.created_by.display_name + ' para ' + w.owner.display_name + ' (' + TARGET[w.request.target] + ')') + ' · por ' + (CHANNEL[w.request.channel] || w.request.channel) + ' · prazo ' + fmt(w.due_at)),
        mine ? h('div', { class: 'row', style: 'margin-top:6px' },
          h('button', { onclick: async () => { try { await api('POST', 'work-items/' + w.id + '/transition', { to_state: 'IN_PROGRESS', version: w.version }); toast('Pedido aceito.'); requestsCard(client); refreshInbox(); } catch (e) { toast(e.message, true); } } }, 'Aceitar'),
          h('button', { class: 'ghost', onclick: async () => { const reason = prompt('Motivo da recusa (10 caracteres ou mais)'); if (!reason) return; try { await api('POST', 'work-items/' + w.id + '/transition', { to_state: 'CANCELLED', reason, version: w.version }); toast('Pedido recusado com motivo.'); requestsCard(client); refreshInbox(); } catch (e) { toast(e.message, true); } } }, 'Recusar')) : null);
    });
    let form = null;
    if (can('work.write')) {
      let lead = null;
      if (client.squad) { try { lead = (await api('GET', 'squads/' + client.squad.id)).data.lead; } catch (e) { lead = null; } }
      const target = h('select', { 'aria-label': 'Para quem' }, h('option', { value: 'CLIENT' }, 'Cobrar da cliente'), h('option', { value: 'THIRD_PARTY' }, 'Cobrar de terceiro (fotógrafo, fornecedor)'),
        lead && lead.id !== me.id ? h('option', { value: 'HEAD' }, 'Pedir para o head: ' + lead.display_name) : null);
      const channel = h('select', { 'aria-label': 'Por onde' }, Object.entries(CHANNEL).map(([c, t]) => h('option', { value: c }, 'Por ' + t)));
      const title = h('input', { 'aria-label': 'Pedido', maxlength: 200, placeholder: 'Ex.: vídeos da coleção nova, aprovação do orçamento' });
      const due = h('input', { type: 'date', 'aria-label': 'Prazo', title: 'Prazo', value: new Date(Date.now() + 21 * 3600000).toISOString().slice(0, 10) });
      form = h('form', { onsubmit: async (ev) => {
        ev.preventDefault();
        const body = { target: target.value, channel: channel.value, title: title.value, due_at: due.value ? due.value + 'T18:00:00-03:00' : undefined };
        if (target.value === 'HEAD') body.owner_user_id = lead.id;
        try { await api('POST', 'clients/' + client.id + '/requests', body); toast('Registrado. O sistema só acompanha o prazo, nada é enviado.'); requestsCard(client); timelineCard(client); } catch (e) { toast(e.message, true); }
      } }, field('O que está esperando', title), h('div', { class: 'row', style: 'margin-top:8px' }, target, channel, h('label', { class: 'small muted' }, 'Prazo ', due), h('button', { type: 'submit' }, 'Registrar')));
    }
    slot('requests', card('Cobranças e pedidos', h('p', { class: 'hint' }, 'O que você está esperando de alguém: material ou aprovação da cliente, entrega de terceiro, pedido para o head. Vence e aparece no Daily.'),
      h('ul', { class: 'list' }, items.length ? items : [empty('Nada sendo cobrado desta cliente.')]), form));
  }

  const KIND = {
    LIFECYCLE_CHANGED: 'Situação mudou', ASSIGNMENT_STARTED: 'Atribuição', ONBOARDING_STEP_DONE: 'Etapa de onboarding concluída', ONBOARDING_STEP_WAIVED: 'Etapa dispensada',
    STRATEGY_ASSESSED: 'Avaliação estratégica', IDENTITY_LINKED: 'Vínculo com fonte', ISSUE_EVENT: 'Alerta', WORK_ITEM_EVENT: 'Pendência', RECOMMENDATION_GENERATED: 'Recomendação gerada',
    RECOMMENDATION_ACCEPTED: 'Recomendação aceita', RECOMMENDATION_REJECTED: 'Recomendação recusada', RECOMMENDATION_SUPERSEDED: 'Recomendação substituída', ACTION_PLAN_CREATED: 'Plano criado',
    ACTION_PLAN_OUTCOME_RECORDED: 'Resultado do plano', NOTE_ADDED: 'Nota', NOTE_CORRECTED: 'Nota corrigida', ATTACHMENT_ADDED: 'Anexo', ATTACHMENT_REVISED: 'Anexo revisado',
    ATTACHMENT_REMOVED: 'Anexo removido', SOURCE_RECORD_CHANGED: 'Mudança na fonte',
  };
  function describe(e) {
    const d = e.details || {};
    switch (e.kind) {
      case 'LIFECYCLE_CHANGED': return (STATE[d.to_state] || d.to_state) + (d.source === 'SOURCE_SYNC' ? ' (registro de fonte aprovado)' : '') + (d.reason ? '. ' + d.reason : '');
      case 'ASSIGNMENT_STARTED': return [d.squad_code, d.manager_name].filter(Boolean).join(' · ') || 'sem squad';
      case 'IDENTITY_LINKED': return 'Ligada ao registro ' + d.provider;
      case 'ISSUE_EVENT': return (d.issue_kind || '') + ' ' + (d.to_state || d.event_type || '');
      case 'WORK_ITEM_EVENT': return (d.title || '') + ' · ' + (d.to_state || d.event_type || '');
      case 'NOTE_ADDED': case 'NOTE_CORRECTED': return d.body || '';
      case 'SOURCE_RECORD_CHANGED': return d.source + ' · ' + d.change + (d.fields && d.fields.length ? ' (' + d.fields.join(', ') + ')' : '');
      case 'ATTACHMENT_ADDED': case 'ATTACHMENT_REVISED': case 'ATTACHMENT_REMOVED': return d.filename || '';
      default: return d.summary || '';
    }
  }
  async function timelineCard(client) {
    let r;
    try { r = await api('GET', 'clients/' + client.id + '/timeline?per_page=60'); } catch (e) { slot('timeline', card('Histórico', empty(e.message))); return; }
    slot('timeline', card('Histórico', h('p', { class: 'small muted' }, 'Mais recente primeiro. Cada evento mostra quem fez e com qual papel naquele momento; fonte e regra aparecem separadas de pessoas.'),
      h('ul', { class: 'list tl' }, r.data.map((e) => h('li', {}, h('time', {}, fmt(e.occurred_at)),
        h('div', {}, h('b', { class: 'small' }, KIND[e.kind] || e.kind), h('div', { class: 'small' }, describe(e)),
          h('div', { class: 'who' }, e.actor ? e.actor.display_name + (e.actor_context.roles.length ? ' (' + e.actor_context.roles.map((x) => ROLE[x] || x).join(', ') + ')' : ' (sem papel vigente no momento)') : e.actor_context.kind === 'SOURCE_OR_RULE' ? 'Fonte ou regra automática' : 'Sistema')))))));
  }

  // ---------- vínculos pendentes ----------
  // Só o que a triagem automática não resolveu, do jeito que se responde: cadastro incompleto, quem é cada
  // pessoa de fora nas reuniões (uma resposta liga todas as reuniões dela) e grupos e contas que sobraram.
  let vqSquad = (() => { try { return sessionStorage.getItem('cc_vq_squad') || ''; } catch (e) { return ''; } })();
  const PROVIDER = { WHATSAPP_GROUP: ['Grupo de WhatsApp', 'tag-green'], META_ADS: ['Conta de anúncio', 'tag-blue'], NOTION: ['Notion', 'tag-gray'], MEETING_RECORDER: ['Reunião', 'tag-purple'] };
  function squadSeg(squads, current, onPick, extra) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Squad' }, [{ id: '', name: 'Todas' }].concat(squads, extra || []).map((q) =>
      h('button', { type: 'button', class: String(q.id) === current ? 'on' : '', onclick: () => onPick(String(q.id)) }, q.name)));
  }
  // Campo de busca da loja: digita parte do nome e escolhe na lista (as da carteira de quem estava na reunião vêm primeiro).
  let pickerSeq = 0;
  function clientPicker(clients, preferIds, preferSquad) {
    const pref = new Set(preferIds || []);
    const rank = (c) => pref.has(c.manager_id) ? 0 : preferSquad && c.squad_id === preferSquad ? 1 : 2;
    const ordered = clients.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const id = 'lojas-' + (++pickerSeq);
    const input = h('input', { type: 'search', class: 'pick', list: id, placeholder: 'Digite a loja…', 'aria-label': 'Loja', autocomplete: 'off' });
    const list = h('datalist', { id }, ordered.map((c) => h('option', { value: c.name })));
    const wrap = h('span', { class: 'pickwrap' }, input, list);
    const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    // Nome exato escolhido na lista; se o digitado bate com uma loja só, vale também.
    wrap.pickedId = () => {
      const q = norm(input.value);
      if (!q) return null;
      const exact = ordered.find((c) => norm(c.name) === q);
      if (exact) return exact.id;
      const partial = ordered.filter((c) => norm(c.name).includes(q));
      return partial.length === 1 ? partial[0].id : null;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const b = wrap.parentElement && wrap.parentElement.querySelector('button'); if (b) b.click(); } });
    return wrap;
  }
  // Pop-up de confirmação (DT-178): toda ação que muda de onde a informação mora pergunta antes.
  function modal(title, body, actions) {
    const dlg = h('dialog', { class: 'modal' });
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.append(h('h2', {}, title), ...(Array.isArray(body) ? body : [body]),
      h('div', { class: 'row', style: 'justify-content:flex-end;gap:8px;margin-top:16px' },
        h('button', { type: 'button', class: 'ghost', onclick: close }, 'Cancelar'),
        ...actions.map(([label, fn, cls]) => h('button', { type: 'button', class: cls || '', onclick: async (ev) => { ev.currentTarget.disabled = true; if (await fn() !== false) close(); else ev.currentTarget.disabled = false; } }, label))));
    dlg.addEventListener('cancel', close);
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  }
  const confirmBox = (title, text, label) => new Promise((resolve) => {
    const dlg = modal(title, h('p', {}, text), [[label || 'Confirmar', () => { resolve(true); }]]);
    dlg.addEventListener('close', () => resolve(false));
  });
  let linkClients = null;
  async function reclassifyMeeting(m, from, done) {
    if (!linkClients) { try { linkClients = (await api('GET', 'reconciliation/queue')).data.clients; } catch (e) { toast(e.message, true); return; } }
    const sel = clientPicker(linkClients, [], null);
    const why = h('input', { maxlength: 300, placeholder: 'Motivo (opcional)' });
    modal('De quem é esta reunião?', [
      h('p', { class: 'small muted' }, (m.title || 'Reunião') + ' · ' + fmt(m.started_at) + (from ? ' · hoje está em ' + from : ' · hoje está sem cliente')),
      field('Cliente certa', sel), field('Motivo', why)],
    [['Reunião interna', async () => {
      if (!(await confirmBox('Tirar da cliente?', 'A reunião sai ' + (from ? 'da ficha de ' + from : 'da fila') + ' e fica marcada como interna. Dá para desfazer depois.', 'Marcar como interna'))) return false;
      try { await api('POST', 'recorded-meetings/' + m.id + '/classify', { client_id: null, reason: why.value || 'Reunião interna, reclassificada na tela.' }); toast('Marcada como interna.'); done(); } catch (e) { toast(e.message, true); return false; }
    }, 'ghost'], ['Mover para esta cliente', async () => {
      const id = sel.pickedId();
      if (!id) { toast('Escolha a loja na lista.', true); return false; }
      const name = linkClients.find((c) => c.id === id).name;
      if (!(await confirmBox('Confirmar', 'Mover a reunião ' + (from ? 'de ' + from + ' ' : '') + 'para ' + name + '? Ela passa a aparecer na ficha de ' + name + '.', 'Mover'))) return false;
      try { await api('POST', 'recorded-meetings/' + m.id + '/classify', { client_id: id, reason: why.value || 'Reclassificada na tela de reuniões.' }); toast('Reunião movida para ' + name + '.'); done(); } catch (e) { toast(e.message, true); return false; }
    }]]);
  }

  async function renderReconciliation() {
    const d = (await api('GET', 'reconciliation/queue' + (vqSquad ? '?squad=' + vqSquad : ''))).data;
    const c = d.counts;
    const pick = (v) => { vqSquad = v; try { sessionStorage.setItem('cc_vq_squad', v); } catch (e) { /* sem armazenamento */ } renderReconciliation(); };
    const done = (msg) => { toast(msg); renderReconciliation(); refreshQueueCount(); };
    const answerPerson = async (p, clientId) => {
      const name = clientId ? (d.clients.find((x) => x.id === clientId) || {}).name : null;
      const ok = await confirmBox(clientId ? 'Ligar ' + p.name + ' a ' + name + '?' : p.name + ' não é de cliente?',
        clientId ? 'As ' + p.meetings + ' reunião(ões) com ' + p.name + ' vão para a ficha de ' + name + ', e as próximas também. Se errar, dá para mover cada reunião depois na aba Reuniões.'
          : 'As ' + p.meetings + ' reunião(ões) com ' + p.name + ' ficam como internas.', clientId ? 'Ligar' : 'Confirmar');
      if (!ok) return;
      try { const r = (await api('POST', 'reconciliation/queue/people', { name: p.name, client_id: clientId })).data; done(r.resolved + ' reunião(ões) de ' + p.name + (clientId ? ' ligada(s).' : ' fechada(s) como não-cliente.')); } catch (e) { toast(e.message, true); }
    };
    const answerRecord = async (r, outcome, clientId) => {
      const name = clientId ? (d.clients.find((x) => x.id === clientId) || {}).name : null;
      if (!(await confirmBox('Confirmar', outcome === 'LINK' ? 'Ligar ' + r.label + ' a ' + name + '?' : r.label + (outcome === 'EX_CLIENT' ? ' é de ex-cliente?' : ' não é de cliente?'), outcome === 'LINK' ? 'Ligar' : 'Confirmar'))) return;
      try { await api('POST', 'reconciliation/queue/records/' + r.case_id, { outcome, client_id: clientId || null }); done(r.label + (outcome === 'LINK' ? ' ligado.' : ' fechado.')); } catch (e) { toast(e.message, true); }
    };

    // Cadastro do Notion que não fecha (DT-179): resolve aqui, sem precisar corrigir a página.
    const answerNotion = async (n, body, text) => {
      if (!(await confirmBox('Confirmar', text, 'Confirmar'))) return;
      try { await api('POST', 'reconciliation/queue/notion/' + n.case_id, body); done(n.name + ' resolvida.'); } catch (e) { toast(e.message, true); }
    };
    const churnNotion = (n) => {
      const date = h('input', { type: 'date', max: todaySP(), value: todaySP() });
      const why = h('input', { maxlength: 300, placeholder: 'Ex.: não renovou no fim do ciclo' });
      modal('Registrar a saída de ' + n.name, [h('p', { class: 'small muted' }, 'A ficha nasce já encerrada nesta data e entra no histórico de saídas da squad.'),
        field('Data de saída', date), field('Motivo (opcional)', why)],
      [['Registrar saída', async () => {
        if (!date.value) { toast('Informe a data de saída.', true); return false; }
        try { await api('POST', 'reconciliation/queue/notion/' + n.case_id, { outcome: 'CHURNED', exit_date: date.value, reason: why.value || null }); done(n.name + ' registrada como encerrada em ' + fmtDay(date.value) + '.'); } catch (e) { toast(e.message, true); return false; }
      }]]);
    };
    const noticeNotion = (n) => {
      const mgrs = (d.managers || []).filter((m) => n.squad_id === null || m.squad_id === n.squad_id);
      const who = h('select', {}, h('option', { value: '' }, 'Escolha…'), mgrs.map((m) => h('option', { value: m.id }, m.name)));
      const until = h('input', { type: 'date', min: todaySP() });
      modal(n.name + ' em aviso', [h('p', { class: 'small muted' }, 'Churn operacional: a operação para, mas ela segue ativa no comercial até completar o período. A ficha nasce em aviso, com o gestor e a data de saída prevista.'),
        field('Gestor da conta', who), field('Ativa no comercial até', until)],
      [['Registrar aviso', async () => {
        if (!who.value || !until.value) { toast('Escolha o gestor e a data.', true); return false; }
        try { await api('POST', 'reconciliation/queue/notion/' + n.case_id, { outcome: 'NOTICE_GIVEN', manager_user_id: Number(who.value), exit_date: until.value }); done(n.name + ' em aviso até ' + fmtDay(until.value) + '.'); } catch (e) { toast(e.message, true); return false; }
      }]]);
    };
    const notion = d.notion.length ? h('section', { class: 'card' }, h('h2', {}, 'Cadastro incompleto', h('span', { class: 'badge' }, String(d.notion.length))),
      h('p', { class: 'hint' }, 'Cadastro que veio do Notion sem fechar (sem situação, ou ativa numa coluna de saída). Resolva aqui mesmo (em aviso, já saiu, é uma ficha que já existe, ou não é cliente): o que você decidir vale, não precisa mexer no Notion. O grupo e a conta da loja ligam juntos.'),
      h('div', { class: 'qlist' }, d.notion.map((n) => {
        const sel = clientPicker(d.clients, [], n.squad_id);
        const can = n.can_decide || n.squad_id === null;
        return h('div', { class: 'qrow' },
          h('div', { class: 'qmain' }, h('b', {}, n.name), h('div', { class: 'small muted' }, [n.manager || 'sem gestor', n.journey].filter(Boolean).join(' · ')),
            n.problem ? h('div', { class: 'qproblem' }, n.problem) : null),
          can ? h('div', { class: 'qact' },
            h('button', { type: 'button', onclick: () => noticeNotion(n) }, 'Em aviso'),
            h('button', { type: 'button', class: 'ghost', onclick: () => churnNotion(n) }, 'Já saiu'),
            sel, h('button', { type: 'button', class: 'ghost', onclick: () => { const id = sel.pickedId(); if (!id) { toast('Escolha a ficha na lista.', true); return; } answerNotion(n, { outcome: 'LINK', client_id: id }, n.name + ' é a ficha de ' + d.clients.find((x) => x.id === id).name + '?'); } }, 'É esta ficha'),
            h('button', { type: 'button', class: 'ghost', onclick: () => answerNotion(n, { outcome: 'NOT_CLIENT' }, n.name + ' não é cliente? O cadastro sai da fila.') }, 'Não é cliente'))
            : h('span', { class: 'small muted' }, 'só o head da squad responde'));
      }))) : null;

    // Primeiro o que quem está olhando consegue responder.
    d.people.sort((a, b) => Number(b.can_decide) - Number(a.can_decide));
    d.records.sort((a, b) => Number(b.can_decide || b.squad_id === null) - Number(a.can_decide || a.squad_id === null));
    const people = h('section', { class: 'card' }, h('h2', {}, 'Quem é esta pessoa?', h('span', { class: 'badge' }, String(c.people))),
      h('p', { class: 'hint' }, 'Gente de fora que apareceu em reunião gravada. Diga de qual loja ela é e todas as reuniões dela ligam, as antigas e as próximas.'),
      d.people.length ? collapsible('div', 'qlist', d.people, 12, (p) => {
        const sel = clientPicker(d.clients, p.manager_ids, p.squad_id);
        return h('div', { class: 'qrow' },
          h('div', { class: 'qmain' }, h('b', {}, p.name),
            h('div', { class: 'small muted' }, p.meetings + (p.meetings === 1 ? ' reunião' : ' reuniões') + (p.last ? ' · última em ' + fmtDay(p.last.slice(0, 10)) : '') + (p.gestores.length ? ' · com ' + p.gestores.join(', ') : ''))),
          p.can_decide ? h('div', { class: 'qact' }, sel,
            h('button', { type: 'button', onclick: () => { const id = sel.pickedId(); if (!id) { toast('Escolha uma loja da lista (ou digite o nome até sobrar uma só).', true); return; } answerPerson(p, id); } }, 'Ligar'),
            h('button', { type: 'button', class: 'ghost', onclick: () => answerPerson(p, null) }, 'Não é cliente'))
            : h('span', { class: 'small muted' }, 'só o head da squad responde'));
      }) : h('p', { class: 'empty' }, 'Ninguém sem loja. 🎉'));

    const open = d.records.filter((r) => !r.waiting_notion);
    const waiting = d.records.filter((r) => r.waiting_notion);
    const records = h('section', { class: 'card' }, h('h2', {}, 'Grupos e contas sem cliente', h('span', { class: 'badge' }, String(open.length))),
      h('p', { class: 'hint' }, 'O nome não bate com nenhuma cliente. Ligue à loja certa ou feche.'),
      open.length ? h('div', { class: 'qlist' }, open.map((r) => {
        const sel = clientPicker(d.clients, [], r.squad_id);
        const [pl, pc] = PROVIDER[r.provider] || [r.provider, ''];
        return h('div', { class: 'qrow' },
          h('div', { class: 'qmain' }, h('div', { class: 'row', style: 'gap:8px' }, h('b', {}, r.label), h('span', { class: 'badge ' + pc }, pl)),
            r.spend_30d ? h('div', { class: 'small muted' }, brl0(r.spend_30d) + ' investidos em 30 dias') : null),
          r.can_decide || r.squad_id === null ? h('div', { class: 'qact' }, sel,
            h('button', { type: 'button', onclick: () => { const id = sel.pickedId(); if (!id) { toast('Escolha uma loja da lista (ou digite o nome até sobrar uma só).', true); return; } answerRecord(r, 'LINK', id); } }, 'Ligar'),
            h('button', { type: 'button', class: 'ghost', onclick: () => answerRecord(r, 'EX_CLIENT') }, 'Ex-cliente'),
            h('button', { type: 'button', class: 'ghost', onclick: () => answerRecord(r, 'NOT_CLIENT') }, 'Não é cliente'))
            : h('span', { class: 'small muted' }, 'só o head da squad responde'));
      })) : h('p', { class: 'empty' }, 'Nada sobrando.'),
      waiting.length ? h('details', { class: 'more' }, h('summary', { class: 'small muted' }, waiting.length + ' ligam sozinhos quando o cadastro incompleto acima for resolvido'),
        h('ul', { class: 'mini' }, waiting.map((r) => h('li', {}, h('span', {}, r.label), h('span', { class: 'badge ' + (PROVIDER[r.provider] || ['', ''])[1] }, (PROVIDER[r.provider] || [r.provider])[0]))))) : null);

    view.replaceChildren(
      h('div', { class: 'ov-head' }, h('div', {}, h('h1', {}, 'Vínculos pendentes'),
        h('p', { class: 'sub', style: 'margin:0' }, 'O que o sistema não conseguiu ligar sozinho a uma cliente.')),
        h('span', { class: 'spacer' }), squadSeg(d.squads, vqSquad, pick, [{ id: 'none', name: 'Sem squad' }])),
      h('div', { class: 'qsum' }, [[c.notion, 'cadastros incompletos'], [c.people, 'pessoas em ' + c.meetings + ' reuniões'], [c.records, 'grupos e contas']].map(([n, t]) =>
        h('div', {}, h('div', { class: 'big' }, nf(n)), h('div', { class: 'small muted' }, t)))),
      notion, people, records);
  }
  async function refreshQueueCount() {
    const el = document.getElementById('queue-count');
    if (!el || !can('reconciliation.read')) return;
    try { const c = (await api('GET', 'reconciliation/queue')).data.counts; const n = c.notion + c.people + c.records; el.textContent = String(n); el.hidden = n === 0; } catch (e) { el.hidden = true; }
  }

  // ---------- operação renova ----------
  // A base "Vencimentos" do Notion: o que vence no mês, com valor, risco e ação. O atrasado de antes não some na virada.
  let rnSquad = (() => { try { return sessionStorage.getItem('cc_rn_squad') || ''; } catch (e) { return ''; } })();
  const SIT = { 'Vencido': 'tag-red', 'A confirmar': 'tag-orange', 'A vencer': 'tag-gray', 'Recebido': 'tag-green', 'Pago em atraso': 'tag-brown' };
  const RSK = { 'Alto': 'tag-red', 'Moderado': 'tag-yellow', 'De boa': 'tag-green' };
  // Rascunho: baixa e novo recebimento valem só na memória desta página, até o servidor ter as rotas de gravação.
  const rnSim = { paid: new Map(), added: [] };
  const rnKey = (r) => r.name + '|' + (r.due_date || '');
  const daysUntil = (d) => Math.round((new Date(d + 'T12:00:00') - new Date(todaySP() + 'T12:00:00')) / 86400000);
  function applyRnSim(d) {
    if (!rnSim.paid.size && !rnSim.added.length) return d;
    const k = Object.assign({}, d.kpis);
    const added = rnSim.added.map((r) => { const days = daysUntil(r.due_date); return Object.assign({}, r, { days, overdue: days < 0, situation: days < 0 ? 'Vencido' : 'A vencer' }); });
    added.forEach((r) => { k.total += 1; k.open += 1; k.amount_total += r.amount; k.amount_open += r.amount; if (r.overdue) k.overdue += 1; else if (r.days <= 7) k.due_7d += 1; });
    const rows = d.rows.concat(added).map((r) => {
      const pay = rnSim.paid.get(rnKey(r));
      if (!pay) return r;
      k.paid += 1; k.open -= 1; k.amount_paid += pay.amount; k.amount_open -= r.amount || 0;
      if (r.overdue) k.overdue -= 1; else if (r.days !== null && r.days <= 7) k.due_7d -= 1;
      if (r.risk === 'Alto') k.high_risk -= 1;
      return Object.assign({}, r, { situation: r.overdue ? 'Pago em atraso' : 'Recebido', overdue: false, sim_paid: pay });
    });
    return Object.assign({}, d, { rows, kpis: k });
  }
  const parseMoney = (t) => { const x = String(t).replace(/[^\d,.-]/g, ''); const n = Number(x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x); return Number.isFinite(n) ? n : NaN; };
  function openPayment(r) {
    const date = h('input', { type: 'date', value: todaySP(), 'aria-label': 'Data do recebimento' });
    const amount = h('input', { inputmode: 'decimal', value: r.amount === null || r.amount === undefined ? '' : nf(r.amount, 2), 'aria-label': 'Valor recebido' });
    modal('Dar baixa em ' + r.name, [h('span', { class: 'soon' }, 'Simulação: ainda não grava'),
      h('div', { class: 'form-grid' }, field('Recebido em', date), field('Valor recebido', amount))],
      [['Confirmar recebimento', () => {
        const v = parseMoney(amount.value);
        if (!date.value) { toast('Informe a data.', true); return false; }
        if (!(v > 0)) { toast('Informe o valor recebido.', true); return false; }
        rnSim.paid.set(rnKey(r), { amount: v, date: date.value });
        toast('Baixa simulada: ' + r.name + '.');
        renderRenewals();
      }]]);
  }
  async function openNewReceipt(presetName) {
    const clients = await clientsList();
    const listId = 'rn-clients';
    const client = h('input', { list: listId, value: presetName || '', placeholder: 'Nome da loja', 'aria-label': 'Cliente' });
    const due = h('input', { type: 'date', value: todaySP(), 'aria-label': 'Vencimento' });
    const amount = h('input', { inputmode: 'decimal', placeholder: 'R$', 'aria-label': 'Valor' });
    const kind = h('select', { 'aria-label': 'Tipo' }, ['MRR', 'TCV', '1º pagamento'].map((t) => h('option', { value: t, selected: presetName && t === '1º pagamento' ? true : null }, t)));
    modal('Novo recebimento', [h('span', { class: 'soon' }, 'Simulação: ainda não grava'),
      h('datalist', { id: listId }, clients.map((c) => h('option', { value: c.trade_name }))),
      h('div', { class: 'form-grid' }, h('div', { class: 'full' }, field('Cliente', client)), field('Vencimento', due), field('Valor', amount), field('Tipo', kind))],
      [['Criar recebimento', () => {
        const name = client.value.trim();
        const v = parseMoney(amount.value);
        if (name.length < 2) { toast('Escolha a cliente.', true); return false; }
        if (!due.value) { toast('Informe o vencimento.', true); return false; }
        if (!(v > 0)) { toast('Informe o valor.', true); return false; }
        if (rnSim.added.some((r) => rnKey(r) === name + '|' + due.value)) { toast('Já existe esse recebimento nesta data.', true); return false; }
        const known = clients.find((c) => c.trade_name.toLowerCase() === name.toLowerCase());
        rnSim.added.push({ name, due_date: due.value, amount: v, kind: kind.value, client_id: known ? known.id : null, manager: known && known.manager ? known.manager.display_name : null, risk: null, sim_added: true });
        rnTab = '';
        toast('Recebimento simulado: ' + name + '.');
        if (location.hash === '#/vencimentos') renderRenewals(); else location.hash = '#/vencimentos';
      }]]);
    (presetName ? amount : client).focus();
  }
  function renovaTable(rows, showAmounts) {
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    const action = (r) => {
      if (r.sim_paid) return h('button', { type: 'button', class: 'linkbtn', onclick: stop(() => { rnSim.paid.delete(rnKey(r)); toast('Baixa desfeita.'); renderRenewals(); }) }, 'Desfazer');
      if (['Recebido', 'Pago em atraso'].includes(r.situation)) return null;
      return h('button', { type: 'button', class: 'ghost row-btn', onclick: stop(() => openPayment(r)) }, 'Dar baixa');
    };
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rn-tbl' },
      h('thead', {}, h('tr', {}, ['Cliente', 'Vencimento', showAmounts ? 'Valor' : null, 'Situação', 'Risco', 'Gestor', ''].filter((t) => t !== null).map((t) => h('th', { class: t === 'Valor' ? 'num' : '' }, t)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.client_id ? 'click' : '', onclick: () => goClient(r.client_id) },
        h('td', {}, h('b', {}, r.name), r.action || r.notes ? h('div', { class: 'small muted' }, r.action || r.notes) : null,
          r.sim_added || r.sim_paid ? h('div', {}, h('span', { class: 'soon' }, 'Simulação')) : null),
        h('td', {}, r.due_date ? fmtDay(r.due_date) : 'sem data'),
        showAmounts ? h('td', { class: 'num' }, r.sim_paid ? brl2(r.sim_paid.amount) : r.amount === null || r.amount === undefined ? 'sem valor' : brl2(r.amount)) : null,
        h('td', {}, h('span', { class: 'badge ' + (SIT[r.situation] || '') }, r.situation)),
        h('td', {}, r.risk ? h('span', { class: 'badge ' + (RSK[r.risk] || '') }, r.risk) : h('span', { class: 'muted small' }, 'sem avaliação')),
        h('td', { class: 'muted' }, r.manager || 'sem gestor'),
        h('td', { style: 'text-align:right;white-space:nowrap' }, action(r)))))));
  }
  let rnTab = '';
  async function renderRenewals() {
    const d = applyRnSim((await api('GET', 'renewals/operation' + (rnSquad ? '?squad_id=' + rnSquad : ''))).data);
    const k = d.kpis;
    const pick = (v) => { rnSquad = v; try { sessionStorage.setItem('cc_rn_squad', v); } catch (e) { /* sem armazenamento */ } renderRenewals(); };
    const mName = MONTHS_LONG[Number(d.month.slice(5)) - 1];
    const kpi = (lbl, val, det) => h('div', { class: 'kpi' }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val' }, val), h('div', { class: 'det' }, det || ''));
    const openRow = (r) => !r.overdue && ['A vencer', 'A confirmar'].includes(r.situation);
    const groups = [
      ['Em atraso', d.rows.filter((r) => r.overdue)],
      ['Vencem hoje', d.rows.filter((r) => openRow(r) && r.days === 0)],
      ['Próximos 7 dias', d.rows.filter((r) => openRow(r) && r.days !== null && r.days > 0 && r.days <= 7)],
      ['A vencer no mês', d.rows.filter((r) => openRow(r) && (r.days === null || r.days > 7 || r.days < 0))],
      ['Recebidos', d.rows.filter((r) => ['Recebido', 'Pago em atraso'].includes(r.situation))],
    ];
    if (!groups.some(([t, rows]) => t === rnTab && rows.length)) { const first = groups.find(([, rows]) => rows.length); rnTab = first ? first[0] : ''; }
    const current = groups.find(([t]) => t === rnTab);
    const pctPaid = k.amount_total ? k.amount_paid / k.amount_total : (k.total ? k.paid / k.total : 0);
    view.replaceChildren(
      h('div', { class: 'ov-head' }, h('div', {}, h('h1', {}, 'Operação Renova'), h('p', { class: 'sub', style: 'margin:0' }, 'Recebimentos de ' + mName)),
        h('span', { class: 'spacer' }), squadSeg(d.squads, rnSquad, pick), h('button', { type: 'button', onclick: () => openNewReceipt() }, '+ Novo recebimento')),
      h('div', { class: 'kpis' },
        kpi('Recebido', d.shows_amounts ? brl0(k.amount_paid) : nf(k.paid), pct(pctPaid, 0) + ' do mês'),
        kpi('Em aberto', d.shows_amounts ? brl0(k.amount_open) : nf(k.open), nf(k.open) + ' vencimentos'),
        kpi('Risco alto', nf(k.high_risk), 'em aberto')),
      rnSim.paid.size || rnSim.added.length ? h('p', { class: 'draft-note', style: 'margin:0 0 14px' }, 'Simulação: os números incluem o que você alterou aqui. Nada foi gravado, e tudo volta ao original ao recarregar a página.') : h('span'),
      h('div', { class: 'picker', role: 'tablist' }, groups.map(([t, rows]) => h('button', { type: 'button', role: 'tab', class: 'pick-t' + (t === rnTab ? ' on' : '') + (rows.length ? '' : ' calm'), 'aria-selected': String(t === rnTab), disabled: rows.length ? null : true,
        onclick: () => { rnTab = t; renderRenewals(); } }, h('span', { class: 'lbl' }, t), h('span', { class: 'num' }, String(rows.length))))),
      current ? h('section', { class: 'card' }, renovaTable(current[1], d.shows_amounts)) : card('Sem vencimentos', empty('Nenhum vencimento no mês no seu acesso.')));
  }

  // ---------- fontes ----------
  async function renderSources() {
    const st = (await api('GET', 'integrations/status')).data;
    sources = st.sources;
    const hist = await api('GET', 'sync/history?per_page=15');
    let people = null;
    if (can('integrations.manage')) { try { people = (await api('GET', 'integrations/notion/people')).data; } catch (e) { people = null; } }
    const run = async (source) => {
      try {
        const j = (await api('POST', 'sync/' + source, undefined, { 'Idempotency-Key': 'ui-' + source + '-' + Date.now() })).data;
        toast('Job #' + j.id + ': ' + j.status + (j.error ? ' (' + j.error.code + ')' : ''), j.status === 'FAILED');
        renderSources();
      } catch (e) { toast(e.message, true); }
    };
    view.replaceChildren(h('h1', {}, 'Fontes de dados'), h('p', { class: 'sub' }, 'De onde vêm os dados e quando foram lidos.'),
      h('div', { class: 'card' }, h('table', {}, h('thead', {}, h('tr', {}, ['Fonte', 'Modo', 'Situação', 'Última leitura', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, st.sources.map((s) => { const f = FRESH[s.freshness] || [s.freshness, '']; return h('tr', {},
          h('td', {}, h('b', {}, s.label), s.connector_in_hub ? null : h('div', { class: 'small muted' }, 'ainda sem conector na central')),
          h('td', {}, modeBadge(s.mode), s.credential_configured === false && s.mode !== 'REAL' ? h('div', { class: 'small muted' }, 'credencial real não configurada') : null),
          h('td', {}, badge(f[0], f[1])), h('td', {}, fmt(s.last_success_at)),
          h('td', {}, can('sync.run') && s.mode !== 'DISABLED' && s.connector_in_hub ? h('button', { onclick: () => run(s.source) }, 'Atualizar agora') : null)); })))),
      foldCard('Histórico de leituras', h('table', {}, h('thead', {}, h('tr', {}, ['Job', 'Fonte', 'Disparo', 'Situação', 'Contagens', 'Quando'].map((t) => h('th', {}, t)))),
        h('tbody', {}, hist.data.map((j) => h('tr', {}, h('td', {}, '#' + j.id), h('td', {}, (j.source || 'todas') + (j.mode ? ' · ' + (j.mode === 'FAKE' ? 'simulada' : 'real') : '')),
          h('td', {}, j.trigger + (j.requested_by ? ' · ' + j.requested_by.display_name : '')), h('td', {}, badge(j.status, j.status === 'SUCCEEDED' ? 'b-ok' : j.status === 'FAILED' ? 'b-bad' : 'b-warn'), j.error ? h('div', { class: 'small muted' }, j.error.code) : null),
          h('td', { class: 'small' }, Object.entries(j.counts || {}).filter(([, v]) => v).map(([k, v]) => k + ' ' + v).join(' · ') || 'sem contagem'), h('td', { class: 'small' }, fmt(j.finished_at || j.queued_at))))))),
      people ? h('div', { class: 'card' }, h('h2', {}, 'Gestores vistos no Notion'), h('p', { class: 'small muted' }, 'Ligar a pessoa do Notion ao usuário certo é uma decisão registrada. Sem ligação, a cliente nasce sem gestor e a lacuna aparece.'),
        h('table', {}, h('thead', {}, h('tr', {}, ['Pessoa no Notion', 'Registros', 'Usuário ligado'].map((t) => h('th', {}, t)))),
          h('tbody', {}, people.map((p) => h('tr', {}, h('td', {}, p.name || p.notion_user_id), h('td', {}, String(p.records)),
            h('td', {}, p.linked_user ? p.linked_user.display_name + ' (' + p.linked_user.username + ')' : h('button', { class: 'ghost', onclick: async () => {
              const uid = prompt('Id do usuário que é esta pessoa');
              const reason = uid ? prompt('Como você conferiu que é a mesma pessoa? (10 caracteres ou mais)') : null;
              if (!uid || !reason) return;
              try { await api('POST', 'integrations/notion/people-links', { notion_user_id: p.notion_user_id, user_id: Number(uid), reason }); toast('Pessoa ligada.'); renderSources(); } catch (e) { toast(e.message, true); }
            } }, 'Ligar a um usuário')))))))
        : null);
  }

  // ---------- caixa ----------
  async function renderInbox() {
    const r = (await api('GET', 'users/me/notifications')).data;
    view.replaceChildren(h('h1', {}, 'Avisos'), h('p', { class: 'sub' }, 'Menções e pedidos para você.'),
      h('div', { class: 'card' }, h('ul', { class: 'list' }, r.items.length ? r.items.map((i) => h('li', {}, h('div', { class: 'row' },
        h('b', {}, i.kind === 'MENTION' ? 'Menção' : 'Pedido para você'), i.read ? null : badge('novo', 'b-real'), h('span', { class: 'small muted' }, i.client.trade_name + ' · ' + i.actor.display_name + ' · ' + fmt(i.occurred_at)),
        h('span', { class: 'spacer' }), h('button', { class: 'ghost', onclick: async () => {
          try { await api('POST', 'users/me/notifications/read', { keys: [i.key] }); } catch (e) { /* segue para a ficha mesmo assim */ }
          location.hash = '#/cliente/' + i.client.id;
        } }, 'Abrir')), h('div', {}, i.summary))) : [empty('Nada novo.')])));
    refreshInbox();
  }


  // ---------- rótulos de execução ----------
  const WSTATE = { OPEN: 'aberta', SEEN: 'vista', IN_PROGRESS: 'em andamento', WAITING_CLIENT: 'esperando a cliente', WAITING_AGENCY: 'esperando a agência',
    EVIDENCE_SUBMITTED: 'prova enviada', VERIFIED: 'conferida', CANCELLED: 'cancelada' };
  const URG = { OVERDUE: ['vencida', 'b-bad'], DUE_TODAY: ['vence hoje', 'b-warn'], DUE_SOON: ['vence em breve', 'b-warn'], SCHEDULED: ['no prazo', ''], NO_DEADLINE: ['sem prazo', ''] };
  const EVIDENCE = { SOURCE_LINK: 'Link da fonte', PLATFORM_OBJECT_ID: 'Id do objeto na plataforma', FILE_REFERENCE: 'Arquivo', CONFIRMED_METRIC_SNAPSHOT: 'Métrica conferida',
    MEETING_RECORD: 'Registro de reunião', HUMAN_ATTESTATION: 'Relato (sem prova verificável)', CLIENT_CONFIRMATION: 'Confirmação da cliente' };
  const needsReason = (from, to) => to === 'CANCELLED' || to === 'WAITING_CLIENT' || (to === 'IN_PROGRESS' && (from === 'EVIDENCE_SUBMITTED' || from === 'VERIFIED'));
  const metricValue = (m) => m.value === null || m.value === undefined ? h('span', { class: 'muted' }, 'sem dado') : h('b', { style: 'font-size:26px' }, String(m.value));

  // ---------- hoje ----------
  // O dia do head como lista de ações: cada grupo é UMA coisa a fazer (responder, cobrar, segurar a cliente,
  // destravar mídia, confirmar o que vence, rever custo), com quem é e por quê. Lê as fontes reais:
  // grupos do WhatsApp, Operação Renova, jornada do Notion e Meta. Quem não lê a agência vê o Radar da carteira.
  let todaySquad = (() => { try { return sessionStorage.getItem('cc_today_squad') || ''; } catch (e) { return ''; } })();
  let todayMine = false;
  let todayTab = '';
  const SIGNAL_LABEL = { risco_de_saida: 'falou em sair', insatisfacao: 'insatisfação', pedido_pendente: 'pedido pendente', dinheiro_parado: 'dinheiro parado', promessa_da_cliente: 'promessa da cliente', sem_resposta: 'sem resposta' };
  async function renderToday() {
    if (!can('reports.read')) return renderTodayRadar();
    const q = todaySquad ? '?squad_id=' + todaySquad : '';
    const [ov, rn] = await Promise.all([api('GET', 'reports/overview' + q), can('renewals.read') ? api('GET', 'renewals/operation' + q).catch(() => null) : null]);
    const d = ov.data;
    const mineOnly = (x) => !todayMine || (x.manager || '') === (me.display_name || '');
    const cl = d.clients.filter(mineOnly);
    const rv = rn ? rn.data.rows.filter(mineOnly) : [];
    const showAmounts = rn ? rn.data.shows_amounts : false;
    const hours = (h0) => h0 >= 48 ? Math.floor(h0 / 24) + ' dias' : Math.round(h0) + 'h';
    const chip = (t, tone) => h('span', { class: 'chip ' + (tone || '') }, t);
    const jChip = (c) => c.journey && c.at_risk ? chip(c.journey.replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase(), 'bad') : null;
    const sChips = (c) => (c.signals || []).filter((x) => SIGNAL_LABEL[x]).map((x) => chip(SIGNAL_LABEL[x], ['risco_de_saida', 'insatisfacao'].includes(x) ? 'bad' : 'warn'));
    const waiting = cl.filter((c) => c.waiting_h !== null && c.waiting_h >= 4).sort((a, b) => b.waiting_h - a.waiting_h);
    const late = rv.filter((r) => r.overdue).sort((a, b) => a.days - b.days);
    const risk = cl.filter((c) => c.at_risk || (c.signals || []).some((x) => ['risco_de_saida', 'insatisfacao'].includes(x))).sort((a, b) => b.score - a.score);
    const media = cl.filter((c) => c.low_balance || c.no_delivery).sort((a, b) => Number(b.low_balance) - Number(a.low_balance) || b.spend_7d - a.spend_7d);
    const dueRenova = rv.filter((r) => !r.overdue && ['A vencer', 'A confirmar'].includes(r.situation) && r.days !== null && r.days <= 7).sort((a, b) => a.days - b.days);
    const dueNames = new Set(dueRenova.map((r) => r.client_id).filter(Boolean));
    const dueCycle = cl.filter((c) => c.cycle_days !== null && c.cycle_days >= 0 && c.cycle_days <= 7 && !dueNames.has(c.client_id)).sort((a, b) => a.cycle_days - b.cycle_days);
    const cost = cl.filter((c) => c.cpc_7d !== null && c.cpc_7d > 7).sort((a, b) => b.cpc_7d - a.cpc_7d);

    const line = (x, meta, chips, right, sub) => h('div', { class: 'qrow' + (x.client_id ? ' click' : ''), tabindex: x.client_id ? 0 : null, onclick: () => goClient(x.client_id),
      onkeydown: (e) => { if (e.key === 'Enter') goClient(x.client_id); } },
      h('div', { class: 'qmain' }, h('b', {}, x.name), h('div', { class: 'small muted' }, meta), chips && chips.filter(Boolean).length ? h('div', { class: 'chips' }, chips) : null),
      h('div', { class: 'qact', style: 'flex-direction:column;align-items:flex-end;gap:2px' }, h('span', { class: 'tbig', style: 'font-size:16px' }, right), sub ? h('span', { class: 'small muted' }, sub) : null));
    const who = (x) => [x.manager || 'sem gestor', x.squad].filter(Boolean).join(' · ');
    const groups = [
      ['responder', 'Responder agora', 'Cliente esperando a agência no grupo. Uma resposta hoje evita o atrito de amanhã.', waiting,
        (c) => line(c, who(c), [jChip(c), ...sChips(c)], hours(c.waiting_h), 'esperando')],
      ['cobrar', 'Cobrar', 'Venceu e não entrou na Operação Renova. Confirme o pagamento ou combine a data.', late,
        (r) => line(r, who(r) + (r.risk ? ' · risco ' + r.risk.toLowerCase() : ''), [r.action ? chip(r.action, 'info') : null], 'há ' + -r.days + 'd', showAmounts && r.amount !== null ? brl0(r.amount) : r.deadline)],
      ['segurar', 'Segurar a cliente', 'Aviso prévio, risco de churn, crítica ou falou em sair no grupo. Conversa de retenção com plano.', risk,
        (c) => line(c, who(c), [jChip(c), ...sChips(c), c.cycle_days !== null && c.cycle_days <= 15 && c.cycle_days >= 0 ? chip('ciclo vence em ' + c.cycle_days + 'd', 'warn') : null],
          c.last_meeting ? fmtDay(c.last_meeting) : 'sem reunião', 'última reunião')],
      ['midia', 'Destravar a mídia', 'Saldo pré-pago no fim ou campanha ativa sem entrega: anúncio parado não vende.', media,
        (c) => line(c, who(c), [c.low_balance ? chip('saldo baixo', 'bad') : null, c.no_delivery ? chip('campanha sem entrega', 'warn') : null], brl0(c.spend_7d), 'na semana')],
      ['vence', 'Vence esta semana', 'Pagamento ou fim de ciclo nos próximos 7 dias: agir antes da data.', [...dueRenova.map((r) => ({ kind: 'r', x: r })), ...dueCycle.map((c) => ({ kind: 'c', x: c }))],
        (it) => it.kind === 'r'
          ? line(it.x, who(it.x), [chip('pagamento', 'info'), it.x.situation === 'A confirmar' ? chip('a confirmar', 'warn') : null], it.x.days === 0 ? 'hoje' : 'em ' + it.x.days + 'd', showAmounts && it.x.amount !== null ? brl0(it.x.amount) : null)
          : line(it.x, who(it.x), [chip('fim do ciclo', 'warn')], it.x.cycle_days === 0 ? 'hoje' : 'em ' + it.x.cycle_days + 'd', fmtDay(it.x.cycle_end))],
      ['custo', 'Custo por conversa alto', 'Acima de R$ 7 na semana, só campanha de conversa. Rever criativo e público.', cost,
        (c) => line(c, who(c), [], brl2(c.cpc_7d), brl0(c.spend_7d) + ' na semana')],
    ];
    // Uma lista por vez: escolher no alto em vez de rolar por seis listas seguidas.
    if (!groups.some(([id, , , list]) => id === todayTab && list.length)) { const first = groups.find(([, , , list]) => list.length); todayTab = first ? first[0] : ''; }
    const picker = h('div', { class: 'picker', role: 'tablist' }, groups.map(([id, title, , list]) => h('button', { type: 'button', role: 'tab', class: 'pick-t' + (id === todayTab ? ' on' : '') + (list.length ? '' : ' calm'), 'aria-selected': String(id === todayTab), disabled: list.length ? null : true,
      onclick: () => { todayTab = id; renderToday(); } }, h('span', { class: 'lbl' }, title), h('span', { class: 'num' }, nf(list.length)))));
    const current = groups.find(([id]) => id === todayTab);
    const seg = h('div', { class: 'row', style: 'gap:8px' },
      squadSeg(d.squads, todaySquad, (v) => { todaySquad = v; try { sessionStorage.setItem('cc_today_squad', v); } catch (e) { /* sem armazenamento */ } renderToday(); }),
      h('button', { type: 'button', class: 'tog' + (todayMine ? ' on' : ''), onclick: () => { todayMine = !todayMine; renderToday(); } }, 'Minha carteira'));
    view.replaceChildren(
      h('div', { class: 'ov-head' }, h('div', {}, h('h1', {}, 'Hoje'), h('p', { class: 'sub', style: 'margin:0' }, new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))),
        h('span', { class: 'spacer' }), seg),
      picker,
      current ? h('section', { class: 'card' }, h('h2', {}, current[1]), h('p', { class: 'lead' }, current[2]), collapsible('div', 'qlist', current[3], 8, current[4]))
        : card('Tudo em dia', empty('Nenhuma ação pendente neste recorte.')));
  }

  // Radar da carteira (quem não lê a agência inteira: gestor).
  // Prioridades do dia como lista do Notion: uma linha por cliente, gravidade e prazo à vista, filtro por gravidade e squad.
  const SEV_TAG = { CRITICAL: 'tag-red', HIGH: 'tag-orange', MEDIUM: 'tag-yellow', LOW: 'tag-gray' };
  const URG_TAG = { OVERDUE: 'tag-red', DUE_TODAY: 'tag-orange', DUE_SOON: 'tag-yellow', SCHEDULED: 'tag-gray', NO_DEADLINE: 'tag-gray' };
  let todaySev = '';
  const WARN_TEXT = { INTERNAL_RULES_STALE: 'regras internas desatualizadas', MEDIA_NOT_CONFIGURED: 'mídia sem leitura', NOTION_NEVER_READ: 'Notion nunca lido',
    WHATSAPP_NOT_CONFIGURED: 'WhatsApp sem leitura', MEETINGS_NOT_CONFIGURED: 'reuniões sem leitura', NOTION_STALE: 'Notion desatualizado', MEDIA_STALE: 'mídia desatualizada' };
  const ISTATE = { DETECTED: ['detectado', 'tag-red'], TRIAGE: ['em triagem', 'tag-yellow'], ADDRESSING: ['em tratamento', 'tag-blue'], RESOLUTION_CLAIMED: ['resolução declarada', 'tag-purple'],
    RESOLUTION_UNCONFIRMED: ['resolução sem confirmação', 'tag-orange'], VERIFIED_RESOLVED: ['resolvido', 'tag-green'], REOPENED: ['reaberto', 'tag-orange'], FALSE_POSITIVE: ['falso alarme', 'tag-gray'] };
  async function renderTodayRadar() {
    const [t, allRes] = await Promise.all([api('GET', 'radar/today'), api('GET', 'radar/all?limit=100').catch(() => null)]);
    const d = t.data;
    const all = allRes ? allRes.data : d.top_priorities;
    const LABEL = { clients_with_urgent_action: 'Clientes com ação urgente', renewals_upcoming: 'Vencimentos próximos', overdue_actions: 'Pendências vencidas',
      meetings_today: 'Reuniões hoje', media_alerts: 'Alertas de mídia' };
    const kpis = h('div', { class: 'kpis' }, Object.entries(d.metrics).map(([k, m]) => h('div', { class: 'kpi' }, h('div', { class: 'lbl' }, LABEL[k] || k),
      h('div', { class: 'val' }, m.value === null || m.value === undefined ? h('span', { class: 'muted', style: 'font-size:16px' }, 'sem dado') : nf(m.value)), h('div', { class: 'det' }, m.note || ''))));
    const list = h('div', { class: 'qlist' });
    const filters = h('div', { class: 'seg' });
    const sevs = ['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].filter((s) => !s || all.some((c) => c.severity === s));
    const row = (c) => {
      const u = URG[c.urgency] || [c.urgency, ''];
      return h('div', { class: 'qrow click', tabindex: 0, onclick: () => goClient(c.client_id), onkeydown: (e) => { if (e.key === 'Enter') goClient(c.client_id); } },
        h('span', { class: 'badge ' + (SEV_TAG[c.severity] || ''), style: 'min-width:58px;justify-content:center' }, SEV[c.severity] || c.severity),
        h('div', { class: 'qmain' }, h('b', {}, c.client.trade_name), h('div', { style: 'margin-top:2px' }, c.sentence),
          h('div', { class: 'small muted', style: 'margin-top:3px' }, [c.client.manager ? c.client.manager.display_name : 'sem gestor', c.client.squad ? c.client.squad.name : null,
            'fonte ' + c.source_evidence.map((x) => SRC[x.source] || x.source).join(', '), c.coverage !== 'COMPLETE' ? 'cobertura ' + (COVER[c.coverage] || c.coverage.toLowerCase()) : null].filter(Boolean).join(' · '))),
        h('div', { class: 'qact', style: 'flex-direction:column;align-items:flex-end;gap:4px' }, h('span', { class: 'badge ' + (URG_TAG[c.urgency] || '') }, u[0]),
          c.deadline ? h('span', { class: 'small muted' }, 'prazo ' + fmtDay(c.deadline.slice(0, 10))) : null,
          c.episodes_count > 1 ? h('span', { class: 'small muted' }, c.episodes_count + ' alertas') : null));
    };
    const draw = () => {
      filters.replaceChildren(...sevs.map((s) => h('button', { type: 'button', class: s === todaySev ? 'on' : '', onclick: () => { todaySev = s; draw(); } },
        s ? (SEV[s] || s) + ' (' + all.filter((c) => c.severity === s).length + ')' : 'Todas (' + all.length + ')')));
      const rows = all.filter((c) => !todaySev || c.severity === todaySev);
      list.replaceChildren(...(rows.length ? rows.map(row) : [h('p', { class: 'empty' }, 'Nada nesta gravidade.')]));
    };
    draw();
    const today = new Date();
    view.replaceChildren(
      h('h1', {}, 'Hoje'),
      h('p', { class: 'sub' }, today.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · uma linha por cliente, a mais urgente primeiro. Clique para abrir a ficha.'),
      kpis,
      h('section', { class: 'card' }, h('div', { class: 'row', style: 'margin-bottom:8px' }, h('h2', { style: 'margin:0' }, 'Prioridades'), h('span', { class: 'spacer' }), filters), list,
        d.source_warnings && d.source_warnings.length ? h('div', { class: 'gap' }, 'Leitura parcial: ' + d.source_warnings.map((w) => {
          const c = typeof w === 'string' ? w : (w.code || w.message || '');
          return WARN_TEXT[c] || (typeof w === 'object' && w.message) || c.toLowerCase().replace(/_/g, ' ');
        }).join(', ') + '. Alerta dessas fontes pode estar faltando nesta lista.') : null));
  }

  // ---------- pendências ----------
  // Lista de tarefas como no Notion: agrupada por prazo, situação em etiqueta, ação principal em um botão e o resto num menu.
  const WTAG = { OPEN: 'tag-gray', SEEN: 'tag-gray', IN_PROGRESS: 'tag-blue', WAITING_CLIENT: 'tag-yellow', WAITING_AGENCY: 'tag-orange', EVIDENCE_SUBMITTED: 'tag-purple', VERIFIED: 'tag-green', CANCELLED: 'tag-gray' };
  function taskRow(w, reviewing, refresh, opts) {
    opts = opts || {};
    const move = async (to) => {
      const body = { to_state: to, version: w.version };
      if (needsReason(w.state, to)) { const r = prompt('Motivo (10 caracteres ou mais)'); if (!r) return; body.reason = r; }
      try { await api('POST', 'work-items/' + w.id + '/transition', body); toast('Pendência ' + (WSTATE[to] || to) + '.'); refresh(); refreshInbox(); } catch (e) { toast(e.message, true); }
    };
      const u = URG[w.urgency] || [w.urgency, ''];
      const proof = h('div');
      if (!reviewing && w.allowed_actions.includes('SUBMIT_EVIDENCE')) {
        const kind = h('select', { 'aria-label': 'Tipo de prova' }, Object.entries(EVIDENCE).map(([k, t]) => h('option', { value: k }, t)));
        const desc = h('input', { 'aria-label': 'O que foi feito', placeholder: 'O que foi feito (10 caracteres ou mais)', maxlength: 2000 });
        const ref = h('input', { 'aria-label': 'Link ou identificador', placeholder: 'Link https ou identificador (opcional)', maxlength: 500 });
        proof.append(h('details', { class: 'more' }, h('summary', { class: 'small' }, 'Concluir com prova'), h('form', { class: 'box', style: 'padding:12px', onsubmit: async (ev) => {
          ev.preventDefault();
          try { await api('POST', 'work-items/' + w.id + '/evidence', { kind: kind.value, description: desc.value, reference: ref.value || null, version: w.version }); toast('Prova enviada; vai para conferência.'); refresh(); } catch (e) { toast(e.message, true); }
        } }, h('div', { class: 'small muted' }, w.proof_required ? 'Esta pendência exige prova verificável (relato sozinho não basta).' : 'Registre o que foi feito.'),
        h('div', { class: 'row', style: 'margin-top:8px' }, kind, desc, ref, h('button', { type: 'submit' }, 'Enviar')))));
      }
      // Ação rápida (DT-178): "Feito" num clique, para o dono e para o head no pente fino; "Amanhã" reprograma com motivo.
      const dayTxt = new Date().toLocaleDateString('pt-BR');
      const quick = h('div', { class: 'row', style: 'gap:6px;margin:0 4px 8px' });
      const canSubmit = w.allowed_actions.includes('SUBMIT_EVIDENCE');
      const canConfirm = w.allowed_transitions.includes('VERIFIED');
      const done = async (btn) => {
        btn.disabled = true;
        try {
          if (canConfirm) {
            const body = { to_state: 'VERIFIED', version: w.version };
            if (w.state !== 'EVIDENCE_SUBMITTED') body.exception_justification = 'Confirmado no daily de ' + dayTxt + ' por ' + me.username + '.';
            await api('POST', 'work-items/' + w.id + '/transition', body);
            toast('Marcada como feita.');
          } else if (!w.proof_required) {
            await api('POST', 'work-items/' + w.id + '/evidence', { kind: 'HUMAN_ATTESTATION', description: 'Feito. Marcado no daily de ' + dayTxt + '.', reference: null, version: w.version });
            toast('Concluída.');
          } else {
            btn.disabled = false;
            const ref = h('input', { placeholder: 'Link https ou id do anúncio', maxlength: 500, style: 'min-width:240px' });
            const ok = h('button', { type: 'button', onclick: async () => {
              const v = ref.value.trim();
              if (!v) { toast('Esta exige prova: cole o link ou o id do anúncio.', true); return; }
              try {
                await api('POST', 'work-items/' + w.id + '/evidence', { kind: v.startsWith('https://') ? 'SOURCE_LINK' : 'PLATFORM_OBJECT_ID', description: 'Feito. Marcado no daily de ' + dayTxt + '.', reference: v, version: w.version });
                toast('Prova enviada: o head confere.'); refresh(); refreshInbox();
              } catch (e) { toast(e.message, true); }
            } }, 'Enviar');
            quick.replaceChildren(ref, ok);
            ref.focus();
            return;
          }
          refresh(); refreshInbox();
        } catch (e) { btn.disabled = false; toast(e.message, true); }
      };
      if (!w.is_closed && (canConfirm || (canSubmit && w.state !== 'EVIDENCE_SUBMITTED'))) {
        const label = canConfirm ? (w.state === 'EVIDENCE_SUBMITTED' ? '✓ Conferir' : '✓ Feito') : '✓ Feito';
        quick.append(h('button', { type: 'button', onclick: (ev) => done(ev.currentTarget) }, label));
        if (w.allowed_actions.includes('UPDATE') && w.state !== 'EVIDENCE_SUBMITTED') {
          quick.append(h('button', { type: 'button', class: 'ghost', onclick: async () => {
            const t = new Date(Date.now() + 86400000 - 3 * 3600000).toISOString().slice(0, 10);
            try { await api('PATCH', 'work-items/' + w.id, { due_at: t + 'T18:00:00-03:00', reschedule_reason: 'Passou para amanhã no daily de ' + dayTxt + '.', version: w.version }); toast('Passou para amanhã.'); refresh(); refreshInbox(); } catch (e) { toast(e.message, true); }
          } }, 'Amanhã'));
        }
      }
      if (proof.firstChild) proof.firstChild.querySelector('summary').textContent = 'Concluir com outro tipo de prova';
      const targets = w.allowed_transitions.filter((x) => reviewing ? true : x !== 'VERIFIED');
      const menu = targets.some((x) => x !== 'VERIFIED') ? (() => {
        const sel = h('select', { 'aria-label': 'Mudar situação', class: 'mini-sel' }, h('option', { value: '' }, 'Mudar…'), targets.filter((x) => x !== 'VERIFIED').map((to) => h('option', { value: to }, WSTATE[to] || to)));
        sel.addEventListener('change', () => { if (sel.value) move(sel.value); });
        return sel;
      })() : null;
      return h('div', { class: 'task' + (w.urgency === 'OVERDUE' ? ' late' : '') },
        h('div', { class: 'qrow', style: 'border-bottom:0;padding:8px 4px' },
          h('div', { class: 'qmain' }, h('div', { class: 'row', style: 'gap:8px' }, h('b', {}, w.title), h('span', { class: 'badge ' + (WTAG[w.state] || '') }, WSTATE[w.state] || w.state),
            w.request ? h('span', { class: 'badge tag-blue' }, 'pedido de ' + w.created_by.display_name) : null),
            h('div', { class: 'small muted', style: 'margin-top:2px' }, opts.hideClient ? null : h('a', { href: '#/cliente/' + w.client.id }, w.client.trade_name), (opts.hideClient ? '' : ' · ') + 'com ' + w.owner.display_name
              + (w.last_evidence ? ' · prova: ' + (EVIDENCE[w.last_evidence.kind] || w.last_evidence.kind) + ' por ' + w.last_evidence.submitted_by.display_name : ''))),
          h('div', { class: 'qact' }, w.is_closed ? null : h('span', { class: 'badge ' + (URG_TAG[w.urgency] || '') }, w.due_at ? u[0] + ' · ' + fmtDay(w.due_at.slice(0, 10)) : u[0]),
            menu)),
        w.last_evidence && (reviewing || opts.showEvidence) ? h('div', { class: 'box small', style: 'margin:0 4px 8px;padding:10px' }, w.last_evidence.description,
          w.last_evidence.reference ? h('div', {}, h('a', { href: w.last_evidence.reference.startsWith('https://') ? w.last_evidence.reference : '#', rel: 'noopener noreferrer', target: '_blank' }, w.last_evidence.reference)) : null) : null,
        quick.firstChild ? quick : null, w.state === 'EVIDENCE_SUBMITTED' ? null : proof);
    }

  let workTab = 'mine';
  async function renderWork() {
    const mine = await api('GET', 'work-items?owner_id=' + me.id + '&per_page=100');
    let review = { data: [] };
    if (can('work.verify')) { try { review = await api('GET', 'work-items?state=EVIDENCE_SUBMITTED&per_page=100'); } catch (e) { review = { data: [] }; } }
    const toReview = review.data.filter((w) => w.allowed_actions.includes('REVIEW'));
    const item = (w, reviewing) => taskRow(w, reviewing, renderWork);
    const open = mine.data.filter((w) => !w.is_closed);
    const groups = [['Vencidas', open.filter((w) => w.urgency === 'OVERDUE')], ['Vencem hoje', open.filter((w) => w.urgency === 'DUE_TODAY')],
      ['Próximos dias', open.filter((w) => w.urgency === 'DUE_SOON')], ['No prazo', open.filter((w) => w.urgency === 'SCHEDULED')], ['Sem prazo', open.filter((w) => w.urgency === 'NO_DEADLINE')]];
    const closed = mine.data.filter((w) => w.is_closed);
    const tabs = [['mine', 'Com você', open.length], ['review', 'Para conferir', toReview.length], ['closed', 'Encerradas', closed.length]];
    workTab = pickValid(tabs, workTab);
    const body = workTab === 'review' ? toReview.map((w) => item(w, true))
      : workTab === 'closed' ? closed.map((w) => item(w, false))
        : groups.filter(([, l]) => l.length).map(([title, l]) => h('div', { class: 'tgroup' }, h('div', { class: 'tgtitle' }, title, h('span', { class: 'tcount' }, String(l.length))), l.map((w) => item(w, false))));
    view.replaceChildren(
      h('div', { class: 'ov-head' }, h('div', {}, h('h1', {}, 'Pendências'), h('p', { class: 'sub', style: 'margin:0' }, groups[0][1].length ? groups[0][1].length + (groups[0][1].length > 1 ? ' vencidas' : ' vencida') : 'Nada vencido')),
        h('span', { class: 'spacer' }), can('work.write') ? h('button', { type: 'button', onclick: () => openNewTask() }, '+ Nova tarefa') : h('span')),
      listPicker(tabs, workTab, (id) => { workTab = id; renderWork(); }),
      workTab ? h('section', { class: 'card' }, body) : card('Tudo em dia', empty('Nada aberto com você.')));
  }

  // ---------- tarefas na ficha e no Daily ----------
  // O sistema é a fonte (DT-177): tarefa nasce aqui, sem passar pelo Notion. Atalhos para o que a operação mais registra;
  // "Já fiz" registra a atividade feita agora (vai para a conferência do head no pente fino).
  let teamCache = null;
  async function team() {
    if (teamCache) return teamCache;
    try { teamCache = (await api('GET', 'managers')).data.filter((m) => m.active); } catch (e) { teamCache = []; }
    return teamCache;
  }
  let squadsCache = null;
  async function squadsList() {
    if (squadsCache) return squadsCache;
    try { squadsCache = (await api('GET', 'squads')).data.filter((q) => q.active); } catch (e) { squadsCache = []; }
    return squadsCache;
  }
  const QUICK = [['Subiu anúncio', true], ['Trocou criativo', true], ['Ajustou campanha', true], ['Recarga de saldo', true], ['Relatório enviado', true],
    ['Follow-up no grupo', true], ['Cobrar material da cliente', false], ['Marcar reunião', false], ['Preparar planejamento', false]];
  const isoLocal = (date, time) => date + 'T' + time + ':00-03:00';
  const todaySP = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  async function taskComposer(client, refresh, preset) {
    preset = preset || {};
    const people = await team();
    const title = h('input', { 'aria-label': 'Tarefa', maxlength: 200, placeholder: 'O que precisa ser feito (ou o que foi feito)', value: preset.title || '' });
    const desc = h('textarea', { 'aria-label': 'Detalhe', maxlength: 4000, rows: 2, placeholder: 'Detalhe (opcional)' }, preset.description || '');
    const done = h('input', { type: 'checkbox', 'aria-label': 'Já fiz' });
    const ref = h('input', { 'aria-label': 'Link ou id', maxlength: 500, placeholder: 'Link https ou id do anúncio (opcional)' });
    const date = h('input', { type: 'date', 'aria-label': 'Prazo', value: preset.due || todaySP() });
    const late = new Date().getHours() >= 17;
    const time = h('input', { type: 'time', 'aria-label': 'Hora', value: late ? '23:30' : '18:00' });
    const canAssign = can('work.assign');
    const def = preset.owner || (client.manager && client.manager.id !== me.id && canAssign ? client.manager.id : me.id);
    const owner = h('select', { 'aria-label': 'Responsável', disabled: !canAssign || null },
      [{ id: me.id, display_name: 'Eu' }].concat(people.filter((p) => p.id !== me.id)).map((p) => h('option', { value: p.id, selected: p.id === def || null }, p.display_name)));
    const dueBox = h('span', { class: 'row', style: 'gap:6px' }, date, time, owner);
    const refBox = h('span', { hidden: true }, ref);
    done.addEventListener('change', () => { dueBox.hidden = done.checked; refBox.hidden = !done.checked; });
    const chips = h('div', { class: 'chips' }, QUICK.map(([t, wasDone]) => h('button', { type: 'button', class: 'chip', onclick: () => {
      title.value = t; done.checked = wasDone; done.dispatchEvent(new Event('change')); title.focus();
    } }, t)));
    const form = h('form', { class: 'composer', onsubmit: async (ev) => {
      ev.preventDefault();
      const t = title.value.trim();
      if (t.length < 3) { toast('Escreva a tarefa (3 caracteres ou mais).', true); return; }
      try {
        if (done.checked) {
          const r = ref.value.trim();
          const w = (await api('POST', 'work-items', { client_id: client.id, kind: r ? 'TASK' : 'FOLLOWUP', title: t, description: desc.value.trim() || null,
            due_at: new Date(Date.now() + 2 * 3600000).toISOString(), proof_required: !!r, origin: 'MANUAL' })).data;
          await api('POST', 'work-items/' + w.id + '/evidence', { kind: r ? (r.startsWith('https://') ? 'SOURCE_LINK' : 'PLATFORM_OBJECT_ID') : 'HUMAN_ATTESTATION',
            description: desc.value.trim().length >= 20 ? desc.value.trim() : 'Feito: ' + t + '. Registrado na ficha.', reference: r || null, version: w.version });
          toast('Registrado como feito. Vai para a conferência no pente fino.');
        } else {
          await api('POST', 'work-items', { client_id: client.id, kind: 'TASK', title: t, description: desc.value.trim() || null, owner_user_id: Number(owner.value),
            due_at: isoLocal(date.value, time.value), origin: preset.origin || 'MANUAL' });
          toast('Tarefa criada.');
        }
        title.value = ''; desc.value = ''; ref.value = ''; done.checked = false; done.dispatchEvent(new Event('change'));
        refresh();
      } catch (e) { toast(e.message, true); }
    } }, title, chips, h('div', { class: 'row', style: 'margin-top:8px;gap:10px;flex-wrap:wrap' },
      h('label', { class: 'small row', style: 'gap:6px;margin:0' }, done, 'Já fiz'), dueBox, refBox, h('span', { class: 'spacer' }), h('button', { type: 'submit' }, 'Salvar')),
    h('details', { class: 'more' }, h('summary', { class: 'small muted' }, 'Detalhe'), desc));
    return form;
  }

  async function tasksCard(client) {
    let r;
    try { r = (await api('GET', 'clients/' + client.id + '/actions?include_closed=true')).data; } catch (e) { slot('tasks', card('Tarefas', empty(e.message))); return; }
    const refresh = () => { tasksCard(client); timelineCard(client); };
    const items = r.items.filter((w) => !w.request);
    const open = items.filter((w) => !w.is_closed && w.state !== 'EVIDENCE_SUBMITTED');
    const waiting = items.filter((w) => w.state === 'EVIDENCE_SUBMITTED');
    const closed = items.filter((w) => w.is_closed).slice(0, 30);
    const tab = document.querySelector('.tabs [data-tab="tarefas"]');
    if (tab) { const c = tab.querySelector('.tcount') || tab.appendChild(h('span', { class: 'tcount' })); c.textContent = String(open.length); c.hidden = !open.length; }
    const row = (w) => taskRow(w, w.allowed_actions.includes('REVIEW'), refresh, { hideClient: true, showEvidence: true });
    slot('tasks', h('div', {},
      can('work.write') ? foldCard('+ Nova tarefa', await taskComposer(client, refresh)) : null,
      h('section', { class: 'card' }, h('h2', {}, 'Em aberto', h('span', { class: 'badge' }, String(open.length))), open.length ? open.map(row) : empty('Nada em aberto para esta cliente.')),
      waiting.length ? h('section', { class: 'card' }, h('h2', {}, 'Feitas, esperando conferência', h('span', { class: 'badge tag-purple' }, String(waiting.length))), waiting.map(row)) : null,
      closed.length ? h('section', { class: 'card' }, h('details', {}, h('summary', {}, h('b', {}, 'Encerradas'), ' (' + closed.length + ')'), closed.map(row))) : null));
  }

  // Texto de briefing (Markdown simples vindo do Notion ou escrito na ficha), montado só com textContent.
  function richText(text) {
    const box = h('div', { class: 'rich' });
    let list = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trimEnd();
      const li = /^(- \[( |x)\] |- |\d+\. )(.*)$/.exec(line);
      if (li) {
        if (!list) { list = h('ul'); box.append(list); }
        list.append(h('li', {}, li[2] !== undefined ? (li[2] === 'x' ? '☑ ' : '☐ ') : '', li[3]));
        continue;
      }
      list = null;
      if (!line.trim()) continue;
      const hd = /^(#{1,3}) (.*)$/.exec(line);
      if (hd) box.append(h(hd[1].length === 1 ? 'h3' : hd[1].length === 2 ? 'h4' : 'h5', {}, hd[2]));
      else if (line === '---') box.append(h('hr'));
      else if (line.startsWith('> ')) box.append(h('blockquote', {}, line.slice(2)));
      else box.append(h('p', {}, line));
    }
    return box;
  }
  function briefingCard(client, rerender) {
    const b = client.sales_briefing;
    const editable = client.allowed_actions.includes('UPDATE');
    const body = h('div');
    const show = () => body.replaceChildren(b ? richText(b.text) : empty('Sem briefing comercial. Quem fechou a venda escreve aqui (ou no corpo da página da cliente no Notion, que entra na próxima leitura).'),
      b ? h('p', { class: 'small muted', style: 'margin-top:8px' }, (b.source === 'MANUAL' ? 'Editado na ficha' : 'Do corpo da página no Notion') + (b.updated_at ? ' · ' + fmt(b.updated_at) : '')) : null,
      editable ? h('button', { type: 'button', class: 'ghost', onclick: edit }, b ? 'Editar briefing' : 'Escrever briefing') : null);
    const edit = () => {
      const ta = h('textarea', { rows: 18, maxlength: 60000, 'aria-label': 'Briefing comercial', style: 'width:100%;font-family:inherit' }, b ? b.text : '');
      body.replaceChildren(h('p', { class: 'small muted' }, 'Use # para título, - para lista. Depois de salvo aqui, a leitura do Notion não sobrescreve mais.'), ta,
        h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { type: 'button', onclick: async () => {
          try { await api('PATCH', 'clients/' + client.id, { sales_briefing: ta.value.trim() || null, version: client.version }); toast('Briefing salvo na ficha.'); rerender(); } catch (e) { toast(e.message, true); }
        } }, 'Salvar'), h('button', { type: 'button', class: 'ghost', onclick: show }, 'Cancelar')));
      ta.focus();
    };
    show();
    return h('section', { class: 'card' }, h('h2', {}, 'Briefing comercial'), body);
  }

  // Cadastro editável: situação, gestor e os campos da casa, no próprio lugar onde aparecem.
  async function editProfile(client, nf0, rerender) {
    const pf = client.profile || {};
    let journeys = [];
    try { journeys = (await api('GET', 'clients/board')).data.journeys; } catch (e) { journeys = []; }
    const people = await team();
    const squads = await squadsList();
    const parts = [];
    const v = (x, y) => (x !== null && x !== undefined && x !== '') ? x : (y || '');
    if (client.allowed_actions.includes('UPDATE')) {
      const name = h('input', { value: client.trade_name, maxlength: 200, 'aria-label': 'Nome' });
      const contact = h('input', { value: v(pf.contact_name, nf0.contact), maxlength: 200, 'aria-label': 'Contato' });
      const term = h('select', { 'aria-label': 'Contrato' }, ['', '3 meses', '6 meses', 'Mês a mês'].map((t) => h('option', { value: t, selected: t === v(pf.contract_term, nf0.contract_term) || null }, t || 'sem contrato')));
      const entry = h('input', { type: 'date', value: v(pf.entry_on, nf0.entry_date), 'aria-label': 'Entrada' });
      const cycle = h('input', { type: 'date', value: v(pf.cycle_end_on, nf0.cycle_end), 'aria-label': 'Fim do ciclo' });
      const jv = v(pf.journey, nf0.journey);
      const journey = h('select', { 'aria-label': 'Jornada' }, [''].concat(journeys).map((j) => h('option', { value: j, selected: j === jv || null }, j || 'sem jornada')));
      parts.push(h('form', { class: 'box', onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          await api('PATCH', 'clients/' + client.id, { trade_name: name.value.trim(), contact_name: contact.value.trim() || null, contract_term: term.value || null,
            entry_on: entry.value || null, cycle_end_on: cycle.value || null, journey: journey.value || null, version: client.version });
          toast('Cadastro salvo.'); rerender();
        } catch (e) { toast(e.message, true); }
      } }, h('b', {}, 'Cadastro'), h('div', { class: 'grid', style: 'margin-top:8px' },
        ...[['Nome', name], ['Contato na cliente', contact], ['Jornada', journey], ['Contrato', term], ['Entrada', entry], ['Fim do ciclo', cycle]].map(([l, i]) => h('div', { class: 'span-4' }, field(l, i)))),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { type: 'submit' }, 'Salvar cadastro'))));
    }
    if (client.allowed_actions.includes('CHANGE_LIFECYCLE')) {
      let lc = null;
      try { lc = (await api('GET', 'clients/' + client.id + '/lifecycle')).data; } catch (e) { lc = null; }
      if (lc && lc.allowed_transitions.length) {
        const to = h('select', { 'aria-label': 'Nova situação' }, lc.allowed_transitions.map((x) => h('option', { value: x }, STATE[x] || x)));
        const when = h('input', { type: 'date', value: todaySP(), 'aria-label': 'Desde' });
        const end = h('input', { type: 'date', 'aria-label': 'Saída prevista' });
        const endBox = h('div', { class: 'span-4' }, field('Saída prevista (aviso prévio)', end));
        const reason = h('input', { maxlength: 1000, placeholder: 'Motivo (5 caracteres ou mais)', 'aria-label': 'Motivo' });
        const sq = h('select', { 'aria-label': 'Squad' }, squads.map((q) => h('option', { value: q.id, selected: client.squad && client.squad.id === q.id || null }, q.name)));
        const mg = h('select', { 'aria-label': 'Gestor' }, people.map((p) => h('option', { value: p.id, selected: client.manager && client.manager.id === p.id || null }, p.display_name)));
        const backBox = h('div', { class: 'span-8 row', style: 'gap:8px' }, sq, mg);
        const sync = () => { endBox.hidden = to.value !== 'NOTICE_GIVEN'; backBox.hidden = !(client.lifecycle_state.code === 'CHURNED' && (to.value === 'ACTIVE' || to.value === 'ONBOARDING')); };
        to.addEventListener('change', sync); sync();
        parts.push(h('form', { class: 'box', onsubmit: async (ev) => {
          ev.preventDefault();
          const body = { to_state: to.value, effective_at: when.value === todaySP() ? null : isoLocal(when.value, '12:00'), expected_end_at: to.value === 'NOTICE_GIVEN' && end.value ? isoLocal(end.value, '12:00') : null,
            reason: reason.value, version: client.version };
          if (!backBox.hidden) { body.squad_id = Number(sq.value); body.manager_user_id = Number(mg.value); }
          try { await api('POST', 'clients/' + client.id + '/lifecycle-transitions', body, { 'Idempotency-Key': 'ui-lc-' + client.id + '-' + client.version }); toast('Situação alterada.'); rerender(); } catch (e) { toast(e.message, true); }
        } }, h('b', {}, 'Situação'), h('span', { class: 'small muted' }, ' · hoje ' + (STATE[client.lifecycle_state.code] || client.lifecycle_state.code)),
        h('div', { class: 'grid', style: 'margin-top:8px' }, h('div', { class: 'span-4' }, field('Nova situação', to)), h('div', { class: 'span-4' }, field('Desde', when)), endBox,
          h('div', { class: 'span-12' }, field('Motivo', reason)), backBox),
        h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { type: 'submit' }, 'Mudar situação'))));
      }
    }
    if (client.allowed_actions.includes('TRANSFER')) {
      const sq = h('select', { 'aria-label': 'Squad' }, squads.map((q) => h('option', { value: q.id, selected: client.squad && client.squad.id === q.id || null }, q.name)));
      const mg = h('select', { 'aria-label': 'Gestor' }, people.map((p) => h('option', { value: p.id, selected: client.manager && client.manager.id === p.id || null }, p.display_name)));
      const why = h('select', { 'aria-label': 'Tipo' }, h('option', { value: 'TRANSFER' }, 'Troca de gestor'), h('option', { value: 'CORRECTION' }, 'Correção de cadastro'));
      const note = h('input', { maxlength: 1000, placeholder: 'Por quê (5 caracteres ou mais)', 'aria-label': 'Nota' });
      parts.push(h('form', { class: 'box', onsubmit: async (ev) => {
        ev.preventDefault();
        try { await api('POST', 'clients/' + client.id + '/transfers', { to_squad_id: Number(sq.value), to_manager_user_id: Number(mg.value), reason: why.value, note: note.value, version: client.version },
          { 'Idempotency-Key': 'ui-tr-' + client.id + '-' + client.version }); toast('Gestor alterado.'); rerender(); } catch (e) { toast(e.message, true); }
      } }, h('b', {}, 'Squad e gestor'), h('div', { class: 'row', style: 'margin-top:8px;gap:8px;flex-wrap:wrap' }, sq, mg, why, note, h('button', { type: 'submit' }, 'Trocar'))));
    }
    return parts.length ? h('div', { class: 'editbox' }, ...parts) : empty('Seu perfil não edita esta ficha.');
  }

  // ---------- daily ----------
  // Abrir o dia (hoje) e o pente fino do fim do dia (ontem por padrão depois das 17h): agenda, reuniões gravadas e tarefas,
  // por squad e por pessoa, com as ações ali mesmo.
  let dailyDate = null;
  let dailySquad = (() => { try { return sessionStorage.getItem('cc_daily_squad') || ''; } catch (e) { return ''; } })();
  let dailyPerson = (() => { try { return sessionStorage.getItem('cc_daily_person') || ''; } catch (e) { return ''; } })();
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  let dailyTab = 'due';
  async function renderDaily() {
    const today = todaySP();
    if (!dailyDate) dailyDate = today;
    const qs = 'date=' + dailyDate + (dailySquad ? '&squad_id=' + dailySquad : '') + (dailyPerson ? '&owner_id=' + dailyPerson : '');
    const [d, squads, people, board] = await Promise.all([api('GET', 'daily?' + qs).then((r) => r.data), squadsList(), team(),
      can('clients.read') ? api('GET', 'clients/board' + (dailySquad ? '?squad_id=' + dailySquad : '')).then((r) => r.data).catch(() => null) : null]);
    const save = () => { try { sessionStorage.setItem('cc_daily_squad', dailySquad); sessionStorage.setItem('cc_daily_person', dailyPerson); } catch (e) { /* sem armazenamento */ } };
    const label = dailyDate === today ? 'Hoje' : dailyDate === addDays(today, -1) ? 'Ontem' : dailyDate === addDays(today, 1) ? 'Amanhã' : fmtDay(dailyDate);
    const dateIn = h('input', { type: 'date', value: dailyDate, 'aria-label': 'Dia' });
    dateIn.addEventListener('change', () => { if (dateIn.value) { dailyDate = dateIn.value; renderDaily(); } });
    const go = (n) => { dailyDate = addDays(dailyDate, n); renderDaily(); };
    const person = h('select', { 'aria-label': 'Pessoa' }, h('option', { value: '' }, 'Todas as pessoas'),
      people.filter((p) => !dailySquad || p.squads.includes((squads.find((q) => String(q.id) === dailySquad) || {}).code)).map((p) => h('option', { value: p.id, selected: String(p.id) === dailyPerson || null }, p.display_name)));
    person.addEventListener('change', () => { dailyPerson = person.value; save(); renderDaily(); });
    const refresh = () => renderDaily();
    const t = d.tasks;
    const clientLinks = (cs) => cs.length ? cs.map((c, i) => [i ? ', ' : '', h('a', { href: '#/cliente/' + c.id }, c.trade_name)]).flat() : [h('span', { class: 'muted' }, 'sem cliente ligada')];
    const past = (iso) => new Date(iso) < new Date();
    const agenda = d.agenda.map((m) => h('div', { class: 'qrow' },
      h('div', { class: 'qmain' }, h('div', { class: 'row', style: 'gap:8px' }, h('b', {}, m.has_time ? hhmm(m.start) : 'dia todo'), h('span', {}, m.title || 'Reunião'),
        m.status ? badge(m.status, m.status === 'Realizada' ? 'b-ok' : m.status === 'No show' ? 'b-bad' : '') : null),
        h('div', { class: 'small muted' }, ...clientLinks(m.clients), m.clients[0] && m.clients[0].manager ? ' · ' + m.clients[0].manager.display_name : '')),
      h('div', { class: 'qact' }, m.recorded_id ? badge('gravada', 'b-ok') : past(m.start) ? badge('sem gravação', 'b-warn') : badge('a fazer', ''),
        m.url ? h('a', { class: 'small', href: m.url, target: '_blank', rel: 'noopener' }, 'Notion ↗') : null)));
    const recorded = d.recorded.map((m) => h('details', { class: 'meet' },
      h('summary', {}, h('b', {}, hhmm(m.started_at)), ' · ', m.title || 'Reunião', ' · ', ...clientLinks(m.clients)),
      m.participants.length ? h('p', { class: 'small muted' }, 'Participantes: ' + m.participants.join(', ')) : null,
      h('p', { class: 'small' }, m.summary || 'Sem resumo do gravador.'),
      m.next_steps.length ? h('div', {}, h('p', { class: 'small', style: 'margin:6px 0 2px' }, h('b', {}, 'Próximos passos ditos na call')),
        h('ul', { class: 'small' }, ...m.next_steps.map((st) => h('li', {}, st, m.clients[0] && can('work.write') ? h('button', { type: 'button', class: 'linkbtn', style: 'margin-left:6px', onclick: async (ev) => {
          const li = ev.currentTarget.parentElement;
          li.append(await taskComposer({ id: m.clients[0].id, manager: m.clients[0].manager }, refresh, { title: st.slice(0, 200), origin: 'MEETING' }));
          ev.currentTarget.remove();
        } }, 'virar tarefa') : null)))) : null));
    const sec = (title, n, list, cls, hint) => h('section', { class: 'card' }, h('h2', {}, title, h('span', { class: 'badge ' + (cls || '') }, String(n))), hint ? h('p', { class: 'hint' }, hint) : null,
      n ? list : empty('Nada aqui.'));
    const row = (w) => taskRow(w, w.allowed_actions.includes('REVIEW'), refresh, { showEvidence: true });
    // Comercial (DT-178): a jornada da carteira, a mesma visão da página Comercial do Notion. Mover de coluna aqui grava na ficha.
    const commercial = (() => {
      if (!board) return null;
      const mine = (c) => !dailyPerson || (c.client && c.client.manager && String(c.client.manager.id) === dailyPerson);
      const cols = board.columns.map((c) => ({ label: c.label, clients: c.clients.filter(mine) })).filter((c) => c.clients.length);
      const calm = cols.filter((c) => /ativos/i.test(c.label));
      const watch = cols.filter((c) => !/ativos/i.test(c.label));
      const total = cols.reduce((n, c) => n + c.clients.length, 0);
      const mover = (card, from) => {
        const sel = h('select', { class: 'mini-sel', 'aria-label': 'Mover na jornada' }, h('option', { value: '' }, 'Mover…'), board.journeys.filter((j) => j !== from).map((j) => h('option', { value: j }, j)));
        sel.addEventListener('change', async () => {
          const to = sel.value; if (!to) return;
          if (!(await confirmBox('Mudar a jornada', 'Mover ' + (card.client ? card.client.trade_name : card.name) + ' de "' + from + '" para "' + to + '"?', 'Mover'))) { sel.value = ''; return; }
          try { await api('POST', 'clients/board/move', { notion_id: card.notion_id, journey: to }); toast('Jornada atualizada.'); refresh(); } catch (e) { toast(e.message, true); sel.value = ''; }
        });
        return sel;
      };
      const line = (c, col) => h('div', { class: 'qrow' },
        h('div', { class: 'qmain' }, c.client ? h('a', { href: '#/cliente/' + c.client.id }, h('b', {}, c.client.trade_name)) : h('b', {}, c.name),
          h('div', { class: 'small muted' }, [c.client && c.client.manager ? c.client.manager.display_name : (c.managers_in_notion.join(', ') || 'sem gestor'),
            c.tenure_days !== null ? tenure(c.tenure_days) : null, c.cycle_end ? 'fim do ciclo ' + fmtDay(c.cycle_end) : null].filter(Boolean).join(' · '))),
        c.can_move ? h('div', { class: 'qact' }, mover(c, col)) : null);
      return h('section', { class: 'card' }, h('h2', {}, 'Comercial · jornada da carteira', h('span', { class: 'badge' }, String(total))),
        h('p', { class: 'hint' }, 'Quem está em onboarding, quem é nova, quem pede atenção e quem está saindo. Mover de coluna aqui atualiza a ficha.'),
        h('div', { class: 'qsum' }, cols.map((c) => h('div', {}, h('div', { class: 'big' }, String(c.clients.length)), h('div', { class: 'small muted' }, c.label)))),
        ...watch.map((c) => h('details', { open: /onboarding|cr[ií]tic|risco|aviso/i.test(c.label) || null, style: 'margin-top:8px' },
          h('summary', {}, h('b', {}, c.label), ' (' + c.clients.length + ')'), ...c.clients.map((x) => line(x, c.label)))),
        ...calm.map((c) => h('details', { style: 'margin-top:8px' }, h('summary', {}, h('b', {}, c.label), ' (' + c.clients.length + ')'), ...c.clients.map((x) => line(x, c.label)))));
    })();
    const isPast = dailyDate < today;
    const done = t.done;
    const toCheck = done.filter((w) => w.state === 'EVIDENCE_SUBMITTED');
    const commercialCount = commercial ? Number(commercial.querySelector('.badge').textContent) : 0;
    const tabs = [['due', isPast ? 'Ficaram abertas' : 'Para fazer', t.due.length], ['overdue', 'Atrasadas', t.overdue.length], ['done', 'Feitas', done.length],
      ['agenda', 'Agenda', d.agenda.length], ['recorded', 'Gravadas', d.recorded.length], ['journey', 'Jornada', commercialCount]];
    dailyTab = pickValid(tabs, dailyTab);
    const pane = { due: () => h('section', { class: 'card' }, t.due.map(row)), overdue: () => h('section', { class: 'card' }, t.overdue.map(row)),
      done: () => h('section', { class: 'card' }, toCheck.length ? h('p', { class: 'lead' }, toCheck.length + ' esperando conferência.') : null, done.map(row)),
      agenda: () => h('section', { class: 'card' }, agenda), recorded: () => h('section', { class: 'card' }, recorded), journey: () => commercial }[dailyTab];
    view.replaceChildren(
      h('div', { class: 'ov-head' }, h('div', {}, h('h1', {}, 'Daily · ' + label), h('p', { class: 'sub', style: 'margin:0' }, isPast ? 'O que estava marcado e o que ficou para trás.' : 'O que colocar em prática no dia.')),
        h('span', { class: 'spacer' }),
        h('div', { class: 'seg' }, h('button', { type: 'button', 'aria-label': 'Dia anterior', onclick: () => go(-1) }, '‹'), h('button', { type: 'button', class: dailyDate === addDays(today, -1) ? 'on' : '', onclick: () => { dailyDate = addDays(today, -1); renderDaily(); } }, 'Ontem'),
          h('button', { type: 'button', class: dailyDate === today ? 'on' : '', onclick: () => { dailyDate = today; renderDaily(); } }, 'Hoje'), h('button', { type: 'button', 'aria-label': 'Próximo dia', onclick: () => go(1) }, '›')), dateIn),
      h('div', { class: 'toolbar' }, squads.length > 1 ? squadSeg(squads, dailySquad, (v) => { dailySquad = v; dailyPerson = ''; save(); renderDaily(); }) : h('span'), person),
      listPicker(tabs, dailyTab, (id) => { dailyTab = id; renderDaily(); }),
      pane ? pane() : card('Dia tranquilo', empty('Nada neste dia.')),
      t.created.length ? foldCard('Criadas no dia · ' + t.created.length, t.created.map(row)) : h('span'));
  }

  // ---------- 1:1 ----------
  // Funil da carteira por gestor: o head abre o gestor, passa cliente a cliente dando verde, amarelo ou vermelho com uma nota,
  // e o que vira ação ganha prazo. A nota vai para a ficha da cliente; a ação vira pendência do gestor que só fecha com o ok do head.
  const COLOR = { RED: ['vermelho', 'tag-red', 'bad'], YELLOW: ['amarelo', 'tag-yellow', 'warn'], GREEN: ['verde', 'tag-green', 'ok'] };
  const dot = (c) => h('span', { class: 'dot dot-' + (c ? c.toLowerCase() : 'none'), title: c ? COLOR[c][0] : 'sem avaliação' });
  async function renderOneOnOnes() {
    const d = (await api('GET', 'one-on-ones/managers')).data;
    const bySquad = {};
    d.managers.forEach((m) => { (bySquad[m.squad || 'Sem squad'] = bySquad[m.squad || 'Sem squad'] || []).push(m); });
    const since = (iso) => {
      if (!iso) return ['nunca', 'tag-red'];
      const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
      return [days === 0 ? 'hoje' : 'há ' + days + 'd', days > 14 ? 'tag-red' : days > 7 ? 'tag-yellow' : 'tag-gray'];
    };
    const bar = (m) => {
      const none = Math.max(0, m.clients - m.red - m.yellow - m.green);
      return h('div', { class: 'sembar', title: m.red + ' vermelho, ' + m.yellow + ' amarelo, ' + m.green + ' verde, ' + none + ' sem avaliação' },
        [['red', m.red], ['yellow', m.yellow], ['green', m.green], ['none', none]].filter(([, n]) => n > 0).map(([k, n]) => h('span', { class: 'seg-' + k, style: 'flex:' + n })));
    };
    const cardFor = (m) => {
      const s0 = since(m.last_one_on_one);
      return h('button', { type: 'button', class: 'tile mgr', onclick: () => { location.hash = '#/1a1/' + m.user_id; } },
        h('div', { class: 'row', style: 'gap:8px' }, h('b', { style: 'font-size:15px' }, m.name), h('span', { class: 'spacer' }), h('span', { class: 'badge ' + s0[1] }, '1:1 ' + s0[0])),
        h('div', { class: 'small muted', style: 'margin:4px 0 10px' }, m.clients + ' clientes ativas' + (m.score !== null ? ' · nota ' + nf(m.score, 1) : '')),
        bar(m),
        h('div', { class: 'row small', style: 'gap:12px;margin-top:10px' },
          h('span', {}, dot('RED'), ' ', String(m.red)), h('span', {}, dot('YELLOW'), ' ', String(m.yellow)), h('span', {}, dot('GREEN'), ' ', String(m.green)),
          h('span', { class: 'spacer' }),
          m.open_actions ? h('span', { class: m.late_actions ? 'chip bad' : 'chip info' }, m.open_actions + ' ação(ões)' + (m.late_actions ? ', ' + m.late_actions + ' atrasada(s)' : '')) : h('span', { class: 'muted' }, 'sem ação aberta')));
    };
    view.replaceChildren(
      h('div', { class: 'ov-head' }, h('div', {}, h('h1', {}, '1:1'),
        h('p', { class: 'sub', style: 'margin:0' }, 'Abra o gestor para conduzir o 1:1.'))),
      h('div', { style: 'height:18px' }),
      ...(d.managers.length ? Object.entries(bySquad).map(([sq, list]) => h('section', { class: 'card' }, h('h2', {}, sq, h('span', { class: 'badge' }, String(list.length))),
        h('div', { class: 'tiles', style: 'margin:0' }, list.map(cardFor)))) : [card('Nenhum gestor', empty('Nenhum gestor no seu acesso.'))]));
  }

  async function renderOneOnOne(userId) {
    const d = (await api('GET', 'one-on-ones/managers/' + userId)).data;
    const axes = Object.entries(d.axes);
    const picks = {};
    const scores = {};
    let filter = '';
    const hours = (h0) => h0 >= 48 ? Math.floor(h0 / 24) + ' dias' : Math.round(h0) + 'h';
    const context = (c) => [
      c.at_risk && c.journey ? h('span', { class: 'chip bad' }, c.journey.replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase()) : null,
      c.waiting_h !== null && c.waiting_h >= 4 ? h('span', { class: 'chip warn' }, 'esperando ' + hours(c.waiting_h)) : null,
      ...(c.signals || []).filter((x) => SIGNAL_LABEL[x]).map((x) => h('span', { class: 'chip ' + (['risco_de_saida', 'insatisfacao'].includes(x) ? 'bad' : 'warn') }, SIGNAL_LABEL[x])),
      c.low_balance ? h('span', { class: 'chip bad' }, 'saldo baixo') : null,
      c.no_delivery ? h('span', { class: 'chip warn' }, 'sem entrega') : null,
      c.cpc_7d !== null && c.cpc_7d > 7 ? h('span', { class: 'chip warn' }, brl2(c.cpc_7d) + ' por conversa') : null,
      c.cycle_days !== null && c.cycle_days >= 0 && c.cycle_days <= 15 ? h('span', { class: 'chip info' }, 'ciclo em ' + c.cycle_days + 'd') : null].filter(Boolean);
    const flagged = (c) => context(c).length > 0 || (c.last && c.last.color !== 'GREEN');
    // Quem tem sinal ou ficou vermelho/amarelo da última vez aparece primeiro.
    const rank = (c) => (c.last && c.last.color === 'RED' ? 0 : 2) + (c.at_risk ? 0 : 1) + (context(c).length ? 0 : 2) + (c.last && c.last.color === 'YELLOW' ? 0 : 1);
    const portfolio = d.portfolio.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    filter = portfolio.some(flagged) ? 'sinal' : 'todas';

    const list = h('div', { class: 'qlist' });
    const counter = h('span', { class: 'badge' });
    const rowFor = (c) => {
      const p = picks[c.client_id];
      const note = h('textarea', { rows: 2, maxlength: 4000, placeholder: 'O que foi falado desta cliente (vai para a ficha)', oninput: (e) => { picks[c.client_id].note = e.target.value; } });
      const act = h('input', { maxlength: 500, placeholder: 'Ação combinada (opcional): vira pendência do gestor', oninput: (e) => { picks[c.client_id].action = e.target.value; } });
      const due = h('input', { type: 'date', 'aria-label': 'Prazo da ação', oninput: (e) => { picks[c.client_id].action_due = e.target.value; } });
      if (p) { note.value = p.note || ''; act.value = p.action || ''; due.value = p.action_due || ''; }
      const btns = h('div', { class: 'sembtns' }, ['GREEN', 'YELLOW', 'RED'].map((k) => h('button', { type: 'button', class: 'sb sb-' + k.toLowerCase() + (p && p.color === k ? ' on' : ''), title: COLOR[k][0],
        onclick: () => {
          if (picks[c.client_id] && picks[c.client_id].color === k) delete picks[c.client_id];
          else picks[c.client_id] = Object.assign(picks[c.client_id] || { note: '', action: '', action_due: '' }, { color: k });
          draw();
        } }, COLOR[k][0])));
      return h('div', { class: 'oorow' + (p ? ' picked' : '') },
        h('div', { class: 'qrow', style: 'border-bottom:0' },
          h('div', { class: 'qmain' }, h('div', { class: 'row', style: 'gap:8px' }, dot(c.last ? c.last.color : null), h('a', { href: '#/cliente/' + c.client_id, target: '_blank', rel: 'noopener' }, h('b', {}, c.name))),
            c.last ? h('div', { class: 'small muted', style: 'margin-top:3px' }, 'Último 1:1 (' + fmtDay(c.last.at.slice(0, 10)) + '): ' + c.last.note) : h('div', { class: 'small muted', style: 'margin-top:3px' }, 'Nunca discutida em 1:1.'),
            context(c).length ? h('div', { class: 'chips' }, context(c)) : null),
          h('div', { class: 'qact' }, btns)),
        p ? h('div', { class: 'oodetail' }, note, h('div', { class: 'row', style: 'gap:8px;margin-top:6px' }, act, due)) : null);
    };
    const filters = h('div', { class: 'seg' });
    function draw() {
      const shown = portfolio.filter((c) => filter === 'todas' || picks[c.client_id] || (filter === 'sinal' ? flagged(c) : !c.last));
      filters.replaceChildren(...[['sinal', 'Com sinal (' + portfolio.filter(flagged).length + ')'], ['nunca', 'Nunca discutidas (' + portfolio.filter((c) => !c.last).length + ')'], ['todas', 'Todas (' + portfolio.length + ')']]
        .map(([k, t]) => h('button', { type: 'button', class: filter === k ? 'on' : '', onclick: () => { filter = k; draw(); } }, t)));
      list.replaceChildren(...(shown.length ? shown.map(rowFor) : [empty('Nenhuma cliente neste filtro.')]));
      counter.textContent = Object.keys(picks).length + ' discutida(s)';
    }
    draw();

    const scoreRow = ([k, label]) => {
      const seg = h('div', { class: 'seg' });
      const paint = () => seg.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: scores[k] === n ? 'on' : '', onclick: () => { scores[k] = scores[k] === n ? undefined : n; paint(); } }, String(n))));
      paint();
      return h('div', { class: 'qrow', style: 'padding:6px' }, h('div', { class: 'qmain' }, label), seg);
    };
    const summary = h('textarea', { rows: 3, maxlength: 4000, placeholder: 'Resumo do 1:1: como está a carteira, o que travou, o que ficou combinado (10 caracteres ou mais)' });
    const promised = h('textarea', { rows: 2, maxlength: 2000, placeholder: 'O que ele(a) prometeu no último 1:1 (opcional)' });
    const executed = h('textarea', { rows: 2, maxlength: 2000, placeholder: 'O que foi executado disso (opcional)' });
    const save = h('button', { type: 'submit' }, 'Registrar 1:1');
    const key = 'ui-1on1-' + userId + '-' + Date.now();
    const form = h('form', { onsubmit: async (ev) => {
      ev.preventDefault();
      const items = Object.entries(picks).map(([cid, p]) => ({ client_id: Number(cid), color: p.color, note: (p.note || '').trim(), action: (p.action || '').trim() || null, action_due: p.action_due || null }));
      const bad = items.find((i) => i.note.length < 3) || items.find((i) => i.action && !i.action_due);
      if (bad) { toast(bad.note.length < 3 ? 'Toda cliente marcada precisa de uma nota.' : 'Ação combinada precisa de prazo.', true); return; }
      const sc = Object.fromEntries(Object.entries(scores).filter(([, v]) => v));
      save.disabled = true;
      try {
        const r = (await api('POST', 'one-on-ones/sessions', { person_user_id: userId, summary: summary.value, promised_last_time: promised.value.trim() || null, executed: executed.value.trim() || null,
          scores: sc, items }, { 'Idempotency-Key': key })).data;
        toast('1:1 registrado: ' + r.items + ' cliente(s) na ficha, ' + r.actions + ' ação(ões) em Pendências esperando o seu ok.');
        renderOneOnOne(userId);
      } catch (e) { save.disabled = false; toast(e.message, true); }
    } },
    h('section', { class: 'card' }, h('div', { class: 'row', style: 'margin-bottom:6px' }, h('h2', { style: 'margin:0' }, 'Carteira', counter), h('span', { class: 'spacer' }), filters),
      h('p', { class: 'hint' }, 'Marque a cor das clientes discutidas e escreva a nota.'), list),
    h('div', { class: 'grid' },
      h('section', { class: 'card span-6' }, h('h2', {}, 'Qualificação do gestor'), h('p', { class: 'hint' }, 'De 1 a 5. Só head e direção veem.'), axes.map(scoreRow)),
      h('section', { class: 'card span-6' }, h('h2', {}, 'Resumo'), summary, h('div', { style: 'height:8px' }), promised, h('div', { style: 'height:8px' }), executed,
        h('div', { class: 'row', style: 'margin-top:12px' }, h('span', { class: 'spacer' }), save))));

    const okAction = async (a) => {
      try { await api('POST', 'work-items/' + a.work_item_id + '/transition', { to_state: 'VERIFIED', version: a.version }); toast('Ok dado: ação encerrada.'); renderOneOnOne(userId); } catch (e) { toast(e.message, true); }
    };
    const actions = d.actions.length ? h('section', { class: 'card' }, h('h2', {}, 'Ações combinadas em aberto', h('span', { class: 'badge' }, String(d.actions.length))),
            h('div', { class: 'qlist' }, d.actions.map((a) => h('div', { class: 'qrow' + (a.late ? ' late' : '') },
        h('div', { class: 'qmain' }, h('div', { class: 'row', style: 'gap:8px' }, dot(a.color), h('b', {}, a.title)),
          h('div', { class: 'small muted', style: 'margin-top:2px' }, h('a', { href: '#/cliente/' + a.client_id }, a.client), ' · prazo ' + fmtDay(a.due_at.slice(0, 10)))),
        h('div', { class: 'qact' }, a.state === 'EVIDENCE_SUBMITTED' ? h('button', { type: 'button', onclick: () => okAction(a) }, 'Dar o ok')
          : h('span', { class: 'badge ' + (a.late ? 'tag-red' : 'tag-gray') }, a.late ? 'atrasada' : (WSTATE[a.state] || a.state))))))) : null;

    const history = d.history.length ? foldCard('Histórico de 1:1 · ' + d.history.length,
      d.history.map((s0) => {
        const vals = Object.values(s0.scores);
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        return h('details', { class: 'more' }, h('summary', {}, h('b', {}, fmtDay(s0.held_at.slice(0, 10))), ' · ' + s0.items.length + ' cliente(s)', avg !== null ? ' · nota ' + nf(avg, 1) : '', ' · com ' + s0.reviewer),
          h('div', { class: 'box' }, h('div', {}, s0.summary),
            s0.promised_last_time ? h('div', { class: 'small', style: 'margin-top:6px' }, h('span', { class: 'muted' }, 'Prometido: '), s0.promised_last_time) : null,
            s0.executed ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Executado: '), s0.executed) : null,
            vals.length ? h('div', { class: 'chips' }, Object.entries(s0.scores).map(([k, v]) => h('span', { class: 'chip' }, (d.axes[k] || k) + ' ' + v))) : null),
          s0.items.map((i) => h('div', { class: 'qrow', style: 'padding:6px' }, h('div', { class: 'qmain' }, h('div', { class: 'row', style: 'gap:8px' }, dot(i.color), h('a', { href: '#/cliente/' + i.client_id }, i.client)),
            h('div', { class: 'small', style: 'margin-top:2px' }, i.note), i.action ? h('div', { class: 'small muted' }, 'Ação: ' + i.action + ' (até ' + fmtDay(i.action_due) + ')' + (i.done ? ' · ok dado' : '')) : null))));
      })) : null;

    const red = d.portfolio.filter((c) => c.last && c.last.color === 'RED').length;
    const lastAt = d.history[0] ? d.history[0].held_at : null;
    view.replaceChildren(...[
      h('div', { class: 'crumbs' }, h('a', { href: '#/1a1' }, '1:1'), h('span', {}, ' / '), h('span', {}, d.manager.name)),
      h('h1', {}, d.manager.name),
      h('p', { class: 'sub' }, [d.manager.squad, d.portfolio.length + ' clientes ativas', red + ' no vermelho', lastAt ? 'último 1:1 em ' + fmtDay(lastAt.slice(0, 10)) : 'nenhum 1:1 registrado'].filter(Boolean).join(' · ')),
      actions, form, history].filter(Boolean));
  }

  // Semáforo dos 1:1 na ficha (head e direção).
  async function oneOnOneCard(client) {
    if (!can('people.read')) return;
    let rows;
    try { rows = (await api('GET', 'clients/' + client.id + '/one-on-ones')).data; } catch (e) { return; }
    if (!rows.length) return;
    slot('oneonone', card('Nos 1:1', h('div', { class: 'qlist' }, rows.slice(0, 6).map((r) => h('div', { class: 'qrow', style: 'padding:6px' },
      h('div', { class: 'qmain' }, h('div', { class: 'row', style: 'gap:8px' }, dot(r.color), h('b', {}, fmtDay(r.held_at.slice(0, 10))), h('span', { class: 'small muted' }, r.manager + ' com ' + r.reviewer)),
        h('div', { class: 'small', style: 'margin-top:2px' }, r.note), r.action ? h('div', { class: 'small muted' }, 'Ação: ' + r.action + ' (até ' + fmtDay(r.action_due) + ')') : null))))));
  }

  // ---------- comercial ----------
  async function renderSales() {
    const p = (await api('GET', 'sales/pipeline')).data;
    const deals = await api('GET', 'sales/deals?per_page=50');
    const STAGES = { LEAD: 'lead', QUALIFIED: 'qualificado', PROPOSAL: 'proposta', NEGOTIATION: 'negociação', CLOSING: 'fechamento', OPEN: 'aberto', WON: 'ganho', LOST: 'perdido' };
    const STAGE = (x) => { const c = x && typeof x === 'object' ? (x.code || '') : String(x); return (x && x.label) || STAGES[c.toUpperCase()] || c.replace(/_/g, ' ').toLowerCase(); };
    const money = (v) => v === null ? (p.amounts_visibility === 'RESTRICTED' ? 'valor restrito' : 'sem valor') : brl(v);
    const funnel = h('table', {}, h('tbody', {}, p.open_by_stage.map((x) => h('tr', {}, h('td', {}, STAGE(x.stage)), h('td', {}, h('b', {}, String(x.deals))), h('td', { class: 'small muted', style: 'text-align:right' }, money(x.expected_amount))))));
    const closedKpi = (lbl, m) => h('div', { class: 'kpi' }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val' }, m.value === null || m.value === undefined ? 'sem dado' : String(m.value)));
    const rows = deals.data.map((d) => h('tr', {},
      h('td', {}, h('b', {}, d.title), d.client ? h('div', { class: 'small muted' }, d.client.trade_name) : null),
      h('td', {}, STAGE(d.stage)), h('td', {}, d.outcome ? STAGE(d.outcome) : 'aberto'), h('td', {}, d.owner ? d.owner.display_name : 'sem dono')));
    const list = rows.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Negócio', 'Etapa', 'Desfecho', 'Responsável'].map((t) => h('th', {}, t)))), h('tbody', {}, rows)) : empty('Nenhum negócio no seu acesso.');
    view.replaceChildren(h('h1', {}, 'Comercial'), h('p', { class: 'sub' }, 'Funil e negócios.'),
      h('div', { class: 'kpis' }, closedKpi('Ganhos com contrato', p.closed.WON_CONTRACT_CONFIRMED), closedKpi('Ganhos sem contrato', p.closed.WON_WITHOUT_CONTRACT), closedKpi('Perdidos', p.closed.LOST)),
      h('div', { class: 'grid', style: 'margin-bottom:18px' }, h('div', { class: 'span-5' }, card('Funil aberto', funnel)), h('div', { class: 'span-7' }, card('Negócios', list))),
      foldCard('Origem dos dados', h('p', { class: 'small muted' }, [p.note, 'Fonte: ' + p.source.provider + ' (' + p.source.reader + ').', p.source.note].filter(Boolean).join(' '))));
  }

  // ---------- reuniões (DT-178) ----------
  let mtState = (() => { try { return JSON.parse(sessionStorage.getItem('cc_mt') || '{}'); } catch (e) { return {}; } })();
  async function renderMeetings() {
    const st = Object.assign({ days: 14, status: 'all', squad: '', q: '' }, mtState);
    const save = () => { mtState = st; try { sessionStorage.setItem('cc_mt', JSON.stringify(st)); } catch (e) { /* sem armazenamento */ } };
    const to = todaySP();
    const from = new Date(Date.now() - 3 * 3600000 - (st.days - 1) * 86400000).toISOString().slice(0, 10);
    const qs = '?from=' + from + '&to=' + to + (st.squad ? '&squad_id=' + st.squad : '');
    const r = (await api('GET', 'recorded-meetings' + qs)).data;
    const squads = await squadsList();
    const seg = (opts, cur, set) => h('div', { class: 'seg' }, opts.map(([v, t]) => h('button', { type: 'button', class: String(cur) === String(v) ? 'on' : '', onclick: () => { set(v); save(); renderMeetings(); } }, t)));
    const LBL = { linked: ['com cliente', 'tag-green'], pending: ['sem cliente', 'tag-yellow'], internal: ['interna', ''] };
    const search = h('input', { type: 'search', placeholder: 'Buscar por cliente, título ou pessoa', value: st.q, style: 'min-width:260px' });
    const listBox = h('div');
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const draw = () => {
      const q = norm(search.value);
      const items = r.items.filter((m) => (st.status === 'all' || m.status === st.status)
        && (!q || norm([m.title, m.client ? m.client.trade_name : '', m.participants.join(' ')].join(' ')).includes(q)));
      let lastDay = '';
      const nodes = [];
      for (const m of items) {
        const day = m.started_at.slice(0, 10);
        if (day !== lastDay) { nodes.push(h('h3', { class: 'dayhead' }, fmtDay(day))); lastDay = day; }
        const [lt, lc] = LBL[m.status];
        const cl = m.client;
        nodes.push(h('details', { class: 'meet card' },
          h('summary', {}, h('div', { class: 'row', style: 'gap:8px' }, h('b', {}, fmt(m.started_at).slice(-5)), h('span', {}, m.title || 'Reunião sem título'), h('span', { class: 'badge ' + lc }, lt),
            cl ? h('a', { href: '#/cliente/' + cl.id, onclick: (e) => e.stopPropagation() }, cl.trade_name) : null,
            cl && cl.manager ? h('span', { class: 'small muted' }, cl.manager.display_name) : null)),
          m.participants.length ? h('p', { class: 'small muted' }, 'Participantes: ' + m.participants.join(', ')) : null,
          h('p', { class: 'small' }, m.summary || 'Sem resumo do gravador.'),
          m.next_steps.length ? h('div', {}, h('p', { class: 'small', style: 'margin:6px 0 2px' }, h('b', {}, 'Próximos passos')),
            h('ul', { class: 'small' }, ...m.next_steps.map((stp) => h('li', {}, stp, cl && can('work.write') ? h('button', { type: 'button', class: 'linkbtn', style: 'margin-left:6px', onclick: async (ev) => {
              const li = ev.currentTarget.parentElement;
              li.append(await taskComposer({ id: cl.id, manager: cl.manager }, () => toast('Tarefa criada na ficha de ' + cl.trade_name + '.'), { title: stp.slice(0, 200), origin: 'MEETING' }));
              ev.currentTarget.remove();
            } }, 'virar tarefa') : null)))) : null,
          h('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
            cl ? h('a', { class: 'small', href: '#/cliente/' + cl.id }, 'Abrir a ficha de ' + cl.trade_name + ' →') : null,
            m.can_reclassify ? h('button', { type: 'button', class: m.status === 'pending' ? '' : 'ghost', onclick: () => reclassifyMeeting(m, cl ? cl.trade_name : null, renderMeetings) },
              m.status === 'pending' ? 'Dizer de quem é' : 'Mudar a cliente') : null)));
      }
      listBox.replaceChildren(...(nodes.length ? nodes : [empty('Nenhuma reunião com esse filtro.')]));
    };
    search.addEventListener('input', () => { st.q = search.value; save(); draw(); });
    const c = r.counts;
    view.replaceChildren(h('h1', {}, 'Reuniões'),
      h('p', { class: 'sub' }, 'Reuniões gravadas.'),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-bottom:12px' },
        seg([[7, '7 dias'], [14, '14 dias'], [30, '30 dias'], [60, '60 dias']], st.days, (v) => { st.days = v; }),
        seg([['all', 'Todas (' + (c.linked + c.pending + c.internal) + ')'], ['linked', 'Com cliente (' + c.linked + ')'], ['pending', 'Sem cliente (' + c.pending + ')'], ['internal', 'Internas (' + c.internal + ')']], st.status, (v) => { st.status = v; }),
        squads.length ? seg([['', 'Todas as squads'], ...squads.map((q) => [q.id, q.name])], st.squad, (v) => { st.squad = v; }) : null,
        search),
      listBox);
    draw();
  }

  // ---------- senha ----------
  function renderPassword() {
    // No primeiro acesso a senha atual é a provisória que a pessoa acabou de digitar: não pede de novo.
    const firstAccess = !!(me && me.must_change_password && provisional);
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: !firstAccess });
    const nw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 12, required: true });
    const cf = h('input', { type: 'password', autocomplete: 'new-password', minlength: 12, required: true });
    const btn = h('button', { type: 'submit' }, firstAccess ? 'Salvar e entrar' : 'Trocar senha');
    view.replaceChildren(h('form', { class: 'card login', onsubmit: async (ev) => {
      ev.preventDefault();
      btn.disabled = true;
      const username = me.username;
      const newPassword = nw.value;
      try {
        await api('POST', 'auth/change-password', { current_password: firstAccess ? provisional : cur.value, new_password: newPassword, new_password_confirmation: cf.value });
      } catch (e) { btn.disabled = false; toast(e.message, true); return; }
      // A troca encerra todas as sessões; entra de novo sozinho com a senha nova, sem pedir para digitar.
      provisional = null;
      try {
        const r = await api('POST', 'auth/login', { username, password: newPassword, device_label: 'interface-web' });
        sessionStorage.setItem('cc_token', r.data.access_token);
        me = null;
        await loadMe();
        toast('Senha salva. Nas próximas vezes, entre com ela.');
        const next = can('radar.read') ? '#/hoje' : '#/carteira';
        if (location.hash === next) route(); else location.hash = next;
      } catch (e) { toast('Senha salva. Entre de novo com a senha nova.'); logout(); }
    } }, h('h1', {}, firstAccess ? 'Crie sua senha' : 'Trocar senha'),
    firstAccess ? h('p', { class: 'notice' }, 'Primeiro acesso: a senha provisória só vale uma vez. Crie a sua agora; é ela que você vai usar daqui para frente.') : null,
    h('p', { class: 'sub' }, '12 caracteres ou mais, sem o seu usuário e sem palavras óbvias como senha, alcansee, admin ou 123456.'),
    firstAccess ? null : field(me && me.must_change_password ? 'Senha provisória' : 'Senha atual', cur),
    field('Senha nova', nw), field('Repita a senha nova', cf),
    h('div', { style: 'margin-top:16px' }, btn)));
  }

  // ---------- roteador ----------
  // Início: painel geral para quem lê relatório da agência, senão o radar do dia, senão a carteira.
  const home = () => can('reports.read') ? '#/painel' : can('radar.read') ? '#/hoje' : '#/carteira';
  async function route() {
    if (!token()) { renderLogin(); return; }
    if (!me) { try { await loadMe(); } catch (e) { renderLogin(); return; } }
    const hash = location.hash && location.hash !== '#/' ? location.hash : home();
    let [, page, id] = hash.split('/');
    if (me.must_change_password) page = 'senha';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (page === 'cliente' ? 'carteira' : page)));
    view.classList.toggle('wide', page === 'painel' || page === 'carteira' || page === 'hoje' || page === '1a1' || page === 'daily' || page === 'reunioes' || (!page && home() === '#/painel'));
    view.replaceChildren(empty('Carregando...'));
    try {
      if (page === 'cliente' && /^\d+$/.test(id || '')) { await renderClient(Number(id)); openPendingEdit(); }
      else if (page === 'painel') await renderOverview();
      else if (page === 'conciliacao') await renderReconciliation();
      else if (page === 'fontes') await renderSources();
      else if (page === 'caixa') await renderInbox();
      else if (page === 'hoje') await renderToday();
      else if (page === 'pendencias') await renderWork();
      else if (page === 'daily') await renderDaily();
      else if (page === 'reunioes') await renderMeetings();
      else if (page === 'vencimentos') await renderRenewals();
      else if (page === '1a1' && /^\d+$/.test(id || '')) await renderOneOnOne(Number(id));
      else if (page === '1a1') await renderOneOnOnes();
      else if (page === 'comercial') await renderSales();
      else if (page === 'senha') renderPassword();
      else if (page === 'login') renderLogin();
      else await renderPortfolio();
    } catch (e) { view.replaceChildren(card('Não foi possível abrir', empty(e.message))); }
  }
  window.addEventListener('hashchange', route);
  route();
})();
