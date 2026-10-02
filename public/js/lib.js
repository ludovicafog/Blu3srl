// Helper condivisi: formattazione, API, modali, form
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtEur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export const eur = (n) => (n == null || n === '' || Number.isNaN(Number(n))) ? '—' : fmtEur.format(Number(n));
export const dt = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—';
export const today = () => new Date().toISOString().slice(0, 10);
export const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

export function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[€\s ]/g, '').replace(/[^\d.,\-]/g, '');
  if (!s || s === '-') return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = s.replace(',', '.');
  else if (ld >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const TIPOLOGIE = {
  preventivo: 'Preventivo', ordine_cliente: 'Ordine cliente', ordine_fornitore: 'Ordine fornitore', ddt: 'DDT',
  fattura_cliente: 'Fattura cliente', fattura_fornitore: 'Fattura fornitore', spesa: 'Spesa / scontrino', excel: 'File Excel',
  contratto: 'Contratto', altro: 'Altro',
};
export const STATI = { preventivo: 'Preventivo', ordinata: 'Ordinata', in_acquisto: 'In acquisto', in_consegna: 'In consegna', fatturata: 'Fatturata', chiusa: 'Chiusa' };
export const PA_LABELS = {
  cig: 'CIG', cup: 'CUP', rif_gara: 'Riferimento gara', num_gara: 'Numero gara', determina: 'Determina', ordine_mepa: 'Ordine MEPA',
  rif_mepa: 'Riferimento MEPA', codice_ufficio: 'Codice ufficio', centro_costo: 'Centro di costo', rif_amministrativo: 'Riferimento amministrativo',
  protocollo: 'Protocollo', num_contratto: 'Numero contratto',
};
export const badge = (t, cls = '') => `<span class="badge ${cls}">${esc(t)}</span>`;
export const statoBadge = (s) => badge(STATI[s] || s, { chiusa: 'gray', fatturata: 'ok', preventivo: '' }[s] || 'warn');

// ---------------------------------------------------------------- API
export async function api(url, { method = 'GET', body, form } = {}) {
  const opt = { method, headers: {} };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch('/api' + url, opt); } catch { toast('Server non raggiungibile', true); throw new Error('network'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { toast(data.error || 'Errore', true); throw new Error(data.error || r.statusText); }
  return data;
}

let toastT;
export function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2600);
}

export const store = { lookup: null };
export async function loadLookup(force) {
  if (!store.lookup || force) store.lookup = await api('/lookup');
  return store.lookup;
}

// ---------------------------------------------------------------- modali
export function modal({ title, body, buttons = [], size = '', onOpen }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${size}"><div class="modal-h"><h2>${esc(title)}</h2><button class="x" aria-label="Chiudi">×</button></div>
    <div class="modal-b"></div>${buttons.length ? '<div class="modal-f"></div>' : ''}</div>`;
  const close = () => bg.remove();
  const b = $('.modal-b', bg);
  if (typeof body === 'string') b.innerHTML = body; else b.append(body);
  $('.x', bg).onclick = close;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg && !bg.dataset.sticky) close(); });
  const f = $('.modal-f', bg);
  buttons.forEach((bt) => {
    const el = document.createElement('button');
    el.className = 'btn ' + (bt.cls || ''); el.textContent = bt.label;
    el.onclick = async () => { el.disabled = true; try { await bt.onClick?.({ close, root: bg, button: el }); } finally { el.disabled = false; } };
    if (bt.id) el.id = bt.id;
    f.append(el);
  });
  $('#modal-root').append(bg);
  onOpen?.({ close, root: bg });
  return { close, root: bg };
}

export const confirmBox = (msg, label = 'Elimina') => new Promise((res) => {
  modal({ title: 'Conferma', body: `<p>${esc(msg)}</p>`, buttons: [
    { label: 'Annulla', cls: 'sec', onClick: ({ close }) => { close(); res(false); } },
    { label, cls: 'danger', onClick: ({ close }) => { close(); res(true); } }] });
});

// ---------------------------------------------------------------- form generico
// field: { k, label, type: text|number|date|select|textarea|checkbox, options: [[v,l]], full, group, step }
export function optionsHtml(opts, sel, blank = true) {
  return (blank ? '<option value="">—</option>' : '') + opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
}
export function fieldHtml(f, v) {
  const val = v?.[f.k];
  const common = `data-k="${f.k}" ${f.req ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
  let inner;
  if (f.type === 'checkbox') return `<label class="chk ${f.full ? 'full' : ''}"><input type="checkbox" data-k="${f.k}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
  if (f.type === 'select') inner = `<select ${common}>${optionsHtml(f.options, val)}</select>`;
  else if (f.type === 'textarea') inner = `<textarea ${common} rows="${f.rows || 4}">${esc(val)}</textarea>`;
  else inner = `<input ${common} type="${f.type === 'number' ? 'text' : f.type || 'text'}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(val)}">`;
  return `<label class="f ${f.full || f.type === 'textarea' ? 'full' : ''}"><span>${esc(f.label)}${f.req ? ' *' : ''}${f.auto ? '<em class="auto">rilevato automaticamente</em>' : ''}</span>${inner}</label>`;
}
export function readForm(root, fields) {
  const o = {};
  for (const f of fields) {
    const el = $(`[data-k="${f.k}"]`, root);
    if (!el) continue;
    o[f.k] = f.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}
export function formGrid(fields, v) { return `<div class="form-grid">${fields.map((f) => fieldHtml(f, v)).join('')}</div>`; }

export function formModal({ title, fields, values = {}, onSave, size = '', extra = '', afterOpen, saveLabel = 'Salva', groups = {} }) {
  const main = fields.filter((f) => !f.group);
  const boxes = Object.entries(groups).map(([g, t]) => `<div class="pa-box" data-group="${g}" hidden><h3>${esc(t)}</h3>${formGrid(fields.filter((f) => f.group === g), values)}</div>`).join('');
  return modal({
    title, size, body: `<form onsubmit="return false">${formGrid(main, values)}${boxes}${extra}</form>`,
    buttons: [
      { label: 'Annulla', cls: 'sec', onClick: ({ close }) => close() },
      { label: saveLabel, onClick: async ({ close, root }) => {
        const form = $('form', root);
        if (!form.reportValidity()) return;
        await onSave(readForm(root, fields), { close, root });
      } },
    ],
    onOpen: (ctx) => {
      // i gruppi (es. campi Pubblica Amministrazione) sono mostrati solo se la casella che li attiva è spuntata
      for (const f of fields.filter((x) => x.toggles)) {
        const cb = $(`[data-k="${f.k}"]`, ctx.root), box = $(`[data-group="${f.toggles}"]`, ctx.root);
        const sync = () => { box.hidden = !cb.checked; };
        cb.addEventListener('change', sync); sync();
      }
      afterOpen?.(ctx);
    },
  });
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
