// Gestione documentale: elenco, visualizzazione, caricamento guidato (estrazione → anteprima → verifica → conferma → collegamento), versioni
import {
  $, $$, esc, eur, dt, kb, api, toast, modal, confirmBox, store, loadLookup, optionsHtml, fieldHtml, formGrid, formModal, readForm,
  TIPOLOGIE, badge, parseNum, today,
} from './lib.js';

export const ENT_LABEL = { commesse: 'Commessa', clienti: 'Cliente', fornitori: 'Fornitore', preventivi: 'Preventivo', ordini: 'Ordine', ddt: 'DDT', fatture: 'Fattura', spese: 'Spesa' };
const ext = (n) => (n.split('.').pop() || '').toLowerCase();
const icon = (n) => ({ pdf: '📄', xlsx: '📊', csv: '📊', xml: '🧾', png: '🖼', jpg: '🖼', jpeg: '🖼' }[ext(n)] || '📎');

// ---------------------------------------------------------------- elenco documenti
export function docTable(docs, { compact = false } = {}) {
  if (!docs.length) return '<div class="empty">Nessun documento. Usa “Carica documento” per aggiungerne uno.</div>';
  return `<div class="tw"><table><thead><tr><th>Documento</th><th>Tipologia</th><th>N°</th><th>Data doc.</th><th>Caricato</th>${compact ? '' : '<th>Collegato a</th>'}<th>Note</th><th></th></tr></thead><tbody>
  ${docs.map((d) => `<tr>
    <td><span>${icon(d.nome_file)}</span> <a href="#" data-doc="view" data-id="${d.id}"><b>${esc(d.nome_file)}</b></a>
      ${d.n_versioni > 1 ? `<a href="#" data-doc="history" data-id="${d.id}">${badge('v' + d.versione + ' · storico', 'warn')}</a>` : ''}<br><small>${kb(d.dimensione || 0)}</small></td>
    <td>${badge(TIPOLOGIE[d.tipologia] || d.tipologia)}</td><td>${esc(d.numero_documento || '')}</td><td>${dt(d.data_documento)}</td><td>${dt(d.data_caricamento)}</td>
    ${compact ? '' : `<td>${(d.links || []).map((l) => `<span class="chip">${ENT_LABEL[l.entita] || l.entita}: ${esc(l.label || '#' + l.entita_id)}</span>`).join('')}</td>`}
    <td><small>${esc(d.note || '')}</small></td>
    <td style="white-space:nowrap">
      <button class="btn sm sec" data-doc="view" data-id="${d.id}">Visualizza</button>
      <button class="btn sm sec" data-doc="download" data-id="${d.id}">Scarica</button>
      <details class="menu"><summary class="btn sm ghost">⋯</summary><div class="dd">
        <button data-doc="edit" data-id="${d.id}">Modifica dati</button>
        <button data-doc="link" data-ent="commesse" data-id="${d.id}">Collega a commessa</button>
        <button data-doc="link" data-ent="ordini" data-id="${d.id}">Collega a ordine</button>
        <button data-doc="link" data-ent="fatture" data-id="${d.id}">Collega a fattura</button>
        <button data-doc="link" data-ent="ddt" data-id="${d.id}">Collega a DDT</button>
        <button data-doc="replace" data-id="${d.id}">Sostituisci file (nuova versione)</button>
        <button data-doc="history" data-id="${d.id}">Storico versioni</button>
        <button data-doc="delete" data-id="${d.id}" style="color:var(--bad)">Elimina</button>
      </div></details>
    </td></tr>`).join('')}</tbody></table></div>`;
}

export function bindDocActions(root, reload) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-doc]');
    if (!b) return;
    e.preventDefault();
    const id = Number(b.dataset.id);
    b.closest('details')?.removeAttribute('open');
    const a = b.dataset.doc;
    if (a === 'view') viewDoc(id);
    else if (a === 'download') location.href = `/api/documenti/${id}/file?download=1`;
    else if (a === 'edit') editDoc(id, reload);
    else if (a === 'link') linkDoc(id, b.dataset.ent, reload);
    else if (a === 'replace') replaceDoc(id, reload);
    else if (a === 'history') history(id, reload);
    else if (a === 'delete') {
      if (await confirmBox('Eliminare il documento e il file originale? L’operazione non è reversibile.')) { await api(`/documenti/${id}`, { method: 'DELETE' }); toast('Documento eliminato'); reload(); }
    }
  });
}

