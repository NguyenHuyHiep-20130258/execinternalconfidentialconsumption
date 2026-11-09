/* ===== app ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, dp = 2) => (isFinite(x) ? x : 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtD = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';
const fmtDY = d => d ? fmtD(d) + '/' + d.slice(0, 4) : '';
const fmtM = m => m ? m.slice(5, 7) + '/' + m.slice(0, 4) : '';
const clone = o => JSON.parse(JSON.stringify(o));
const FAC = { f1: 'F1', f2: 'F2' };
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const wkLabel = w => fmtD(w.from) + '–' + fmtD(w.to);
const nowStamp = () => { const d = new Date(); return d.toISOString(); };
const fmtStamp = s => { if (!s) return ''; const d = new Date(s); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

/* ---------- data ---------- */
const D = {}, NAMEMAP = {};
function seedFactory(f) {
  const s = SEED && SEED[f];
  if (!s || !s.models) { NAMEMAP[f] = new Map(); return { rows: [], weeks: [], report: {} }; }
  const cat = catalog(s.report);
  const mg = migrateV1(clone(s.models), s.rows, cat, ALIAS[f]);
  NAMEMAP[f] = mg.nameMap;
  return { rows: mg.rows, weeks: [{ id: 'w' + s.from.replace(/-/g, ''), from: s.from, to: s.to, locked: false, models: mg.models }], report: clone(s.report) };
}
for (const f of ['f1', 'f2']) D[f] = seedFactory(f);

const S = {
  fac: 'f2', tab: 'cmp', mtab: 'models',
  view: { f1: D.f1.weeks[0] ? D.f1.weeks[0].id : null, f2: D.f2.weeks[0] ? D.f2.weeks[0].id : null },
  sel: { f1: null, f2: null }, msel: { f1: 'm1', f2: 'm1' },
  q: '', hideZero: false, onlyDev: false, onlyFlag: false, mq: '',
  addRow: false, paste: false, newWeek: false, confirm: null, items: [], importMsg: '', undo: null,
  status: 'pending', statusNote: '', openMonth: null
};
const cur = () => D[S.fac];
const CAT = () => catalog(cur().report);
const weekById = (f, id) => D[f].weeks.find(w => w.id === id);
const sortWeeks = f => D[f].weeks.sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);

function ctx() {
  const d = cur(), v = S.view[S.fac];
  if (v && v.startsWith('M:')) {
    const mon = v.slice(2), ws = d.weeks.filter(w => w.from.slice(0, 7) === mon);
    const models = ws.flatMap(w => w.models.map(m => ({ id: w.id + '/' + m.id, name: m.name, prs: m.prs, lines: m.lines, wk: wkLabel(w) })));
    let from, to;
    if (ws.length) { from = ws.map(w => w.from).sort()[0]; to = ws.map(w => w.to).sort().pop(); }
    else { const ds = reportDates(d.report).filter(x => x.slice(0, 7) === mon); from = ds[0] || mon + '-01'; to = ds[ds.length - 1] || mon + '-28'; }
    return { kind: 'month', mon, weeks: ws, models, from, to, editable: false };
  }
  const w = weekById(S.fac, v) || d.weeks[d.weeks.length - 1];
  if (!w) return { kind: 'none', models: [], from: '', to: '', editable: false };
  S.view[S.fac] = w.id;
  return { kind: 'week', week: w, mon: w.from.slice(0, 7), models: w.models, from: w.from, to: w.to, editable: !w.locked && !Store.readonly };
}
let CALC = null, CTX = null;
function recalc() { CTX = ctx(); CALC = compute(CTX.models, cur().rows, cur().report, CTX.from, CTX.to, CAT()); return CALC; }
const itemById = id => CALC.list.find(x => x.id === id);
const modelOf = id => CTX.models.find(m => m.id === id);
const rangeLabel = (a, b) => a === b ? fmtD(b) : (a.slice(5, 7) === b.slice(5, 7) ? a.slice(8, 10) + '–' + fmtD(b) : fmtD(a) + '–' + fmtD(b));

function resolveChem(f, raw) {
  const k = norm(raw); if (!k) return '';
  const cat = catalog(D[f].report);
  if (cat.has(k)) return cat.get(k).name;
  if (NAMEMAP[f] && NAMEMAP[f].has(k)) return NAMEMAP[f].get(k);
  for (const r of D[f].rows) if (norm(r.name) === k) { const n = (r.rep || []).find(x => cat.has(norm(x))); if (n) return cat.get(norm(n)).name; }
  for (const [n] of ALIAS[f] || []) if (norm(n) === k && cat.has(k)) return cat.get(k).name;
  return clean(raw);
}

