import {
  $, $$, esc, eur, dt, today, api, toast, modal, confirmBox, formModal, loadLookup, store, optionsHtml, badge, statoBadge, debounce,
  TIPOLOGIE, STATI, PA_LABELS, parseNum, kb,
} from './lib.js';
import { docTable, bindDocActions, uploadWizard, viewDoc, ENT_LABEL } from './docs.js';
import { importWizard } from './importer.js';
import { preventivoView } from './preventivo.js';

const view = $('#view');
const refresh = () => route();
const link = (h, t) => `<a href="${h}">${esc(t)}</a>`;

// ------------------------------------------------------------------ router
async function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const q = new URLSearchParams(qs || '');
  const seg = path.split('/').filter(Boolean);
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === (seg[0] === 'commessa' || seg[0] === 'preventivo' ? 'commesse' : seg[0] === 'cliente' ? 'clienti' : seg[0] === 'fornitore' ? 'fornitori' : seg[0] || 'dashboard')));
  $('#side').classList.remove('open');
  $('#modal-root').innerHTML = '';
  view.innerHTML = '<p class="muted">Caricamento…</p>';
  try {
    await loadLookup(true);
    if (!seg.length) await dashboard();
    else if (seg[0] === 'commesse') await commesseList();
    else if (seg[0] === 'commessa') await commessaView(Number(seg[1]), q.get('tab') || 'riepilogo');
    else if (seg[0] === 'preventivo') await preventivoView(Number(seg[1]), view);
    else if (seg[0] === 'documenti') await documentiPage();
    else if (seg[0] === 'clienti') await anagrafica('clienti');
    else if (seg[0] === 'fornitori') await anagrafica('fornitori');
    else if (seg[0] === 'cliente' || seg[0] === 'fornitore') await soggettoView(seg[0], Number(seg[1]));
    else view.innerHTML = '<div class="empty">Pagina non trovata</div>';
  } catch (e) { if (e.message !== 'network') view.innerHTML = `<div class="alert">Errore: ${esc(e.message)}</div>`; console.error(e); }
}
addEventListener('hashchange', route);