// ---------------------------------------------------------------- visualizzazione
export async function viewDoc(id) {
  const d = await api(`/documenti/${id}`);
  const url = `/api/documenti/${id}/file`;
  const e = ext(d.nome_file);
  const body = document.createElement('div');
  if (e === 'pdf') body.innerHTML = `<iframe src="${url}" style="width:100%;height:76vh;border:1px solid var(--line);border-radius:8px" title="${esc(d.nome_file)}"></iframe>`;
  else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) body.innerHTML = `<div class="pv"><img src="${url}" alt="${esc(d.nome_file)}"></div>`;
  else if (e === 'xlsx' || e === 'csv') {
    const sheets = await api(`/documenti/${id}/tabella`);
    body.innerHTML = sheets.map((s) => `<h3 style="margin:8px 0">${esc(s.nome)}</h3><div class="tw" style="max-height:60vh"><table>${s.rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table></div>`).join('');
  } else if (e === 'xml') {
    const t = await (await fetch(url)).text();
    body.innerHTML = `<pre style="white-space:pre-wrap;max-height:70vh;overflow:auto">${esc(t)}</pre>`;
  } else body.innerHTML = '<p>Anteprima non disponibile per questo formato: usare “Scarica”.</p>';
  const meta = `<p class="muted" style="margin:0 0 10px">${badge(TIPOLOGIE[d.tipologia] || d.tipologia)} ${d.numero_documento ? 'n. ' + esc(d.numero_documento) + ' · ' : ''}${dt(d.data_documento)} ${d.links.map((l) => `<span class="chip">${ENT_LABEL[l.entita]}: ${esc(l.label || '')}</span>`).join('')}</p>`;
  body.insertAdjacentHTML('afterbegin', meta);
  modal({ title: d.nome_file, size: 'wide', body, buttons: [
    { label: 'Modifica dati', cls: 'sec', onClick: ({ close }) => { close(); editDoc(id, () => location.reload()); } },
    { label: 'Scarica', onClick: () => { location.href = `${url}?download=1`; } }] });
}

// ---------------------------------------------------------------- modifica dati / collegamenti
async function entityOptions(entita) {
  const L = await loadLookup();
  if (entita === 'commesse') return L.commesse.map((c) => [c.id, `${c.codice} — ${c.oggetto || ''}`]);
  if (entita === 'clienti') return L.clienti.map((c) => [c.id, c.ragione_sociale]);
  if (entita === 'fornitori') return L.fornitori.map((c) => [c.id, c.ragione_sociale]);
  const rows = await api(`/${entita}`);
  const map = {
    ordini: (r) => `Ord. ${r.tipo} ${r.numero || '—'} · ${r.codice || ''}`,
    fatture: (r) => `Fatt. ${r.tipo} ${r.numero || '—'} · ${dt(r.data)}`,
    ddt: (r) => `DDT ${r.numero || '—'} · ${dt(r.data)}`,
    preventivi: (r) => `Prev. ${r.riferimento || '—'} · ${r.commessa || ''}`,
    spese: (r) => `Spesa ${r.descrizione || ''} · ${dt(r.data)}`,
  };
  return rows.map((r) => [r.id, map[entita](r)]);
}

