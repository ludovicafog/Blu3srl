// Editor preventivo Blu3: prezzo di acquisto / vendita (interno) / prezzo mostrato al cliente sempre separati.
import { $, $$, esc, eur, dt, api, toast, modal, confirmBox, loadLookup, optionsHtml, fieldHtml, readForm, parseNum, badge, PA_LABELS } from './lib.js';
import { importWizard } from './importer.js';
import { uploadWizard, docTable, bindDocActions } from './docs.js';

const STATI_P = [['bozza', 'Bozza'], ['inviato', 'Inviato'], ['accettato', 'Accettato'], ['rifiutato', 'Rifiutato']];
const HEAD = [
  { k: 'riferimento', label: 'Riferimento preventivo' }, { k: 'data', label: 'Data', type: 'date' },
  { k: 'stato', label: 'Stato', type: 'select', options: STATI_P },
  { k: 'destinatario', label: 'Destinatario (Spett.le)', full: true }, { k: 'oggetto', label: 'Oggetto', full: true },
];
const COND = [
  { k: 'intro', label: 'Testo introduttivo', type: 'textarea', rows: 7 },
  { k: 'criteri_fornitura', label: 'Criteri di fornitura (IVA / regime)', type: 'textarea', rows: 2 },
  { k: 'pagamento', label: 'Condizioni di pagamento' }, { k: 'disponibilita', label: 'Disponibilità' }, { k: 'consegna', label: 'Modalità di consegna' },
  { k: 'validita', label: 'Validità dell’offerta' }, { k: 'spese_spedizione', label: 'Spese di spedizione' },
  { k: 'iva_percent', label: 'Aliquota IVA %', type: 'number' }, { k: 'iva_nota', label: 'Nota IVA (es. esenzione / non imponibile)' },
  { k: 'note', label: 'Note', type: 'textarea', rows: 2 },
];
const num = (v) => parseNum(v);
const rowCalc = (r) => {
  const q = num(r.qta) || 0, a = num(r.prezzo_acquisto), v = num(r.prezzo_vendita), c = num(r.prezzo_cliente);
  const unitCli = c ?? v ?? 0;
  return { tot: q * unitCli, margine: a != null ? q * ((v ?? c ?? 0) - a) : null, vend: q * (v ?? c ?? 0), costo: a != null ? q * a : null };
};

