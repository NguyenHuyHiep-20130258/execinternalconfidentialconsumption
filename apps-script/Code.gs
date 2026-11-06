/**
 * Kho dữ liệu chung cho trang "Đối chiếu hóa chất" (GitHub Pages).
 *
 * Cài đặt (một lần):
 *  1. Tạo một Google Sheet mới → Extensions (Tiện ích mở rộng) → Apps Script.
 *  2. Xóa nội dung có sẵn, dán toàn bộ file này vào, bấm Save.
 *  3. Project Settings (biểu tượng bánh răng) → Script properties → Add script property:
 *       Property: PASSWORD   Value: mật khẩu của trang
 *  4. Deploy → New deployment → Select type: Web app
 *       Execute as: Me    Who has access: Anyone   → Deploy → cấp quyền.
 *  5. Copy "Web app URL" (dạng https://script.google.com/macros/s/.../exec) gửi cho người build trang.
 *
 * Mỗi tài liệu (bảng Comparison, một tuần, một ngày Report) là một dòng ở sheet "data":
 *   A key | B updatedAt (ms) | C rev | D deleted | E.. nội dung JSON, cắt thành nhiều ô.
 */
const SHEET_NAME = 'data';
const CHUNK = 40000;          // một ô Google Sheets chứa tối đa 50.000 ký tự
const HEAD = 4;               // số cột trước phần nội dung

function doGet() {
  return json_({ ok: true, app: 'doi-chieu-hoa-chat', configured: !!password_() });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  if (!password_()) return json_({ ok: false, error: 'not_configured' });
  if (!req || req.pw !== password_()) return json_({ ok: false, error: 'unauthorized' });
  try {
    if (req.op === 'pull') return json_(pull_(Number(req.since) || 0));
    if (req.op === 'push') return json_(push_(req.docs || []));
    return json_({ ok: false, error: 'bad_op' });
  } catch (err) {
    return json_({ ok: false, error: 'server', message: String(err) });
  }
}

function password_() { return PropertiesService.getScriptProperties().getProperty('PASSWORD'); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEAD + 1).setValues([['key', 'updatedAt', 'rev', 'deleted', 'json (cắt nhiều ô)']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* every row changed after `since` (server clock, ms) */
function pull_(since) {
  const sh = sheet_();
  const last = sh.getLastRow(), cols = sh.getLastColumn();
  const docs = [];
  let maxT = since;
  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, Math.max(cols, HEAD + 1)).getValues();
    for (const r of vals) {
      const key = r[0], t = Number(r[1]) || 0;
      if (!key || t <= since) continue;
      if (t > maxT) maxT = t;
      let body = null;
      if (!r[3]) {
        let s = '';
        for (let c = HEAD; c < r.length; c++) { const v = r[c]; if (v === '' || v == null) break; s += String(v).slice(1); }
        try { body = JSON.parse(s); } catch (err) { continue; }
      }
      docs.push({ key: String(key), t: t, rev: String(r[2] || ''), body: body });
    }
  }
  return { ok: true, now: maxT, docs: docs };
}

/* write documents; body null deletes */
function push_(docs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = sheet_();
    const last = sh.getLastRow();
    const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : [];
    const rowOf = {};
    keys.forEach((k, i) => { if (k) rowOf[k] = i + 2; });
    const props = PropertiesService.getScriptProperties();
    let t = Math.max(Date.now(), Number(props.getProperty('LAST_T')) || 0);
    const results = [];
    let next = last + 1;
    for (const d of docs) {
      if (!d || !d.key) continue;
      t += 1;
      const text = d.body == null ? '' : JSON.stringify(d.body);
      const parts = [];
      for (let i = 0; i < text.length; i += CHUNK) parts.push('~' + text.slice(i, i + CHUNK)); // "~" keeps Sheets from reading a part as a number or formula
      const row = rowOf[d.key] || (rowOf[d.key] = next++);
      const width = sh.getMaxColumns();
      const need = HEAD + Math.max(parts.length, 1);
      if (width < need) sh.insertColumnsAfter(width, need - width);
      sh.getRange(row, HEAD + 1, 1, sh.getMaxColumns() - HEAD).clearContent();
      sh.getRange(row, HEAD + 1, 1, Math.max(parts.length, 1)).setNumberFormat('@');
      sh.getRange(row, 1, 1, HEAD + parts.length).setValues([[d.key, t, String(d.rev || ''), d.body == null ? 1 : '', ...parts]]);
      results.push({ key: d.key, t: t });
    }
    props.setProperty('LAST_T', String(t));
    SpreadsheetApp.flush();
    return { ok: true, results: results };
  } finally {
    lock.releaseLock();
  }
}