export async function linkDoc(id, entita = 'commesse', reload) {
  const m = modal({
    title: 'Collega documento', body: `<label class="f"><span>Collega a</span><select id="le">${optionsHtml(Object.entries(ENT_LABEL), entita, false)}</select></label>
      <label class="f"><span>Elemento</span><select id="lv"></select></label>`,
    buttons: [{ label: 'Annulla', cls: 'sec', onClick: ({ close }) => close() },
      { label: 'Collega', onClick: async ({ close, root }) => {
        const v = $('#lv', root).value;
        if (!v) return toast('Selezionare un elemento', true);
        await api(`/documenti/${id}/collega`, { method: 'POST', body: { entita: $('#le', root).value, entita_id: Number(v) } });
        toast('Documento collegato'); close(); reload?.();
      } }],
  });
  const fill = async () => { $('#lv', m.root).innerHTML = '<option>Caricamento…</option>'; $('#lv', m.root).innerHTML = optionsHtml(await entityOptions($('#le', m.root).value), '', false) || '<option value="">Nessun elemento</option>'; };
  $('#le', m.root).onchange = fill; fill();
}

export async function editDoc(id, reload) {
  const d = await api(`/documenti/${id}`);
  const fields = [
    { k: 'nome_file', label: 'Nome file', full: true },
    { k: 'tipologia', label: 'Tipologia', type: 'select', options: Object.entries(TIPOLOGIE) },
    { k: 'numero_documento', label: 'Numero documento' }, { k: 'data_documento', label: 'Data documento', type: 'date' },
    { k: 'note', label: 'Note', type: 'textarea' },
  ];
  const linksHtml = `<h3 style="margin:6px 0">Collegamenti</h3><div class="pill-list" id="lk">${d.links.map((l) => `<span class="chip">${ENT_LABEL[l.entita]}: ${esc(l.label || '')} <a href="#" data-un="${l.entita}:${l.entita_id}" title="Scollega">×</a></span>`).join('') || '<small>Nessuno</small>'}</div>
    <p style="margin-top:10px"><button class="btn sm sec" type="button" data-add>+ Aggiungi collegamento</button></p>`;
  formModal({
    title: `Dati documento — ${d.nome_file}`, fields, values: d, extra: linksHtml,
    onSave: async (v, { close }) => { await api(`/documenti/${id}`, { method: 'PUT', body: v }); toast('Dati salvati'); close(); reload?.(); },
    afterOpen: ({ root, close }) => {
      root.addEventListener('click', async (e) => {
        const u = e.target.closest('[data-un]');
        if (u) { e.preventDefault(); const [en, ei] = u.dataset.un.split(':'); await api(`/documenti/${id}/collega/${en}/${ei}`, { method: 'DELETE' }); close(); editDoc(id, reload); reload?.(); }
        if (e.target.closest('[data-add]')) { close(); linkDoc(id, 'commesse', () => { editDoc(id, reload); reload?.(); }); }
      });
    },
  });
}

export function replaceDoc(id, reload) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.onchange = async () => {
    if (!inp.files[0]) return;
    const form = new FormData(); form.append('file', inp.files[0]);
    await api(`/documenti/${id}/versione`, { method: 'POST', form });
    toast('Nuova versione caricata: la precedente resta nello storico'); reload?.();
  };
  inp.click();
}

async function history(id, reload) {
  const d = await api(`/documenti/${id}`);
  modal({ title: `Storico versioni — ${d.nome_file}`, body: `<table><thead><tr><th>Versione</th><th>File</th><th>Caricata</th><th></th></tr></thead><tbody>
    ${d.versioni.map((v) => `<tr><td>v${v.versione} ${v.corrente ? badge('corrente', 'ok') : ''}</td><td>${esc(v.nome_file)}</td><td>${dt(v.data_caricamento)}</td>
    <td><a href="/api/documenti/${v.id}/file" target="_blank">Visualizza</a> · <a href="/api/documenti/${v.id}/file?download=1">Scarica</a></td></tr>`).join('')}</tbody></table>`,
  buttons: [{ label: 'Sostituisci con nuovo file', onClick: ({ close }) => { close(); replaceDoc(id, reload); } }] });
}

// ---------------------------------------------------------------- caricamento guidato
const CREA = { ddt: 'DDT', ordine_cliente: 'ordine cliente', ordine_fornitore: 'ordine fornitore', fattura_cliente: 'fattura cliente', fattura_fornitore: 'fattura fornitore', spesa: 'spesa' };
const SOGGETTO = { preventivo: 'cliente', ordine_cliente: 'cliente', fattura_cliente: 'cliente', ordine_fornitore: 'fornitore', fattura_fornitore: 'fornitore', spesa: 'fornitore' };

