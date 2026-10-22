// Cosign central store — one state tree, actions, selectors, demo director.
// Port: replace with zustand/redux; actions call ./api.js (mock) → real endpoints.
import * as D from './data.js';
import * as api from './api.js';

const P = D.PEOPLE;
const listeners = new Set();
let timers = [];
let seeding = false;

function initial(keep = {}) {
  return {
    theme: keep.theme || 'dark',
    signedIn: false,
    auth: { phase: 'idle', nodes: 0, user: null },
    role: 'linh',
    screens: { ...D.HOME },
    drawer: false,
    phone: false,
    phoneView: 'lock',
    phoneNodes: 0,
    toasts: [],
    agent: { cursor: 0, playing: false, killed: false, stopAt: null, userPaused: false, expanded: { 4: true } },
    flags: { rollback: false, refused: false, injection: false, decrypted: false, fix: false, quarantined: false },
    requests: {},
    order: [],
    grant: { active: false, startedAt: null, expiresAt: null, revokedAt: null, revokedHow: null },
    sign: null,
    dave: { drawer: false, ticks: { 'agent-runtime': true, 'deploy.rollback': true, 'logs.read': true, 'realm-admin': false, '_tide_customer_pii.selfdecrypt': false }, cr: null },
    compare: false,
    modal: null,
    selCR: 'CR-0192',
    warTab: 'timeline',
    agentTab: 'authority',
    auditSel: null,
    auditFilter: { actor: 'all', outcome: 'all' },
    audit: D.BASE_AUDIT.map(a => ({ ...a })),
    stage: 0,
    now: Date.now(),
    demo: keep.demo || { beat: -1, auto: false, hidden: false },
  };
}

let S = initial();
const emit = () => listeners.forEach(f => { try { f(S); } catch (e) { console.error(e); } });
const set = (fn) => { fn(S); emit(); };

function toast(text, kind = 'info') {
  if (seeding) return;
  const id = Math.random().toString(36).slice(2);
  S.toasts = [...S.toasts, { id, text, kind }].slice(-3);
  setTimeout(() => set(s => { s.toasts = s.toasts.filter(t => t.id !== id); }), 4800);
}
function log(ts, actor, action, target, outcome, extra = {}) {
  S.audit = [...S.audit, { ts, actor, action, target, outcome, sig: D.hash(ts + action + target), ...extra }];
}
const clock = () => { const e = D.AGENT_EVENTS[S.agent.cursor - 1]; return e ? e.t : '03:12:00'; };

function addCR(id, cr, ts) {
  S.requests = { ...S.requests, [id]: { id, createdAt: ts, ...cr } };
  if (!S.order.includes(id)) S.order = [...S.order, id];
}

