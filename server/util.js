import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { all } from './db.js';

const execFileP = promisify(execFile);

// "10.749,00 €" -> 10749 ; "1,5" -> 1.5 ; "1.234" -> 1234 ; 12.5 -> 12.5
export function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && 'result' in v) return parseNum(v.result);
  let s = String(v).replace(/[€\s ]/g, '').replace(/[^\d.,\-]/g, '');
  if (!s || s === '-') return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = s.replace(',', '.');
  else if (ld >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// dd/mm/yyyy | dd.mm.yyyy | dd-mm-yyyy | yyyy-mm-dd | Date -> yyyy-mm-dd
export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

const eur = (n) => n == null ? null : Math.round(n * 100) / 100;
export const round2 = eur;

// ---------------------------------------------------------------- estrazione da documenti
export async function pdfText(file) {
  try {
    const { stdout } = await execFileP('pdftotext', ['-layout', file, '-'], { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch { return ''; }
}

function guessTipologia(t, nome = '') {
  const x = (t + ' ' + nome).toLowerCase();
  if (/documento di trasporto|\bddt\b/.test(x)) return 'ddt';
  if (/fattura/.test(x)) return 'fattura_cliente'; // affinata dopo con P.IVA
  if (/ordine d.acquisto|ordine fornitore|\bof-\d/.test(x)) return 'ordine_fornitore';
  if (/quotazione|preventivo|offerta/.test(x)) return 'preventivo';
  if (/ordine (?:cliente|n[.°]|di acquisto|mepa)|\bodv\b/.test(x)) return 'ordine_cliente';
  if (/scontrino|ricevuta/.test(x)) return 'spesa';
  return 'altro';
}

export const BLU3_PIVA = '07843401006';

export function extractFromText(text, nomeFile = '') {
  const out = { tipologia: guessTipologia(text, nomeFile), confidenza: {} };
  if (!text.trim()) return out;
  const sig = (k, v) => { if (v != null && v !== '') { out[k] = v; out.confidenza[k] = 'auto'; } };

  const commessa = text.match(/\b([A-Z]{2,5}-\d{3,5}-\d{2})\b/);
  sig('commessa_codice', commessa?.[1]);

  const rif = text.match(/\bRIF\.?\s*:?\s*([A-Z]{2,5}-\d{3,5}-\d{2})/);
  const num = rif ? [null, rif[1]] : text.match(/(?:fattura|ddt|documento di trasporto|ordine)[^\n\d]{0,40}(?:n[.°ro]*\s*)?(\d[\w\/-]{0,20})/i);
  sig('numero_documento', num?.[1]);
  const ordine = text.match(/ordine(?:\s+d.acquisto)?\s*(?:n[.°ro]*\s*)?([A-Z]{1,3}-?\d{4}-?\d{2,5}|\d{3,})/i);
  sig('numero_ordine', ordine?.[1]);
  const ddt = text.match(/\bddt\s*(?:n[.°ro]*\s*)?(\d{1,10})/i);
  sig('numero_ddt', ddt?.[1]);

  const dateM = text.match(/\b(\d{1,2}[./]\d{1,2}[./]\d{4})\b/);
  sig('data_documento', parseDate(dateM?.[1]));

  const piva = [...text.matchAll(/(?:P\.?\s*IVA|partita iva)[^\d]{0,6}(\d{11})/gi)].map((m) => m[1]).filter((p) => p !== BLU3_PIVA);
  sig('piva', piva[0]);

  const IMP = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})';
  const imponibile = text.match(new RegExp('TOTALE IMPONIBILE[^\\d]{0,40}' + IMP, 'i')) || text.match(new RegExp('imponibile[^\\d]{0,30}' + IMP, 'i'));
  const ivaM = text.match(/TOTALE IVA[^\n]*?([\d.]+,\d{2})\s*€?\s*$/im) || text.match(/\bIVA\b[^\d\n]{0,30}([\d.]+,\d{2})/i);
  const tot = text.match(new RegExp('^\\s*TOTALE(?:\\s+DOCUMENTO)?\\s+' + IMP, 'im')) || text.match(new RegExp('totale\\s+(?:documento|fattura)[^\\d]{0,20}' + IMP, 'i'));
  sig('imponibile', parseNum(imponibile?.[1]));
  sig('iva', parseNum(ivaM?.[1]));
  sig('importo', parseNum(tot?.[1]));
  if (out.imponibile == null && out.importo != null) sig('imponibile', out.importo);
  return out;
}

// FatturaPA XML (semplificato, tollera namespace)
export function extractFromXml(xml) {
  const tag = (t, from = xml) => from.match(new RegExp(`<(?:\\w+:)?${t}>([^<]*)</(?:\\w+:)?${t}>`))?.[1]?.trim();
  const cedente = xml.match(/<(?:\w+:)?CedentePrestatore>([\s\S]*?)<\/(?:\w+:)?CedentePrestatore>/)?.[1] || '';
  const cess = xml.match(/<(?:\w+:)?CessionarioCommittente>([\s\S]*?)<\/(?:\w+:)?CessionarioCommittente>/)?.[1] || '';
  const piva = tag('IdCodice', cedente);
  const out = { tipologia: piva === BLU3_PIVA ? 'fattura_cliente' : 'fattura_fornitore', confidenza: {} };
  const set = (k, v) => { if (v != null && v !== '') { out[k] = v; out.confidenza[k] = 'auto'; } };
  set('numero_documento', tag('Numero'));
  set('data_documento', parseDate(tag('Data')));
  set('piva', out.tipologia === 'fattura_cliente' ? tag('IdCodice', cess) : piva);
  set('soggetto_nome', tag('Denominazione', out.tipologia === 'fattura_cliente' ? cess : cedente));
  set('imponibile', parseNum(tag('ImponibileImporto')));
  set('iva', parseNum(tag('Imposta')));
  set('importo', parseNum(tag('ImportoTotaleDocumento')));
  const cmm = xml.match(/\b([A-Z]{2,5}-\d{3,5}-\d{2})\b/);
  set('commessa_codice', cmm?.[1]);
  return out;
}

export async function analizzaDocumento(file, nomeFile, mime) {
  const ext = nomeFile.toLowerCase().split('.').pop();
  let res;
  if (ext === 'xml') res = extractFromXml(fs.readFileSync(file, 'utf8'));
  else if (ext === 'pdf') res = extractFromText(await pdfText(file), nomeFile);
  else res = { tipologia: ext.match(/xlsx|csv/) ? 'excel' : 'altro', confidenza: {} };

  // Riconosci soggetti e commessa già presenti nel gestionale
  if (res.piva) {
    const c = all('SELECT id, ragione_sociale FROM clienti WHERE piva = ?', res.piva)[0];
    const f = all('SELECT id, ragione_sociale FROM fornitori WHERE piva = ?', res.piva)[0];
    if (c) { res.cliente_id = c.id; res.soggetto_nome = c.ragione_sociale; }
    if (f) { res.fornitore_id = f.id; res.soggetto_nome = f.ragione_sociale; }
    if (res.tipologia === 'fattura_cliente' && f && !c) res.tipologia = 'fattura_fornitore';
    if (res.tipologia === 'fattura_fornitore' && c && !f) res.tipologia = 'fattura_cliente';
  }
  if (res.commessa_codice) {
    const cm = all('SELECT id FROM commesse WHERE codice = ?', res.commessa_codice)[0];
    if (cm) res.commessa_id = cm.id;
  }
  return res;
}

// ---------------------------------------------------------------- Excel / CSV
export const CAMPI_RIGA = [
  { key: 'codice', label: 'Codice prodotto', syn: ['codice', 'cod', 'part number', 'p/n', 'pn', 'sku', 'articolo', 'codice articolo', 'codice prodotto', 'mpn'] },
  { key: 'descrizione', label: 'Descrizione', syn: ['descrizione', 'descrizione articolo', 'prodotto', 'articolo', 'denominazione', 'oggetto', 'description', 'item'] },
  { key: 'qta', label: 'Quantità', syn: ['quantita', 'qta', 'q.ta', "q.tà", 'qty', 'pezzi', 'n.', 'quantity'] },
  { key: 'prezzo_vendita', label: 'Prezzo unitario (vendita)', syn: ['prezzo unitario', 'prezzo', 'prezzo vendita', 'unitario', 'p.u.', 'pu', 'prezzo unit', 'prezzo unitario iva esclusa', 'unit price'] },
  { key: 'prezzo_cliente', label: 'Prezzo mostrato al cliente', syn: ['prezzo cliente', 'prezzo offerta'] },
  { key: 'prezzo_acquisto', label: 'Prezzo di acquisto', syn: ['acquisto', 'prezzo acquisto', 'costo', 'costo unitario', 'netto', 'prezzo netto', 'cost'] },
  { key: 'prezzo_totale', label: 'Prezzo totale (controllo)', syn: ['totale', 'prezzo totale', 'importo', 'totale riga', 'prezzo totale iva esclusa', 'total'] },
  { key: 'fornitore', label: 'Fornitore', syn: ['fornitore', 'supplier', 'vendor', 'marca', 'brand'] },
  { key: 'note', label: 'Note', syn: ['note', 'nota', 'annotazioni', 'notes'] },
];

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9/. ]/g, ' ').replace(/\s+/g, ' ').trim();

