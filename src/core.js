/* ===== core: pure logic (no DOM) ===== */
const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase();
const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const toNum = v => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/,/g, '.').replace(/[^0-9.\-eE]/g, ''));
  return isFinite(n) ? n : 0;
};
const r6 = x => Math.round(x * 1e6) / 1e6;
const lineKg = (m, l) => (toNum(l.g) * toNum(m.prs)) / 1000;
const WASTE = norm('WASTE CHEMICAL');

/* dates (ISO yyyy-mm-dd, computed in UTC) */
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = s => new Date(s + 'T00:00:00Z').getUTCDay();
function isoWeek(s) {
  const d = new Date(s + 'T00:00:00Z'); const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - y) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7);
}

function reportDates(report) {
  return Object.keys(report).filter(d => report[d] && report[d].length).sort();
}

/* chemical catalog from the Daily Report: latest name, code and row order win */
function catalog(report) {
  const ds = reportDates(report), cat = new Map();
  for (let i = ds.length - 1; i >= 0; i--) {
    report[ds[i]].forEach((r, j) => {
      const k = norm(r[0]);
      if (!k || k === WASTE || /^TOTAL\b/.test(k) || cat.has(k)) return;
      cat.set(k, { name: clean(r[0]), code: clean(r[1]), ord: (ds.length - 1 - i) * 1000 + j });
    });
  }
  return new Map([...cat].sort((a, b) => a[1].ord - b[1].ord));
}

/* net (Output - DVL) over [from, to] and stock on `to`, by normalised name */
function reportIndex(report, from, to) {
  const idx = new Map();
  for (const d of reportDates(report)) {
    if (d < from || d > to) continue;
    for (const r of report[d]) {
      const k = norm(r[0]);
      let o = idx.get(k); if (!o) { o = { out: 0, dvl: 0, stock: 0 }; idx.set(k, o); }
      o.out += toNum(r[2]); o.dvl += toNum(r[3]);
      if (d === to) o.stock += toNum(r[4]);
    }
  }
  return idx;
}

/* v1 (lines keyed by Comparison KEY) -> v2 (lines carry the Report chemical name) */
function migrateV1(models, rowsV1, cat, alias) {
  const nameMap = new Map();
  const pick = l => {
    const k = norm(l.name);
    if (cat.has(k)) return cat.get(k).name;
    if (l.key) {
      for (const r of rowsV1) if (r.key === l.key) for (const n of r.rep || []) if (cat.has(norm(n))) return cat.get(norm(n)).name;
      for (const [n, kk] of alias || []) if (kk === l.key && cat.has(norm(n))) return cat.get(norm(n)).name;
      const r = rowsV1.find(r => r.key === l.key && r.rep && r.rep.length);
      if (r) return clean(r.rep[0]);
    }
    return clean(l.name || l.key || '');
  };
  const out = models.map((m, i) => ({
    id: m.id || 'm' + (i + 1), name: m.name, prs: m.prs,
    lines: m.lines.map(l => {
      if (l.chem !== undefined) return { chem: l.chem, g: l.g };
      const chem = l.key || l.name ? pick(l) : '';
      if (l.name) nameMap.set(norm(l.name), chem);
      return { chem, g: l.g };
    })
  }));
  const rows = rowsV1.filter(r => r.rep && r.rep.length).map(r => ({ id: r.id, name: r.name, rep: r.rep.map(clean), code: r.code || '', adj: r.adj === 0 ? 0 : 1 }));
  return { models: out, rows, nameMap };
}

/* the Comparison: user rows + Report chemicals without a row + chemicals not in the Report */
function compute(models, rows, report, from, to, cat) {
  const rowOf = new Map();
  for (const r of rows) for (const n of r.rep || []) { const k = norm(n); if (k && !rowOf.has(k)) rowOf.set(k, r.id); }
  const idOf = chem => { const k = norm(chem); if (!k) return null; if (rowOf.has(k)) return rowOf.get(k); return (cat.has(k) ? 'r:' : 'x:') + k; };
  const act = new Map(), nl = new Map(), xName = new Map();
  let unassigned = 0;
  for (const m of models) for (const l of m.lines) {
    const id = idOf(l.chem);
    if (!id) { unassigned++; continue; }
    act.set(id, (act.get(id) || 0) + lineKg(m, l));
    nl.set(id, (nl.get(id) || 0) + 1);
    if (id.startsWith('x:') && !xName.has(id)) xName.set(id, clean(l.chem));
  }
  const idx = reportIndex(report, from, to);
  const list = [];
  for (const r of rows) {
    let rep = 0, stock = 0;
    for (const n of r.rep || []) { const o = idx.get(norm(n)); if (o) { rep += o.out - o.dvl; stock += o.stock; } }
    const inRep = (r.rep || []).some(n => cat.has(norm(n)));
    const c0 = (r.rep || []).map(n => cat.get(norm(n))).find(Boolean);
    list.push({ id: r.id, kind: 'row', name: r.name, code: r.code || (c0 ? c0.code : ''), rep: r.rep || [], adj: r.adj, inRep, actual: act.get(r.id) || 0, report: rep, stock, lines: nl.get(r.id) || 0 });
  }
  for (const [k, c] of cat) {
    if (rowOf.has(k)) continue;
    const id = 'r:' + k, o = idx.get(k);
    const it = { id, kind: 'cat', name: c.name, code: c.code, rep: [c.name], adj: 1, inRep: true, actual: act.get(id) || 0, report: o ? o.out - o.dvl : 0, stock: o ? o.stock : 0, lines: nl.get(id) || 0 };
    if (it.actual || it.report || it.stock || it.lines) list.push(it);
  }
  for (const [id, name] of xName) list.push({ id, kind: 'x', name, code: '', rep: [], adj: 1, inRep: false, actual: act.get(id) || 0, report: 0, stock: 0, lines: nl.get(id) || 0 });
  const t = { tA: 0, tR: 0, tS: 0, tAadj: 0, tRadj: 0 };
  let flagged = 0;
  for (const it of list) {
    t.tA += it.actual; t.tR += it.report; t.tS += it.stock;
    if (it.adj !== 0) { t.tAadj += it.actual; t.tRadj += it.report; }
    it.flag = it.actual > 0.0005 && Math.abs(it.report) < 1e-9;
    if (it.flag) flagged++;
  }
  const w = idx.get(WASTE);
  return Object.assign(t, { list, idOf, waste: w ? w.out - w.dvl : 0, unassigned, flagged, hasAdj: rows.some(r => r.adj === 0) });
}