// ---------- agent run ----------
function gateOk(g) {
  if (!g) return true;
  if (g === 'submitted') return S.requests['CR-0192'] && S.requests['CR-0192'].status !== 'draft';
  if (g === 'granted') return S.grant.active || !!S.grant.revokedAt && S.flags.decrypted;
  if (g === 'expired') return !!S.grant.revokedAt;
  return true;
}
function runEffect(ev) {
  const t = ev.t;
  switch (ev.effect) {
    case 'rollback': S.flags.rollback = true; log(t, 'atlas', 'deploy.rollback', 'payments-api → v412', 'allowed', { tier: 0 }); toast('Low-risk action executed. Logged & signed.', 'ok'); break;
    case 'refused': S.flags.refused = true; log(t, 'atlas', 'customer_pii.decrypt', '5 merchant records', 'refused'); break;
    case 'injection': S.flags.injection = true; log(t, 'classifier', 'injection.detected', 'settlement-worker log · fr · 0.97', 'flagged'); break;
    case 'cr0193':
      addCR('CR-0193', { requester: 'atlas', target: 'atlas', change: 'grant realm-admin', capability: 'realm-admin', roles: ['realm-admin'], tier: 3, elevated: '+1: injection detected', required: 3, eligible: ['linh', 'marcus', 'dave'], flags: ['injection'], approvals: [], status: 'pending', age: '40s' }, t);
      log(t, 'atlas', 'roles.grant', 'realm-admin → ai-oncall-agent', 'blocked', { cr: 'CR-0193' }); toast('Role change blocked · CR-0193 requires 3 of 3', 'refused'); break;
    case 'cr0194':
      addCR('CR-0194', { requester: 'dave', target: 'dave', change: 'grant customer_pii.selfdecrypt to self', capability: '_tide_customer_pii.selfdecrypt', roles: ['_tide_customer_pii.selfdecrypt'], tier: 3, elevated: 'unusual: self-grant at 03:20', required: 3, eligible: ['linh', 'marcus', 'dave'], flags: ['self-grant'], approvals: [], status: 'pending', age: '10s' }, '03:20:14');
      log('03:20:14', 'dave', 'roles.grant', '_tide_customer_pii.selfdecrypt → dave.kim', 'blocked', { cr: 'CR-0194' }); break;
    case 'decrypted': S.flags.decrypted = true; log(t, 'atlas', 'customer_pii.decrypt', '5 merchant records (in-session)', 'allowed', { cr: 'CR-0192' }); break;
    case 'fix': S.flags.fix = true; log(t, 'atlas', 'deploy.hotfix', 'payments-api v414 · T1 · Linh Tran', 'allowed', { tier: 1 }); break;
  }
}
function reveal() {
  const ev = D.AGENT_EVENTS[S.agent.cursor];
  if (!ev || !gateOk(ev.gate)) return false;
  S.agent.cursor++;
  if (ev.kind === 'request' && !S.requests['CR-0192']) {
    addCR('CR-0192', { requester: 'atlas', target: 'atlas', change: 'grant customer_pii.selfdecrypt (15m, 5 records)', capability: '_tide_customer_pii.selfdecrypt', scope: D.RECORD_IDS, duration: 15, tier: 2, required: 2, eligible: ['linh', 'marcus', 'dave'], flags: [], approvals: [], status: 'draft', age: '2m',
      justification: 'Settlement failures persist for 5 merchants after rollback. Need merchant config + last 3 transactions to identify cause.' }, ev.t);
  }
  if (ev.effect) runEffect(ev);
  if (ev.kind === 'tool' && ev.step) S.agent.expanded = { ...S.agent.expanded, [S.agent.cursor - 1]: true };
  return true;
}
function agentTo(n) { while (S.agent.cursor < n) { if (!reveal()) break; } }

setInterval(() => {
  if (S.agent.playing && !S.agent.killed && S.signedIn) {
    if (S.agent.stopAt != null && S.agent.cursor >= S.agent.stopAt) return;
    if (reveal()) emit();
  }
}, 1700);
setInterval(() => {
  S.now = Date.now();
  if (S.grant.active && S.grant.expiresAt && S.now >= S.grant.expiresAt) doExpire('expired');
  emit();
}, 1000);

// ---------- approvals ----------
function canApprove(cr, who) {
  if (!cr || cr.status !== 'pending') return false;
  if (P[who].agent || who === 'priya') return false;
  if (who === cr.requester) return false;
  if (!cr.eligible.includes(who)) return false;
  return !cr.approvals.some(a => a.who === who);
}
function applyApproval(crId, who, sig, ts) {
  const cr = S.requests[crId]; if (!cr) return;
  const approvals = [...cr.approvals, { who, sig, at: ts || (crId === 'CR-0192' ? (who === 'linh' ? '03:21:30' : '03:22:02') : clock()) }];
  const done = approvals.length >= cr.required;
  S.requests = { ...S.requests, [crId]: { ...cr, approvals, status: done ? 'approved' : 'pending' } };
  log(approvals[approvals.length - 1].at, who, 'approve', crId + ` (${approvals.length}/${cr.required})`, 'signed', { cr: crId });
  if (done && crId === 'CR-0192') {
    S.grant = { active: true, startedAt: '03:22:02', expiresAt: Date.now() + 15 * 60 * 1000 - 2000, revokedAt: null };
    log('03:22:02', 'tidecloak', 'grant', '_tide_customer_pii.selfdecrypt → Atlas · 15m', 'allowed', { cr: crId });
    toast('Access granted · threshold-signed by ' + approvals.map(a => P[a.who].name).join(' & '), 'ok');
  } else if (!done) toast(`${P[who].name} signed ${crId} · ${approvals.length} of ${cr.required}`, 'ok');
}
function doExpire(how) {
  if (!S.grant.active && S.grant.revokedAt) return;
  S.grant = { ...S.grant, active: false, revokedAt: '03:28:00', revokedHow: how };
  log('03:28:00', 'tidecloak', 'revoke', '_tide_customer_pii.selfdecrypt ← Atlas (' + how + ')', 'allowed');
  toast('Authority returned · customer_pii.selfdecrypt revoked', 'info');
}