export async function preventivoView(id, view) {
  const [p, L] = await Promise.all([api(`/preventivi/${id}`), loadLookup(true)]);
  let righe = p.righe.map((r) => ({ ...r }));
  const forn = L.fornitori.map((f) => [f.id, f.ragione_sociale]);
  const reload = () => preventivoView(id, view);

  view.innerHTML = `
    <div class="page-head"><div class="grow">
      <div class="crumbs muted">${p.commessa ? `<a href="#/commessa/${p.commessa.id}">← Commessa ${esc(p.commessa.codice)}</a>` : ''}</div>
      <h1>Preventivo ${esc(p.riferimento || '')} ${badge(STATI_P.find((s) => s[0] === p.stato)?.[1] || p.stato, p.stato === 'accettato' ? 'ok' : p.stato === 'rifiutato' ? 'bad' : '')}</h1></div>
      <button class="btn sec" data-a="import">⤓ Importa da Excel</button>
      <button class="btn sec" data-a="preview">⎙ Anteprima / Stampa</button>
      <button class="btn sec" data-a="pdf">⤒ Carica PDF finale</button>
      <button class="btn" data-a="save">Salva</button></div>
    <div class="card"><div class="card-h"><h2>Intestazione</h2></div><div class="form-grid" id="hd">
      ${fieldHtml({ k: 'cliente_id', label: 'Cliente', type: 'select', options: L.clienti.map((c) => [c.id, c.ragione_sociale]) }, p)}
      ${HEAD.map((f) => fieldHtml(f, p)).join('')}</div></div>
    <div class="card"><div class="card-h"><h2>Testi e condizioni</h2></div><div class="form-grid" id="cd">${COND.map((f) => fieldHtml(f, p)).join('')}</div></div>
    <div class="card"><div class="card-h"><h2>Prodotti</h2><button class="btn sm sec" data-a="add">+ Riga</button></div>
      <p class="muted" style="margin-top:0"><small>Tre prezzi separati: <b>acquisto</b> (costo Blu3), <b>vendita</b> (interno, usato nei calcoli) e <b>prezzo cliente</b> (mostrato nel preventivo; se vuoto coincide con la vendita). Il margine usa sempre acquisto e vendita interna.</small></p>
      <div class="tw"><table class="rows"><thead><tr><th>#</th><th>Codice</th><th>Descrizione articolo</th><th>Q.tà</th><th>Acquisto €</th><th>Vendita int. €</th><th>Prezzo cliente €</th><th class="num">Totale cliente</th><th class="num">Margine</th><th>Fornitore</th><th></th></tr></thead><tbody id="rb"></tbody></table></div>
      <div class="totbar" id="tot"></div></div>
    <div class="card"><div class="card-h"><h2>Documenti del preventivo</h2></div><div id="docs">${docTable(p.documenti)}</div></div>
    <p><button class="btn danger" data-a="del">Elimina preventivo</button></p>`;

  const rb = $('#rb', view);
  function drawRows() {
    rb.innerHTML = righe.map((r, i) => `
      <tr data-i="${i}"><td>${i + 1}</td>
        <td><input class="w-c" data-f="codice" value="${esc(r.codice)}"></td>
        <td><textarea data-f="descrizione" rows="2" style="min-height:44px;min-width:260px">${esc(r.descrizione)}</textarea></td>
        <td><input class="w-q" data-f="qta" value="${esc(r.qta)}"></td>
        <td><input class="w-p" data-f="prezzo_acquisto" value="${esc(r.prezzo_acquisto ?? '')}" placeholder="da inserire"></td>
        <td><input class="w-p" data-f="prezzo_vendita" value="${esc(r.prezzo_vendita ?? '')}"></td>
        <td><input class="w-p" data-f="prezzo_cliente" value="${esc(r.prezzo_cliente ?? '')}" placeholder="= vendita"></td>
        <td class="num" data-c="tot"></td><td class="num" data-c="mar"></td>
        <td><select data-f="fornitore_id" style="min-width:120px">${optionsHtml(forn, r.fornitore_id)}</select></td>
        <td><a href="#" data-del="${i}" title="Rimuovi riga">×</a></td></tr>
      <tr class="rn" data-n="${i}"><td></td><td colspan="10"><input data-f="note" placeholder="Nota specifica per questa riga (facoltativa)" value="${esc(r.note ?? '')}"></td></tr>`).join('')
      || '<tr><td colspan="11" class="empty">Nessun prodotto. Aggiungi una riga o importa da Excel.</td></tr>';
    righe.forEach((_, i) => calcRow(i));
    totals();
  }
  function calcRow(i) {
    const tr = rb.querySelector(`tr[data-i="${i}"]`); if (!tr) return;
    const c = rowCalc(righe[i]);
    $('[data-c=tot]', tr).textContent = eur(c.tot);
    const mc = $('[data-c=mar]', tr);
    mc.textContent = c.margine == null ? '—' : eur(c.margine); mc.className = 'num ' + (c.margine == null ? 'muted' : c.margine < 0 ? 'margin-neg' : 'margin-pos');
  }
  function totals() {
    const calc = righe.map(rowCalc);
    const imp = calc.reduce((s, c) => s + c.tot, 0);
    const ivaP = num($('[data-k=iva_percent]', view).value) || 0;
    const iva = imp * ivaP / 100;
    const completo = righe.length && righe.every((r) => num(r.prezzo_acquisto) != null);
    const costo = calc.reduce((s, c) => s + (c.costo || 0), 0), vend = calc.reduce((s, c) => s + c.vend, 0);
    const mar = calc.reduce((s, c) => s + (c.margine || 0), 0);
    const nSenza = righe.filter((r) => num(r.prezzo_acquisto) == null).length;
    $('#tot', view).innerHTML = `
      <div><small>Totale imponibile (cliente)</small><b>${eur(imp)}</b></div><div><small>IVA ${ivaP}%</small><b>${eur(iva)}</b></div><div><small>Totale documento</small><b>${eur(imp + iva)}</b></div>
      <div style="border-left:1px solid var(--line);padding-left:22px"><small>Costo d’acquisto</small><b>${eur(costo)}</b></div><div><small>Vendita interna</small><b>${eur(vend)}</b></div>
      <div><small>Margine${completo ? '' : ' parziale'}</small><b class="${mar < 0 ? 'margin-neg' : 'margin-pos'}">${eur(mar)}${completo && vend ? ` · ${(mar / vend * 100).toFixed(1)}%` : ''}</b>${nSenza ? `<small>${nSenza} righe senza prezzo d’acquisto</small>` : ''}</div>`;
  }

  rb.addEventListener('input', (e) => {
    const tr = e.target.closest('tr'); if (!tr || !e.target.dataset.f) return;
    const i = Number(tr.dataset.i ?? tr.dataset.n);
    righe[i][e.target.dataset.f] = e.target.value;
    calcRow(i); totals();
  });
  rb.addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { e.preventDefault(); righe.splice(Number(d.dataset.del), 1); drawRows(); } });
  $('#cd [data-k=iva_percent]', view).addEventListener('input', totals);
  $('#hd [data-k=cliente_id]', view).addEventListener('change', (e) => {
    const c = L.clienti.find((x) => String(x.id) === e.target.value), dest = $('#hd [data-k=destinatario]', view);
    if (c && (!dest.value || L.clienti.some((x) => x.ragione_sociale === dest.value))) dest.value = c.ragione_sociale;
  });
  drawRows();
  bindDocActions($('#docs', view), reload);

  const collect = () => ({ ...readForm(view, [{ k: 'cliente_id' }, ...HEAD, ...COND]), righe });
  const save = async () => { await api(`/preventivi/${id}`, { method: 'PUT', body: collect() }); toast('Preventivo salvato'); };

  view.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'add') { righe.push({ codice: '', descrizione: '', qta: 1 }); drawRows(); rb.querySelector(`tr[data-i="${righe.length - 1}"] textarea`)?.focus(); }
    if (a === 'save') { await save(); reload(); }
    if (a === 'import') { await save(); importWizard({ commessa_id: p.commessa_id, preventivo_id: id }, reload); }
    if (a === 'pdf') { await save(); uploadWizard({ commessa_id: p.commessa_id, tipologia: 'preventivo', preventivo_id: id, collega: [{ entita: 'preventivi', entita_id: id }], crea: null }, reload); }
    if (a === 'preview') anteprima(collect(), p);
    if (a === 'del' && await confirmBox('Eliminare il preventivo e le sue righe?')) { await api(`/preventivi/${id}`, { method: 'DELETE' }); location.hash = p.commessa_id ? `#/commessa/${p.commessa_id}` : '#/commesse'; }
  };
}

