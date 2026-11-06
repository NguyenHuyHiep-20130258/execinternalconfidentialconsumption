// node tests/test_core.js — needs data/seed.json and data/alias.json (factory data, kept out of git)
const fs = require('fs'), path = require('path');
const C = require('../src/core.js');
const dir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(path.join(dir, 'seed.json'))) { console.log('Bỏ qua: không có data/seed.json (dữ liệu nhà máy không nằm trong repo).'); process.exit(0); }
const seed = require('../data/seed.json'), alias = require('../data/alias.json');
for (const f of ['f1', 'f2']) {
  const s = seed[f], cat = C.catalog(s.report);
  const mg = C.migrateV1(s.models, s.rows, cat, alias[f]);
  const r = C.compute(mg.models, mg.rows, s.report, s.from, s.to, cat);
  console.log(f, 'chất trong Report', cat.size, '| Actual', r.tA.toFixed(2), '| Report', r.tR.toFixed(2), '| Stock', r.tS.toFixed(2), '| Actual có, Report không', r.flagged);
}