export function uploadWizard(preset = {}, onDone) {
  const m = modal({
    title: 'Carica documento', body: `<div class="drop" id="drop"><b>Trascina qui il file</b><p class="muted">PDF, Excel / XLSX, CSV, XML fattura, immagini (scontrini)</p>
      <button class="btn" type="button">Scegli file</button><input type="file" id="fi" hidden accept=".pdf,.xlsx,.csv,.xml,.png,.jpg,.jpeg,.webp,.heic"></div>
      <p class="muted" style="margin-bottom:0">Il sistema prova a riconoscere i dati principali, ma dovrai sempre verificarli prima della conferma. Per importare le <b>righe</b> di un Excel in un preventivo usa “Importa da Excel”.</p>`,
    buttons: [{ label: 'Annulla', cls: 'sec', onClick: ({ close }) => close() }],
  });
  const drop = $('#drop', m.root), fi = $('#fi', m.root);
  drop.onclick = () => fi.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) go(e.dataTransfer.files[0]); };
  fi.onchange = () => fi.files[0] && go(fi.files[0]);
  async function go(file) {
    drop.innerHTML = '<b>Analisi del documento in corso…</b>';
    const form = new FormData(); form.append('file', file);
    try { const r = await api('/documenti/analizza', { method: 'POST', form }); m.close(); anteprima(r, preset, onDone); } catch { m.close(); }
  }
}