// ------------------------------------------------------------------ cruscotto
async function dashboard() {
  const d = await api('/dashboard');
  const kpi = (q, v, s = '', cls = '') => `<div class="kpi ${cls}"><div class="q">${q}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  view.innerHTML = `
    <div class="page-head"><div class="grow"><h1>Cruscotto</h1><p class="muted">Situazione delle commesse aperte — ${d.commesse_aperte} in corso</p></div>
      <button class="btn" data-a="nuova">+ Nuova commessa</button></div>
    <div class="grid g3">
      ${kpi('Preventivato', eur(d.preventivato), 'commesse aperte', 'sky')}${kpi('Venduto', eur(d.venduto), 'ordini cliente')}${kpi('Speso', eur(d.speso), 'fatture fornitori + spese')}
      ${kpi('Da pagare ai fornitori', eur(d.da_pagare), '', d.da_pagare ? 'warn' : '')}${kpi('Da incassare dai clienti', eur(d.da_incassare), '', d.da_incassare ? 'warn' : '')}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h2>Documenti mancanti</h2></div>${d.con_documenti_mancanti.length ? `<table><tbody>${d.con_documenti_mancanti.map((c) => `<tr class="click" onclick="location.hash='#/commessa/${c.id}?tab=documenti'"><td><b>${esc(c.codice)}</b></td><td>${c.mancanti.map((m) => badge(m, 'warn')).join(' ')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessun documento mancante 🎉</div>'}</div>
      <div class="card"><div class="card-h"><h2>Scadenze da gestire</h2></div>${d.scadenze.length ? `<table><thead><tr><th>Scad.</th><th>Fattura</th><th>Soggetto</th><th class="num">Residuo</th></tr></thead><tbody>${d.scadenze.map((f) => `<tr><td>${dt(f.scadenza)}</td><td>${f.tipo === 'cliente' ? 'Incasso' : 'Pagamento'} ${esc(f.numero || '')}<br><small>${esc(f.codice || '')}</small></td><td>${esc(f.soggetto || '')}</td><td class="num">${eur(f.residuo)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessuna scadenza</div>'}</div></div>
    <div class="card"><div class="card-h"><h2>Ultima attività</h2></div>${d.ultimi.length ? `<table><tbody>${d.ultimi.map((t) => `<tr class="click" onclick="location.hash='#/commessa/${t.commessa_id}?tab=timeline'"><td style="width:90px">${dt(t.data)}</td><td><b>${esc(t.codice)}</b></td><td>${esc(t.testo)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessuna attività</div>'}</div>`;
  view.onclick = (e) => { if (e.target.closest('[data-a=nuova]')) nuovaCommessa(); };
}

// ------------------------------------------------------------------ commesse
async function commesseList() {
  const rows = await api('/commesse');
  let stato = '', text = '';
  view.innerHTML = `<div class="page-head"><div class="grow"><h1>Commesse</h1></div>
    <select id="fs" style="width:auto"><option value="">Tutti gli stati</option>${Object.entries(STATI).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <input id="ft" placeholder="Filtra…" style="width:200px"><button class="btn" data-a="nuova">+ Nuova commessa</button></div><div class="card" id="lst"></div>`;
  const draw = () => {
    const f = rows.filter((c) => (!stato || c.stato === stato) && (!text || `${c.codice} ${c.cliente} ${c.oggetto}`.toLowerCase().includes(text)));
    $('#lst', view).innerHTML = f.length ? `<div class="tw"><table><thead><tr><th>Codice</th><th>Cliente</th><th>Oggetto</th><th>Stato</th><th class="num">Preventivato</th><th class="num">Venduto</th><th class="num">Speso</th><th class="num">Margine</th><th>Doc.</th></tr></thead><tbody>
      ${f.map((c) => `<tr class="click" data-go="${c.id}"><td><b>${esc(c.codice)}</b></td><td>${esc(c.cliente || '—')}</td><td>${esc(c.oggetto || '')}</td><td>${statoBadge(c.stato)}</td>
        <td class="num">${eur(c.preventivato)}</td><td class="num">${eur(c.venduto)}</td><td class="num">${eur(c.speso)}</td>
        <td class="num">${c.margine_reale != null ? eur(c.margine_reale) : c.margine_previsto != null ? `<span class="muted" title="Margine previsto">~${eur(c.margine_previsto)}</span>` : '<span class="muted">n/d</span>'}</td>
        <td>${c.mancanti ? badge(`${c.mancanti} mancanti`, 'warn') : badge('ok', 'ok')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nessuna commessa</div>';
  };
  draw();
  $('#fs', view).onchange = (e) => { stato = e.target.value; draw(); };
  $('#ft', view).oninput = (e) => { text = e.target.value.toLowerCase(); draw(); };
  view.onclick = (e) => { const r = e.target.closest('[data-go]'); if (r) location.hash = `#/commessa/${r.dataset.go}`; if (e.target.closest('[data-a=nuova]')) nuovaCommessa(); };
}

const PA_KEYS = Object.keys(PA_LABELS);
const commessaFields = (L) => [
  { k: 'codice', label: 'Codice commessa', placeholder: 'automatico (es. WEB-0053-26)' },
  { k: 'cliente_id', label: 'Cliente', type: 'select', options: L.clienti.map((c) => [c.id, c.ragione_sociale]) },
  { k: 'oggetto', label: 'Oggetto', full: true }, { k: 'data_apertura', label: 'Data apertura', type: 'date' },
  { k: 'stato', label: 'Stato', type: 'select', options: Object.entries(STATI) },
  { k: 'note', label: 'Note', type: 'textarea', rows: 2 },
  { k: 'pa_attiva', label: 'Questa commessa riguarda una Pubblica Amministrazione (attiva i riferimenti PA)', type: 'checkbox', toggles: 'pa', full: true },
  ...PA_KEYS.map((k) => ({ k, label: PA_LABELS[k], group: 'pa' })),
];
const PA_GROUP = { pa: 'Riferimenti Pubblica Amministrazione' };

async function nuovaCommessa() {
  const L = await loadLookup(true);
  const next = (await api('/commesse/prossimo-codice')).codice;
  const f = commessaFields(L); f[0].placeholder = `automatico: ${next}`;
  formModal({
    title: 'Nuova commessa', fields: f, groups: PA_GROUP, size: 'wide', values: { data_apertura: today(), stato: 'preventivo' }, saveLabel: 'Crea commessa',
    afterOpen: ({ root }) => {
      $('[data-k=cliente_id]', root).addEventListener('change', (e) => {
        const c = L.clienti.find((x) => String(x.id) === e.target.value);
        if (c?.pa_attiva) { const cb = $('[data-k=pa_attiva]', root); cb.checked = true; cb.dispatchEvent(new Event('change')); }
      });
    },
    onSave: async (v, { close }) => { const c = await api('/commesse', { method: 'POST', body: v }); close(); toast(`Commessa ${c.codice} creata`); location.hash = `#/commessa/${c.id}`; },
  });
}

// ------------------------------------------------------------------ scheda commessa
const TABS = [['riepilogo', 'Riepilogo'], ['preventivi', 'Preventivi'], ['ordini', 'Ordini'], ['ddt', 'DDT'], ['fatture', 'Fatture'], ['spese', 'Spese'], ['documenti', 'Documenti'], ['timeline', 'Timeline']];

async function commessaView(id, tab) {
  const c = await api(`/commesse/${id}`);
  const co = c.commessa, L = store.lookup;
  const idx = Object.keys(STATI).indexOf(co.stato);
  const counts = { preventivi: c.preventivi_lista.length, ordini: c.ordini.length, ddt: c.ddt.length, fatture: c.fatture.length, spese: c.spese.length, documenti: c.documenti.length, timeline: c.timeline.length };
  const reload = () => commessaView(id, tab);
  const docsOf = (ent, eid) => c.documenti.filter((d) => d.links.some((l) => l.entita === ent && l.entita_id === eid));
  const docBtns = (ent, eid) => docsOf(ent, eid).map((d) => `<button class="btn sm sec" data-doc="view" data-id="${d.id}" title="${esc(d.nome_file)}">📄 PDF</button>`).join(' ');

  view.innerHTML = `
    <div class="page-head"><div class="grow"><div class="crumbs muted"><a href="#/commesse">Commesse</a> /</div>
      <h1>${esc(co.codice)} ${statoBadge(co.stato)}</h1>
      <p>${esc(co.oggetto || '')}${c.cliente ? ` — <a href="#/cliente/${c.cliente.id}">${esc(c.cliente.ragione_sociale)}</a>` : ''}</p></div>
      <button class="btn sec" data-a="edit">Modifica</button><button class="btn sec" data-a="import">⤓ Importa da Excel</button><button class="btn" data-a="upload">⤒ Carica documento</button></div>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/commessa/${id}?tab=${k}" class="${k === tab ? 'on' : ''}">${l}${counts[k] ? `<span class="n">${counts[k]}</span>` : ''}</a>`).join('')}</div>
    <div id="tabc"></div>`;
  const tc = $('#tabc', view);
  const T = {};

  // ---- riepilogo: risponde alle domande chiave sulla commessa
  T.riepilogo = () => {
    const mReal = c.margine_reale, mPrev = c.margine_previsto ?? null;
    const k = (q, v, s = '', cls = '') => `<div class="kpi ${cls}"><div class="q">${q}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    const pa = co.pa_attiva ? PA_KEYS.filter((x) => co[x]).map((x) => `<dt>${PA_LABELS[x]}</dt><dd>${esc(co[x])}</dd>`).join('') : '';
    return `
      <div class="stepper">${Object.entries(STATI).map(([s, l], i) => `<button data-stato="${s}" class="${i < idx ? 'done' : i === idx ? 'cur' : ''}">${l}</button>`).join('')}</div>
      ${c.documenti_mancanti.length ? `<div class="alert"><b>Documenti mancanti:</b> ${c.documenti_mancanti.map((m) => badge(m, 'warn')).join(' ')} <a href="#" data-a="upload" style="margin-left:8px">Carica ora</a></div>` : '<div class="alert ok">Tutti i documenti previsti per questa fase sono presenti.</div>'}
      <div class="grid g3">
        ${k('Quanto abbiamo preventivato?', eur(c.preventivato), c.preventivo_attivo ? `Preventivo ${esc(c.preventivo_attivo.riferimento || '')} · ${c.preventivo_attivo.stato}` : 'nessun preventivo', 'sky')}
        ${k('Quanto abbiamo venduto?', eur(c.venduto), c.conteggi.ordini_cliente ? `${c.conteggi.ordini_cliente} ordine/i cliente` : 'nessun ordine cliente ancora')}
        ${k('Quanto abbiamo speso?', eur(c.speso), `fatture fornitori ${eur(c.speso_dettaglio.fatture_fornitori)} + spese ${eur(c.speso_dettaglio.spese)}<br>ordinato ai fornitori: ${eur(c.ordinato_fornitori)}`)}
        ${k('Quanto stiamo realmente guadagnando?', mReal != null ? eur(mReal) : 'n/d', mReal != null ? 'fatturato cliente − costi sostenuti' : 'nessuna fattura cliente emessa', mReal == null ? '' : mReal >= 0 ? 'good' : 'bad')}
        ${k('Margine previsto', mPrev != null ? eur(mPrev) : 'n/d', mPrev != null ? 'da prezzi acquisto/vendita' : `mancano ${c.righe_senza_acquisto} prezzi di acquisto${c.margine_previsto_parziale ? ` · parziale ${eur(c.margine_previsto_parziale)}` : ''}`)}
        ${k('Quanto dobbiamo ancora pagare?', eur(c.da_pagare), `${c.conteggi.fatture_ricevute} fatture ricevute`, c.da_pagare ? 'warn' : '')}
        ${k('Quanto dobbiamo ancora incassare?', eur(c.da_incassare), `${c.conteggi.fatture_emesse} fatture emesse`, c.da_incassare ? 'warn' : '')}</div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h2>A quali fornitori abbiamo comprato?</h2></div>${c.fornitori.length ? `<div class="pill-list">${c.fornitori.map((f) => `<a class="chip" href="#/fornitore/${f.id}">${esc(f.ragione_sociale)}</a>`).join('')}</div>` : '<div class="muted">Nessun fornitore associato</div>'}
          <h3 style="margin-top:14px">DDT</h3><p style="margin:2px 0">${c.conteggi.ddt_uscita} emessi (uscita) · ${c.conteggi.ddt_entrata} ricevuti (entrata)</p>
          ${c.ddt.map((d) => `<span class="chip">DDT ${esc(d.numero || '—')} · ${dt(d.data)} · ${d.tipo}</span>`).join('')}</div>
        <div class="card"><div class="card-h"><h2>Dati commessa</h2></div><dl class="kv"><dt>Cliente</dt><dd>${esc(c.cliente?.ragione_sociale || '—')}</dd><dt>Apertura</dt><dd>${dt(co.data_apertura)}</dd><dt>Stato</dt><dd>${STATI[co.stato]}</dd>${pa}${co.note ? `<dt>Note</dt><dd>${esc(co.note)}</dd>` : ''}</dl>
          ${co.pa_attiva && !pa ? '<p class="muted"><small>Riferimenti PA attivi ma non compilati: usa “Modifica”.</small></p>' : ''}</div></div>
      <div class="card"><div class="card-h"><h2>Quali prodotti abbiamo acquistato?</h2></div>${c.prodotti.length ? `<div class="tw"><table><thead><tr><th>Codice</th><th>Descrizione</th><th class="num">Q.tà</th><th class="num">Acquisto unit.</th></tr></thead><tbody>${c.prodotti.map((p) => `<tr><td>${esc(p.codice || '')}</td><td>${esc(p.descrizione)}</td><td class="num">${p.qta}</td><td class="num">${p.prezzo_acquisto != null ? eur(p.prezzo_acquisto) : '<span class="muted">da inserire</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nessun prodotto: importa un Excel o compila il preventivo.</div>'}</div>`;
  };

  // ---- preventivi
  T.preventivi = () => `<div class="card"><div class="card-h"><h2>Preventivi</h2><button class="btn sm" data-a="newprev">+ Nuovo preventivo</button></div>
    ${c.preventivi_lista.length ? `<table><thead><tr><th>Rif.</th><th>Data</th><th>Stato</th><th class="num">Righe</th><th class="num">Imponibile</th><th class="num">Totale</th><th class="num">Margine</th><th></th></tr></thead><tbody>
    ${c.preventivi_lista.map((p) => `<tr class="click" onclick="location.hash='#/preventivo/${p.id}'"><td><b>${esc(p.riferimento || '—')}</b></td><td>${dt(p.data)}</td><td>${badge(p.stato, p.stato === 'accettato' ? 'ok' : p.stato === 'rifiutato' ? 'bad' : '')}</td><td class="num">${p.righe}</td><td class="num">${eur(p.imponibile)}</td><td class="num">${eur(p.totale)}</td>
      <td class="num">${p.margine != null ? eur(p.margine) : `<span class="muted">n/d</span>`}</td><td>${docBtns('preventivi', p.id)} <button class="btn sm sec">Apri</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessun preventivo. Crea un preventivo oppure importa le righe da un Excel.</div>'}</div>`;

  // ---- ordini
  T.ordini = () => {
    const t = (tipo, titolo) => { const rows = c.ordini.filter((o) => o.tipo === tipo); return `<div class="card"><div class="card-h"><h2>${titolo}</h2>
      <button class="btn sm sec" data-a="up-ord" data-t="${tipo}">⤒ Carica documento</button><button class="btn sm" data-a="new-ord" data-t="${tipo}">+ Registra</button></div>
      ${rows.length ? `<table><thead><tr><th>Numero</th><th>Data</th><th>${tipo === 'cliente' ? 'Cliente' : 'Fornitore'}</th><th>Stato</th><th class="num">Importo</th><th></th></tr></thead><tbody>${rows.map((o) => `<tr><td><b>${esc(o.numero || '—')}</b></td><td>${dt(o.data)}</td><td>${esc(o.soggetto || '')}</td><td>${badge(o.stato)}</td><td class="num">${eur(o.importo)}</td>
        <td style="white-space:nowrap">${docBtns('ordini', o.id)} <button class="btn sm sec" data-a="edit-ord" data-id="${o.id}">Modifica</button> <button class="btn sm danger" data-a="del" data-e="ordini" data-id="${o.id}">×</button></td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4">Totale</td><td class="num">${eur(rows.reduce((s, o) => s + (o.importo || 0), 0))}</td><td></td></tr></tfoot></table>` : '<div class="empty">Nessun ordine</div>'}</div>`; };
    return t('cliente', 'Ordini cliente') + t('fornitore', 'Ordini fornitore');
  };

  // ---- DDT
  T.ddt = () => `<div class="card"><div class="card-h"><h2>DDT</h2><button class="btn sm sec" data-a="new-ddt">+ Registra manualmente</button><button class="btn sm" data-a="up-ddt">⤒ Carica DDT da WebDesk</button></div>
    <p class="muted" style="margin-top:0"><small>I DDT sono creati in WebDesk: qui si carica il PDF originale e si registrano i dati essenziali.</small></p>
    ${c.ddt.length ? `<table><thead><tr><th>Numero</th><th>Data</th><th>Tipo</th><th>Soggetto</th><th>Ordine</th><th>Prodotti</th><th>Stato</th><th></th></tr></thead><tbody>${c.ddt.map((d) => `<tr><td><b>${esc(d.numero || '—')}</b></td><td>${dt(d.data)}</td><td>${badge(d.tipo === 'entrata' ? 'Entrata' : 'Uscita', d.tipo === 'entrata' ? 'warn' : '')}</td><td>${esc(d.soggetto || '')}</td><td>${esc(d.ordine_numero || '—')}</td>
      <td><small>${d.righe.map((r) => `${esc(r.descrizione || r.codice)} ×${r.qta}`).join('<br>') || '—'}</small></td><td>${badge(d.stato)}</td>
      <td style="white-space:nowrap">${docBtns('ddt', d.id) || '<small class="muted">PDF mancante</small>'} <button class="btn sm sec" data-a="edit-ddt" data-id="${d.id}">Modifica</button> <button class="btn sm danger" data-a="del" data-e="ddt" data-id="${d.id}">×</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessun DDT</div>'}</div>`;

  // ---- fatture
  T.fatture = () => {
    const t = (tipo, titolo) => { const rows = c.fatture.filter((f) => f.tipo === tipo); return `<div class="card"><div class="card-h"><h2>${titolo}</h2>
      <button class="btn sm sec" data-a="up-fat" data-t="${tipo}">⤒ Carica fattura (PDF/XML)</button><button class="btn sm" data-a="new-fat" data-t="${tipo}">+ Registra</button></div>
      ${rows.length ? `<table><thead><tr><th>Numero</th><th>Data</th><th>Scadenza</th><th>${tipo === 'cliente' ? 'Cliente' : 'Fornitore'}</th><th class="num">Imponibile</th><th class="num">Totale</th><th class="num">${tipo === 'cliente' ? 'Incassato' : 'Pagato'}</th><th class="num">Residuo</th><th></th></tr></thead><tbody>
      ${rows.map((f) => { const res = Math.max(0, (f.totale || 0) - f.pagato); return `<tr><td><b>${esc(f.numero || '—')}</b></td><td>${dt(f.data)}</td><td>${dt(f.scadenza)}</td><td>${esc(f.soggetto || '')}</td><td class="num">${eur(f.imponibile)}</td><td class="num">${eur(f.totale)}</td><td class="num">${eur(f.pagato)}</td><td class="num">${res > 0.005 ? `<b>${eur(res)}</b>` : badge('saldata', 'ok')}</td>
        <td style="white-space:nowrap">${docBtns('fatture', f.id)} <button class="btn sm sec" data-a="pag" data-id="${f.id}">${tipo === 'cliente' ? 'Incassi' : 'Pagamenti'}</button> <button class="btn sm sec" data-a="edit-fat" data-id="${f.id}">Modifica</button> <button class="btn sm danger" data-a="del" data-e="fatture" data-id="${f.id}">×</button></td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Nessuna fattura</div>'}</div>`; };
    return t('fornitore', 'Fatture fornitori (ricevute)') + t('cliente', 'Fatture cliente (emesse)');
  };

  // ---- spese
  T.spese = () => `<div class="card"><div class="card-h"><h2>Spese</h2><button class="btn sm sec" data-a="up-spesa">⤒ Carica scontrino / ricevuta</button><button class="btn sm" data-a="new-spesa">+ Registra spesa</button></div>
    ${c.spese.length ? `<table><thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th>Fornitore</th><th class="num">Importo</th><th></th></tr></thead><tbody>${c.spese.map((s) => `<tr><td>${dt(s.data)}</td><td>${esc(s.descrizione || '')}</td><td>${esc(s.categoria || '')}</td><td>${esc(s.fornitore || '')}</td><td class="num">${eur(s.importo)}</td>
      <td style="white-space:nowrap">${docBtns('spese', s.id)} <button class="btn sm sec" data-a="edit-spesa" data-id="${s.id}">Modifica</button> <button class="btn sm danger" data-a="del" data-e="spese" data-id="${s.id}">×</button></td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4">Totale</td><td class="num">${eur(c.spese.reduce((s, x) => s + (x.importo || 0), 0))}</td><td></td></tr></tfoot></table>` : '<div class="empty">Nessuna spesa</div>'}</div>`;

  // ---- documenti
  T.documenti = () => `<div class="card"><div class="card-h"><h2>Documenti della commessa ${esc(co.codice)}</h2><button class="btn sm" data-a="upload">⤒ Carica documento</button></div>
    ${c.documenti_mancanti.length ? `<div class="alert">Mancano: ${c.documenti_mancanti.map((m) => badge(m, 'warn')).join(' ')}</div>` : ''}<div id="dl">${docTable(c.documenti)}</div></div>`;

  // ---- timeline
  T.timeline = () => {
    const ICON = { commessa: '◆', preventivo: '▤', ordine_cliente: '⬇', ordine_fornitore: '⬆', ddt: '▣', fattura_cliente: '€', fattura_fornitore: '€', pagamento: '€', spesa: '◔', excel: '▦', nota: '✎', stato: '➜' };
    return `<div class="card"><div class="card-h"><h2>Timeline</h2></div>
      <form id="nf" style="display:flex;gap:8px;margin-bottom:16px"><input type="date" id="nd" value="${today()}" style="width:150px"><input id="nt" placeholder="Aggiungi una nota alla timeline…" required><button class="btn">Aggiungi</button></form>
      ${c.timeline.length ? `<div class="tl">${c.timeline.map((t) => `<div class="it ${t.tipo}"><div class="d">${dt(t.data)}</div><div class="t">${ICON[t.tipo] || '•'} ${esc(t.testo)}
        ${t.documento_id ? ` <a href="#" data-doc="view" data-id="${t.documento_id}">[Visualizza documento]</a>` : ''}${t.tipo === 'nota' ? ` <a href="#" data-tdel="${t.id}" class="muted">elimina</a>` : ''}</div></div>`).join('')}</div>` : '<div class="empty">Nessun evento</div>'}</div>`;
  };

  tc.innerHTML = T[tab]();
  bindDocActions(tc, reload);

  // ---- azioni
  const nuovoPrev = async () => { const p = await api('/preventivi', { method: 'POST', body: { commessa_id: id } }); location.hash = `#/preventivo/${p.id}`; };
  const L2 = store.lookup;
  const sogg = (tipo) => tipo === 'cliente' ? { k: 'cliente_id', label: 'Cliente', type: 'select', options: L2.clienti.map((x) => [x.id, x.ragione_sociale]) } : { k: 'fornitore_id', label: 'Fornitore', type: 'select', options: L2.fornitori.map((x) => [x.id, x.ragione_sociale]) };
  const ordOpts = () => c.ordini.map((o) => [o.id, `${o.tipo} ${o.numero || '—'}`]);
  const saveE = (ent, eid, extra = {}) => async (v, { close }) => {
    await api(`/${ent}${eid ? '/' + eid : ''}`, { method: eid ? 'PUT' : 'POST', body: { ...v, commessa_id: id, ...extra } }); toast('Salvato'); close(); reload();
  };
  const formOrd = (tipo, o = {}) => formModal({ title: `${o.id ? 'Modifica' : 'Registra'} ordine ${tipo}`, values: { data: today(), stato: 'aperto', cliente_id: c.cliente?.id, ...o },
    fields: [{ k: 'numero', label: 'Numero ordine' }, { k: 'data', label: 'Data', type: 'date' }, sogg(tipo), { k: 'importo', label: 'Importo imponibile €', type: 'number' },
      { k: 'stato', label: 'Stato', type: 'select', options: ['aperto', 'confermato', 'consegnato', 'chiuso'].map((x) => [x, x]) }, { k: 'note', label: 'Note', type: 'textarea', rows: 2 }], onSave: saveE('ordini', o.id, { tipo }) });
  const formDdt = (d = {}) => {
    const righe = (d.righe || []).map((r) => ({ ...r }));
    const f = formModal({ title: `${d.id ? 'Modifica' : 'Registra'} DDT`, size: 'wide', values: { data: today(), tipo: 'uscita', stato: 'emesso', origine: 'WebDesk', cliente_id: c.cliente?.id, ...d },
      fields: [{ k: 'numero', label: 'Numero DDT' }, { k: 'data', label: 'Data', type: 'date' }, { k: 'tipo', label: 'Tipo', type: 'select', options: [['uscita', 'Uscita (verso cliente)'], ['entrata', 'Entrata (da fornitore)']] },
        { k: 'cliente_id', label: 'Cliente (se uscita)', type: 'select', options: L2.clienti.map((x) => [x.id, x.ragione_sociale]) }, { k: 'fornitore_id', label: 'Fornitore (se entrata)', type: 'select', options: L2.fornitori.map((x) => [x.id, x.ragione_sociale]) },
        { k: 'ordine_id', label: 'Ordine collegato', type: 'select', options: ordOpts() }, { k: 'stato', label: 'Stato', type: 'select', options: ['emesso', 'consegnato', 'ricevuto', 'annullato'].map((x) => [x, x]) }, { k: 'note', label: 'Note', type: 'textarea', rows: 2 }],
      extra: '<h3>Prodotti</h3><div id="dr"></div><button type="button" class="btn sm sec" id="da">+ Riga</button> <button type="button" class="btn sm sec" id="df">Precompila dal preventivo</button>',
      afterOpen: ({ root }) => {
        const draw = () => { $('#dr', root).innerHTML = righe.map((r, i) => `<div style="display:grid;grid-template-columns:140px 1fr 70px 24px;gap:6px;margin-bottom:6px"><input data-i="${i}" data-f="codice" placeholder="Codice" value="${esc(r.codice)}"><input data-i="${i}" data-f="descrizione" placeholder="Descrizione" value="${esc(r.descrizione)}"><input data-i="${i}" data-f="qta" value="${esc(r.qta ?? 1)}"><a href="#" data-x="${i}">×</a></div>`).join(''); };
        draw();
        $('#dr', root).oninput = (e) => { if (e.target.dataset.f) righe[e.target.dataset.i][e.target.dataset.f] = e.target.value; };
        $('#dr', root).onclick = (e) => { const x = e.target.closest('[data-x]'); if (x) { e.preventDefault(); righe.splice(x.dataset.x, 1); draw(); } };
        $('#da', root).onclick = () => { righe.push({ codice: '', descrizione: '', qta: 1 }); draw(); };
        $('#df', root).onclick = async () => { const pv = c.preventivo_attivo; if (!pv) return toast('Nessun preventivo', true); (await api(`/preventivi/${pv.id}`)).righe.forEach((r) => righe.push({ codice: r.codice || '', descrizione: r.descrizione || '', qta: r.qta })); draw(); };
      },
      onSave: (v, ctx) => saveE('ddt', d.id, { righe: righe.filter((r) => r.descrizione || r.codice) })(v, ctx) });
    return f;
  };
  const formFat = (tipo, f = {}) => formModal({ title: `${f.id ? 'Modifica' : 'Registra'} fattura ${tipo}`, values: { data: today(), cliente_id: c.cliente?.id, ...f }, size: 'wide',
    fields: [{ k: 'numero', label: 'Numero fattura' }, { k: 'data', label: 'Data', type: 'date' }, { k: 'scadenza', label: 'Scadenza', type: 'date' }, sogg(tipo),
      { k: 'ordine_id', label: 'Ordine collegato', type: 'select', options: ordOpts() }, { k: 'imponibile', label: 'Imponibile €', type: 'number' }, { k: 'iva', label: 'IVA €', type: 'number' }, { k: 'totale', label: 'Totale € (vuoto = imponibile + IVA)', type: 'number' },
      { k: 'note', label: 'Note', type: 'textarea', rows: 2 }], onSave: saveE('fatture', f.id, { tipo }) });
  const formSpesa = (s = {}) => formModal({ title: `${s.id ? 'Modifica' : 'Registra'} spesa`, values: { data: today(), ...s },
    fields: [{ k: 'data', label: 'Data', type: 'date' }, { k: 'descrizione', label: 'Descrizione', req: true }, { k: 'categoria', label: 'Categoria (trasporto, trasferta…)' }, { k: 'importo', label: 'Importo €', type: 'number', req: true },
      { k: 'fornitore_id', label: 'Fornitore', type: 'select', options: L2.fornitori.map((x) => [x.id, x.ragione_sociale]) }, { k: 'note', label: 'Note', type: 'textarea', rows: 2 }], onSave: saveE('spese', s.id) });
  const pagamenti = async (fid) => {
    const f = await api(`/fatture/${fid}`);
    const draw = (fx) => `<table><thead><tr><th>Data</th><th class="num">Importo</th><th>Note</th><th></th></tr></thead><tbody>${fx.pagamenti.map((p) => `<tr><td>${dt(p.data)}</td><td class="num">${eur(p.importo)}</td><td>${esc(p.note || '')}</td><td><a href="#" data-dp="${p.id}">elimina</a></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nessun movimento</td></tr>'}</tbody></table>
      <p>Totale fattura ${eur(fx.totale)} · registrato ${eur(fx.pagamenti.reduce((s, p) => s + p.importo, 0))}</p>
      <div class="form-grid"><label class="f"><span>Data</span><input type="date" id="pd" value="${today()}"></label><label class="f"><span>Importo €</span><input id="pi" value="${Math.max(0, fx.totale - fx.pagamenti.reduce((s, p) => s + p.importo, 0)) || ''}"></label><label class="f"><span>Note</span><input id="pn"></label></div>`;
    const m = modal({ title: `${f.tipo === 'cliente' ? 'Incassi' : 'Pagamenti'} — fattura ${f.numero || ''}`, body: draw(f), buttons: [{ label: 'Chiudi', cls: 'sec', onClick: ({ close }) => { close(); reload(); } },
      { label: 'Registra', onClick: async ({ root }) => { const imp = parseNum($('#pi', root).value); if (!imp) return toast('Importo non valido', true); await api('/pagamenti', { method: 'POST', body: { fattura_id: fid, data: $('#pd', root).value, importo: imp, note: $('#pn', root).value } }); $('.modal-b', root).innerHTML = draw(await api(`/fatture/${fid}`)); toast('Registrato'); } }] });
    m.root.addEventListener('click', async (e) => { const x = e.target.closest('[data-dp]'); if (x) { e.preventDefault(); await api(`/pagamenti/${x.dataset.dp}`, { method: 'DELETE' }); $('.modal-b', m.root).innerHTML = draw(await api(`/fatture/${fid}`)); } });
  };
  const up = (preset) => uploadWizard({ commessa_id: id, ...preset }, reload);

  view.onclick = async (e) => {
    const s = e.target.closest('[data-stato]');
    if (s) { await api(`/commesse/${id}`, { method: 'PUT', body: { stato: s.dataset.stato } }); return reload(); }
    const b = e.target.closest('[data-a]'); if (!b) return;
    e.preventDefault();
    const a = b.dataset.a, t = b.dataset.t, eid = Number(b.dataset.id);
    const find = (arr) => arr.find((x) => x.id === eid);
    if (a === 'upload') up({});
    else if (a === 'import') importWizard({ commessa_id: id }, (r) => { location.hash = `#/preventivo/${r.preventivo_id}`; });
    else if (a === 'edit') {
      formModal({ title: `Modifica commessa ${co.codice}`, fields: commessaFields(L), groups: PA_GROUP, values: co, size: 'wide', onSave: async (v, { close }) => { await api(`/commesse/${id}`, { method: 'PUT', body: v }); close(); toast('Commessa aggiornata'); reload(); } });
    }
    else if (a === 'newprev') nuovoPrev();
    else if (a === 'new-ord') formOrd(t); else if (a === 'edit-ord') formOrd(find(c.ordini).tipo, find(c.ordini));
    else if (a === 'up-ord') up({ tipologia: t === 'cliente' ? 'ordine_cliente' : 'ordine_fornitore', crea: t === 'cliente' ? 'ordine_cliente' : 'ordine_fornitore' });
    else if (a === 'new-ddt') formDdt(); else if (a === 'edit-ddt') formDdt(find(c.ddt)); else if (a === 'up-ddt') up({ tipologia: 'ddt', crea: 'ddt' });
    else if (a === 'new-fat') formFat(t); else if (a === 'edit-fat') formFat(find(c.fatture).tipo, find(c.fatture)); else if (a === 'pag') pagamenti(eid);
    else if (a === 'up-fat') up({ tipologia: t === 'cliente' ? 'fattura_cliente' : 'fattura_fornitore', crea: t === 'cliente' ? 'fattura_cliente' : 'fattura_fornitore' });
    else if (a === 'new-spesa') formSpesa(); else if (a === 'edit-spesa') formSpesa(find(c.spese)); else if (a === 'up-spesa') up({ tipologia: 'spesa', crea: 'spesa' });
    else if (a === 'del' && await confirmBox('Eliminare definitivamente questo elemento? I documenti allegati restano archiviati.')) { await api(`/${b.dataset.e}/${eid}`, { method: 'DELETE' }); toast('Eliminato'); reload(); }
  };
  if (tab === 'timeline') {
    $('#nf', view).onsubmit = async (e) => { e.preventDefault(); await api(`/commesse/${id}/timeline`, { method: 'POST', body: { data: $('#nd', view).value, testo: $('#nt', view).value } }); reload(); };
    tc.addEventListener('click', async (e) => { const x = e.target.closest('[data-tdel]'); if (x) { e.preventDefault(); await api(`/timeline/${x.dataset.tdel}`, { method: 'DELETE' }); reload(); } });
  }
}

// ------------------------------------------------------------------ documenti (archivio globale)
async function documentiPage() {
  let tip = '', text = '';
  view.innerHTML = `<div class="page-head"><div class="grow"><h1>Documenti</h1><p class="muted">Archivio dei documenti originali: PDF, Excel, XML, immagini. I dati restano sempre collegati al file.</p></div>
    <select id="dt" style="width:auto"><option value="">Tutte le tipologie</option>${Object.entries(TIPOLOGIE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <input id="dq" placeholder="Cerca per nome, numero, note…" style="width:240px"><button class="btn" data-a="up">⤒ Carica documento</button></div><div class="card" id="dl"></div>`;
  const draw = async () => { $('#dl', view).innerHTML = docTable(await api(`/documenti?tipologia=${tip}&q=${encodeURIComponent(text)}`)); };
  await draw();
  bindDocActions($('#dl', view), draw);
  $('#dt', view).onchange = (e) => { tip = e.target.value; draw(); };
  $('#dq', view).oninput = debounce((e) => { text = e.target.value; draw(); });
  view.onclick = (e) => { if (e.target.closest('[data-a=up]')) uploadWizard({}, draw); };
}

// ------------------------------------------------------------------ anagrafiche
const SOGG_FIELDS = (cli) => [
  { k: 'ragione_sociale', label: 'Ragione sociale', req: true, full: true }, { k: 'piva', label: 'Partita IVA' }, { k: 'cf', label: 'Codice fiscale' },
  { k: 'indirizzo', label: 'Indirizzo', full: true }, { k: 'email', label: 'Email' }, { k: 'pec', label: 'PEC' }, { k: 'telefono', label: 'Telefono' }, { k: 'referente', label: 'Referente' },
  ...(cli ? [{ k: 'tipo', label: 'Tipo soggetto', type: 'select', options: [['privato', 'Privato / azienda'], ['pa', 'Pubblica Amministrazione'], ['istituzionale', 'Ente istituzionale / militare']] },
    { k: 'pa_attiva', label: 'Attiva i campi PA (CIG, CUP, MEPA…) per le commesse di questo cliente', type: 'checkbox', full: true, toggles: 'pa' }, { k: 'codice_ufficio', label: 'Codice ufficio (IPA)', group: 'pa' }] : []),
  { k: 'note', label: 'Note', type: 'textarea', rows: 2 },
];

function formSogg(ent, v = {}, done) {
  const cli = ent === 'clienti';
  formModal({ title: `${v.id ? 'Modifica' : 'Nuovo'} ${cli ? 'cliente' : 'fornitore'}`, fields: SOGG_FIELDS(cli), groups: { pa: 'Pubblica Amministrazione' }, values: v, size: 'wide',
    onSave: async (d, { close }) => { await api(`/${ent}${v.id ? '/' + v.id : ''}`, { method: v.id ? 'PUT' : 'POST', body: d }); await loadLookup(true); toast('Salvato'); close(); done?.(); } });
}

async function anagrafica(ent) {
  const rows = await api(`/${ent}`), cli = ent === 'clienti';
  view.innerHTML = `<div class="page-head"><div class="grow"><h1>${cli ? 'Clienti' : 'Fornitori'}</h1></div><input id="ft" placeholder="Filtra…" style="width:200px"><button class="btn" data-a="new">+ Nuovo ${cli ? 'cliente' : 'fornitore'}</button></div><div class="card" id="lst"></div>`;
  const draw = (t = '') => {
    const f = rows.filter((r) => !t || `${r.ragione_sociale} ${r.piva}`.toLowerCase().includes(t));
    $('#lst', view).innerHTML = f.length ? `<table><thead><tr><th>Ragione sociale</th><th>P.IVA</th><th>Email / PEC</th><th>Referente</th>${cli ? '<th>Tipo</th>' : ''}<th></th></tr></thead><tbody>${f.map((r) => `<tr class="click" data-go="${r.id}"><td><b>${esc(r.ragione_sociale)}</b></td><td>${esc(r.piva || '')}</td><td>${esc(r.email || r.pec || '')}</td><td>${esc(r.referente || '')}</td>${cli ? `<td>${r.pa_attiva ? badge('PA', 'warn') : ''}</td>` : ''}<td><button class="btn sm sec" data-edit="${r.id}">Modifica</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessun elemento</div>';
  };
  draw();
  $('#ft', view).oninput = (e) => draw(e.target.value.toLowerCase());
  view.onclick = (e) => {
    if (e.target.closest('[data-a=new]')) return formSogg(ent, {}, refresh);
    const ed = e.target.closest('[data-edit]'); if (ed) return formSogg(ent, rows.find((r) => r.id === Number(ed.dataset.edit)), refresh);
    const g = e.target.closest('[data-go]'); if (g) location.hash = `#/${cli ? 'cliente' : 'fornitore'}/${g.dataset.go}`;
  };
}

async function soggettoView(tipo, id) {
  const ent = tipo === 'cliente' ? 'clienti' : 'fornitori', s = await api(`/${ent}/${id}`);
  const docs = await api(`/documenti?entita=${ent}&id=${id}`);
  const cm = tipo === 'cliente' ? (await api('/commesse')).filter((c) => c.cliente_id === id) : [];
  const ord = tipo === 'fornitore' ? await api(`/ordini?fornitore_id=${id}`) : [];
  const fat = tipo === 'fornitore' ? await api(`/fatture?fornitore_id=${id}`) : [];
  view.innerHTML = `<div class="page-head"><div class="grow"><div class="crumbs muted"><a href="#/${ent}">${tipo === 'cliente' ? 'Clienti' : 'Fornitori'}</a> /</div><h1>${esc(s.ragione_sociale)} ${s.pa_attiva ? badge('PA', 'warn') : ''}</h1></div><button class="btn sec" data-a="edit">Modifica</button></div>
    <div class="card"><dl class="kv"><dt>P.IVA</dt><dd>${esc(s.piva || '—')}</dd><dt>Codice fiscale</dt><dd>${esc(s.cf || '—')}</dd><dt>Indirizzo</dt><dd>${esc(s.indirizzo || '—')}</dd><dt>Email</dt><dd>${esc(s.email || '—')}</dd><dt>PEC</dt><dd>${esc(s.pec || '—')}</dd><dt>Telefono</dt><dd>${esc(s.telefono || '—')}</dd><dt>Referente</dt><dd>${esc(s.referente || '—')}</dd>${s.codice_ufficio ? `<dt>Codice ufficio</dt><dd>${esc(s.codice_ufficio)}</dd>` : ''}${s.note ? `<dt>Note</dt><dd>${esc(s.note)}</dd>` : ''}</dl></div>
    ${tipo === 'cliente' ? `<div class="card"><div class="card-h"><h2>Commesse</h2></div>${cm.length ? `<table><tbody>${cm.map((c) => `<tr class="click" onclick="location.hash='#/commessa/${c.id}'"><td><b>${esc(c.codice)}</b></td><td>${esc(c.oggetto || '')}</td><td>${statoBadge(c.stato)}</td><td class="num">${eur(c.venduto || c.preventivato)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessuna commessa</div>'}</div>`
    : `<div class="card"><div class="card-h"><h2>Ordini e fatture</h2></div>${ord.length || fat.length ? `<table><tbody>${ord.map((o) => `<tr><td>Ordine ${esc(o.numero || '—')}</td><td>${esc(o.codice || '')}</td><td>${dt(o.data)}</td><td class="num">${eur(o.importo)}</td></tr>`).join('')}${fat.map((f) => `<tr><td>Fattura ${esc(f.numero || '—')}</td><td></td><td>${dt(f.data)}</td><td class="num">${eur(f.totale)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessun movimento</div>'}</div>`}
    <div class="card"><div class="card-h"><h2>Documenti</h2></div><div id="dl">${docTable(docs)}</div></div>`;
  bindDocActions($('#dl', view), refresh);
  view.onclick = (e) => { if (e.target.closest('[data-a=edit]')) formSogg(ent, s, refresh); };
}

// ------------------------------------------------------------------ ricerca globale e shell
const sr = $('#search-res');
$('#search').addEventListener('input', debounce(async (e) => {
  const t = e.target.value.trim().toLowerCase();
  if (t.length < 2) { sr.hidden = true; return; }
  const L = await loadLookup();
  const hit = [];
  L.commesse.filter((c) => `${c.codice} ${c.oggetto}`.toLowerCase().includes(t)).slice(0, 6).forEach((c) => hit.push([`#/commessa/${c.id}`, `Commessa ${c.codice} — ${c.oggetto || ''}`]));
  L.clienti.filter((c) => c.ragione_sociale.toLowerCase().includes(t)).slice(0, 4).forEach((c) => hit.push([`#/cliente/${c.id}`, `Cliente: ${c.ragione_sociale}`]));
  L.fornitori.filter((c) => c.ragione_sociale.toLowerCase().includes(t)).slice(0, 4).forEach((c) => hit.push([`#/fornitore/${c.id}`, `Fornitore: ${c.ragione_sociale}`]));
  (await api(`/documenti?q=${encodeURIComponent(t)}`)).slice(0, 6).forEach((d) => hit.push([`#/documenti`, `Documento: ${d.nome_file}`]));
  sr.innerHTML = hit.map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join('') || '<a>Nessun risultato</a>';
  sr.hidden = false;
}));
document.addEventListener('click', (e) => { if (!e.target.closest('#search-res, #search')) sr.hidden = true; else if (e.target.closest('#search-res a')) { sr.hidden = true; $('#search').value = ''; } });
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'carica-doc') uploadWizard({}, refresh);
  if (a.dataset.act === 'menu') $('#side').classList.toggle('open');
});
route();