/* ---------- storage: db capability, fallback localStorage ---------- */
const Store = {
  db: null, mode: 'memory', chain: Promise.resolve(), timers: {}, rev: {}, dirty: new Set(), readonly: false,
  appInit: { f1: false, f2: false }, dbWeeks: { f1: new Map(), f2: new Map() }, waiting: 0,
  setStatus(s, note) { S.status = s; S.statusNote = note || ''; renderStatus(); },
  appBody(f) { return { v: 2, init: true, rows: D[f].rows }; },
  weekBody(w) { return { from: w.from, to: w.to, locked: !!w.locked, lockedAt: w.lockedAt || null, models: w.models }; },
  dayBody(rows) { return { rows: rows.map(r => ({ n: r[0], c: r[1], o: r[2], d: r[3], s: r[4] })) }; },
  dayRows(doc) { return (doc.rows || []).map(r => [r.n, r.c, r.o, r.d, r.s]); },
  async init() {
    let c = null;
    try { if (window.claude && window.claude.use) c = await window.claude.use('db'); } catch (e) { c = null; }
    if (c) { this.db = c; this.mode = 'db'; this.subscribe(); return; }
    if (GAS) { this.mode = 'sheet'; this.gas = true; this.sheetStart('', gasToken()); return; }
    const url = syncUrl();
    if (url && SYNC && SYNC.token) { this.mode = 'sheet'; this.sheetStart(url, SYNC.token); return; }
    this.mode = 'local';
    try {
      const raw = localStorage.getItem('hoachat-v2');
      if (raw) {
        const x = JSON.parse(raw);
        for (const f of ['f1', 'f2']) {
          if (x[f] && x[f].rows) { D[f].rows = x[f].rows; D[f].weeks = x[f].weeks; }
          if (x.rep && x.rep[f]) Object.assign(D[f].report, x.rep[f]);
          fixView(f);
        }
      }
    } catch (e) { /* ignore */ }
    this.setStatus('local');
    renderAll();
  },
  subscribe() {
    this.setStatus('pending');
    const timer = setTimeout(() => { if (S.status === 'pending') this.setStatus('slow'); }, 10000);
    let n = 0;
    const done = () => { if (++n === 6) { clearTimeout(timer); if (S.status === 'pending' || S.status === 'slow') this.setStatus('saved'); } };
    const err = e => { clearTimeout(timer); this.setStatus(e && e.code === 'revoked' ? 'readonly' : 'error', e && e.message); };
    for (const f of ['f1', 'f2']) {
      const ap = 'app/' + f;
      this.db.doc(ap).onSnapshot(snap => {
        if (!snap.metadata.hasPendingWrites && snap.exists) {
          const x = clone(snap.data());
          if (!x.v) { this.fromV1(f, x); }
          else if (x.rev !== this.rev[ap] && !this.dirty.has(ap)) { this.appInit[f] = true; D[f].rows = x.rows || D[f].rows; this.syncWeeks(f); renderAll(); }
          else this.appInit[f] = true;
        }
        done();
      }, err);
      this.db.collection('weeks_' + f).onSnapshot(qs => {
        for (const ch of qs.docChanges()) {
          if (ch.doc.metadata && ch.doc.metadata.hasPendingWrites) continue;
          if (ch.type === 'removed') this.dbWeeks[f].delete(ch.doc.id);
          else this.dbWeeks[f].set(ch.doc.id, Object.assign({ id: ch.doc.id }, clone(ch.doc.data())));
        }
        if (this.appInit[f]) { this.syncWeeks(f); renderAll(); }
        done();
      }, err);
      this.db.collection('report_' + f).onSnapshot(qs => {
        let ch = false;
        for (const doc of qs.docs) {
          if (doc.metadata && doc.metadata.hasPendingWrites) continue;
          const rows = this.dayRows(doc.data());
          if (JSON.stringify(D[f].report[doc.id] || []) !== JSON.stringify(rows)) { D[f].report[doc.id] = rows; ch = true; }
        }
        if (ch) renderAll();
        done();
      }, err);
    }
  },
  fromV1(f, x) { /* an app doc saved by the first version of this page */
    const cat = catalog(D[f].report);
    const mg = migrateV1(x.models || [], x.rows || [], cat, ALIAS[f]);
    D[f].rows = mg.rows;
    D[f].weeks = [{ id: 'w' + (x.from || '2026-10-01').replace(/-/g, ''), from: x.from, to: x.to, locked: false, models: mg.models }];
    fixView(f); this.markRows(f); this.markWeek(f, D[f].weeks[0]); renderAll();
  },
  syncWeeks(f) {
    const local = new Map(D[f].weeks.map(w => [w.id, w]));
    const out = [];
    for (const [id, w] of this.dbWeeks[f]) {
      const p = 'weeks_' + f + '/' + id;
      if (this.dirty.has(p) && local.has(id)) out.push(local.get(id));
      else if (w.rev !== this.rev[p] || !local.has(id)) out.push(w);
      else out.push(local.get(id));
    }
    for (const [id, w] of local) if (!this.dbWeeks[f].has(id) && this.dirty.has('weeks_' + f + '/' + id)) out.push(w);
    D[f].weeks = out; sortWeeks(f); fixView(f);
  },
  mark(path, body) {
    if (this.mode === 'local') { clearTimeout(this.timers.local); this.timers.local = setTimeout(() => this.saveLocal(), 500); return; }
    if (this.mode === 'sheet') {
      this.dirty.add(path); this.getters[path] = body; this.seq[path] = (this.seq[path] || 0) + 1;
      this.setStatus('saving'); clearTimeout(this.timers.sheet);
      if (this.ready) this.timers.sheet = setTimeout(() => this.sheetFlush(), 1000);
      return;
    }
    if (this.mode !== 'db' || this.readonly) return;
    this.dirty.add(path); this.setStatus('saving');
    clearTimeout(this.timers[path]);
    this.timers[path] = setTimeout(() => {
      const b = body(); const rev = Math.random().toString(36).slice(2);
      this.rev[path] = rev;
      this.enqueue(async () => {
        if (b === null) await this.db.doc(path).delete(); else await this.db.doc(path).set(Object.assign(b, { rev }));
        this.dirty.delete(path);
        if (!this.dirty.size && S.status === 'saving') this.setStatus('saved');
      });
    }, 700);
  },
  markRows(f) { this.mark('app/' + f, () => this.appBody(f)); },
  markWeek(f, w) { this.markRows(f); this.mark('weeks_' + f + '/' + w.id, () => (weekById(f, w.id) ? this.weekBody(weekById(f, w.id)) : null)); },
  dropWeek(f, id) { this.markRows(f); this.mark('weeks_' + f + '/' + id, () => null); },
  saveDay(f, date, rows) {
    if (this.mode === 'local') { this.mark('local'); return; }
    if (this.mode === 'sheet') { this.mark('report_' + f + '/' + date, () => this.dayBody(rows)); return; }
    if (this.mode !== 'db' || this.readonly) return;
    this.setStatus('saving');
    this.enqueue(async () => { await this.db.doc('report_' + f + '/' + date).set(this.dayBody(rows)); if (!this.dirty.size && S.status === 'saving') this.setStatus('saved'); });
  },
  enqueue(task) {
    this.chain = this.chain.then(task).catch(e => {
      if (e && e.code === 'invalid_argument') { this.readonly = true; this.setStatus('readonly'); renderAll(); }
      else if (e && e.code === 'quota_exceeded') this.setStatus('error', 'kho dữ liệu đã đầy');
      else this.setStatus('error', e && e.message);
    });
    return this.chain;
  },
  /* ----- Google Sheets (Apps Script web app) ----- */
  getters: {}, seq: {}, ready: false, lastT: 0, lastSync: 0,
  async sheetCall(body) {
    if (this.gas) { /* page served by Apps Script itself: google.script.run, signed in with Google */
      return new Promise((res, rej) => google.script.run
        .withSuccessHandler(j => (j && j.ok ? res(j) : rej({ code: (j && j.error) || 'server', message: j && j.message })))
        .withFailureHandler(e => rej({ code: 'server', message: e && e.message }))
        .api(Object.assign({ pw: this.token }, body)));
    }
    let r;
    try {
      r = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ pw: this.token }, body)) });
    } catch (e) { throw { code: 'network' }; }
    if (!r.ok) throw { code: 'http', message: 'HTTP ' + r.status };
    let j; try { j = await r.json(); } catch (e) { throw { code: 'http', message: 'phản hồi không hợp lệ' }; }
    if (!j.ok) throw { code: j.error || 'server', message: j.message };
    return j;
  },
  sheetError(e) {
    if (this.gas && e && e.code === 'unauthorized') { this.setStatus('error', 'cần mật khẩu'); askPassword(); return; }
    if (this.gas && e && e.code === 'forbidden') { this.setStatus('error', 'tài khoản Google này chưa được cấp quyền xem dữ liệu'); return; }
    const m = { unauthorized: 'mật khẩu ở Google Sheets không khớp với mật khẩu trang', not_configured: 'Google Sheets chưa đặt PASSWORD trong Script properties', network: 'không kết nối được Google Sheets, sẽ thử lại' };
    this.setStatus('error', m[e && e.code] || (e && e.message) || 'không rõ lỗi');
  },
  async sheetStart(url, token) {
    this.url = url; this.token = token;
    this.setStatus('pending');
    await this.sheetInitial();
    setInterval(() => this.sheetPoll(), 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sheetPoll(); });
  },
  async sheetInitial() {
    try {
      const j = await this.sheetCall({ op: 'pull', since: 0 });
      this.ready = true;
      if (!j.docs.length) await this.sheetSeed();
      else { this.applyDocs(j.docs, true); this.lastT = j.now; }
      this.lastSync = Date.now();
      if (this.dirty.size) await this.sheetFlush(); else this.setStatus('saved');
      renderAll();
    } catch (e) { this.sheetError(e); }
  },
  async sheetSeed() { /* an empty sheet: upload what this page starts with */
    for (const f of ['f1', 'f2']) {
      this.markRows(f);
      D[f].weeks.forEach(w => this.markWeek(f, w));
      for (const day of reportDates(D[f].report)) this.saveDay(f, day, D[f].report[day]);
    }
    clearTimeout(this.timers.sheet);
    await this.sheetFlush();
  },
  async sheetFlush() {
    if (!this.ready) return;
    if (this.flushing) { this.flushAgain = true; return; }
    const snap = [...this.dirty].map(p => ({ p, seq: this.seq[p], body: this.getters[p] ? this.getters[p]() : null }));
    if (!snap.length) return;
    this.flushing = true;
    let failed = false;
    try {
      const docs = snap.map(x => ({ key: x.p, rev: (this.rev[x.p] = Math.random().toString(36).slice(2)), body: x.body }));
      for (let i = 0; i < docs.length; i += 25) await this.sheetCall({ op: 'push', docs: docs.slice(i, i + 25) });
      for (const x of snap) if (this.seq[x.p] === x.seq) this.dirty.delete(x.p);
      this.lastSync = Date.now();
      if (!this.dirty.size) this.setStatus('saved');
    } catch (e) { failed = true; this.sheetError(e); }
    this.flushing = false;
    if (this.dirty.size && (this.flushAgain || !failed)) { this.flushAgain = false; clearTimeout(this.timers.sheet); this.timers.sheet = setTimeout(() => this.sheetFlush(), 800); }
    this.flushAgain = false;
  },
  async sheetPoll() {
    if (this.mode !== 'sheet' || document.hidden || this.polling) return;
    if (!this.ready) { await this.sheetInitial(); return; }
    this.polling = true;
    try {
      if (this.dirty.size && !this.flushing) await this.sheetFlush();
      const j = await this.sheetCall({ op: 'pull', since: this.lastT });
      if (j.docs.length && this.applyDocs(j.docs, false)) renderSafe();
      this.lastT = Math.max(this.lastT, j.now || 0);
      this.lastSync = Date.now();
      if (!this.dirty.size) this.setStatus('saved');
    } catch (e) { this.sheetError(e); }
    this.polling = false;
  },
  applyDocs(docs, initial) {
    let changed = false;
    if (initial) for (const f of ['f1', 'f2']) if (docs.some(d => d.key === 'app/' + f)) { D[f].weeks = []; changed = true; }
    for (const d of docs) {
      if (d.t > this.lastT) this.lastT = d.t;
      if (this.dirty.has(d.key)) continue;
      if (!initial && d.rev && d.rev === this.rev[d.key]) continue;
      const [col, id] = d.key.split('/');
      const f = col === 'app' ? id : col.split('_')[1];
      if (!D[f]) continue;
      if (col === 'app') { if (d.body && d.body.rows) { D[f].rows = d.body.rows; changed = true; } }
      else if (col.startsWith('weeks_')) {
        const i = D[f].weeks.findIndex(w => w.id === id);
        if (!d.body) { if (i >= 0) { D[f].weeks.splice(i, 1); changed = true; } }
        else { const w = Object.assign({ id }, d.body); if (i >= 0) D[f].weeks[i] = w; else D[f].weeks.push(w); changed = true; }
      } else if (col.startsWith('report_')) { D[f].report[id] = d.body ? this.dayRows(d.body) : []; changed = true; }
    }
    if (changed) for (const f of ['f1', 'f2']) { sortWeeks(f); fixView(f); }
    return changed;
  },
  saveLocal() {
    try {
      const rep = {};
      for (const f of ['f1', 'f2']) {
        rep[f] = {};
        for (const d of Object.keys(D[f].report)) if (JSON.stringify(D[f].report[d]) !== JSON.stringify(((SEED && SEED[f] && SEED[f].report) || {})[d] || [])) rep[f][d] = D[f].report[d];
      }
      localStorage.setItem('hoachat-v2', JSON.stringify({ f1: { rows: D.f1.rows, weeks: D.f1.weeks }, f2: { rows: D.f2.rows, weeks: D.f2.weeks }, rep }));
      this.setStatus('local');
    } catch (e) { this.setStatus('memory'); }
  }
};
function fixView(f) {
  const v = S.view[f];
  if (v && v.startsWith('M:')) return;
  if (!weekById(f, v)) S.view[f] = D[f].weeks.length ? D[f].weeks[D[f].weeks.length - 1].id : null;
}
const GAS = typeof google !== 'undefined' && google.script && google.script.run;
function gasToken() { try { return sessionStorage.getItem('hc-pw') || ''; } catch (e) { return ''; } }
/* Apps Script deployments that cannot tell who the viewer is ask for the page password */
function askPassword() {
  if (document.getElementById('pwgate')) return;
  const f = document.createElement('form');
  f.id = 'pwgate'; f.className = 'pwgate';
  f.innerHTML = '<div class="pwbox" role="dialog" aria-labelledby="pw-t"><b id="pw-t">Nhập mật khẩu để mở dữ liệu</b><p class="mute">Mật khẩu do người quản lý trang cung cấp.</p><label for="pw-in">Mật khẩu<input id="pw-in" type="password" required autocomplete="current-password"></label><p class="pwerr" id="pw-err" hidden>Sai mật khẩu. Thử lại.</p><button class="btn primary" type="submit">Mở dữ liệu</button></div>';
  document.body.appendChild(f);
  if (Store.token) f.querySelector('#pw-err').hidden = false;
  f.querySelector('#pw-in').focus();
  f.addEventListener('submit', e => {
    e.preventDefault(); e.stopPropagation();
    const pw = f.querySelector('#pw-in').value;
    try { sessionStorage.setItem('hc-pw', pw); } catch (x) { /* ignore */ }
    Store.token = pw; f.remove(); Store.setStatus('pending'); Store.sheetInitial();
  });
}
function syncUrl() {
  let u = '';
  try { u = localStorage.getItem('hc-sync-url') || ''; } catch (e) { /* ignore */ }
  return u || (SYNC && SYNC.url) || '';
}
/* a remote change arrives while someone is typing: wait until they leave the field */
function renderSafe() {
  const a = document.activeElement;
  if (CP.open || (a && a.matches && a.matches('input:not([type=checkbox]):not([type=radio]), textarea, select') && a.closest('main, #period'))) { S.pendingRender = true; return; }
  renderAll();
}
document.addEventListener('focusout', () => {
  if (!S.pendingRender) return;
  setTimeout(() => { const a = document.activeElement; if (!(a && a.matches && a.matches('input, textarea, select'))) { S.pendingRender = false; renderAll(); } }, 0);
});
const touchWeek = () => { if (CTX && CTX.week) Store.markWeek(S.fac, CTX.week); };
const touchRows = () => Store.markRows(S.fac);

const STATUS = {
  pending: ['wait', 'Đang kết nối kho dữ liệu…'], slow: ['warn', 'Chưa kết nối được kho dữ liệu, đang dùng dữ liệu có sẵn trên trang'],
  saving: ['wait', 'Đang lưu…'], saved: ['ok', 'Đã lưu'], local: ['warn', 'Chỉ lưu trong trình duyệt này'],
  readonly: ['warn', 'Chỉ xem: tài khoản này không có quyền ghi'], error: ['bad', 'Lưu lỗi'], memory: ['warn', 'Không lưu được, dữ liệu mất khi đóng trang']
};
function renderStatus() {
  let [k, t] = STATUS[S.status] || STATUS.pending;
  if (Store.mode === 'sheet') {
    if (S.status === 'saved') t = 'Đã đồng bộ Google Sheets' + (Store.lastSync ? ' · ' + fmtStamp(new Date(Store.lastSync).toISOString()).slice(6) : '');
    if (S.status === 'pending') t = 'Đang tải dữ liệu từ Google Sheets…';
    if (S.status === 'error') t = 'Đồng bộ lỗi';
  }
  const el = $('#status'); if (!el) return;
  el.className = 'status ' + k;
  $('#status-t').textContent = t + (S.statusNote && S.status === 'error' ? ': ' + S.statusNote : '');
}