async function anteprima(r, preset, onDone) {
  const L = await loadLookup();
  const est = r.estratti || {};
  const d = {
    tipologia: preset.tipologia || est.tipologia || 'altro', numero_documento: est.numero_documento || '', data_documento: est.data_documento || '',
    commessa_id: preset.commessa_id || est.commessa_id || '', cliente_id: est.cliente_id || '', fornitore_id: est.fornitore_id || '',
    imponibile: est.imponibile ?? '', iva: est.iva ?? '', totale: est.importo ?? '', numero_ordine: est.numero_ordine || '', ordine_id: preset.ordine_id || '',
    ddt_tipo: 'uscita', scadenza: '', descrizione: '', categoria: '', note: '', righe: [], crea: null, piva: est.piva || '',
  };
  let crea = preset.crea !== undefined ? preset.crea : (CREA[d.tipologia] ? d.tipologia : null);
  let nuovo = null, ordini = [];
  const conf = est.confidenza || {};
  const e = ext(r.nome_file);
  const previewable = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e);
  const trovati = Object.keys(conf).length;

  const m = modal({ title: `Verifica dati — ${r.nome_file}`, size: 'xl', body: '<div class="split"><div id="pv"></div><div id="fm"></div></div>', buttons: [
    { label: 'Annulla', cls: 'sec', onClick: async ({ close }) => { await api(`/documenti/temp/${r.token}`, { method: 'DELETE' }); close(); } },
    { label: 'Conferma e collega alla commessa', id: 'ok', onClick: salva }] });
  m.root.dataset.sticky = '1';
  $('#pv', m.root).innerHTML = !previewable ? '<div class="pv"><p class="muted">Anteprima non disponibile per questo formato.</p></div>'
    : e === 'pdf' ? `<iframe src="/api/documenti/temp/${r.token}" title="anteprima"></iframe>` : `<div class="pv"><img src="/api/documenti/temp/${r.token}" alt=""></div>`;

  const read = () => {
    for (const el of $$('#fm [data-k]', m.root)) { if (el.dataset.k in d) d[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; }
    if ($('#fm [name=nn]', m.root)) nuovo = { ragione_sociale: $('#nn', m.root).value, piva: $('#np', m.root).value };
    d.righe = $$('#fm .drow', m.root).map((tr) => ({ codice: $('[data-r=codice]', tr).value, descrizione: $('[data-r=descrizione]', tr).value, qta: $('[data-r=qta]', tr).value }));
    const cb = $('#fm #crea', m.root); if (cb) crea = cb.checked ? (CREA[d.tipologia] ? d.tipologia : null) : null;
  };
  async function loadOrdini() {
    ordini = d.commessa_id ? await api(`/ordini?commessa_id=${d.commessa_id}`) : [];
  }
  const A = (k) => !!conf[k] && String(d[k]) === String(est[k === 'importo' ? 'importo' : k] ?? '');
  const sel = (k, label, opts, extra = '') => `<label class="f"><span>${label}${A(k) ? '<em class="auto">rilevato automaticamente</em>' : ''}</span><select data-k="${k}" ${extra}>${optionsHtml(opts, d[k])}</select></label>`;
  const inp = (k, label, type = 'text') => fieldHtml({ k, label, type, auto: conf[k] && String(d[k]) === String(est[k] ?? est.importo ?? '') }, d);

  async function render() {
    await loadOrdini();
    const sogg = d.tipologia === 'ddt' ? (d.ddt_tipo === 'entrata' ? 'fornitore' : 'cliente') : (SOGGETTO[d.tipologia] || 'entrambi');
    const cliOpts = L.clienti.map((c) => [c.id, c.ragione_sociale]), forOpts = L.fornitori.map((c) => [c.id, c.ragione_sociale]);
    if (!d.cliente_id && d.commessa_id && sogg !== 'fornitore') d.cliente_id = L.commesse.find((c) => String(c.id) === String(d.commessa_id))?.cliente_id || '';
    const money = ['fattura_cliente', 'fattura_fornitore', 'ordine_cliente', 'ordine_fornitore', 'spesa'].includes(d.tipologia);
    const ddtHtml = d.tipologia === 'ddt' ? `<div class="card" style="margin:6px 0 12px;padding:10px"><div class="card-h" style="margin-bottom:6px"><h3>Prodotti del DDT</h3>
      <button class="btn sm sec" type="button" data-fill>Precompila dal preventivo</button><button class="btn sm sec" type="button" data-addrow>+ Riga</button></div>
      <table><tbody>${d.righe.map((x, i) => `<tr class="drow"><td><input data-r="codice" placeholder="Codice" value="${esc(x.codice)}"></td><td><input data-r="descrizione" placeholder="Descrizione" value="${esc(x.descrizione)}"></td><td style="width:70px"><input data-r="qta" value="${esc(x.qta)}"></td><td><a href="#" data-delrow="${i}">×</a></td></tr>`).join('') || '<tr><td class="muted">Nessun prodotto: facoltativo.</td></tr>'}</tbody></table></div>` : '';
    $('#fm', m.root).innerHTML = `
      <div class="alert ${trovati ? 'info' : ''}">${trovati ? `Abbiamo riconosciuto <b>${trovati}</b> dati nel documento. Verificali e correggili se necessario.` : 'Nessun dato riconosciuto automaticamente: compila i campi che ti servono (sono tutti modificabili).'}</div>
      <div class="form-grid">
        ${sel('tipologia', 'Tipologia documento', Object.entries(TIPOLOGIE), 'data-struct')}
        ${inp('numero_documento', 'Numero documento')}${inp('data_documento', 'Data documento', 'date')}
        ${sel('commessa_id', 'Commessa', L.commesse.map((c) => [c.id, `${c.codice} — ${c.oggetto || ''}`]), 'data-struct')}
        ${d.tipologia === 'ddt' ? sel('ddt_tipo', 'Tipo DDT', [['uscita', 'Uscita (verso cliente)'], ['entrata', 'Entrata (da fornitore)']], 'data-struct') : ''}
        ${sogg !== 'fornitore' ? sel('cliente_id', 'Cliente', cliOpts) : ''}${sogg !== 'cliente' ? sel('fornitore_id', 'Fornitore', forOpts) : ''}
        ${money ? inp('imponibile', 'Imponibile €') + inp('iva', 'IVA €') + inp('totale', 'Totale €') : ''}
        ${d.tipologia.startsWith('fattura') ? inp('scadenza', 'Scadenza pagamento', 'date') : ''}
        ${d.tipologia === 'spesa' ? inp('descrizione', 'Descrizione spesa') + inp('categoria', 'Categoria') : ''}
        ${['ddt', 'fattura_cliente', 'fattura_fornitore'].includes(d.tipologia) ? sel('ordine_id', `Ordine collegato${d.numero_ordine ? ' (rilevato: ' + esc(d.numero_ordine) + ')' : ''}`, ordini.map((o) => [o.id, `${o.tipo} ${o.numero || '—'}`])) : ''}
        ${fieldHtml({ k: 'note', label: 'Note', type: 'textarea', rows: 2 }, d)}
      </div>
      ${ddtHtml}
      ${d.piva && !d.cliente_id && !d.fornitore_id ? `<div class="alert">P.IVA ${esc(d.piva)} non presente in anagrafica.</div>` : ''}
      ${(sogg !== 'fornitore' && !d.cliente_id) || (sogg === 'fornitore' && !d.fornitore_id) || sogg === 'entrambi' ? `<details ${nuovo?.ragione_sociale || d.piva ? 'open' : ''}><summary class="muted" style="cursor:pointer">+ Crea nuovo ${sogg === 'fornitore' ? 'fornitore' : 'cliente'}</summary>
        <div class="form-grid" style="margin-top:8px"><label class="f"><span>Ragione sociale</span><input id="nn" name="nn" value="${esc(nuovo?.ragione_sociale || '')}"></label><label class="f"><span>P.IVA</span><input id="np" value="${esc(nuovo?.piva ?? d.piva)}"></label></div></details>` : ''}
      ${CREA[d.tipologia] ? `<label class="chk"><input type="checkbox" id="crea" ${crea ? 'checked' : ''}> Registra anche i dati come ${CREA[d.tipologia]} (il PDF originale resta sempre consultabile)</label>` : ''}
      ${d.tipologia === 'ddt' ? '<p class="muted"><small>Il DDT viene creato in WebDesk: qui si registrano solo i dati essenziali e si allega il PDF originale.</small></p>' : ''}`;
    for (const el of $$('#fm [data-struct]', m.root)) el.onchange = async () => { read(); if (el.dataset.k === 'tipologia') crea = CREA[d.tipologia] ? d.tipologia : null; await render(); };
    $('#fm', m.root).onclick = async (ev) => {
      if (ev.target.closest('[data-addrow]')) { read(); d.righe.push({ codice: '', descrizione: '', qta: 1 }); render(); }
      const del = ev.target.closest('[data-delrow]'); if (del) { ev.preventDefault(); read(); d.righe.splice(Number(del.dataset.delrow), 1); render(); }
      if (ev.target.closest('[data-fill]')) {
        read();
        if (!d.commessa_id) return toast('Selezionare prima la commessa', true);
        const pv = (await api(`/preventivi?commessa_id=${d.commessa_id}`))[0];
        if (!pv) return toast('Nessun preventivo in questa commessa', true);
        d.righe = (await api(`/preventivi/${pv.id}`)).righe.map((x) => ({ codice: x.codice || '', descrizione: x.descrizione || '', qta: x.qta }));
        render();
      }
    };
  }

  async function salva({ close }) {
    read();
    if (!d.commessa_id && !confirm('Nessuna commessa selezionata: il documento non comparirà in nessuna timeline. Continuare?')) return;
    const body = {
      token: r.token, nome_file: r.nome_file, estratti: est, commessa_id: d.commessa_id || null, crea,
      dati: { ...d, righe: d.righe.filter((x) => x.descrizione || x.codice), cliente_id: d.cliente_id || null, fornitore_id: d.fornitore_id || null, ordine_id: d.ordine_id || null,
        preventivo_id: preset.preventivo_id || null, importo: parseNum(d.totale) },
      collega: preset.collega || [],
    };
    if (nuovo?.ragione_sociale) {
      const sogg = d.tipologia === 'ddt' ? (d.ddt_tipo === 'entrata' ? 'fornitore' : 'cliente') : (SOGGETTO[d.tipologia] || 'cliente');
      body[`nuovo_${sogg}`] = nuovo;
    }
    await api('/documenti/conferma', { method: 'POST', body });
    await loadLookup(true);
    toast('Documento archiviato e collegato'); close(); onDone?.();
  }
  render();
}
