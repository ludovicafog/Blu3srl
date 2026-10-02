// Importazione righe da Excel/CSV: mappatura colonne → campi, anteprima, esclusione righe, conferma.
// La struttura del file NON è assunta: l'utente può sempre cambiare foglio, riga di intestazione e mappatura.
import { $, $$, esc, eur, api, toast, modal, loadLookup, optionsHtml, parseNum } from './lib.js';

const colName = (i) => { let s = '', n = i + 1; while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };

export async function importWizard(preset = {}, onDone) {
  const L = await loadLookup();
  const m = modal({
    title: 'Importa righe da Excel / CSV', body: `
      ${preset.commessa_id || preset.preventivo_id ? '' : `<label class="f"><span>Commessa di destinazione *</span><select id="ic">${optionsHtml(L.commesse.map((c) => [c.id, `${c.codice} — ${c.oggetto || ''}`]), '')}</select></label>`}
      <div class="drop" id="drop"><b>Trascina qui il file Excel</b><p class="muted">.xlsx o .csv — le righe verranno lette e potrai verificarle prima dell’importazione</p><button class="btn" type="button">Scegli file</button><input type="file" id="fi" hidden accept=".xlsx,.csv"></div>`,
    buttons: [{ label: 'Annulla', cls: 'sec', onClick: ({ close }) => close() }],
  });
  const drop = $('#drop', m.root), fi = $('#fi', m.root);
  drop.onclick = () => fi.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); e.dataTransfer.files[0] && go(e.dataTransfer.files[0]); };
  fi.onchange = () => fi.files[0] && go(fi.files[0]);
  async function go(file) {
    const cid = preset.commessa_id || $('#ic', m.root)?.value;
    if (!cid && !preset.preventivo_id) return toast('Selezionare la commessa', true);
    drop.innerHTML = '<b>Lettura del file…</b>';
    const form = new FormData(); form.append('file', file);
    try { const r = await api('/import/parse', { method: 'POST', form }); m.close(); anteprima(r, { ...preset, commessa_id: cid }, onDone); } catch { m.close(); }
  }
}