/* ---------- shared bits ---------- */
function chemOptions(selected, filter) {
  const cat = CAT(); const sk = norm(selected);
  let h = '<option value="">— chọn hóa chất trong Report —</option>';
  for (const [k, c] of cat) { if (filter && !filter(k)) continue; h += `<option value="${esc(c.name)}"${k === sk ? ' selected' : ''}>${esc(c.name)}${c.code ? ' · ' + esc(c.code) : ''}</option>`; }
  if (selected && !cat.has(sk)) h += `<option value="${esc(selected)}" selected>${esc(selected)} (không có trong Report)</option>`;
  return h;
}
/* ---------- searchable picker (chemicals from the Report, models) ---------- */
const chemLabel = v => { const c = CAT().get(norm(v)); return c ? c.name + (c.code ? ' · ' + c.code : '') : v + ' (không có trong Report)'; };
function pickBtn({ id, kind, value = '', label = '', ph, extra = '', disabled = false, exclude = '' }) {
  return `<button type="button" class="cp-btn" id="${id}" data-cp="${kind}" data-v="${esc(value)}" data-x="${esc(exclude)}" data-ph="${esc(ph)}" ${extra} ${disabled ? 'disabled' : ''} aria-haspopup="listbox" aria-expanded="false">`
    + `<span class="cp-t">${value ? esc(label) : `<span class="mute">${esc(ph)}</span>`}</span><span class="cp-car" aria-hidden="true"></span></button>`;
}
function setPick(btn, v, label) {
  btn.dataset.v = v;
  btn.querySelector('.cp-t').innerHTML = v ? esc(label) : `<span class="mute">${esc(btn.dataset.ph)}</span>`;
}
const CP = { open: false, btn: null, items: [], shown: [], active: 0 };
function pickItems(btn) {
  if (btn.dataset.cp === 'model') {
    const it = itemById(S.sel[S.fac]); const have = new Set(it ? drillLines(it.id).map(x => x.m.id) : []);
    return CTX.models.filter(m => !have.has(m.id)).map(m => ({ v: m.id, t: m.name || '(chưa đặt tên)', s: fmt(toNum(m.prs), 0) + ' prs', label: m.name || m.id }));
  }
  const out = [];
  for (const [k, c] of CAT()) if (k !== btn.dataset.x) out.push({ v: c.name, t: c.name, s: c.code, label: c.name + (c.code ? ' · ' + c.code : '') });
  return out;
}
function cpPop() {
  let el = document.getElementById('cp-pop');
  if (!el) {
    el = document.createElement('div'); el.id = 'cp-pop'; el.className = 'cp-pop'; el.hidden = true;
    el.innerHTML = '<input id="cp-q" type="search" autocomplete="off" aria-label="Tìm" aria-controls="cp-list"><ul id="cp-list" role="listbox"></ul>';
    document.body.appendChild(el);
    el.querySelector('#cp-q').addEventListener('input', () => { CP.active = 0; cpRender(); });
    el.querySelector('#cp-q').addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); CP.active = Math.max(0, Math.min(CP.shown.length - 1, CP.active + (e.key === 'ArrowDown' ? 1 : -1))); cpRender(true); }
      else if (e.key === 'Enter') { e.preventDefault(); if (CP.shown[CP.active]) cpPick(CP.shown[CP.active]); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); const b = CP.btn; cpClose(); if (b && document.body.contains(b)) b.focus(); }
    });
  }
  return el;
}
function cpOpen(btn) {
  const pop = cpPop();
  CP.open = true; CP.btn = btn; CP.items = pickItems(btn); CP.active = 0;
  btn.setAttribute('aria-expanded', 'true');
  const q = pop.querySelector('#cp-q');
  q.value = ''; q.placeholder = btn.dataset.cp === 'model' ? 'Tìm model' : 'Tìm tên hóa chất hoặc mã vật tư';
  pop.hidden = false; cpPlace(); cpRender();
  const cur = CP.shown.findIndex(x => x.v === btn.dataset.v); if (cur >= 0) { CP.active = cur; cpRender(true); }
  q.focus();
}
function cpPlace() {
  const pop = cpPop(), r = CP.btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const w = Math.min(vw - 16, Math.max(r.width, 340));
  pop.style.width = w + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
  const below = vh - r.bottom - 12, above = r.top - 12, up = below < 260 && above > below;
  const h = Math.min(420, Math.max(180, up ? above : below));
  pop.style.maxHeight = h + 'px';
  pop.style.top = (up ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
}
function cpRender(keepScroll) {
  const pop = cpPop(), q = norm(pop.querySelector('#cp-q').value), toks = q ? q.split(' ') : [];
  CP.shown = CP.items.filter(x => { const h = norm(x.t + ' ' + x.s); return toks.every(t => h.includes(t)); });
  const hl = s => { let h = esc(s); for (const t of toks) { if (!t) continue; const i = norm(s).indexOf(t); if (i >= 0 && norm(s).length === s.length) { h = esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + t.length)) + '</mark>' + esc(s.slice(i + t.length)); break; } } return h; };
  const ul = pop.querySelector('#cp-list');
  ul.innerHTML = CP.shown.map((x, i) => `<li role="option" data-i="${i}" class="${i === CP.active ? 'on' : ''} ${x.v === CP.btn.dataset.v ? 'cur' : ''}" aria-selected="${i === CP.active}"><span>${hl(x.t)}</span>${x.s ? `<small>${hl(x.s)}</small>` : ''}</li>`).join('')
    || `<li class="none">Không có ${CP.btn.dataset.cp === 'model' ? 'model' : 'hóa chất'} nào khớp "${esc(pop.querySelector('#cp-q').value)}"</li>`;
  const on = ul.querySelector('li.on'); if (on && keepScroll) on.scrollIntoView({ block: 'nearest' });
}
function cpClose() {
  if (!CP.open) return;
  CP.open = false; cpPop().hidden = true;
  if (CP.btn) CP.btn.setAttribute('aria-expanded', 'false');
  if (S.pendingRender) { S.pendingRender = false; renderAll(); }
}
function cpPick(x) {
  const btn = CP.btn; cpClose();
  if (!btn || !document.body.contains(btn)) return;
  setPick(btn, x.v, x.label);
  if (btn.dataset.l !== undefined && btn.dataset.cp === 'chem' && CTX.editable) {
    const i = +btn.dataset.l, m = modelOf(S.msel[S.fac]); if (!m || !m.lines[i]) return;
    m.lines[i].chem = x.v; touchWeek(); renderMedit();
    const g = document.getElementById('lg-' + i); if (g) { g.focus(); g.select(); }
  } else btn.focus();
}
window.addEventListener('resize', () => { if (CP.open) cpPlace(); });
document.addEventListener('scroll', e => {
  if (!CP.open || (e.target.closest && e.target.closest('#cp-pop'))) return;
  const r = CP.btn.getBoundingClientRect();
  if (!document.body.contains(CP.btn) || r.bottom < 0 || r.top > window.innerHeight) cpClose(); else cpPlace();
}, true);

function ratioInfo(a, r) {
  if (!r && !a) return { t: '—', c: 'mute' };
  if (!r) return { t: 'Chỉ Actual', c: 'bad' };
  const x = a / r, dv = Math.abs(x - 1);
  return { t: Math.round(x * 100) + '%', c: dv <= 0.1 ? 'ok' : dv <= 0.25 ? 'warn' : 'bad' };
}
function similarity(a, b) {
  const bg = s => { s = norm(s).replace(/LOCTITE BONDACE|\(.*?\)|\d+\s*KG/g, '').replace(/[^A-Z0-9]/g, ''); const o = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); o.set(g, (o.get(g) || 0) + 1); } return [o, Math.max(1, s.length - 1)]; };
  const [x, nx] = bg(a), [y, ny] = bg(b); let c = 0;
  for (const [g, n] of x) c += Math.min(n, y.get(g) || 0);
  return (2 * c) / (nx + ny);
}

/* ---------- period bar (month, week, confirm) ---------- */
function monthsOf(d) {
  const s = new Set(d.weeks.map(w => w.from.slice(0, 7)));
  reportDates(d.report).forEach(x => s.add(x.slice(0, 7)));
  return [...s].sort();
}
function lockChecks(w) {
  const out = [], cat = CAT();
  const zero = w.models.filter(m => m.lines.some(l => toNum(l.g) > 0) && !toNum(m.prs));
  if (zero.length) out.push(`${zero.length} model có hóa chất nhưng Total prs = 0: ${zero.slice(0, 6).map(m => esc(m.name)).join(', ')}${zero.length > 6 ? '…' : ''}`);
  const days = reportDates(cur().report).filter(x => x >= w.from && x <= w.to).length;
  if (!days) out.push('Chưa có ngày Report nào trong tuần này');
  const notIn = new Set(); w.models.forEach(m => m.lines.forEach(l => { if (l.chem && !cat.has(norm(l.chem))) notIn.add(clean(l.chem)); }));
  if (notIn.size) out.push(`${notIn.size} hóa chất không có trong Report: ${[...notIn].slice(0, 6).map(esc).join(', ')}${notIn.size > 6 ? '…' : ''}`);
  const empty = w.models.filter(m => !m.lines.length).length;
  if (empty) out.push(`${empty} model chưa có hóa chất`);
  return out;
}
function renderPeriod() {
  const d = cur(), c = CTX, el = $('#period');
  if (S.tab === 'rep') { el.hidden = true; return; }
  el.hidden = false;
  const months = monthsOf(d); const mon = c.mon || months[months.length - 1];
  const ws = d.weeks.filter(w => w.from.slice(0, 7) === mon);
  let h = !months.length ? `<div class="pbar"><span class="mute">${FAC[S.fac]} chưa có tuần nào.</span><span class="grow"></span><button class="btn" data-a="wnew" ${Store.readonly ? 'disabled' : ''}>+ Tuần mới</button></div>` : `<div class="pbar">
    <label for="pm">Tháng</label><select id="pm" data-c="month">${months.map(m => `<option value="${m}"${m === mon ? ' selected' : ''}>${fmtM(m)}</option>`).join('')}</select>
    <div class="wchips" role="tablist" aria-label="Tuần">${ws.map(w => `<button role="tab" class="wchip ${c.kind === 'week' && c.week.id === w.id ? 'on' : ''}" data-a="wsel" data-w="${w.id}" aria-selected="${c.kind === 'week' && c.week.id === w.id}"><span>${wkLabel(w)}</span><small>W${isoWeek(w.from)} · ${w.locked ? 'đã xác nhận' : 'nháp'}</small>${w.locked ? '<i class="lk" aria-hidden="true"></i>' : ''}</button>`).join('')}
      <button role="tab" class="wchip ${c.kind === 'month' ? 'on' : ''}" data-a="msel-all" data-m="${mon}" aria-selected="${c.kind === 'month'}"><span>Cả tháng</span><small>${ws.length} tuần</small></button></div>
    <button class="btn" data-a="wnew" ${Store.readonly ? 'disabled' : ''}>+ Tuần mới</button></div>`;
  if (S.newWeek) {
    const last = d.weeks[d.weeks.length - 1];
    const today = new Date().toISOString().slice(0, 10);
    let nf = last ? addDays(last.to, 1) : (reportDates(d.report).length ? addDays(reportDates(d.report).slice(-1)[0], -((weekday(reportDates(d.report).slice(-1)[0]) + 6) % 7)) : addDays(today, -((weekday(today) + 6) % 7)));
    if (weekday(nf) === 0) nf = addDays(nf, 1);
    const nt = addDays(nf, 5);
    h += `<form class="newweek" data-form="newweek">
      <label for="nw-from">Từ ngày<input type="date" id="nw-from" value="${nf}" required></label>
      <label for="nw-to">Đến ngày<input type="date" id="nw-to" value="${nt}" required></label>
      <label for="nw-src">Chép định mức từ<select id="nw-src">${d.weeks.slice().reverse().map(w => `<option value="${w.id}">Tuần ${wkLabel(w)}${w.locked ? ' (đã xác nhận)' : ''}</option>`).join('')}<option value="">Không chép, tuần trống</option></select></label>
      <fieldset><legend>Total prs</legend><label class="chk"><input type="radio" name="nw-prs" id="nw-keep" value="keep" checked> Giữ như tuần chép</label><label class="chk"><input type="radio" name="nw-prs" id="nw-blank" value="blank"> Để trống, nhập mới</label></fieldset>
      <div class="mact"><button class="btn primary" type="submit">Tạo tuần</button><button class="btn" type="button" data-a="wnew">Hủy</button></div></form>`;
  }
  if (c.kind === 'week') {
    const w = c.week;
    h += `<div class="wkbar ${w.locked ? 'locked' : ''}">
      <div class="wkinfo"><b>Tuần ${wkLabel(w)}/${w.to.slice(0, 4)}</b><span class="pill ${w.locked ? 'ok' : 'draft'}">${w.locked ? 'Đã xác nhận ' + fmtStamp(w.lockedAt) : 'Nháp, chưa xác nhận'}</span></div>
      ${w.locked ? `<span class="mute">Định mức và Total prs của tuần này đã khóa.</span>` : `<label for="wf">Từ<input type="date" id="wf" value="${w.from}" data-c="wdate"></label><label for="wt">Đến<input type="date" id="wt" value="${w.to}" data-c="wdate"></label>`}
      <span class="grow"></span>
      ${Store.readonly ? '' : w.locked ? `<button class="btn" data-a="wunlock">${S.confirm === 'unlock' ? 'Bấm lần nữa để mở khóa' : 'Mở khóa để sửa'}</button>` : `<button class="btn primary" data-a="wlock">Xác nhận tuần</button><button class="btn danger" data-a="wdel">${S.confirm === 'wdel' ? 'Bấm lần nữa để xóa tuần' : 'Xóa tuần'}</button>`}
    </div>`;
    if (S.confirm === 'lock' && !w.locked) {
      const ck = lockChecks(w);
      h += `<div class="confirm" role="alertdialog" aria-labelledby="cf-t"><b id="cf-t">Xác nhận tuần ${wkLabel(w)}?</b>
        <p>Sau khi xác nhận, g/prs và Total prs của ${w.models.length} model trong tuần này được giữ cố định. Report vẫn cập nhật khi bạn nhập thêm ngày.</p>
        ${ck.length ? `<ul class="checks">${ck.map(x => `<li>${x}</li>`).join('')}</ul>` : '<p class="okt">Không thấy vấn đề nào cần xem lại.</p>'}
        <div class="mact"><button class="btn primary" data-a="wlock-ok">Xác nhận và khóa tuần</button><button class="btn" data-a="wlock-no">Để sau</button></div></div>`;
    }
  } else if (c.kind === 'month') {
    const nl = c.weeks.filter(w => w.locked).length;
    h += `<p class="note">Cả tháng ${fmtM(c.mon)}: gộp ${c.weeks.length} tuần (${nl} đã xác nhận), Report từ ${fmtDY(c.from)} đến ${fmtDY(c.to)}. Màn hình này chỉ để xem; chọn một tuần để sửa.</p>`;
  }
  el.innerHTML = h;
}