/* ===== Daily report parser (F1 / F2 xls, xlsx) ===== */
const DATE_RE = /ng[àa]y\s*(\d{1,2})\s*th[áa]ng\s*(\d{1,2})\s*n[ăa]m\s*(\d{4})/i;
const isoYMD = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

function parseDaily(aoa, sheetName) {
  const cell = (r, c) => (aoa[r] && aoa[r][c] != null ? aoa[r][c] : null);
  if (/^\s*(m[ẫaÃ]u|develop)/i.test(sheetName)) return { sheet: sheetName, skip: 'Sheet mẫu, bỏ qua' };
  let date = null, fac = null;
  for (let r = 0; r < Math.min(8, aoa.length); r++) {
    for (let c = 0; c < 4; c++) {
      const v = cell(r, c);
      if (v == null) continue;
      const s = String(v);
      const m = DATE_RE.exec(s);
      if (m && !date) date = isoYMD(+m[3], +m[2], +m[1]);
      if (/MIXING\s*ROOM\s*1\b/i.test(s) || /FACTORY\s*1\b/i.test(s)) fac = fac || 'f1';
      if (/MIXING\s*ROOM\s*2\b/i.test(s) || /FACTORY\s*2\b/i.test(s)) fac = fac || 'f2';
    }
  }
  if (!date) return { sheet: sheetName, skip: 'Không thấy dòng "Ngày … tháng … năm …"' };
  let outC = -1, stockC = -1, dvlC = -1;
  const H = r => aoa[r] || [];
  for (let r = 3; r < Math.min(12, aoa.length); r++) {
    H(r).forEach((v, c) => {
      if (typeof v !== 'string') return;
      const t = v.replace(/\s+/g, ' ').toLowerCase();
      if (/total out ?put|t[ổo]ng s[ốo] l[ưu][ơo]ng xu[ấa]t/.test(t)) outC = c;
      if (/last stock|s[ốo] l[ưu][ợo]ng hi[ệe]n c[òo]n/.test(t)) stockC = c;
    });
  }
  if (outC < 0) return { sheet: sheetName, skip: 'Không tìm thấy cột Total out put' };
  for (let r = 3; r < Math.min(12, aoa.length); r++) {
    H(r).forEach((v, c) => {
      if (typeof v !== 'string' || c >= outC) return;
      if (/^\s*(dvl|develop)/i.test(v) && c > dvlC) dvlC = c;
    });
  }
  const rows = [];
  for (let r = 9; r < aoa.length; r++) {
    const code = cell(r, 1), name = cell(r, 2);
    if ((code == null || code === '') && (name == null || name === '')) {
      const a = cell(r, 0);
      if (a == null || a === '' || /total/i.test(String(a))) break;
      continue;
    }
    if (name == null || name === '') continue;
    const nm = clean(name);
    if (/^total\b/i.test(nm)) break;
    rows.push([nm, code == null ? '' : clean(code), r6(toNum(cell(r, outC))), dvlC >= 0 ? r6(toNum(cell(r, dvlC))) : 0, stockC >= 0 ? r6(toNum(cell(r, stockC))) : 0]);
  }
  if (!rows.length) return { sheet: sheetName, skip: 'Không có dòng hóa chất' };
  return { sheet: sheetName, date, fac, rows, dvlFound: dvlC >= 0 };
}

if (typeof module !== 'undefined') module.exports = { norm, toNum, compute, parseDaily, catalog, reportIndex, lineKg, reportDates, migrateV1, isoWeek, addDays, weekday };