export function guessMapping(headers) {
  const map = {}, used = new Set();
  const h = headers.map(norm);
  // prima corrispondenza esatta, poi "contiene"
  for (const pass of [0, 1]) {
    for (const c of CAMPI_RIGA) {
      if (map[c.key] != null) continue;
      const idx = h.findIndex((x, i) => !used.has(i) && x && c.syn.some((s) => pass === 0 ? x === s : (s.length > 3 && x.includes(s))));
      if (idx >= 0) { map[c.key] = idx; used.add(idx); }
    }
  }
  return map;
}

function cellValue(c) {
  const v = c.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return v.result ?? '';
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;
    return String(v);
  }
  return v;
}

function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = [';', '\t', ','].map((s) => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// Restituisce i fogli come matrici; la struttura NON è assunta: header e mappatura sono solo proposte.
export async function leggiTabelle(file, nomeFile) {
  const ext = nomeFile.toLowerCase().split('.').pop();
  const sheets = [];
  if (ext === 'csv') {
    sheets.push({ nome: 'CSV', rows: parseCsv(fs.readFileSync(file, 'utf8')) });
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    for (const ws of wb.worksheets) {
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const arr = [];
        for (let i = 1; i <= ws.columnCount; i++) arr.push(cellValue(row.getCell(i)));
        if (arr.some((c) => String(c).trim() !== '')) rows.push(arr);
      });
      if (rows.length) sheets.push({ nome: ws.name, rows });
    }
  }
  return sheets.map((s) => {
    // header = la prima delle prime 15 righe con più corrispondenze di sinonimi
    let best = 0, bestScore = -1;
    s.rows.slice(0, 15).forEach((r, i) => {
      const sc = Object.keys(guessMapping(r.map(String))).length;
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    return { ...s, headerRow: best, mapping: guessMapping(s.rows[best].map(String)) };
  });
}

// ---------------------------------------------------------------- calcoli commessa
export const totRiga = (r) => (r.qta || 0) * (r.prezzo_cliente ?? r.prezzo_vendita ?? 0);

export function riepilogoPreventivo(prevId) {
  const righe = all('SELECT * FROM righe WHERE preventivo_id = ? ORDER BY pos, id', prevId);
  const p = all('SELECT iva_percent FROM preventivi WHERE id = ?', prevId)[0] || { iva_percent: 22 };
  const imponibile = eur(righe.reduce((s, r) => s + totRiga(r), 0));
  const iva = eur(imponibile * (p.iva_percent || 0) / 100);
  const costo = righe.reduce((s, r) => s + (r.qta || 0) * (r.prezzo_acquisto || 0), 0);
  const venditaInt = righe.reduce((s, r) => s + (r.qta || 0) * (r.prezzo_vendita ?? r.prezzo_cliente ?? 0), 0);
  const conAcquisto = righe.filter((r) => r.prezzo_acquisto != null).length;
  return {
    imponibile, iva, totale: eur(imponibile + iva), righe: righe.length,
    costo: eur(costo), vendita_interna: eur(venditaInt), righe_con_acquisto: conAcquisto,
    margine: conAcquisto === righe.length && righe.length ? eur(venditaInt - costo) : null,
    margine_parziale: eur(righe.filter((r) => r.prezzo_acquisto != null).reduce((s, r) => s + (r.qta || 0) * ((r.prezzo_vendita ?? r.prezzo_cliente ?? 0) - r.prezzo_acquisto), 0)),
  };
}

const DOC_ATTESI = [
  { tipologia: 'preventivo', label: 'Preventivo (PDF)', quando: () => true },
  { tipologia: 'ordine_cliente', label: 'Ordine cliente', quando: (s) => s.stato_idx >= 1 },
  { tipologia: 'ordine_fornitore', label: 'Ordine fornitore', quando: (s) => s.stato_idx >= 2 },
  { tipologia: 'ddt', label: 'DDT (WebDesk)', quando: (s) => s.stato_idx >= 3 },
  { tipologia: 'fattura_fornitore', label: 'Fattura fornitore', quando: (s) => s.stato_idx >= 3 },
  { tipologia: 'fattura_cliente', label: 'Fattura cliente', quando: (s) => s.stato_idx >= 4 },
];
export const STATI_COMMESSA = ['preventivo', 'ordinata', 'in_acquisto', 'in_consegna', 'fatturata', 'chiusa'];

export function riepilogoCommessa(id) {
  const c = all('SELECT * FROM commesse WHERE id = ?', id)[0];
  if (!c) return null;
  const prevs = all('SELECT * FROM preventivi WHERE commessa_id = ? ORDER BY data DESC, id DESC', id);
  const attivo = prevs.find((p) => p.stato === 'accettato') || prevs.find((p) => p.stato !== 'rifiutato') || null;
  const rp = attivo ? riepilogoPreventivo(attivo.id) : null;
  const ordC = all("SELECT * FROM ordini WHERE commessa_id = ? AND tipo = 'cliente'", id);
  const ordF = all("SELECT o.*, f.ragione_sociale AS fornitore FROM ordini o LEFT JOIN fornitori f ON f.id = o.fornitore_id WHERE o.commessa_id = ? AND o.tipo = 'fornitore'", id);
  const fatC = all("SELECT * FROM fatture WHERE commessa_id = ? AND tipo = 'cliente'", id);
  const fatF = all("SELECT * FROM fatture WHERE commessa_id = ? AND tipo = 'fornitore'", id);
  const pagato = (f) => all('SELECT COALESCE(SUM(importo),0) s FROM pagamenti WHERE fattura_id = ?', f.id)[0].s;
  const sum = (a, k) => eur(a.reduce((s, x) => s + (x[k] || 0), 0));
  const spese = all('SELECT * FROM spese WHERE commessa_id = ?', id);
  const ddt = all('SELECT * FROM ddt WHERE commessa_id = ?', id);

  const preventivato = rp?.imponibile ?? 0;
  const venduto = ordC.length ? sum(ordC, 'importo') : (attivo?.stato === 'accettato' ? preventivato : 0);
  const ordinatoForn = sum(ordF, 'importo');
  const fatturatoForn = sum(fatF, 'imponibile');
  const speseTot = sum(spese, 'importo');
  const speso = eur(fatturatoForn + speseTot);
  const fatturatoCli = sum(fatC, 'imponibile');
  const daPagare = eur(fatF.reduce((s, f) => s + Math.max(0, (f.totale || 0) - pagato(f)), 0));
  const daIncassare = eur(fatC.reduce((s, f) => s + Math.max(0, (f.totale || 0) - pagato(f)), 0));
  const margineReale = fatC.length ? eur(fatturatoCli - speso) : null;

  const fornitori = all(`SELECT DISTINCT f.id, f.ragione_sociale FROM fornitori f WHERE f.id IN (
      SELECT fornitore_id FROM ordini WHERE commessa_id = ? UNION SELECT fornitore_id FROM fatture WHERE commessa_id = ?
      UNION SELECT r.fornitore_id FROM righe r JOIN preventivi p ON p.id = r.preventivo_id WHERE p.commessa_id = ?)`, id, id, id);
  const prodotti = attivo ? all('SELECT codice, descrizione, qta, prezzo_acquisto FROM righe WHERE preventivo_id = ? ORDER BY pos, id', attivo.id) : [];

  const stato_idx = Math.max(0, STATI_COMMESSA.indexOf(c.stato));
  const presenti = new Set(all(`SELECT DISTINCT d.tipologia FROM documenti d JOIN doc_links l ON l.documento_id = d.id
      WHERE d.corrente = 1 AND ((l.entita = 'commesse' AND l.entita_id = ?))`, id).map((r) => r.tipologia));
  const documenti_mancanti = DOC_ATTESI.filter((d) => d.quando({ stato_idx }) && !presenti.has(d.tipologia)).map((d) => d.label);

  return {
    commessa: c, preventivo_attivo: attivo, preventivi: prevs.length,
    preventivato, venduto, ordinato_fornitori: ordinatoForn, speso, speso_dettaglio: { fatture_fornitori: fatturatoForn, spese: speseTot },
    margine_previsto: rp?.margine ?? null, margine_previsto_parziale: rp?.margine_parziale ?? null,
    righe_senza_acquisto: rp ? rp.righe - rp.righe_con_acquisto : 0,
    fatturato_cliente: fatturatoCli, margine_reale: margineReale,
    da_pagare: daPagare, da_incassare: daIncassare,
    fornitori, prodotti, documenti_mancanti,
    conteggi: { ddt_entrata: ddt.filter((d) => d.tipo === 'entrata').length, ddt_uscita: ddt.filter((d) => d.tipo === 'uscita').length,
      fatture_ricevute: fatF.length, fatture_emesse: fatC.length, ordini_cliente: ordC.length, ordini_fornitore: ordF.length },
  };
}