/* ---------- Comparison ---------- */
function visibleItems() {
  const q = norm(S.q);
  return CALC.list.filter(it => {
    if (q && !norm(it.name + ' ' + it.code + ' ' + it.rep.join(' ')).includes(q)) return false;
    if (S.hideZero && !it.actual && !it.report && !it.stock) return false;
    if (S.onlyDev && ratioInfo(it.actual, it.report).c !== 'bad') return false;
    if (S.onlyFlag && !it.flag) return false;
    return true;
  });
}
function renderCmp() {
  const c = CTX;
  $('#view-cmp').innerHTML = `
  <section class="tiles" aria-label="Tổng hợp">
    <div class="tile"><span>Actual (kg)</span><b id="tA"></b></div>
    <div class="tile"><span id="tRl">Report</span><b id="tR"></b></div>
    <div class="tile"><span>Actual / Report</span><b id="tP"></b></div>
    <div class="tile"><span id="tSl">Stock</span><b id="tS"></b></div>
  </section>
  ${c.kind === 'none' ? `<div class="note start"><b>Bắt đầu với ${FAC[S.fac]}</b><ol><li>Vào tab <b>Report</b>, chọn file Chemical Daily Report (.xls/.xlsx) để có danh sách hóa chất và số Output.</li><li>Bấm <b>+ Tuần mới</b> ở trên để tạo tuần cần đối chiếu.</li><li>Vào tab <b>Model (Summary)</b>, thêm model, Total prs và g/prs từng hóa chất. Bảng này sẽ hiện Actual so với Report.</li></ol></div>`
    : reportDates(cur().report).some(x => x >= c.from && x <= c.to) ? '' : `<p class="note warn">Chưa có dữ liệu Report từ ${fmtDY(c.from)} đến ${fmtDY(c.to)}. Vào tab Report để nhập Chemical Daily Report.</p>`}
  <div class="bar">
    <input id="q" type="search" placeholder="Tìm hóa chất hoặc mã" value="${esc(S.q)}" data-i="q" aria-label="Tìm hóa chất">
    <label class="chk" for="of"><input type="checkbox" id="of" data-c="of" ${S.onlyFlag ? 'checked' : ''}> Actual có, Report không <span class="count" id="fcount"></span></label>
    <label class="chk" for="od"><input type="checkbox" id="od" data-c="od" ${S.onlyDev ? 'checked' : ''}> Lệch trên 25%</label>
    <label class="chk" for="hz"><input type="checkbox" id="hz" data-c="hz" ${S.hideZero ? 'checked' : ''}> Ẩn dòng bằng 0</label>
    <span class="grow"></span>
    <button class="btn" data-a="addrow">+ Thêm dòng</button>
    <button class="btn" data-a="export" id="btn-export" ${canSave() ? '' : 'hidden'}>Xuất Excel</button>
  </div>
  ${S.addRow ? `<form class="addrow" data-form="addrow">
      <label for="ar-name">Tên hiển thị<input id="ar-name" required></label>
      <label for="ar-rep">Hóa chất trong Report${pickBtn({ id: 'ar-rep', kind: 'chem', ph: 'Chọn hoặc tìm hóa chất' })}</label>
      <button class="btn primary" type="submit">Thêm dòng</button><button class="btn" type="button" data-a="addrow">Hủy</button></form>` : ''}
  <div class="split">
    <div class="tablewrap"><table class="grid" id="cmpt">
      <thead><tr><th class="n">#</th><th>Hóa chất</th><th class="r">Actual (kg)</th><th class="r" id="thR"></th><th class="r">A / R</th><th class="r" id="thS"></th><th></th></tr></thead>
      <tbody id="cmpb"></tbody><tfoot id="cmpf"></tfoot></table></div>
    <aside class="drill" id="drill" aria-live="polite"></aside>
  </div>`;
  renderCmpRows(); renderDrill(); refreshCmp();
}
function renderCmpRows() {
  const items = visibleItems();
  $('#cmpb').innerHTML = items.map((it, i) => `<tr data-a="sel" data-id="${esc(it.id)}" class="${S.sel[S.fac] === it.id ? 'sel' : ''} ${it.kind}" tabindex="0">
      <td class="n">${i + 1}</td><td class="nm">${esc(it.name)}<small>${esc([it.code, it.kind === 'cat' ? 'chưa có dòng riêng' : '', it.kind === 'x' ? 'không có trong Report' : '', it.rep.length > 1 ? 'gộp ' + it.rep.length + ' tên Report' : ''].filter(Boolean).join(' · '))}</small></td>
      <td class="r num" data-v="a"></td><td class="r num" data-v="r"></td><td class="r"><span class="pill" data-v="p"></span></td><td class="r num" data-v="s"></td>
      <td>${it.flag && CTX.editable ? `<button class="btn sm warnb" data-a="swapgo" data-id="${esc(it.id)}">Đổi chất</button>` : ''}</td></tr>`).join('')
    || `<tr><td colspan="7" class="empty-r">${CALC.list.length ? 'Không có dòng nào khớp bộ lọc.' : 'Chưa có hóa chất nào. Nhập Chemical Daily Report ở tab Report để bắt đầu.'}</td></tr>`;
  refreshCmp();
}
function refreshCmp() {
  recalc();
  const set = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  for (const tr of $$('#cmpb tr[data-id]')) {
    const it = itemById(tr.dataset.id); if (!it) continue;
    const x = ratioInfo(it.actual, it.report);
    set(tr.querySelector('[data-v="a"]'), fmt(it.actual)); set(tr.querySelector('[data-v="r"]'), fmt(it.report)); set(tr.querySelector('[data-v="s"]'), fmt(it.stock));
    const p = tr.querySelector('[data-v="p"]'); set(p, x.t); p.className = 'pill ' + x.c;
  }
  const lbl = rangeLabel(CTX.from, CTX.to);
  set($('#tA'), fmt(CALC.tA)); set($('#tR'), fmt(CALC.tR)); set($('#tS'), fmt(CALC.tS));
  set($('#tRl'), 'Report ' + lbl + ' (kg)'); set($('#thR'), 'Report ' + lbl); set($('#tSl'), 'Stock ' + fmtD(CTX.to) + ' (kg)'); set($('#thS'), 'Stock ' + fmtD(CTX.to));
  set($('#fcount'), String(CALC.flagged));
  const tx = ratioInfo(CALC.tA, CALC.tR), tp = $('#tP'); if (tp) { tp.textContent = tx.t; tp.className = 'big ' + tx.c; }
  const frow = (lab, a, r, cls = '') => `<tr class="${cls}"><td></td><td class="nm">${lab}</td><td class="r num">${a == null ? '' : fmt(a)}</td><td class="r num">${fmt(r)}</td><td class="r">${a == null ? '' : `<span class="pill ${ratioInfo(a, r).c}">${ratioInfo(a, r).t}</span>`}</td><td></td><td></td></tr>`;
  let f = frow('TỔNG HÓA CHẤT', CALC.tA, CALC.tR, 'tot');
  if (CALC.hasAdj) f += frow('Tổng không tính ' + cur().rows.filter(r => r.adj === 0).map(r => esc(r.name)).join(', '), CALC.tAadj, CALC.tRadj);
  f += frow('WASTE CHEMICAL (chỉ có ở Report)', null, CALC.waste);
  f += frow('TỔNG GỒM WASTE', null, CALC.tR + CALC.waste, 'tot');
  const cf = $('#cmpf'); if (cf) cf.innerHTML = f;
}