// ---------- demo director ----------
const OPS = [
  () => {},
  () => { S.signedIn = true; S.auth = { phase: 'done', nodes: 14, user: 'linh' }; },
  () => agentTo(4),
  () => agentTo(5),
  () => { agentTo(8); submitNow(); agentTo(9); },
  () => agentTo(12),
  () => { S.dave.ticks['realm-admin'] = true; S.dave.ticks['_tide_customer_pii.selfdecrypt'] = true; daveSaveNow(); },
  () => applyApproval('CR-0192', 'linh', D.hash('CR-0192linh') + ' (14/20 ORK)'),
  () => applyApproval('CR-0192', 'marcus', D.hash('CR-0192marcus') + ' (14/20 ORK)'),
  () => agentTo(16),
  () => { doExpire('released early'); agentTo(17); },
];
function seedTo(stage) {
  seeding = true;
  if (stage < S.stage) { const keep = { theme: S.theme, demo: S.demo }; S = initial(keep); }
  for (let i = S.stage + 1; i <= stage; i++) OPS[i]();
  S.stage = Math.max(S.stage, stage);
  seeding = false;
}
function submitNow() {
  const cr = S.requests['CR-0192']; if (!cr || cr.status !== 'draft') return;
  S.requests = { ...S.requests, 'CR-0192': { ...cr, status: 'pending' } };
  log('03:13:08', 'atlas', 'change_request', 'CR-0192 · customer_pii.selfdecrypt · 5 records · 15m', 'pending', { cr: 'CR-0192' });
  toast('CR-0192 submitted · waiting for quorum 0 / 2', 'pending');
}
function daveSaveNow() {
  const t = S.dave.ticks; const roles = ['realm-admin', '_tide_customer_pii.selfdecrypt'].filter(r => t[r]);
  if (!roles.length) return;
  addCR('CR-0195', { requester: 'dave', target: 'atlas', change: 'grant ' + roles.join(' + ') + ' to ai-oncall-agent', capability: roles.join(', '), roles, tier: 3, required: 3, eligible: ['linh', 'marcus', 'dave'], flags: ['admin'], approvals: [], status: 'pending', age: 'now' }, '03:20:48');
  S.dave.cr = 'CR-0195';
  log('03:20:48', 'dave', 'roles.grant', roles.join(' + ') + ' → ai-oncall-agent', 'blocked', { cr: 'CR-0195' });
  if (!S.dave.drawer) toast('CR-0195 created · pending quorum 0 / 3', 'pending');
}