// ------------------------------------------------------------------ anteprima di stampa nel formato Blu3
const PIE = `<p><b>Azienda Iscritta al Mercato Elettronico della Pubblica Amministrazione</b></p>
  <p>Sede legale Via dei Gozzadini, n. 42 – 00165 Roma · Sede operativa Via Modena, n. 92 – 00040 Ardea (RM)</p>
  <p>Rea 1058328 – P.I. 07843401006 – Codice NATO AE428</p><p>Segr. Tel. +39069130514 · Mobile Direzione +39392705596</p>
  <p>e-mail: blu3srl@gmail.com · blu3srl@legalmail.it · blu3srl@pcert.postacert.it</p>`;
const TESTATA = `<div class="ph"><img src="/img/logo-blu3.png" alt="Blu3 Srl"><p>Società di Servizi Informatici e Tecnologici<br>Codice NATO AE428_0<br>Certificato ISO 9001:2015<br>Reg. numero 20058 – A<br>Settore IAF 29, 35</p><span style="margin-left:auto"><img src="/img/certificazioni.png" alt="" style="width:92px"></span></div>`;

function anteprima(p, orig) {
  const calc = p.righe.map(rowCalc);
  const imp = calc.reduce((s, c) => s + c.tot, 0), ivaP = num(p.iva_percent) || 0, iva = imp * ivaP / 100;
  const d = (p.data || '').split('-').reverse().join('.');
  const pa = orig.commessa?.pa_attiva ? Object.keys(PA_LABELS).filter((k) => orig.commessa[k]).map((k) => `${PA_LABELS[k]}: ${orig.commessa[k]}`).join(' · ') : '';
  const crit = [['Tipo di pagamento', p.pagamento], ['Disponibilità', p.disponibilita], ['Consegna', p.consegna], ['Validità offerta', p.validita], ['Spese di spedizione', p.spese_spedizione]].filter((x) => x[1]);
  const html = `
    <div class="paper">${TESTATA}
      <div>Roma ${esc(d)}</div>
      <div class="dest">Spett.le<br>${esc(p.destinatario)}</div>
      <div class="ogg">OGGETTO: ${esc(p.oggetto)}<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;RIF. ${esc(p.riferimento)}${pa ? `<br><span style="font-weight:400;font-style:normal;font-size:11px">${esc(pa)}</span>` : ''}</div>
      <div class="intro">${esc(p.intro)}</div>
      <div class="crit"><h4>Criteri di fornitura:</h4>${p.criteri_fornitura ? `<p style="margin:0 0 4px">${esc(p.criteri_fornitura)}</p>` : ''}<dl>${crit.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${p.note ? `<p style="margin-top:8px">${esc(p.note)}</p>` : ''}</div>
      <div class="pf">${PIE}</div></div>
    <div class="paper">${TESTATA}
      <table><thead><tr><th style="width:44px">VOCE PROG.</th><th>DESCRIZIONE ARTICOLO</th><th style="width:56px">QUANTITÀ</th><th style="width:96px">PREZZO UNITARIO (IVA ESCLUSA)</th><th style="width:100px">PREZZO TOTALE (IVA ESCLUSA)</th></tr></thead><tbody>
      ${p.righe.map((r, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc(r.descrizione)}${r.codice && !String(r.descrizione).includes(r.codice) ? `<br><small>Cod. ${esc(r.codice)}</small>` : ''}${r.note ? `<span class="rnota">${esc(r.note)}</span>` : ''}</td>
        <td style="text-align:center">${esc(r.qta)}</td><td style="text-align:right">${eur(num(r.prezzo_cliente) ?? num(r.prezzo_vendita) ?? 0)}</td><td style="text-align:right">${eur(calc[i].tot)}</td></tr>`).join('')}</tbody></table>
      <div class="ptot"><span>TOTALE IMPONIBILE</span><span>${eur(imp)}</span><span>TOTALE IVA${p.iva_nota ? ' ' + esc(p.iva_nota) : ` ${ivaP}%`}</span><span>${eur(iva)}</span><span>TOTALE</span><span>${eur(imp + iva)}</span></div>
      <div class="pf">${PIE}</div></div>`;
  modal({ title: 'Anteprima preventivo', size: 'xl', body: `<div class="alert info noprint">Anteprima nel formato Blu3. Usa “Stampa / Salva PDF”, poi carica il PDF finale con “Carica PDF finale”: resterà allegato alla commessa. I prezzi di acquisto e il margine non compaiono mai nel documento.</div>${html}`,
    buttons: [{ label: 'Chiudi', cls: 'sec', onClick: ({ close }) => close() }, { label: 'Stampa / Salva PDF', onClick: () => window.print() }] });
}