/* drill-down: every model line counted in the selected row */
function drillLines(id) {
  const out = [];
  CTX.models.forEach(m => m.lines.forEach((l, li) => { if (CALC.idOf(l.chem) === id) out.push({ m, l, li }); }));
  return out;
}
function renderDrill() {
  const el = $('#drill'); if (!el) return;
  const it = itemById(S.sel[S.fac]);
  if (!it) {
    el.classList.remove('open');
    el.innerHTML = `<div class="empty"><b>Chọn một hóa chất</b><p>Bấm vào một dòng ở bảng. Danh sách model chạy hóa chất đó hiện ở đây; sửa g/prs hoặc Total prs thì Actual đổi ngay.</p><p>Dòng có nút <b>Đổi chất</b> là chất có Actual nhưng Report không có trong khoảng ngày này.</p></div>`;
    return;
  }
  el.classList.add('open');
  const ed = CTX.editable, L = drillLines(it.id), cat = CAT();
  const models = new Set(L.map(x => x.m.id));
  const addable = CTX.models.filter(m => !models.has(m.id));
  const multi = it.rep.length > 1 || L.some(x => norm(x.l.chem) !== norm(L[0].l.chem));
  let sugg = [];
  if (it.flag) {
    const cands = CALC.list.filter(x => x.id !== it.id && x.kind !== 'x' && x.report > 0 && x.actual < 0.0005);
    sugg = cands.map(x => ({ x, s: similarity(it.name, x.name) })).sort((a, b) => b.s - a.s).slice(0, 5).map(o => o.x);
  }
  const lockedNote = CTX.kind === 'month' ? 'Đang xem cả tháng: chỉ đọc. Chọn một tuần để sửa.' : (CTX.week && CTX.week.locked ? 'Tuần này đã xác nhận nên không sửa được. Bấm "Mở khóa để sửa" ở thanh tuần nếu cần.' : '');
  el.innerHTML = `
  <header><div><h2>${esc(it.name)}</h2><div class="sub">${esc([it.code, it.kind === 'x' ? 'không có trong Report' : it.rep.length ? 'Report: ' + it.rep.join(' + ') : ''].filter(Boolean).join(' · '))}</div></div>
    <button class="icon" data-a="closedrill" aria-label="Đóng">×</button></header>
  <div class="dsum"><span>Actual</span><b id="d-act"></b><span class="mute" id="d-rep"></span></div>
  ${lockedNote ? `<p class="note">${lockedNote}</p>` : ''}
  ${it.flag ? `<p class="note warn">Actual có ${fmt(it.actual)} kg nhưng Report ${it.kind === 'x' ? 'không có chất này' : 'bằng 0 trong khoảng ngày này'}. Có thể xưởng đang dùng chất khác trong Report: chọn các dòng bên dưới rồi đổi sang chất đúng.</p>` : ''}
  <div class="dtable"><table class="grid compact"><thead><tr>${ed ? '<th><input type="checkbox" id="d-all" data-c="dall" checked aria-label="Chọn tất cả"></th>' : ''}<th>Model</th>${multi ? '<th>Chất</th>' : ''}<th class="r">g/prs</th><th class="r">Total prs</th><th class="r">kg</th>${ed ? '<th></th>' : ''}</tr></thead>
  <tbody>${L.map(({ m, l, li }) => `<tr>${ed ? `<td><input type="checkbox" class="d-pick" data-m="${esc(m.id)}" data-l="${li}" checked aria-label="Chọn ${esc(m.name)}"></td>` : ''}
     <td class="nm">${esc(m.name || '(chưa đặt tên)')}${m.wk ? `<small>Tuần ${esc(m.wk)}</small>` : ''}</td>${multi ? `<td class="mute">${esc(l.chem)}</td>` : ''}
     <td class="r">${ed ? `<input class="num" inputmode="decimal" id="dg-${esc(m.id)}-${li}" value="${esc(l.g)}" data-i="dg" data-m="${esc(m.id)}" data-l="${li}" aria-label="g/prs ${esc(m.name)}">` : `<span class="num">${esc(l.g)}</span>`}</td>
     <td class="r">${ed ? `<input class="num" inputmode="decimal" id="dp-${esc(m.id)}-${li}" value="${esc(m.prs)}" data-i="dprs" data-m="${esc(m.id)}" aria-label="Total prs ${esc(m.name)}">` : `<span class="num">${fmt(toNum(m.prs), 0)}</span>`}</td>
     <td class="r num" data-kg="${esc(m.id)}:${li}"></td>
     ${ed ? `<td><button class="icon sm" data-a="dline-del" data-m="${esc(m.id)}" data-l="${li}" aria-label="Bỏ chất này khỏi ${esc(m.name)}" title="Bỏ khỏi model">×</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="7" class="empty-r">Chưa có model nào chạy chất này${CTX.kind === 'week' ? ' trong tuần này' : ''}.</td></tr>`}</tbody>
  <tfoot><tr>${ed ? '<td></td>' : ''}<td class="nm">Cộng</td>${multi ? '<td></td>' : ''}<td class="r num" id="d-sg"></td><td></td><td class="r num" id="d-sk"></td>${ed ? '<td></td>' : ''}</tr></tfoot></table></div>
  ${ed ? `<p class="hint">Total prs là của cả model trong tuần này: đổi ở đây cũng đổi các chất khác của model đó.</p>` : ''}
  ${ed && L.length ? `<section class="swap ${it.flag ? 'hot' : ''}" id="swap"><h3>Đổi chất cho các dòng đã chọn</h3>
    <div class="dadd">${pickBtn({ id: 'sw-to', kind: 'chem', ph: 'Tìm chất thay thế', exclude: norm(L[0].l.chem), extra: 'aria-label="Đổi sang chất"' })}<button class="btn ${it.flag ? 'primary' : ''}" data-a="swap">Đổi chất</button></div>
    ${sugg.length ? `<div class="sugg"><span class="mute">Gợi ý (có Report, chưa có Actual):</span>${sugg.map(x => `<button class="chip" data-a="sugg" data-n="${esc((x.rep.map(n => cat.get(norm(n))).find(Boolean) || { name: x.name }).name)}">${esc(x.name)} <small>${fmt(x.report)} kg</small></button>`).join('')}</div>` : ''}
  </section>` : ''}
  ${S.undo && S.undo.f === S.fac ? `<p class="note">${esc(S.undo.msg)} <button class="btn sm" data-a="undo">Hoàn tác</button></p>` : ''}
  ${ed && it.kind !== 'x' ? `<div class="dadd">${pickBtn({ id: 'd-addm', kind: 'model', ph: 'Tìm model cần thêm', extra: 'aria-label="Model cần thêm"', disabled: !addable.length })}
    ${it.rep.length > 1 ? `<select id="d-addc" aria-label="Tên trong Report">${it.rep.map(n => `<option>${esc(n)}</option>`).join('')}</select>` : ''}
    <input id="d-addg" class="num" inputmode="decimal" placeholder="g/prs" aria-label="g/prs">
    <button class="btn" data-a="dline-add" ${addable.length ? '' : 'disabled'}>Thêm model chạy chất này</button></div>` : ''}
  ${it.kind === 'row' ? `<details class="rowset"><summary>Cài đặt dòng</summary>
    <label for="rs-name">Tên hiển thị<input id="rs-name" value="${esc(it.name)}" data-i="rs-name"></label>
    <label for="rs-rep">Tên trong Report được cộng vào dòng này (cách nhau bằng dấu ;)<input id="rs-rep" value="${esc(it.rep.join('; '))}" data-i="rs-rep" list="catlist"></label>
    <label class="chk" for="rs-adj"><input type="checkbox" id="rs-adj" data-c="rs-adj" ${it.adj === 0 ? '' : 'checked'}> Tính vào tổng đã điều chỉnh</label>
    <button class="btn danger" data-a="row-del">${S.confirm === 'row:' + it.id ? 'Bấm lần nữa để xóa dòng' : 'Xóa dòng này'}</button>
    <datalist id="catlist">${[...cat.values()].map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
  </details>` : it.kind === 'cat' ? `<p class="hint">Chất này có trong Report nhưng chưa có dòng riêng ở bảng Comparison. <button class="btn sm" data-a="pin">Tạo dòng riêng</button></p>` : ''}`;
  refreshDrill();
}
function refreshDrill() {
  const it = itemById(S.sel[S.fac]); if (!it) return;
  let sg = 0, sk = 0;
  for (const { m, l, li } of drillLines(it.id)) {
    const kg = lineKg(m, l); sg += toNum(l.g); sk += kg;
    const e = document.querySelector(`[data-kg="${CSS.escape(m.id)}:${li}"]`); if (e) e.textContent = fmt(kg);
  }
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  set('d-sg', fmt(sg, 3)); set('d-sk', fmt(sk)); set('d-act', fmt(sk) + ' kg');
  set('d-rep', 'Report ' + fmt(it.report) + ' kg · ' + ratioInfo(it.actual, it.report).t);
}

/* ---------- Models ---------- */
function renderModels() {
  const sub = `<div class="subtabs" role="tablist"><button role="tab" class="${S.mtab === 'models' ? 'on' : ''}" data-a="mtab" data-v="models">Theo model</button><button role="tab" class="${S.mtab === 'chem' ? 'on' : ''}" data-a="mtab" data-v="chem">Theo hóa chất</button></div>`;
  if (S.mtab === 'chem') { $('#view-mdl').innerHTML = sub + chemSumHtml(); return; }
  if (CTX.kind !== 'week') { $('#view-mdl').innerHTML = sub + `<p class="note">Định mức model được nhập theo từng tuần. Chọn một tuần ở thanh phía trên.</p>`; return; }
  const ms = CTX.models, mq = norm(S.mq);
  if (!ms.find(m => m.id === S.msel[S.fac])) S.msel[S.fac] = ms[0] ? ms[0].id : null;
  const list = ms.filter(m => !mq || norm(m.name).includes(mq));
  $('#view-mdl').innerHTML = sub + `<div class="mgrid">
   <div class="mlist"><div class="mtools"><input type="search" id="mq" placeholder="Tìm model" value="${esc(S.mq)}" data-i="mq" aria-label="Tìm model">${CTX.editable ? '<button class="btn primary" data-a="madd">+ Model</button>' : ''}</div>
     <p class="mute mcount">${ms.length} model · ${fmt(ms.reduce((a, m) => a + toNum(m.prs), 0), 0)} prs</p>
     <ul id="mlist-ul">${list.map(m => `<li><button class="mi ${S.msel[S.fac] === m.id ? 'on' : ''}" data-a="msel" data-m="${esc(m.id)}"><span class="nm">${esc(m.name || '(chưa đặt tên)')}</span><span class="meta">${m.lines.length ? m.lines.length + ' hóa chất' : '<i class="warnt">chưa có hóa chất</i>'} · ${fmt(toNum(m.prs), 0)} prs</span></button></li>`).join('') || '<li class="empty-r">Không có model phù hợp.</li>'}</ul></div>
   <div class="medit" id="medit"></div></div>`;
  renderMedit();
}
function renderMedit() {
  const el = $('#medit'); if (!el) return;
  const m = modelOf(S.msel[S.fac]), ed = CTX.editable, cat = CAT();
  if (!m) { el.innerHTML = '<div class="empty"><b>Tuần này chưa có model</b><p>Bấm "+ Model" để thêm.</p></div>'; return; }
  const dis = ed ? '' : ' disabled';
  el.innerHTML = `
  ${ed ? '' : `<p class="note">${CTX.week.locked ? 'Tuần này đã xác nhận, định mức được giữ cố định.' : 'Chỉ xem.'}</p>`}
  <div class="mhead"><label class="grow" for="m-name">Tên model<input id="m-name" value="${esc(m.name)}" data-i="mname"${dis}></label>
    <label for="m-prs">Total prs (tuần ${wkLabel(CTX.week)})<input id="m-prs" class="num" inputmode="decimal" value="${esc(m.prs)}" data-i="mprs"${dis}></label></div>
  <div class="tablewrap flat"><table class="grid compact"><thead><tr><th>Hóa chất (theo Report)</th><th class="r">g/prs</th><th class="r">kg</th>${ed ? '<th></th>' : ''}</tr></thead>
   <tbody>${m.lines.map((l, i) => `<tr><td>${pickBtn({ id: 'lk-' + i, kind: 'chem', value: l.chem, label: l.chem ? chemLabel(l.chem) : '', ph: 'Chọn hoặc tìm hóa chất', extra: `data-l="${i}" aria-label="Hóa chất dòng ${i + 1}"`, disabled: !ed })}${l.chem && !cat.has(norm(l.chem)) ? '<small class="warnt">Không có trong Report: chọn lại chất đúng</small>' : ''}</td>
      <td class="r"><input class="num" inputmode="decimal" id="lg-${i}" value="${esc(l.g)}" data-i="lg" data-l="${i}" aria-label="g/prs dòng ${i + 1}"${dis}></td>
      <td class="r num" data-mkg="${i}"></td>${ed ? `<td><button class="icon sm" data-a="ldel" data-l="${i}" aria-label="Xóa dòng ${i + 1}">×</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="4" class="empty-r">Model chưa có hóa chất. Thêm từng dòng hoặc dán từ Excel.</td></tr>'}</tbody>
   <tfoot><tr><td class="nm">Cộng</td><td class="r num" id="m-sg"></td><td class="r num" id="m-sk"></td>${ed ? '<td></td>' : ''}</tr></tfoot></table></div>
  ${ed ? `<div class="mact"><button class="btn" data-a="ladd">+ Thêm hóa chất</button><button class="btn" data-a="paste">Dán từ Excel</button><button class="btn" data-a="mdup">Nhân bản model</button><span class="grow"></span><button class="btn danger" data-a="mdel">${S.confirm === 'm:' + m.id ? 'Bấm lần nữa để xóa' : 'Xóa model'}</button></div>` : ''}
  ${ed && S.paste ? `<div class="pastebox"><label for="paste-t">Dán các dòng "Tên hóa chất ⇥ g/prs" (copy 2 cột từ Excel)<textarea id="paste-t" rows="6" placeholder="PR-550&#9;3&#10;PW-700NF&#9;8"></textarea></label>
    <div class="mact"><button class="btn primary" data-a="paste-ok">Thêm các dòng này</button><span class="hint" id="paste-msg"></span></div></div>` : ''}`;
  refreshMedit();
}
function refreshMedit() {
  const m = modelOf(S.msel[S.fac]); if (!m) return;
  let sg = 0, sk = 0;
  m.lines.forEach((l, i) => { const kg = lineKg(m, l); sg += toNum(l.g); sk += kg; const e = document.querySelector(`[data-mkg="${i}"]`); if (e) e.textContent = fmt(kg); });
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  set('m-sg', fmt(sg, 3)); set('m-sk', fmt(sk));
}
function chemSumHtml() {
  const cat = CAT(), map = new Map();
  for (const m of CTX.models) for (const l of m.lines) {
    const k = norm(l.chem); if (!k) continue;
    const o = map.get(k) || { name: clean(l.chem), g: 0, models: new Set(), kg: 0 };
    o.g += toNum(l.g); o.models.add(m.id); o.kg += lineKg(m, l); map.set(k, o);
  }
  const keys = [...map.keys()].sort((a, b) => ((cat.get(a) || { ord: 1e9 }).ord - (cat.get(b) || { ord: 1e9 }).ord) || a.localeCompare(b));
  return `<p class="mute">${CTX.kind === 'month' ? 'Cả tháng ' + fmtM(CTX.mon) : 'Tuần ' + (CTX.week ? wkLabel(CTX.week) : '')}: tổng theo từng hóa chất trong Report (giống sheet Chemical_Sum).</p>
  <div class="tablewrap"><table class="grid"><thead><tr><th>Hóa chất</th><th>Mã vật tư</th><th class="r">Số model</th><th class="r">Σ g/prs</th><th class="r">Actual (kg)</th><th></th></tr></thead><tbody>
  ${keys.map(k => { const o = map.get(k), c = cat.get(k); const id = CALC.idOf(o.name); return `<tr><td class="nm">${esc(c ? c.name : o.name)}${c ? '' : '<small class="warnt">không có trong Report</small>'}</td><td class="num">${esc(c ? c.code : '')}</td><td class="r num">${o.models.size}</td><td class="r num">${fmt(o.g, 3)}</td><td class="r num">${fmt(o.kg)}</td><td><button class="btn sm ${c ? '' : 'warnb'}" data-a="gochem" data-id="${esc(id)}">${c ? 'Xem / sửa' : 'Đổi chất'}</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty-r">Chưa có dữ liệu.</td></tr>'}
  </tbody><tfoot><tr class="tot"><td class="nm">Tổng</td><td></td><td></td><td></td><td class="r num">${fmt([...map.values()].reduce((a, b) => a + b.kg, 0))}</td><td></td></tr></tfoot></table></div>`;
}

/* ---------- Report ---------- */
function monthGroups(items) {
  const g = new Map();
  for (const x of items) { const k = x.date.slice(0, 7); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
  return [...g].sort((a, b) => a[0] < b[0] ? 1 : -1);
}
function renderReport() {
  const d = cur(), dates = reportDates(d.report);
  const ok = S.items.filter(x => !x.skip), skipped = S.items.filter(x => x.skip);
  const groups = monthGroups(dates.map(x => ({ date: x })));
  const openM = S.openMonth || (groups[0] ? groups[0][0] : null);
  $('#view-rep').innerHTML = `
  <section class="drop" id="drop"><div><b>Nhập Chemical Daily Report</b>
    <p>Chọn hoặc kéo thả file .xls / .xlsx của Mixing Room 1 (F1) hoặc 2 (F2). Có thể chọn nhiều file, nhiều tháng cùng lúc. Mỗi sheet ngày (ví dụ 26.10) được đọc thành một ngày: Output, DVL và Stock cuối ngày của từng hóa chất. Danh sách hóa chất trong Report cũng là danh sách để chọn khi nhập định mức model.</p></div>
    <label class="btn primary filebtn" for="file">Chọn file<input type="file" id="file" accept=".xls,.xlsx" multiple hidden></label></section>
  ${S.importMsg ? `<p class="note ${S.importMsg.startsWith('!') ? 'warn' : ''}" role="status">${esc(S.importMsg.replace(/^!/, ''))}</p>` : ''}
  ${S.items.length ? `<section class="prev"><h3>Xem trước: ${ok.length} ngày đọc được${skipped.length ? `, bỏ qua ${skipped.length} sheet` : ''}</h3>
    <div class="tablewrap"><table class="grid compact"><thead><tr><th></th><th>Ngày</th><th>File / sheet</th><th>Xưởng</th><th class="r">Số chất</th><th class="r">Σ Output</th><th class="r">Σ DVL</th><th>Ghi chú</th></tr></thead>
    ${monthGroups(ok).map(([mon, xs]) => { const all = xs.every(x => x.checked), some = xs.some(x => x.checked); return `<tbody><tr class="mrow"><td><input type="checkbox" data-c="imon" data-m="${mon}" ${all ? 'checked' : ''} ${!all && some ? 'data-mixed="1"' : ''} aria-label="Chọn cả tháng ${fmtM(mon)}" id="im-${mon}"></td><td colspan="7"><label for="im-${mon}"><b>Tháng ${fmtM(mon)}</b> · ${xs.length} ngày · đã chọn ${xs.filter(x => x.checked).length}</label></td></tr>
      ${xs.sort((a, b) => a.date < b.date ? -1 : 1).map(x => { const i = S.items.indexOf(x); return `<tr><td><input type="checkbox" data-c="itm" data-i2="${i}" ${x.checked ? 'checked' : ''} aria-label="Nhập ngày ${fmtDY(x.date)}"></td><td>${fmtDY(x.date)}</td><td class="nm">${esc(x.file)} / ${esc(x.sheet)}</td><td>${x.fac ? FAC[x.fac] : '<span class="warnt">không rõ</span>'}</td><td class="r num">${x.rows.length}</td><td class="r num">${fmt(x.rows.reduce((a, r) => a + r[2], 0))}</td><td class="r num">${fmt(x.rows.reduce((a, r) => a + r[3], 0))}</td><td>${x.notes.map(esc).join('; ')}</td></tr>`; }).join('')}</tbody>`; }).join('')}
    ${skipped.length ? `<tbody><tr class="mute"><td></td><td colspan="7">Bỏ qua: ${skipped.map(x => esc(x.file + ' / ' + x.sheet) + ' (' + esc(x.skip) + ')').join('; ')}</td></tr></tbody>` : ''}
    </table></div>
    <div class="mact"><button class="btn primary" data-a="import-ok" ${ok.some(x => x.checked) ? '' : 'disabled'}>Nhập ${ok.filter(x => x.checked).length} ngày đã chọn</button><button class="btn" data-a="import-clear">Hủy</button></div></section>` : ''}
  <section><h3>Dữ liệu Report đã có ở ${FAC[S.fac]}: ${dates.length} ngày, ${groups.length} tháng</h3>
  ${groups.map(([mon, xs]) => { const rowsAll = xs.map(x => d.report[x.date]); return `<details class="mon" ${mon === openM ? 'open' : ''} data-mon="${mon}"><summary><b>Tháng ${fmtM(mon)}</b><span class="mute">${xs.length} ngày · ${fmtD(xs[0].date)}–${fmtD(xs[xs.length - 1].date)} · Σ Output ${fmt(rowsAll.flat().reduce((a, b) => a + toNum(b[2]), 0))} kg · Σ DVL ${fmt(rowsAll.flat().reduce((a, b) => a + toNum(b[3]), 0))} kg</span></summary>
    <div class="mact"><button class="btn sm" data-a="mon-view" data-m="${mon}">Xem Comparison cả tháng</button><span class="grow"></span>${Store.readonly ? '' : `<button class="btn sm danger" data-a="mon-del" data-m="${mon}">${S.confirm === 'mon:' + mon ? 'Bấm lần nữa để xóa cả tháng' : 'Xóa cả tháng'}</button>`}</div>
    <div class="tablewrap"><table class="grid compact"><thead><tr><th>Ngày</th><th class="r">Số chất</th><th class="r">Σ Output</th><th class="r">Σ DVL</th><th class="r">Σ Stock</th><th></th></tr></thead><tbody>
    ${xs.slice().reverse().map(({ date: x }) => { const r = d.report[x]; return `<tr><td class="nm">${fmtDY(x)} <small>W${isoWeek(x)}</small></td><td class="r num">${r.length}</td><td class="r num">${fmt(r.reduce((a, b) => a + toNum(b[2]), 0))}</td><td class="r num">${fmt(r.reduce((a, b) => a + toNum(b[3]), 0))}</td><td class="r num">${fmt(r.reduce((a, b) => a + toNum(b[4]), 0))}</td><td>${Store.readonly ? '' : `<button class="btn sm danger" data-a="day-del" data-d="${x}">${S.confirm === 'day:' + x ? 'Bấm lần nữa' : 'Xóa ngày'}</button>`}</td></tr>`; }).join('')}
    </tbody></table></div></details>`; }).join('') || '<p class="empty-r">Chưa có ngày nào. Chọn file Chemical Daily Report ở trên để bắt đầu.</p>'}
  </section>
  ${Store.mode === 'db' ? '' : `<section class="sync"><h3>Đồng bộ giữa các trình duyệt</h3>
    ${Store.mode === 'sheet' ? `<p class="mute">Dữ liệu được lưu chung trong Google Sheets: mọi trình duyệt mở trang đều thấy cùng dữ liệu, tự cập nhật khoảng 30 giây một lần.${Store.lastSync ? ' Lần đồng bộ gần nhất: ' + fmtStamp(new Date(Store.lastSync).toISOString()) + '.' : ''}</p>
      <div class="mact"><button class="btn" data-a="sync-now">Đồng bộ ngay</button></div>`
    : SYNC && SYNC.token ? `<p class="mute">Chưa nối Google Sheets nên dữ liệu chỉ nằm trong trình duyệt này. Dán Web app URL của Apps Script để nối (chỉ áp dụng cho trình duyệt này).</p>
      <form class="mact" data-form="sync"><input id="sync-url" type="url" placeholder="https:\/\/script.google.com/macros/s/…/exec" aria-label="Web app URL"><button class="btn primary" type="submit">Nối Google Sheets</button></form>`
    : '<p class="mute">Bản trang này chưa được build để đồng bộ.</p>'}
  </section>`}
  <section class="backup"><h3>Sao lưu dữ liệu</h3>
    <p class="mute">${Store.mode === 'db' ? 'Dữ liệu đang được lưu chung trong kho của trang.' : Store.mode === 'sheet' ? 'Có thể tải thêm một bản sao lưu để giữ riêng.' : 'Dữ liệu chỉ nằm trong trình duyệt này. Nên tải bản sao lưu định kỳ, và dùng nó để chuyển sang máy khác.'} Bản sao lưu gồm cả F1 và F2: tuần, định mức model, bảng Comparison và Report.</p>
    <div class="mact">${canSave() ? '<button class="btn" data-a="backup">Tải bản sao lưu (.json)</button>' : ''}${Store.readonly ? '' : '<label class="btn" for="restore">Khôi phục từ bản sao lưu<input type="file" id="restore" accept=".json,application/json" hidden></label>'}</div>
  </section>`;
  $$('[data-mixed]').forEach(x => { x.indeterminate = true; });
}
async function handleFiles(files) {
  if (typeof XLSX === 'undefined') { S.importMsg = '!Chưa tải được thư viện đọc Excel. Kiểm tra kết nối mạng rồi mở lại trang.'; renderReport(); return; }
  S.items = []; S.importMsg = '';
  for (const f of files) {
    let wb;
    try { wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); } catch (e) { S.items.push({ file: f.name, sheet: '-', skip: 'Không đọc được file này' }); continue; }
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn]; if (!ws || !ws['!ref']) continue;
      const ref = XLSX.utils.decode_range(ws['!ref']);
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, range: { s: { r: 0, c: 0 }, e: ref.e } });
      const p = parseDaily(aoa, sn); p.file = f.name;
      if (!p.skip) {
        const fac = p.fac || S.fac; p.notes = [];
        if (!p.fac) p.notes.push('không thấy tên xưởng, nhập vào ' + FAC[S.fac]);
        else if (p.fac !== S.fac) p.notes.push('file của ' + FAC[p.fac]);
        if (!p.dvlFound) p.notes.push('không thấy cột DVL, coi DVL = 0');
        if (D[fac].report[p.date] && D[fac].report[p.date].length) p.notes.push('đã có ngày này, sẽ ghi đè');
        const dup = S.items.find(x => !x.skip && x.date === p.date && (x.fac || S.fac) === fac);
        if (dup) { dup.checked = false; dup.notes.push('trùng ngày với sheet khác, dùng sheet sau'); }
        p.checked = true;
      }
      S.items.push(p);
    }
  }
  if (!S.items.some(x => !x.skip)) S.importMsg = '!Không có sheet nào đọc được. Sheet cần có dòng "Ngày … tháng … năm …" ở đầu và cột Total out put.';
  renderReport();
}
function doImport() {
  const picked = S.items.filter(x => !x.skip && x.checked), byFac = {};
  for (const x of picked) { const f = x.fac || S.fac; D[f].report[x.date] = x.rows; Store.saveDay(f, x.date, x.rows); (byFac[f] = byFac[f] || []).push(x.date); }
  const fs = Object.keys(byFac); if (!fs.length) return;
  const f = fs.includes(S.fac) ? S.fac : fs[0], ds = byFac[f].sort();
  const months = [...new Set(ds.map(x => x.slice(0, 7)))];
  S.importMsg = `Đã nhập ${picked.length} ngày vào ${fs.map(x => FAC[x]).join(' và ')} (${months.map(fmtM).join(', ')}).`;
  S.items = []; S.fac = f; S.openMonth = months[months.length - 1];
  renderAll();
}

/* ---------- shell ---------- */
function renderAll() {
  if (CP.open) { CP.open = false; cpPop().hidden = true; }
  $$('[data-fac]').forEach(b => b.setAttribute('aria-pressed', b.dataset.fac === S.fac ? 'true' : 'false'));
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab ? 'true' : 'false'));
  $('#view-cmp').hidden = S.tab !== 'cmp'; $('#view-mdl').hidden = S.tab !== 'mdl'; $('#view-rep').hidden = S.tab !== 'rep';
  renderStatus(); recalc(); renderPeriod();
  if (S.tab === 'cmp') renderCmp(); else if (S.tab === 'mdl') renderModels(); else renderReport();
}

