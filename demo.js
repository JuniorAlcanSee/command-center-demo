/* Versão de demonstração: tudo aqui é fictício e nada é enviado a nenhum servidor. */
(function () {
  const module = { exports: {} };
/*
 * Dados 100% fictícios do login de teste do rascunho. Lojas, pessoas e valores são inventados.
 * Nunca colocar dados reais neste arquivo.
 */
const USUARIO = 'marcelo.demo';
const SENHA = 'rascunho2026';
const TOKEN = 'token-demo-local';

const agoraSP = () => new Date(Date.now() - 3 * 3600000);
const dia = (n) => new Date(agoraSP().getTime() + n * 86400000).toISOString().slice(0, 10);
const horas = (n) => new Date(Date.now() - n * 3600000).toISOString();
const mesAtual = () => dia(0).slice(0, 7);

const LOJAS = ['Loja Aurora', 'Ateliê Bela', 'Casa Clara', 'Moda Dália', 'Brechó Estela', 'Loja Flora', 'Vitrine Gaia', 'Studio Helena', 'Boutique Íris', 'Closet Jade', 'Loja Kali', 'Maison Luna'];
const GESTORES = [{ id: 11, display_name: 'Gestor Ana', active: true, squads: ['A'] }, { id: 12, display_name: 'Gestor Bruno', active: true, squads: ['A'] }, { id: 13, display_name: 'Gestor Carla', active: true, squads: ['B'] }];
const SQUADS = [{ id: 1, code: 'A', name: 'Squad A', active: true }, { id: 2, code: 'B', name: 'Squad B', active: true }];
const gestorDe = (i) => GESTORES[i % 3];
const squadDe = (i) => SQUADS[i % 3 === 2 ? 1 : 0];
const clienteMini = (i) => ({ id: i + 1, trade_name: LOJAS[i], manager: { id: gestorDe(i).id, display_name: gestorDe(i).display_name } });

const PERMISSOES = ['reconciliation.read', 'radar.read', 'reports.read', 'renewals.read', 'sales.read', 'work.read', 'work.write', 'work.verify', 'meetings.read', 'clients.read', 'people.read', 'integrations.read'].map((permission) => ({ permission }));
const me = () => ({ id: 1, username: USUARIO, display_name: 'Visitante (teste)', roles: ['DIRECTOR'], permissions: PERMISSOES, must_change_password: false });

const fontes = () => ['NOTION', 'META_ADS', 'WHATSAPP_GROUP', 'MEETING_RECORDER'].map((source, i) => ({
  source, label: ['Notion', 'Meta Ads', 'WhatsApp', 'Gravador de reuniões'][i], mode: 'FAKE', freshness: 'FRESH', last_success_at: horas(0.3), connector_in_hub: true, credential_configured: false,
  last_job: { id: 90 + i, status: 'SUCCEEDED' } }));

const historico = () => Array.from({ length: 12 }, (_, i) => {
  const d = new Date(agoraSP()); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 11 + i);
  const entrou = i === 11 ? 3 : 6 + (i % 5); const saiu = i === 11 ? 1 : 3 + (i % 4);
  return { month: d.toISOString().slice(0, 7), entries: entrou, exits: saiu, base_start: 60 + i, churn_rate: saiu / (60 + i), in_progress: i === 11,
    entered: i === 11 ? [{ client_id: 1, name: LOJAS[0], manager: 'Gestor Ana', squad: 'Squad A', term: 'Trimestral' }] : [],
    left: i === 11 ? [{ client_id: null, name: 'Loja Exemplo Antiga', manager: 'Gestor Bruno', squad: 'Squad A', reason: 'Resultado', date: dia(-4), lifetime_days: 150 }] : [] };
});

const clientesOverview = () => LOJAS.map((name, i) => ({ client_id: i + 1, name, manager: gestorDe(i).display_name, squad: squadDe(i).name, journey: i % 4 === 0 ? 'Risco de churn' : 'Ativos', at_risk: i % 4 === 0,
  score: 3 + (i % 4), signals: i % 3 === 0 ? ['pedido_pendente'] : [], waiting_h: i % 3 === 0 ? 5 + i : null, low_balance: i === 3, no_delivery: i === 5, spend_7d: 800 + i * 90, cpc_7d: i === 7 ? 9.4 : 4.2, cycle_days: i === 6 ? 3 : null, cycle_end: dia(i === 6 ? 3 : 40), last_meeting: dia(-6 - i) }));

const overview = () => ({ as_of: dia(0), squad: null, squads: SQUADS, history: historico(), history_scope: {}, clients: clientesOverview(),
  kpis: { active: 72, entries_month: 3, exits_month: 1, churn_month: 1 / 71, churn_3m: 0.09, base_start_month: 71, at_risk: 3, attention: 4, spend_7d: 12400, spend_prev_7d: 11900, conv_7d: 980, conv_prev_7d: 930, cpc_7d: 12.65, cpc_prev_7d: 12.8 },
  exit_reasons: { items: [{ reason: 'Resultado', count: 8 }, { reason: 'Financeiro', count: 5 }, { reason: 'Encerrou a loja', count: 2 }], exits: 21, with_reason: 15, lifetime_median_days: 150 },
  attention: LOJAS.slice(0, 4).map((name, i) => ({ client_id: i + 1, name, manager: gestorDe(i).display_name, squad: squadDe(i).name, journey: 'Risco de churn', score: 6 - i, reasons: [{ label: 'Sem resposta há 2 dias', tone: 'bad' }, { label: 'Campanha sem entrega', tone: 'warn' }] })),
  journey: [{ label: 'Onboarding', count: 8 }, { label: 'Ativos', count: 58 }, { label: 'Risco de churn', count: 3 }, { label: 'Aviso prévio', count: 3 }],
  managers: GESTORES.map((g, i) => ({ name: g.display_name, squad: squadDe(i).name, active: 24, at_risk: 1, attention: 1 + (i % 2), spend_7d: 4100, conv_7d: 320, cpc_7d: 12.8, waiting: 1, no_delivery: i === 1 ? 1 : 0, low_balance: 0, meetings_30d: 15 })),
  media: { clients_with_spend: 60, no_delivery: 1, low_balance: 1, expensive_threshold: 30, expensive: [], top: [{ client_id: 2, name: LOJAS[1], manager: 'Gestor Bruno', spend_7d: 1500 }], outside_spend_7d: 0,
    daily: Array.from({ length: 14 }, (_, i) => ({ day: dia(i - 14), spend: 1500 + (i % 5) * 110, conversations: 110 + (i % 6) * 9 })) },
  relationship: { waiting_threshold_h: 4, waiting_count: 2, silent_7d: 1, waiting_unlinked: 0, waiting: [{ client_id: 3, name: LOJAS[2], manager: 'Gestor Carla', hours: 7 }], signals_14d: [{ kind: 'pedido_pendente', label: 'Pedido pendente', count: 4 }, { kind: 'feedback_positivo', label: 'Retorno positivo', count: 6 }], meetings_30d: 34,
    meetings_weekly: Array.from({ length: 5 }, (_, i) => ({ week: dia(-28 + i * 7), count: 5 + i, in_progress: i === 4 })) },
  contracts: { tenure_median_days: 190, tenure_buckets: [{ label: 'Até 3 meses', count: 22 }, { label: '3 a 6 meses', count: 25 }, { label: 'Mais de 6 meses', count: 25 }], terms: [{ label: 'Trimestral', count: 45 }, { label: 'Semestral', count: 27 }], cycle_end_known: 60,
    cycles: [{ client_id: 7, name: LOJAS[6], manager: 'Gestor Ana', cycle_end: dia(3), days: 3 }] },
  coverage: { active: 72, linked: 70, meta: 66, whatsapp: 60, meetings: 44, entry_date: 71 } });

const linhaRenova = (i, days, situation, amount, overdue, risk) => ({ client_id: i + 1, name: LOJAS[i], manager: gestorDe(i).display_name, squad: squadDe(i).name, risk, overdue, situation, days, amount, due_date: dia(days), kind: 'MRR', contract: null, action: null, notes: null, deadline: null });
const renova = () => {
  const rows = [linhaRenova(0, -6, 'Vencido', 1200, true, 'Alto'), linhaRenova(1, -3, 'Vencido', 1500, true, 'Moderado'), linhaRenova(2, -1, 'Vencido', 1000, true, 'Alto'),
    linhaRenova(3, 0, 'A vencer', 1300, false, 'De boa'), linhaRenova(4, 0, 'A vencer', 1100, false, 'De boa'),
    linhaRenova(5, 4, 'A vencer', 1400, false, 'Moderado'), linhaRenova(6, 12, 'A vencer', 1250, false, 'De boa'), linhaRenova(7, 18, 'A vencer', 1600, false, 'De boa'),
    linhaRenova(8, -8, 'Recebido', 1200, false, 'De boa'), linhaRenova(9, -5, 'Recebido', 1350, false, 'De boa'), linhaRenova(10, -10, 'Pago em atraso', 1000, false, 'De boa')];
  const soma = (f) => rows.filter(f).reduce((n, r) => n + r.amount, 0);
  const pago = (r) => ['Recebido', 'Pago em atraso'].includes(r.situation);
  return { month: mesAtual(), shows_amounts: true, squads: SQUADS, rows,
    kpis: { total: rows.length, paid: rows.filter(pago).length, open: rows.filter((r) => !pago(r)).length, overdue: rows.filter((r) => r.overdue).length, due_7d: 3, high_risk: rows.filter((r) => !pago(r) && r.risk === 'Alto').length,
      amount_total: soma(() => true), amount_paid: soma(pago), amount_open: soma((r) => !pago(r)) } };
};

const cartao = (i) => ({ notion_id: 'demo-' + i, name: LOJAS[i], contact: 'Contato ' + (i + 1), tenure_days: 30 + i * 28, contract_term: i % 2 ? 'Semestral' : 'Trimestral', cycle_end: dia(i === 6 ? 3 : 45), managers_in_notion: [gestorDe(i).display_name], can_move: true,
  client: { id: i + 1, trade_name: LOJAS[i], squad: squadDe(i), manager: { id: gestorDe(i).id, display_name: gestorDe(i).display_name } } });
const quadro = () => ({ source: { freshness: 'FRESH', mode: 'FAKE', observed_at: horas(0.3) }, move: { enabled: true }, journeys: ['Onboarding', 'Ativos', 'Risco de churn', 'Aviso prévio'],
  columns: [{ label: 'Onboarding', clients: [0, 1, 2].map(cartao) }, { label: 'Ativos', clients: [3, 4, 5, 6, 7, 8, 9].map(cartao) }, { label: 'Risco de churn', clients: [10].map(cartao) }, { label: 'Aviso prévio', clients: [11].map(cartao) }] });

const clienteLista = (i) => ({ id: i + 1, trade_name: LOJAS[i], version: 1, lifecycle_state: { code: i === 11 ? 'NOTICE_GIVEN' : 'ACTIVE' }, squad: squadDe(i), manager: { id: gestorDe(i).id, display_name: gestorDe(i).display_name }, origin: { synthetic: true, linked_sources: [] } });
const clienteFicha = (i) => Object.assign(clienteLista(i), { allowed_actions: ['UPDATE', 'CHANGE_LIFECYCLE', 'TRANSFER'], lifecycle_start_at: dia(-90), sales_briefing: null,
  profile: { contact_name: 'Contato ' + (i + 1), contract_term: 'Trimestral', entry_on: dia(-90), cycle_end_on: dia(30), journey: 'Ativos' } });

const tarefa = (id, i, title, urgency, dias) => ({ id, version: 1, title, kind: 'TASK', state: 'OPEN', urgency, due_at: dias === null ? null : dia(dias) + 'T18:00:00-03:00', is_closed: false, proof_required: false, request: false,
  client: { id: i + 1, trade_name: LOJAS[i] }, owner: { id: 1, display_name: 'Visitante (teste)' }, created_by: { id: 1, display_name: 'Visitante (teste)' }, last_evidence: null, description: null, allowed_actions: ['SUBMIT_EVIDENCE', 'UPDATE'], allowed_transitions: ['IN_PROGRESS', 'VERIFIED'] });
const tarefas = () => [tarefa(1, 0, 'Enviar relatório do mês', 'OVERDUE', -1), tarefa(2, 1, 'Trocar criativo da campanha', 'DUE_TODAY', 0), tarefa(3, 2, 'Marcar reunião de alinhamento', 'DUE_SOON', 2)];

const reunioes = () => [0, 1, 2].map((i) => ({ id: i + 1, title: 'Alinhamento ' + LOJAS[i], started_at: horas(24 + i * 30), status: i === 2 ? 'pending' : 'linked', client: i === 2 ? null : clienteMini(i), clients: i === 2 ? [] : [clienteMini(i)], participants: ['Gestor', 'Contato'], summary: 'Resumo fictício da reunião.', next_steps: ['Enviar novo criativo'], can_reclassify: true }));

const anuncios = () => {
  const semana = { spend: 1250, conversations: 96, cost_per_conversation: 13.02, ctr: 1.8, cpm: 21.4, cpc: 1.2 };
  const anterior = { spend: 1180, conversations: 88, cost_per_conversation: 13.41, ctr: 1.7, cpm: 22, cpc: 1.25 };
  return { week: semana, previous_week: anterior, accounts: [{ name: 'Conta de teste', external_id: 'act_000', funding: { status: 'OK', prepaid_available: null } }],
    campaigns: [{ name: 'Campanha de conversas', objective: null, status: 'ACTIVE', spend: 1250, spend_prev: 1180, conversations: 96, cost_per_conversation: 13.02, message_objective: true, ctr: 1.8, cpm: 21.4, active_ads: 3, last_delivery: dia(-1) }],
    creatives: [{ name: 'Criativo de teste', campaign: 'Campanha de conversas', adset: 'Público aberto', status: 'ACTIVE', spend: 700, spend_prev: 650, conversations: 60, cost_per_conversation: 11.67, message_objective: true, ctr: 2, frequency_7d: 1.6, reach_7d: 8200, days_delivered: 7 }], creatives_read: true,
    daily: Array.from({ length: 14 }, (_, i) => ({ day: dia(i - 14), spend: 150 + (i % 5) * 12, conversations: 11 + (i % 4), clicks: 60 + i })),
    window: { week_from: dia(-7), to: dia(-1), days: 7, from: dia(-14), previous_to: dia(-8), default: true } };
};

function responder(caminho, busca = '') {
  const c = caminho.replace(/^\/api\/v1\//, '');
  if (c === 'auth/me') return me();
  if (c === 'integrations/status') return { sources: fontes(), scheduler: { command: 'agendador de teste' } };
  if (c === 'users/me/notifications') return { unread: 1, items: [{ key: 'k1', kind: 'MENTION', read: false, client: { id: 1, trade_name: LOJAS[0] }, actor: { display_name: 'Gestor Ana' }, occurred_at: horas(2), summary: 'Mencionou você em uma nota de teste.' }] };
  if (c === 'reports/overview') return overview();
  if (c === 'renewals/operation') return renova();
  if (c === 'clients/board') return quadro();
  if (c === 'clients') return LOJAS.map((_, i) => clienteLista(i));
  if (c === 'managers') return [{ id: 1, display_name: 'Visitante (teste)', active: true, squads: [] }, ...GESTORES];
  if (c === 'squads') return SQUADS;
  if (c === 'work-items') return /kind=REQUEST/.test(busca) ? [] : tarefas();
  if (c === 'sync/history') return [{ id: 90, source: 'NOTION', mode: 'FAKE', trigger: 'AGENDADO', requested_by: null, status: 'SUCCEEDED', counts: { lidas: 72 }, finished_at: horas(0.3) }];
  if (c === 'reconciliation/queue') return { counts: { notion: 0, people: 0, records: 0, meetings: 0 }, squads: SQUADS, clients: LOJAS.map((name, i) => ({ id: i + 1, name })), notion: [], people: [], records: [], waiting: [] };
  if (c === 'recorded-meetings') return { items: reunioes(), counts: { linked: 2, pending: 1, internal: 0 } };
  if (c === 'daily') { const [a, b, f] = tarefas(); return { counts: { agenda: 2, recorded: 1 }, tasks: { due: [b], overdue: [a], done: [], created: [f] },
    agenda: [{ title: 'Alinhamento ' + LOJAS[0], has_time: true, start: horas(-3), status: null, clients: [clienteMini(0)], recorded_id: null, url: null }, { title: 'Planejamento ' + LOJAS[1], has_time: true, start: horas(-5), status: null, clients: [clienteMini(1)], recorded_id: null, url: null }],
    recorded: [{ title: 'Alinhamento ' + LOJAS[2], started_at: horas(20), clients: [clienteMini(2)], participants: ['Gestor', 'Contato'], summary: 'Resumo fictício da reunião.', next_steps: ['Enviar novo criativo'] }] }; }
  if (/^media\/clients\/\d+\/summary$/.test(c)) return { window: { from: dia(-7) }, totals_by_currency: [{ spend: '1250', conversations: 96 }], current_accounts: [{ funding: { status: 'OK' } }] };
  if (/^media\/clients\/\d+\/ads$/.test(c)) return anuncios();
  if (c === 'sales/pipeline') return { amounts_visibility: 'VISIBLE', note: 'Funil fictício.', source: { provider: 'Teste', reader: 'dados fictícios', note: 'Nenhum dado real.' }, open_by_stage: [{ stage: 'QUALIFIED', deals: 5, expected_amount: 6000 }, { stage: 'PROPOSAL', deals: 3, expected_amount: 3900 }], closed: { WON_CONTRACT_CONFIRMED: { value: 4 }, WON_WITHOUT_CONTRACT: { value: 1 }, LOST: { value: 2 } } };
  if (c === 'sales/deals') return [{ title: 'Negócio de teste', client: null, stage: 'PROPOSAL', outcome: null, owner: { display_name: 'Comercial' } }];
  if (c === 'one-on-ones/managers') return { managers: GESTORES.map((g, i) => ({ user_id: g.id, name: g.display_name, squad: squadDe(i).name, clients: 24, red: 2, yellow: 4, green: 16, score: 7.5, last_one_on_one: horas(24 * (3 + i * 5)), open_actions: 1, late_actions: 0 })) };
  const umUm = c.match(/^one-on-ones\/managers\/(\d+)$/);
  if (umUm) { const g = GESTORES.find((x) => x.id === Number(umUm[1])) || GESTORES[0]; return { manager: { id: g.id, name: g.display_name, display_name: g.display_name, squad: 'Squad A' }, name: g.display_name, squad: 'Squad A', axes: { DEDICACAO: 'Dedicação', RESULTADO: 'Resultado' }, portfolio: clientesOverview().slice(0, 4).map((x) => Object.assign({}, x, { last: null })), actions: [], history: [], sessions: [], last_session: null }; }
  const ficha = c.match(/^clients\/(\d+)(\/.*)?$/);
  if (ficha) {
    const i = Math.min(Math.max(Number(ficha[1]) - 1, 0), LOJAS.length - 1);
    if (!ficha[2]) return clienteFicha(i);
    if (ficha[2] === '/source-records') return { records: [], whatsapp: [], meetings: [], meetings_source: null };
    if (ficha[2] === '/lifecycle') return { allowed_transitions: ['NOTICE_GIVEN', 'CHURNED', 'PAUSED'] };
    if (ficha[2] === '/actions') return { items: tarefas().filter((w) => w.client.id === i + 1) };
    return [];
  }
  return [];
}

module.exports = { USUARIO, SENHA, TOKEN, responder };

  const demo = module.exports;
  const resposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (url, opcoes) => {
    const u = new URL(url, location.href);
    const pos = u.pathname.indexOf('/api/v1/');
    if (pos < 0) return fetchOriginal(url, opcoes);
    const caminho = u.pathname.slice(pos);
    const op = opcoes || {};
    const metodo = op.method || 'GET';
    if (caminho === '/api/v1/auth/login') {
      let envio = {};
      try { envio = JSON.parse(op.body); } catch (e) { /* corpo inválido */ }
      if (envio.username !== demo.USUARIO || envio.password !== demo.SENHA) return resposta(401, { error: { message: 'Usuário ou senha incorretos.' } });
      return resposta(200, { data: { access_token: demo.TOKEN } });
    }
    if (caminho === '/api/v1/auth/logout') return resposta(200, { data: { ok: true } });
    if (((op.headers || {}).Authorization) !== 'Bearer ' + demo.TOKEN) return resposta(401, { error: { message: 'Entre de novo.' } });
    if (metodo !== 'GET') return resposta(403, { error: { message: 'Demonstração: nada é salvo aqui.' } });
    return resposta(200, { data: demo.responder(caminho, u.search), meta: { pagination: { total: 12 } } });
  };
  // Mostra o acesso de teste na tela de login.
  new MutationObserver(() => {
    const form = document.querySelector('form.login');
    if (!form || form.querySelector('.demo-hint')) return;
    const aviso = document.createElement('p');
    aviso.className = 'demo-hint';
    aviso.textContent = 'Demonstração com dados fictícios. Usuário: ' + demo.USUARIO + ' · Senha: ' + demo.SENHA;
    form.append(aviso);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