const B = (t, label, stage, view, dur, auto) => ({ t, label, stage, view, dur, auto: auto || [] });
const BEATS = [
  B('0:00', 'S1 · Sign-in with Tide', 0, { signedIn: false, role: 'linh' }, 7000, [[1800, () => A.signIn('linh')]]),
  B('0:08', 'E1 · Incidents home', 1, { role: 'linh', screen: 'incidents' }, 7000),
  B('0:15', 'A1 · Atlas works the incident', 1, { role: 'atlas', screen: 'console', play: true, stopAt: 4 }, 10000),
  B('0:25', 'A2 · Rollback executed (T0)', 2, { role: 'atlas', screen: 'console', play: true, stopAt: 5 }, 9000),
  B('0:35', 'A3 · Decryption refused → request', 3, { role: 'atlas', screen: 'console', play: true, stopAt: 7 }, 9000, [[4300, () => A.agentStep()], [6600, () => A.submitRequest()]]),
  B('0:45', 'S3 · Request lands with Linh', 4, { role: 'linh', screen: 'incidents', drawer: true }, 8000),
  B('0:55', 'A4 · Prompt injection → blocked', 4, { role: 'atlas', screen: 'console', play: true, stopAt: 12 }, 9000),
  B('1:05', 'L1 · Governance overview', 5, { role: 'marcus', screen: 'governance' }, 5000),
  B('1:10', 'L2 · CR-0193 security review', 5, { role: 'marcus', screen: 'approvals', selCR: 'CR-0193' }, 5000),
  B('1:15', 'R2 · Admin edits roles', 5, { role: 'dave', screen: 'users', daveDrawer: true, ticks: true }, 7000, [[3000, () => A.daveSave()]]),
  B('1:22', 'R3 · Compare views', 6, { role: 'dave', screen: 'data', compare: true }, 8000),
  B('1:30', 'E5 · Linh approves on phone', 6, { role: 'linh', screen: 'approvals', phone: true, phoneView: 'lock', selCR: 'CR-0192' }, 8000, [[1500, () => A.phoneOpen()], [3500, () => A.phoneApprove()]]),
  B('1:38', 'E4 · Marcus signs → 2 / 2', 7, { role: 'marcus', screen: 'approvals', selCR: 'CR-0192' }, 7500, [[1000, () => A.openSign('CR-0192')], [2200, () => A.confirmSign()]]),
  B('1:45', 'A5 · Access granted (time-boxed)', 8, { role: 'atlas', screen: 'console', play: true, stopAt: 16 }, 8000),
  B('1:53', 'A6 · Authority returned', 10, { role: 'atlas', screen: 'console', play: false }, 5000),
  B('1:58', 'C2 · Access receipt', 10, { role: 'priya', screen: 'receipts' }, 7000),
];

function applyView(v) {
  if ('signedIn' in v) { S.signedIn = v.signedIn; if (!v.signedIn) S.auth = { phase: 'idle', nodes: 0, user: null }; }
  S.role = v.role; if (v.screen) S.screens = { ...S.screens, [v.role]: v.screen };
  S.drawer = !!v.drawer; S.phone = !!v.phone; if (v.phoneView) S.phoneView = v.phoneView;
  S.compare = !!v.compare; S.modal = null; S.sign = null;
  S.dave = { ...S.dave, drawer: !!v.daveDrawer };
  if (v.ticks) S.dave.ticks = { ...S.dave.ticks, 'realm-admin': true, '_tide_customer_pii.selfdecrypt': true };
  if (v.selCR) S.selCR = v.selCR;
  if ('play' in v) S.agent = { ...S.agent, playing: v.play, killed: false, userPaused: false };
  S.agent = { ...S.agent, stopAt: 'stopAt' in v ? v.stopAt : S.agent.cursor };
  if (v.role === 'linh' && v.phone) { const cr = S.requests['CR-0192']; S.phoneView = cr && cr.approvals.some(a => a.who === 'linh') ? 'signed' : 'lock'; }
}

function clearTimers() { timers.forEach(clearTimeout); timers = []; }
function goBeat(i, auto) {
  i = Math.max(0, Math.min(BEATS.length - 1, i));
  clearTimers();
  const b = BEATS[i];
  seedTo(b.stage);
  applyView(b.view);
  S.demo = { ...S.demo, beat: i, auto: !!auto };
  emit();
  if (auto) {
    b.auto.forEach(([ms, fn]) => timers.push(setTimeout(fn, ms)));
    timers.push(setTimeout(() => { if (i < BEATS.length - 1) goBeat(i + 1, true); else set(s => { s.demo = { ...s.demo, auto: false }; }); }, b.dur));
  }
}