function sheetsForExport() {
  recalc();
  const lbl = rangeLabel(CTX.from, CTX.to);
  const cmp = [['#', 'Hóa chất', 'Mã vật tư', 'Tên trong Report', 'Actual (kg)', 'Report ' + lbl + ' (kg)', 'A/R', 'Stock ' + fmtD(CTX.to) + ' (kg)', 'Ghi chú']];
  CALC.list.forEach((it, i) => cmp.push([i + 1, it.name, it.code, it.rep.join(' + '), r6(it.actual), r6(it.report), it.report ? r6(it.actual / it.report) : '', r6(it.stock), it.kind === 'x' ? 'Không có trong Report' : it.flag ? 'Actual có, Report không' : '']));
  cmp.push(['', 'TỔNG HÓA CHẤT', '', '', r6(CALC.tA), r6(CALC.tR), CALC.tR ? r6(CALC.tA / CALC.tR) : '', r6(CALC.tS)]);
  cmp.push(['', 'WASTE CHEMICAL', '', '', '', r6(CALC.waste)]);
  const sm = [['Tuần', 'NO', 'Model', 'Total prs', 'Hóa chất', 'g/prs', 'kg']];
  CTX.models.forEach((m, i) => { const wk = m.wk || wkLabel(CTX.week); if (!m.lines.length) sm.push([wk, i + 1, m.name, toNum(m.prs)]); m.lines.forEach(l => sm.push([wk, i + 1, m.name, toNum(m.prs), l.chem, toNum(l.g), r6(lineKg(m, l))])); });
  const rp = [['Ngày', 'Chemical name', 'Material code', 'Output (kg)', 'DVL (kg)', 'Stock (kg)']];
  for (const x of reportDates(cur().report)) if (x >= CTX.from && x <= CTX.to) for (const r of cur().report[x]) rp.push([x, r[0], r[1], r[2], r[3], r[4]]);
  return { Comparison: cmp, Summary: sm, Report_Data: rp };
}
/* saving files: the claude.ai downloads capability inside an artifact, a plain browser download elsewhere */
const standalone = () => !(window.claude && window.claude.use);
const canSave = () => !!window.__dl || standalone();
async function saveFile(filename, data, type) {
  if (window.__dl) { await window.__dl.save({ filename, data }); return; }
  if (!standalone()) return;
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function doExport() {
  try {
    if (typeof XLSX === 'undefined') return;
    const wb = XLSX.utils.book_new(), sh = sheetsForExport();
    for (const k of Object.keys(sh)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh[k]), k);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    await saveFile('Chemical_' + FAC[S.fac] + '_' + CTX.from + '_' + CTX.to + '.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (e) { /* declined or unavailable */ }
}
async function doBackup() {
  try {
    const body = JSON.stringify({ app: 'doi-chieu-hoa-chat', v: 2, savedAt: new Date().toISOString(), f1: D.f1, f2: D.f2 });
    await saveFile('doi-chieu-hoa-chat_sao-luu_' + new Date().toISOString().slice(0, 10) + '.json', body, 'application/json');
  } catch (e) { /* declined */ }
}
async function doRestore(file) {
  try {
    const x = JSON.parse(await file.text());
    if (x.app !== 'doi-chieu-hoa-chat' || !x.f1 || !x.f2) throw new Error('bad');
    for (const f of ['f1', 'f2']) {
      D[f] = { rows: x[f].rows || [], weeks: x[f].weeks || [], report: x[f].report || {} };
      fixView(f);
      for (const day of Object.keys(D[f].report)) Store.saveDay(f, day, D[f].report[day]);
      Store.markRows(f); D[f].weeks.forEach(w => Store.markWeek(f, w));
    }
    S.importMsg = 'Đã khôi phục dữ liệu từ ' + file.name + '.';
  } catch (e) { S.importMsg = '!File này không phải bản sao lưu của trang Đối chiếu hóa chất.'; }
  renderAll();
}

/* ---------- actions ---------- */
function pickedLines() {
  return $$('.d-pick').filter(x => x.checked).map(x => ({ m: modelOf(x.dataset.m), li: +x.dataset.l })).filter(x => x.m);
}
function doSwap(target) {
  if (!CTX.editable || !target) return;
  const ps = pickedLines(); if (!ps.length) return;
  const from = itemById(S.sel[S.fac]);
  const changes = ps.map(({ m, li }) => ({ mid: m.id, li, old: m.lines[li].chem }));
  ps.forEach(({ m, li }) => { m.lines[li].chem = target; });
  S.undo = { f: S.fac, wid: CTX.week.id, changes, msg: `Đã đổi ${changes.length} dòng từ ${from ? from.name : ''} sang ${target}.` };
  touchWeek(); recalc();
  S.sel[S.fac] = CALC.idOf(target);
  renderCmpRows(); renderDrill(); refreshCmp();
}

document.addEventListener('click', e => {
  const li = e.target.closest('#cp-list li[data-i]');
  if (li) { cpPick(CP.shown[+li.dataset.i]); return; }
  if (e.target.closest('#cp-pop')) return;
  const pb = e.target.closest('.cp-btn');
  if (pb) { if (CP.open && CP.btn === pb) cpClose(); else { cpClose(); cpOpen(pb); } return; }
  if (CP.open) cpClose();
  const t = e.target.closest('[data-fac],[data-tab],[data-a]'); if (!t) return;
  if (t.dataset.fac) { S.fac = t.dataset.fac; S.confirm = null; S.newWeek = false; renderAll(); return; }
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.confirm = null; renderAll(); return; }
  const a = t.dataset.a, d = cur(), ed = CTX && CTX.editable;
  const two = (key, fn, rerender) => { if (S.confirm !== key) { S.confirm = key; rerender(); return; } S.confirm = null; fn(); };
  switch (a) {
    case 'sel': S.sel[S.fac] = t.dataset.id; $$('#cmpb tr.sel').forEach(x => x.classList.remove('sel')); t.classList.add('sel'); S.confirm = null; renderDrill(); if (window.matchMedia('(max-width: 900px)').matches) document.body.classList.add('sheet'); break;
    case 'swapgo': e.stopPropagation(); S.sel[S.fac] = t.dataset.id; renderCmpRows(); renderDrill(); if (window.matchMedia('(max-width: 900px)').matches) document.body.classList.add('sheet'); { const s = $('#sw-to'); if (s) { $('#swap').scrollIntoView({ block: 'nearest' }); cpOpen(s); } } break;
    case 'closedrill': document.body.classList.remove('sheet'); S.sel[S.fac] = null; renderCmpRows(); renderDrill(); break;
    case 'addrow': S.addRow = !S.addRow; renderCmp(); if (S.addRow) $('#ar-name').focus(); break;
    case 'export': doExport(); break;
    case 'swap': { const s = $('#sw-to'); if (!s.dataset.v) { cpOpen(s); break; } doSwap(s.dataset.v); break; }
    case 'sugg': { const s = $('#sw-to'); setPick(s, t.dataset.n, chemLabel(t.dataset.n)); s.focus(); break; }
    case 'undo': {
      const u = S.undo; if (!u || u.f !== S.fac) break;
      const w = weekById(S.fac, u.wid); if (!w || w.locked) { S.undo = null; renderDrill(); break; }
      u.changes.forEach(c => { const m = w.models.find(x => x.id === c.mid); if (m && m.lines[c.li]) m.lines[c.li].chem = c.old; });
      Store.markWeek(S.fac, w); S.undo = null; recalc(); S.sel[S.fac] = CALC.idOf(u.changes[0].old); renderCmpRows(); renderDrill(); refreshCmp(); break;
    }
    case 'dline-del': if (!ed) break; { const m = modelOf(t.dataset.m); m.lines.splice(+t.dataset.l, 1); touchWeek(); renderDrill(); refreshCmp(); } break;
    case 'dline-add': if (!ed) break; {
      const it = itemById(S.sel[S.fac]); const m = modelOf($('#d-addm').dataset.v); if (!it || !m) { if (it) cpOpen($('#d-addm')); break; }
      const chem = $('#d-addc') ? $('#d-addc').value : (it.rep[0] || it.name);
      m.lines.push({ chem, g: toNum($('#d-addg').value) }); touchWeek(); renderDrill(); refreshCmp(); } break;
    case 'row-del': { const it = itemById(S.sel[S.fac]); two('row:' + it.id, () => { d.rows = d.rows.filter(r => r.id !== it.id); S.sel[S.fac] = null; touchRows(); renderCmp(); }, renderDrill); break; }
    case 'pin': { const it = itemById(S.sel[S.fac]); const id = uid('c'); d.rows.push({ id, name: it.name, rep: [it.name], code: it.code, adj: 1 }); S.sel[S.fac] = id; touchRows(); renderCmp(); break; }
    case 'wsel': S.view[S.fac] = t.dataset.w; S.confirm = null; S.sel[S.fac] = null; renderAll(); break;
    case 'msel-all': S.view[S.fac] = 'M:' + t.dataset.m; S.confirm = null; renderAll(); break;
    case 'wnew': S.newWeek = !S.newWeek; renderPeriod(); break;
    case 'wlock': S.confirm = 'lock'; renderPeriod(); break;
    case 'wlock-no': S.confirm = null; renderPeriod(); break;
    case 'wlock-ok': { const w = CTX.week; if (!w) break; w.locked = true; w.lockedAt = nowStamp(); S.confirm = null; S.undo = null; Store.markWeek(S.fac, w); renderAll(); break; }
    case 'wunlock': { const w = CTX.week; two('unlock', () => { w.locked = false; w.lockedAt = null; Store.markWeek(S.fac, w); renderAll(); }, renderPeriod); break; }
    case 'wdel': { const w = CTX.week; two('wdel', () => { d.weeks = d.weeks.filter(x => x.id !== w.id); Store.dropWeek(S.fac, w.id); fixView(S.fac); renderAll(); }, renderPeriod); break; }
    case 'mtab': S.mtab = t.dataset.v; renderModels(); break;
    case 'msel': S.msel[S.fac] = t.dataset.m; S.paste = false; S.confirm = null; $$('#mlist-ul .mi').forEach(x => x.classList.toggle('on', x === t)); renderMedit(); break;
    case 'madd': if (!ed) break; { const id = uid('m'); CTX.week.models.push({ id, name: 'Model mới', prs: 0, lines: [] }); S.msel[S.fac] = id; S.mq = ''; touchWeek(); renderModels(); $('#m-name').select(); } break;
    case 'mdup': if (!ed) break; { const m = modelOf(S.msel[S.fac]); const c = clone(m); c.id = uid('m'); c.name = m.name + ' (bản sao)'; c.prs = 0; CTX.week.models.push(c); S.msel[S.fac] = c.id; touchWeek(); renderModels(); } break;
    case 'mdel': if (!ed) break; { const m = modelOf(S.msel[S.fac]); two('m:' + m.id, () => { CTX.week.models = CTX.week.models.filter(x => x.id !== m.id); touchWeek(); renderAll(); }, renderMedit); } break;
    case 'ladd': if (!ed) break; modelOf(S.msel[S.fac]).lines.push({ chem: '', g: 0 }); touchWeek(); renderMedit(); { const s = $$('#medit .cp-btn[data-l]').pop(); if (s) cpOpen(s); } break;
    case 'ldel': if (!ed) break; modelOf(S.msel[S.fac]).lines.splice(+t.dataset.l, 1); touchWeek(); renderMedit(); break;
    case 'paste': S.paste = !S.paste; renderMedit(); break;
    case 'paste-ok': if (!ed) break; {
      const m = modelOf(S.msel[S.fac]), cat = CAT(); let n = 0; const bad = [];
      for (const raw of $('#paste-t').value.split(/\r?\n/)) {
        const line = raw.trim(); if (!line) continue;
        let name, g; const parts = line.split('\t');
        if (parts.length >= 2) { name = parts[0]; g = parts[1]; } else { const mm = /^(.*?)[\s;]+(-?[\d.,]+)\s*$/.exec(line); if (!mm) { bad.push(line); continue; } name = mm[1]; g = mm[2]; }
        const chem = resolveChem(S.fac, name); if (!cat.has(norm(chem))) bad.push(clean(name));
        m.lines.push({ chem, g: toNum(g) }); n++;
      }
      touchWeek(); renderMedit();
      const msg = $('#paste-msg'); if (msg) msg.textContent = `Đã thêm ${n} dòng.` + (bad.length ? ` ${bad.length} dòng chưa khớp tên trong Report: ${bad.slice(0, 5).join('; ')}. Chọn lại ở cột Hóa chất.` : '');
      break;
    }
    case 'gochem': S.sel[S.fac] = t.dataset.id; S.tab = 'cmp'; renderAll(); { const r = $('#cmpb tr.sel'); if (r) r.scrollIntoView({ block: 'center' }); } break;
    case 'import-ok': doImport(); break;
    case 'import-clear': S.items = []; renderReport(); break;
    case 'day-del': { const k = t.dataset.d; two('day:' + k, () => { d.report[k] = []; Store.saveDay(S.fac, k, []); renderReport(); }, renderReport); break; }
    case 'mon-del': { const mon = t.dataset.m; two('mon:' + mon, () => { for (const k of reportDates(d.report)) if (k.slice(0, 7) === mon) { d.report[k] = []; Store.saveDay(S.fac, k, []); } S.openMonth = null; renderReport(); }, renderReport); break; }
    case 'backup': doBackup(); break;
    case 'sync-now': Store.sheetPoll().then(() => { if (S.tab === 'rep') renderReport(); }); break;
    case 'mon-view': S.view[S.fac] = 'M:' + t.dataset.m; S.tab = 'cmp'; renderAll(); break;
  }
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-a="sel"]')) { e.preventDefault(); e.target.click(); } });
document.addEventListener('toggle', e => { const t = e.target; if (t.matches && t.matches('details.mon') && t.open) S.openMonth = t.dataset.mon; }, true);

document.addEventListener('input', e => {
  const t = e.target, k = t.dataset.i; if (!k) return;
  if (k === 'q') { S.q = t.value; renderCmpRows(); refreshCmp(); return; }
  if (k === 'mq') { S.mq = t.value; const pos = t.selectionStart; renderModels(); const n = $('#mq'); n.focus(); n.setSelectionRange(pos, pos); return; }
  if (!CTX.editable && !k.startsWith('rs-')) return;
  if (k === 'dg' || k === 'dprs') {
    const m = modelOf(t.dataset.m); if (!m) return;
    if (k === 'dg') m.lines[+t.dataset.l].g = toNum(t.value); else m.prs = toNum(t.value);
    if (k === 'dprs') $$(`[data-i="dprs"][data-m="${CSS.escape(m.id)}"]`).forEach(x => { if (x !== t) x.value = t.value; });
    touchWeek(); refreshDrill(); refreshCmp(); return;
  }
  const m = modelOf(S.msel[S.fac]);
  if (k === 'mname' && m) { m.name = t.value; touchWeek(); const b = $('.mi.on .nm'); if (b) b.textContent = t.value || '(chưa đặt tên)'; }
  else if (k === 'mprs' && m) { m.prs = toNum(t.value); touchWeek(); refreshMedit(); const b = $('.mi.on .meta'); if (b) b.innerHTML = (m.lines.length ? m.lines.length + ' hóa chất' : '<i class="warnt">chưa có hóa chất</i>') + ' · ' + fmt(m.prs, 0) + ' prs'; }
  else if (k === 'lg' && m) { m.lines[+t.dataset.l].g = toNum(t.value); touchWeek(); refreshMedit(); }
});
document.addEventListener('change', e => {
  const t = e.target, d = cur();
  if (t.id === 'file') { handleFiles([...t.files]); t.value = ''; return; }
  if (t.id === 'restore') { if (t.files[0]) doRestore(t.files[0]); t.value = ''; return; }
  const c = t.dataset.c, k = t.dataset.i;
  if (c === 'month') {
    const mon = t.value, ws = d.weeks.filter(w => w.from.slice(0, 7) === mon);
    S.view[S.fac] = ws.length ? ws[ws.length - 1].id : 'M:' + mon; S.sel[S.fac] = null; renderAll();
  }
  else if (c === 'wdate') {
    const w = CTX.week; if (!w || w.locked) return;
    const f = $('#wf').value, to = $('#wt').value; if (!f || !to) return;
    w.from = f <= to ? f : to; w.to = f <= to ? to : f; sortWeeks(S.fac); touchWeek(); renderAll();
  }
  else if (c === 'hz') { S.hideZero = t.checked; renderCmpRows(); refreshCmp(); }
  else if (c === 'od') { S.onlyDev = t.checked; renderCmpRows(); refreshCmp(); }
  else if (c === 'of') { S.onlyFlag = t.checked; renderCmpRows(); refreshCmp(); }
  else if (c === 'dall') { $$('.d-pick').forEach(x => { x.checked = t.checked; }); }
  else if (c === 'itm') { S.items[+t.dataset.i2].checked = t.checked; renderReport(); }
  else if (c === 'imon') { S.items.forEach(x => { if (!x.skip && x.date.slice(0, 7) === t.dataset.m) x.checked = t.checked; }); renderReport(); }
  else if (c === 'rs-adj') { const r = d.rows.find(x => x.id === S.sel[S.fac]); r.adj = t.checked ? 1 : 0; touchRows(); refreshCmp(); }
  else if (k === 'rs-name') { const r = d.rows.find(x => x.id === S.sel[S.fac]); r.name = t.value.trim() || r.name; touchRows(); renderCmpRows(); refreshCmp(); renderDrill(); }
  else if (k === 'rs-rep') { const r = d.rows.find(x => x.id === S.sel[S.fac]); r.rep = t.value.split(';').map(x => clean(x)).filter(Boolean); touchRows(); renderCmp(); }
});
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  const d = cur();
  if (f.dataset.form === 'addrow') {
    const name = $('#ar-name').value.trim(), rep = $('#ar-rep').dataset.v; if (!name) return;
    const id = uid('c'); d.rows.push({ id, name, rep: rep ? [rep] : [name], code: '', adj: 1 }); S.sel[S.fac] = id; S.addRow = false; touchRows(); renderCmp();
  } else if (f.dataset.form === 'sync') {
    const u = $('#sync-url').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\/./.test(u)) { S.importMsg = '!Link phải là Web app URL của Apps Script (https:\/\/script.google.com/macros/s/…/exec).'; renderReport(); return; }
    try { localStorage.setItem('hc-sync-url', u); } catch (e) { /* ignore */ }
    Store.mode = 'sheet'; S.importMsg = 'Đang nối Google Sheets…'; Store.sheetStart(u, SYNC.token).then(() => { S.importMsg = ''; renderAll(); });
  } else if (f.dataset.form === 'newweek') {
    let from = $('#nw-from').value, to = $('#nw-to').value; if (!from || !to) return;
    if (from > to) [from, to] = [to, from];
    const src = weekById(S.fac, $('#nw-src').value), blank = $('#nw-blank').checked;
    let id = 'w' + from.replace(/-/g, ''); while (weekById(S.fac, id)) id += 'b';
    const models = src ? clone(src.models) : [];
    if (blank) models.forEach(m => { m.prs = 0; });
    const w = { id, from, to, locked: false, models };
    d.weeks.push(w); sortWeeks(S.fac); S.view[S.fac] = id; S.newWeek = false; S.sel[S.fac] = null;
    Store.markWeek(S.fac, w); renderAll();
  }
});
/* drag & drop */
document.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('#drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', () => { const z = $('#drop'); if (z) z.classList.remove('over'); });
document.addEventListener('drop', e => {
  const z = e.target.closest && e.target.closest('#drop'); if (!z) return;
  e.preventDefault(); z.classList.remove('over');
  const fs = [...(e.dataTransfer.files || [])].filter(f => /\.xlsx?$/i.test(f.name)); if (fs.length) handleFiles(fs);
});

(async function start() {
  renderAll();
  try { if (window.claude && window.claude.use) { const dl = await window.claude.use('downloads'); if (dl) { window.__dl = dl; const b = $('#btn-export'); if (b) b.hidden = false; } } } catch (e) { /* none */ }
  await Store.init();
})();