async function anteprima(r, preset, onDone) {
  const campi = r.campi;
  let fi = 0, header = r.fogli[0].headerRow, mapping = { ...r.fogli[0].mapping }, items = [];
  let prevId = preset.preventivo_id || '', modalita = 'aggiungi';
  const prevs = preset.commessa_id ? await api(`/preventivi?commessa_id=${preset.commessa_id}`) : [];
  if (!prevId && prevs.length === 1) prevId = prevs[0].id;

  const m = modal({ title: `Importazione — ${r.nome_file}`, size: 'xl', body: '<div id="w"></div>', buttons: [
    { label: 'Annulla', cls: 'sec', onClick: async ({ close }) => { await api(`/documenti/temp/${r.token}`, { method: 'DELETE' }); close(); } },
    { label: 'Importa le righe selezionate', id: 'imp', onClick: conferma }] });
  m.root.dataset.sticky = '1';

  const sheet = () => r.fogli[fi];
  const SKIP = /^(totale|imponibile|iva|subtotale|sub-totale|sconto|spese)/i;

  function build() {
    const rows = sheet().rows.slice(header + 1);
    items = rows.map((row) => {
      const vals = {};
      for (const c of campi) { const i = mapping[c.key]; vals[c.key] = i == null || i === '' ? '' : String(row[i] ?? ''); }
      const vuota = !vals.descrizione.trim() && !vals.codice.trim();
      const nonRiga = SKIP.test(vals.descrizione.trim()) || (!vals.qta && !vals.prezzo_vendita && !vals.prezzo_totale && !vals.prezzo_acquisto);
      return { incl: !vuota && !nonRiga, vals };
    }).filter((it) => Object.values(it.vals).some((v) => v.trim() !== ''));
  }

  const warn = (v) => {
    const q = parseNum(v.qta), p = parseNum(v.prezzo_vendita ?? '') ?? parseNum(v.prezzo_cliente), t = parseNum(v.prezzo_totale);
    const w = [];
    if (!v.descrizione.trim() && !v.codice.trim()) w.push('manca descrizione');
    if (v.qta !== '' && q == null) w.push('quantità non numerica');
    if (v.prezzo_vendita !== '' && parseNum(v.prezzo_vendita) == null) w.push('prezzo non numerico');
    if (q != null && p != null && t != null && Math.abs(q * p - t) > 0.011) w.push(`q.tà × prezzo = ${eur(q * p)} ≠ totale ${eur(t)}`);
    return w;
  };

  function renderTable() {
    const mapped = campi.filter((c) => mapping[c.key] != null && mapping[c.key] !== '');
    const sel = items.filter((i) => i.incl).length;
    $('#cnt', m.root).innerHTML = `Abbiamo trovato <b>${items.length} righe</b> (${sel} selezionate). Verifica i dati prima di importare.`;
    $('#imp', m.root).disabled = !sel;
    $('#tb', m.root).innerHTML = `<table><thead><tr><th><input type="checkbox" id="all" ${sel === items.length && items.length ? 'checked' : ''} title="Seleziona tutte"></th><th>#</th>${mapped.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th>Controlli</th></tr></thead>
      <tbody>${items.map((it, i) => `<tr data-i="${i}" style="${it.incl ? '' : 'opacity:.45'}"><td><input type="checkbox" data-incl ${it.incl ? 'checked' : ''}></td><td>${i + 1}</td>
        ${mapped.map((c) => `<td><input data-f="${c.key}" value="${esc(it.vals[c.key])}" style="min-width:${c.key === 'descrizione' ? 280 : 90}px"></td>`).join('')}
        <td class="w"><small style="color:var(--warn)">${warn(it.vals).join('; ')}</small></td></tr>`).join('')}</tbody></table>`;
  }

  function render() {
    const s = sheet();
    const headers = s.rows[header] || [];
    $('#w', m.root).innerHTML = `
      <div class="form-grid">
        <label class="f"><span>Foglio</span><select id="sh">${r.fogli.map((x, i) => `<option value="${i}" ${i === fi ? 'selected' : ''}>${esc(x.nome)} (${x.rows.length} righe)</option>`).join('')}</select></label>
        <label class="f"><span>Riga di intestazione</span><select id="hd">${s.rows.slice(0, 30).map((row, i) => `<option value="${i}" ${i === header ? 'selected' : ''}>${i + 1}: ${esc(row.filter(Boolean).join(' | ').slice(0, 50))}</option>`).join('')}</select></label>
        ${preset.commessa_id ? `<label class="f"><span>Destinazione</span><select id="pv"><option value="">Nuovo preventivo (bozza)</option>${prevs.map((p) => `<option value="${p.id}" ${String(p.id) === String(prevId) ? 'selected' : ''}>Preventivo ${esc(p.riferimento || p.id)} (${p.righe} righe)</option>`).join('')}</select></label>` : ''}
        <label class="f"><span>Modalità</span><select id="md"><option value="aggiungi" ${modalita === 'aggiungi' ? 'selected' : ''}>Aggiungi alle righe esistenti</option><option value="sostituisci" ${modalita === 'sostituisci' ? 'selected' : ''}>Sostituisci le righe esistenti</option></select></label>
      </div>
      <h3 style="margin:6px 0">Associa le colonne del file ai campi del gestionale</h3>
      <div class="form-grid" id="map">${campi.map((c) => `<label class="f"><span>${esc(c.label)}</span><select data-m="${c.key}"><option value="">— non importare —</option>${headers.map((h, i) => `<option value="${i}" ${mapping[c.key] === i ? 'selected' : ''}>${colName(i)}${h !== '' ? ': ' + esc(String(h).slice(0, 28)) : ''}</option>`).join('')}</select></label>`).join('')}</div>
      <p id="cnt" class="alert info"></p>
      <div class="tw" id="tb" style="max-height:46vh;overflow:auto"></div>
      <p class="muted"><small>Il prezzo unitario viene importato come prezzo di vendita interno; il prezzo mostrato al cliente coincide con esso finché non lo modifichi nel preventivo. Prezzo di acquisto, vendita e margine restano sempre separati.</small></p>`;
    const w = $('#w', m.root);
    $('#sh', w).onchange = (e) => { fi = Number(e.target.value); header = sheet().headerRow; mapping = { ...sheet().mapping }; build(); render(); };
    $('#hd', w).onchange = (e) => { header = Number(e.target.value); mapping = guess(sheet().rows[header]); build(); render(); };
    $('#pv', w) && ($('#pv', w).onchange = (e) => { prevId = e.target.value; });
    $('#md', w).onchange = (e) => { modalita = e.target.value; };
    $$('#map select', w).forEach((el) => { el.onchange = () => { mapping[el.dataset.m] = el.value === '' ? null : Number(el.value); build(); renderTable(); }; });
    w.onchange = (e) => {
      if (e.target.id === 'all') { items.forEach((x) => { x.incl = e.target.checked; }); return renderTable(); }
      const tr = e.target.closest('tr[data-i]');
      if (tr && e.target.matches('[data-incl]')) { items[tr.dataset.i].incl = e.target.checked; renderTable(); }
    };
    w.oninput = (e) => {
      const tr = e.target.closest('tr[data-i]'); if (!tr || !e.target.dataset.f) return;
      const it = items[tr.dataset.i]; it.vals[e.target.dataset.f] = e.target.value;
      $('.w small', tr).textContent = warn(it.vals).join('; ');
    };
    renderTable();
  }
  // ri-propone la mappatura quando cambia la riga di intestazione
  function guess(hdr) {
    const out = {};
    const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const rules = { codice: /cod|p\/n|^pn$|sku|part/, descrizione: /descr|prodotto|articolo|denomin/, qta: /q\.?t|quant|pezzi|qty/, prezzo_acquisto: /acquist|costo|netto/, prezzo_cliente: /prezzo cliente|offerta/, prezzo_totale: /totale|importo/, prezzo_vendita: /unit|prezzo|vendita|p\.?u\.?$/, fornitore: /fornit|supplier|vendor|marca/, note: /note|annot/ };
    const used = new Set();
    for (const k of ['prezzo_acquisto', 'prezzo_cliente', 'prezzo_totale', 'codice', 'descrizione', 'qta', 'fornitore', 'note', 'prezzo_vendita']) {
      const i = hdr.findIndex((h, ix) => !used.has(ix) && h !== '' && rules[k].test(norm(h)));
      if (i >= 0) { out[k] = i; used.add(i); }
    }
    return out;
  }

  async function conferma({ close }) {
    const righe = items.filter((i) => i.incl).map((i) => i.vals);
    if (!righe.length) return toast('Nessuna riga selezionata', true);
    if (righe.some((v) => !v.descrizione.trim() && !v.codice.trim()) && !confirm('Alcune righe selezionate non hanno né codice né descrizione. Importarle comunque?')) return;
    const out = await api('/import/conferma', { method: 'POST', body: { token: r.token, commessa_id: preset.commessa_id || null, preventivo_id: prevId || null, righe, modalita } });
    toast(`${out.righe} righe importate. Il file Excel è stato allegato alla commessa.`);
    close(); onDone?.(out);
  }

  build(); render();
}