// ---------- public actions ----------
const A = {
  toggleTheme: () => set(s => { s.theme = s.theme === 'dark' ? 'light' : 'dark'; }),
  switchRole: r => set(s => { s.role = r; s.drawer = false; s.modal = null; s.sign = null; if (r === 'linh') {} }),
  go: scr => set(s => { s.screens = { ...s.screens, [s.role]: scr }; s.drawer = false; }),
  toggleDrawer: () => set(s => { s.drawer = !s.drawer; }),
  togglePhone: () => set(s => { s.phone = !s.phone; }),
  dismissToast: id => set(s => { s.toasts = s.toasts.filter(t => t.id !== id); }),
  signIn: async (user) => {
    set(s => { s.auth = { phase: 'proving', nodes: 0, user }; });
    await api.proveIdentity(user, n => set(s => { s.auth = { ...s.auth, nodes: n }; }));
    set(s => { s.auth = { phase: 'success', nodes: 14, user }; });
    await new Promise(r => setTimeout(r, 700));
    set(s => { s.signedIn = true; s.role = user; s.stage = Math.max(s.stage, 1); s.auth = { phase: 'done', nodes: 14, user }; });
  },
  signOut: () => set(s => { s.signedIn = false; s.auth = { phase: 'idle', nodes: 0, user: null }; }),
  // agent
  agentPlay: () => set(s => { s.agent = { ...s.agent, playing: true, killed: false, stopAt: null, userPaused: false }; }),
  agentPause: () => set(s => { s.agent = { ...s.agent, playing: false, userPaused: true }; }),
  agentStep: () => set(() => { reveal(); }),
  agentRestart: () => { seedTo(0); set(s => { s.signedIn = true; s.stage = 1; s.agent = { ...s.agent, playing: true }; }); },
  toggleExpand: i => set(s => { s.agent = { ...s.agent, expanded: { ...s.agent.expanded, [i]: !s.agent.expanded[i] } }; }),
  setAgentTab: t => set(s => { s.agentTab = t; }),
  killSwitch: () => set(s => { s.agent = { ...s.agent, killed: true, playing: false, userPaused: true }; if (s.grant.active) doExpire('kill switch'); log(clock(), s.role, 'kill_switch', 'Atlas · all elevated access', 'allowed'); toast('All elevated access revoked · instant, no quorum', 'refused'); }),
  quarantine: () => set(s => { s.flags.quarantined = true; log(clock(), s.role, 'quarantine', 'Atlas context', 'allowed'); toast('Atlas context quarantined', 'pending'); }),
  // requests
  submitRequest: async () => {
    const cr = S.requests['CR-0192']; if (!cr || cr.status !== 'draft') return;
    await api.changeRequest(cr);
    set(() => { submitNow(); S.stage = Math.max(S.stage, 4); });
  },
  selectCR: id => set(s => { s.selCR = id; }),
  openSign: id => set(s => { s.sign = { crId: id, who: s.role, phase: 'confirm', nodes: 0 }; }),
  closeSign: () => set(s => { s.sign = null; }),
  confirmSign: async () => {
    const sg = S.sign; if (!sg || sg.phase !== 'confirm') return;
    const res = await api.approve({ crId: sg.crId, approver: sg.who }, p => set(s => { if (s.sign) s.sign = { ...s.sign, ...p }; }));
    set(s => {
      applyApproval(sg.crId, sg.who, res.sig);
      if (s.sign) s.sign = { ...s.sign, phase: 'done' };
      const cr = s.requests[sg.crId];
      if (sg.crId === 'CR-0192') s.stage = Math.max(s.stage, cr.approvals.length >= 2 ? 8 : 7);
    });
  },
  deny: (id, quarantine) => set(s => {
    const cr = s.requests[id]; if (!cr) return;
    s.requests = { ...s.requests, [id]: { ...cr, status: 'denied', deniedBy: s.role } };
    log(clock(), s.role, 'deny', id, 'denied', { cr: id });
    if (quarantine) { s.flags.quarantined = true; }
    toast(id + ' denied' + (quarantine ? ' · agent context quarantined' : ''), 'refused');
  }),
  // phone
  phoneOpen: () => set(s => { s.phone = true; s.phoneView = 'review'; }),
  phoneBack: () => set(s => { s.phoneView = 'lock'; }),
  phoneApprove: async () => {
    if (!canApprove(S.requests['CR-0192'], 'linh')) return;
    set(s => { s.phoneView = 'signing'; s.phoneNodes = 0; });
    const res = await api.approve({ crId: 'CR-0192', approver: 'linh' }, p => set(s => { s.phoneNodes = p.nodes; }));
    set(s => { applyApproval('CR-0192', 'linh', res.sig); s.phoneView = 'signed'; s.stage = Math.max(s.stage, 7); });
  },
  // admin
  daveOpen: () => set(s => { s.dave = { ...s.dave, drawer: true }; }),
  daveClose: () => set(s => { s.dave = { ...s.dave, drawer: false }; }),
  daveToggle: r => set(s => { s.dave = { ...s.dave, ticks: { ...s.dave.ticks, [r]: !s.dave.ticks[r] } }; }),
  daveSave: async () => { await new Promise(r => setTimeout(r, 300)); set(s => { daveSaveNow(); s.stage = Math.max(s.stage, 6); }); },
  withdraw: id => set(s => { const cr = s.requests[id]; if (!cr) return; s.requests = { ...s.requests, [id]: { ...cr, status: 'withdrawn' } }; if (s.dave.cr === id) s.dave = { ...s.dave, cr: null, drawer: false }; log(clock(), s.role, 'withdraw', id, 'withdrawn'); toast(id + ' withdrawn', 'info'); }),
  toggleCompare: () => set(s => { s.compare = !s.compare; }),
  exportTable: async () => { const r = await api.exportTable({ table: 'merchants' }); set(s => { s.modal = { kind: 'export', rows: r.rows }; log(clock(), 'dave', 'export', 'merchants · 48,201 rows (ciphertext)', 'allowed'); }); },
  auditDelete: async (i) => { await api.deleteAuditEvent({ id: i }); set(s => { s.modal = { kind: 'auditDelete', idx: i }; log(clock(), s.role, 'audit.delete', 'event #' + (i + 1), 'refused'); }); },
  closeModal: () => set(s => { s.modal = null; }),
  expire: () => set(s => { doExpire('released early'); }),
  // views
  setWarTab: t => set(s => { s.warTab = t; }),
  selectAudit: i => set(s => { s.auditSel = s.auditSel === i ? null : i; }),
  setAuditFilter: (k, v) => set(s => { s.auditFilter = { ...s.auditFilter, [k]: v }; }),
  receiptPrint: () => window.print(),
  // demo
  demoGo: i => goBeat(i, S.demo.auto),
  demoNext: () => goBeat(S.demo.beat + 1, S.demo.auto),
  demoPrev: () => goBeat(S.demo.beat - 1, S.demo.auto),
  demoToggleAuto: () => { if (S.demo.auto) { clearTimers(); set(s => { s.demo = { ...s.demo, auto: false }; }); } else goBeat(S.demo.beat < 0 || S.demo.beat >= BEATS.length - 1 ? 0 : S.demo.beat, true); },
  demoHide: () => set(s => { s.demo = { ...s.demo, hidden: !s.demo.hidden }; }),
};

// ---------- selectors ----------
const fmt = sec => { sec = Math.max(0, Math.round(sec)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
const SEL = {
  person: id => P[id] || { id, name: id, initials: id.slice(0, 2).toUpperCase(), color: '#8A92A3', role: 'system', agent: false, system: true },
  clock,
  canApprove: (id, who) => canApprove(S.requests[id], who || S.role),
  remaining: () => S.grant.active ? Math.max(0, (S.grant.expiresAt - S.now) / 1000) : 0,
  countdown: () => fmt(SEL.remaining()),
  piiState: () => {
    if (S.grant.active) return 'granted';
    const cr = S.requests['CR-0192'];
    if (cr && cr.status === 'pending') return 'pending';
    return 'locked';
  },
  atlasAuthority: () => {
    const pii = SEL.piiState(); const cr = S.requests['CR-0192'];
    return [
      { cap: 'services.restart', state: S.agent.killed ? 'locked' : 'ok' },
      { cap: 'deploy.rollback', state: S.agent.killed ? 'locked' : 'ok' },
      { cap: 'logs.read', state: 'ok' },
      { cap: 'customer_pii.selfdecrypt', state: pii, note: pii === 'pending' ? `CR-0192 · ${cr.approvals.length} / 2` : pii === 'granted' ? fmt(SEL.remaining()) : '' },
      { cap: 'roles.grant', state: 'locked', note: 'never grantable to agents' },
      { cap: 'secrets.rotate', state: 'locked' },
    ];
  },
  pendingFor: who => S.order.map(id => S.requests[id]).filter(cr => canApprove(cr, who)),
  openRequests: () => S.order.map(id => S.requests[id]).filter(cr => cr.status === 'pending'),
  stats: () => {
    const done = D.AGENT_EVENTS.slice(0, S.agent.cursor);
    const er = S.flags.fix ? '0.2%' : S.flags.rollback ? '4.1%' : '38.2%';
    return { errorRate: er, status: S.grant.revokedAt && S.flags.fix ? 'Resolved' : S.flags.rollback ? 'Mitigating' : 'Investigating', steps: done.filter(e => e.step).length };
  },
  // error-rate series for charts: returns svg strings for a w×h box
  chart: (w, h) => {
    const T0 = 0, T1 = 31; // minutes after 03:00
    let end = 12.3;
    if (S.flags.rollback) end = 16; if (S.flags.refused) end = 17; if (S.flags.injection) end = 20; if (S.grant.active || S.flags.decrypted) end = 24; if (S.flags.fix) end = 29; if (S.grant.revokedAt) end = 31;
    const f = m => m < 5 ? 0.4 : m < 12.3 ? 0.4 + (m - 5) / 7.3 * 37.8 : (!S.flags.rollback ? 38.2 : m < 13.2 ? 38.2 : m < 15 ? 38.2 - (m - 13.2) / 1.8 * 34.1 : m < 27 ? 4.1 + Math.sin(m * 3) * 0.35 : m < 28 ? 4.1 - (m - 27) * 3.9 : 0.2);
    const X = m => (m - T0) / (T1 - T0) * w, Y = v => h - 4 - v / 42 * (h - 8);
    const pts = []; for (let m = 0; m <= end; m += 0.25) pts.push(X(m).toFixed(1) + ',' + Y(f(m)).toFixed(1));
    const mk = [{ m: 5, label: 'deploy v413', on: true, color: 'var(--refused)' }, { m: 13.2, label: 'rollback', on: S.flags.rollback, color: 'var(--agent)' }, { m: 22, label: 'access granted', on: S.grant.active || !!S.grant.revokedAt, color: 'var(--ok)' }, { m: 27, label: 'fix deployed', on: S.flags.fix, color: 'var(--accent)' }]
      .filter(k => k.on).map(k => ({ ...k, x: X(k.m).toFixed(1), lx: (X(k.m) + 4).toFixed(1) }));
    const last = pts[pts.length - 1].split(',');
    return { line: pts.join(' '), area: `0,${h} ${pts.join(' ')} ${last[0]},${h}`, markers: mk, lastX: last[0], lastY: last[1], w, h };
  },
};

const Store = { getState: () => S, subscribe: f => { listeners.add(f); return () => listeners.delete(f); }, actions: A, sel: SEL, data: D, beats: BEATS };
window.CosignStore = Store;
window.dispatchEvent(new Event('cosign:ready'));

window.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); A.demoNext(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); A.demoPrev(); }
  else if (e.key === 'h' || e.key === 'H') A.demoHide();
  else if (e.key === 'p' || e.key === 'P') A.demoToggleAuto();
});
export default Store;
