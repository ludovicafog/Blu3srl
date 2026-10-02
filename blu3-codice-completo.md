# Blu3 Gestionale — codice completo

Struttura: server Node (Express + node:sqlite) in server/, frontend vanilla JS in public/. Avvio: npm install && npm start.

## FILE: package.json

````json
{
  "name": "blu3-gestionale",
  "version": "1.0.0",
  "description": "Gestionale interno Blu3 Srl — commesse, preventivi, ordini, DDT, fatture e documenti",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=22.13"
  },
  "scripts": {
    "start": "node --disable-warning=ExperimentalWarning server/index.js",
    "dev": "node --watch --disable-warning=ExperimentalWarning server/index.js",
    "seed": "node --disable-warning=ExperimentalWarning server/seed.js",
    "test": "node --disable-warning=ExperimentalWarning --test test/"
  },
  "dependencies": {
    "exceljs": "^4.4.0",
    "express": "^5.2.1",
    "multer": "^2.4.0"
  }
}
````

## FILE: README.md

````md
# Blu3 Gestionale

Gestionale interno di Blu3 Srl: il "cervello centrale" che raccoglie, collega e monitora documenti e dati di commesse, preventivi, ordini, DDT (WebDesk), fatture e spese. Non sostituisce gli strumenti esistenti.

## Avvio
Richiede Node ≥ 22.13 (usa `node:sqlite`) e, opzionalmente, `pdftotext` (poppler) per il riconoscimento dei PDF.

    npm install
    npm start        # http://localhost:3000

Al primo avvio con database vuoto viene caricata la commessa reale **WEB-0052-26** (Niger) con il PDF originale (`NO_SEED=1` per disattivare). Dati in `data/` (database SQLite + file originali). Variabili: `PORT`, `BLU3_DATA`.

## Funzioni
- **Commessa**: riepilogo che risponde a preventivato / venduto / speso / margine reale / da pagare / da incassare / fornitori / prodotti / DDT / documenti mancanti; stato; timeline automatica.
- **Documenti**: file originale sempre conservato; associabile a più elementi; visualizza, scarica, modifica dati, collega, sostituisci con storico versioni.
- **Caricamento guidato**: file → estrazione dati (PDF, XML FatturaPA) → anteprima → verifica/correzione → conferma → collegamento. L'estrazione è sempre facoltativa.
- **Import Excel/CSV**: scelta foglio e riga intestazione, mappatura colonne, esclusione/modifica righe, anteprima.
- **Preventivi** nel formato Blu3 con prezzo di acquisto, vendita interna, prezzo cliente e margine separati; anteprima/stampa.
- **Campi PA** (CIG, CUP, gara, determina, MEPA, …) attivabili per cliente/commessa.
- **DDT**: dati essenziali + PDF WebDesk originale.

## Note
- Il logo è `public/img/logo-blu3.png`, estratto dal PDF fornito (294 px): sostituirlo con il file ad alta risoluzione.
- Nessuna autenticazione: da usare in rete interna o dietro un proxy con login.
````

## FILE: server/db.js

````js
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.BLU3_DATA || path.join(root, 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.BLU3_DB || path.join(DATA_DIR, 'blu3.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Campi dedicati alla Pubblica Amministrazione (attivabili per cliente / commessa)
export const PA_FIELDS = [
  'cig', 'cup', 'rif_gara', 'num_gara', 'determina', 'ordine_mepa', 'rif_mepa',
  'codice_ufficio', 'centro_costo', 'rif_amministrativo', 'protocollo', 'num_contratto',
];

db.exec(`
CREATE TABLE IF NOT EXISTS clienti (
  id INTEGER PRIMARY KEY, ragione_sociale TEXT NOT NULL, piva TEXT, cf TEXT, indirizzo TEXT,
  email TEXT, pec TEXT, telefono TEXT, referente TEXT, tipo TEXT DEFAULT 'privato',
  pa_attiva INTEGER DEFAULT 0, codice_ufficio TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fornitori (
  id INTEGER PRIMARY KEY, ragione_sociale TEXT NOT NULL, piva TEXT, cf TEXT, indirizzo TEXT,
  email TEXT, pec TEXT, telefono TEXT, referente TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS commesse (
  id INTEGER PRIMARY KEY, codice TEXT NOT NULL UNIQUE, cliente_id INTEGER REFERENCES clienti(id),
  oggetto TEXT, stato TEXT DEFAULT 'preventivo', data_apertura TEXT, note TEXT,
  pa_attiva INTEGER DEFAULT 0,
  ${PA_FIELDS.map((f) => `${f} TEXT`).join(', ')},
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS preventivi (
  id INTEGER PRIMARY KEY, commessa_id INTEGER REFERENCES commesse(id) ON DELETE CASCADE,
  cliente_id INTEGER REFERENCES clienti(id), riferimento TEXT, data TEXT, oggetto TEXT,
  destinatario TEXT, intro TEXT, criteri_fornitura TEXT, pagamento TEXT, disponibilita TEXT,
  consegna TEXT, validita TEXT, spese_spedizione TEXT, note TEXT,
  iva_percent REAL DEFAULT 22, iva_nota TEXT, stato TEXT DEFAULT 'bozza',
  created_at TEXT DEFAULT (datetime('now'))
);
-- Righe: prezzo_acquisto / prezzo_vendita (interno) / prezzo_cliente (mostrato nel preventivo) sono separati.
CREATE TABLE IF NOT EXISTS righe (
  id INTEGER PRIMARY KEY, preventivo_id INTEGER NOT NULL REFERENCES preventivi(id) ON DELETE CASCADE,
  pos INTEGER DEFAULT 0, codice TEXT, descrizione TEXT, qta REAL DEFAULT 1,
  prezzo_acquisto REAL, prezzo_vendita REAL, prezzo_cliente REAL,
  fornitore_id INTEGER REFERENCES fornitori(id), note TEXT, extra TEXT
);
CREATE TABLE IF NOT EXISTS ordini (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, numero TEXT, data TEXT,
  commessa_id INTEGER REFERENCES commesse(id) ON DELETE CASCADE,
  cliente_id INTEGER REFERENCES clienti(id), fornitore_id INTEGER REFERENCES fornitori(id),
  importo REAL, stato TEXT DEFAULT 'aperto', note TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ddt (
  id INTEGER PRIMARY KEY, numero TEXT, data TEXT, tipo TEXT DEFAULT 'uscita',
  commessa_id INTEGER REFERENCES commesse(id) ON DELETE CASCADE,
  ordine_id INTEGER REFERENCES ordini(id) ON DELETE SET NULL,
  cliente_id INTEGER REFERENCES clienti(id), fornitore_id INTEGER REFERENCES fornitori(id),
  stato TEXT DEFAULT 'emesso', origine TEXT DEFAULT 'WebDesk', note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ddt_righe (
  id INTEGER PRIMARY KEY, ddt_id INTEGER NOT NULL REFERENCES ddt(id) ON DELETE CASCADE,
  codice TEXT, descrizione TEXT, qta REAL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS fatture (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, numero TEXT, data TEXT, scadenza TEXT,
  commessa_id INTEGER REFERENCES commesse(id) ON DELETE CASCADE,
  cliente_id INTEGER REFERENCES clienti(id), fornitore_id INTEGER REFERENCES fornitori(id),
  ordine_id INTEGER REFERENCES ordini(id) ON DELETE SET NULL,
  imponibile REAL DEFAULT 0, iva REAL DEFAULT 0, totale REAL DEFAULT 0, note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pagamenti (
  id INTEGER PRIMARY KEY, fattura_id INTEGER NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  data TEXT, importo REAL NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS spese (
  id INTEGER PRIMARY KEY, commessa_id INTEGER REFERENCES commesse(id) ON DELETE CASCADE,
  data TEXT, descrizione TEXT, categoria TEXT, importo REAL DEFAULT 0, fornitore_id INTEGER REFERENCES fornitori(id),
  note TEXT, created_at TEXT DEFAULT (datetime('now'))
);
-- Il file originale è sempre conservato; i dati sono un livello in più.
CREATE TABLE IF NOT EXISTS documenti (
  id INTEGER PRIMARY KEY, gruppo TEXT NOT NULL, versione INTEGER DEFAULT 1, corrente INTEGER DEFAULT 1,
  nome_file TEXT NOT NULL, file_path TEXT NOT NULL, mime TEXT, dimensione INTEGER,
  tipologia TEXT DEFAULT 'altro', data_caricamento TEXT DEFAULT (datetime('now')),
  data_documento TEXT, numero_documento TEXT, note TEXT, dati_estratti TEXT
);
-- Un documento può essere associato a più elementi.
CREATE TABLE IF NOT EXISTS doc_links (
  documento_id INTEGER NOT NULL REFERENCES documenti(id) ON DELETE CASCADE,
  entita TEXT NOT NULL, entita_id INTEGER NOT NULL,
  PRIMARY KEY (documento_id, entita, entita_id)
);
CREATE TABLE IF NOT EXISTS timeline (
  id INTEGER PRIMARY KEY, commessa_id INTEGER NOT NULL REFERENCES commesse(id) ON DELETE CASCADE,
  data TEXT NOT NULL, tipo TEXT, testo TEXT NOT NULL, documento_id INTEGER, ref_entita TEXT, ref_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_links ON doc_links(entita, entita_id);
CREATE INDEX IF NOT EXISTS ix_tl ON timeline(commessa_id, data);
`);

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const tx = (fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};
````

## FILE: server/util.js

````js
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
````

## FILE: server/index.js

````js
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, all, get, run, tx, PA_FIELDS, FILES_DIR, TMP_DIR } from './db.js';
import {
  parseNum, parseDate, analizzaDocumento, leggiTabelle, CAMPI_RIGA,
  riepilogoCommessa, riepilogoPreventivo, STATI_COMMESSA, round2,
} from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(here, '..', 'public')));

const upload = multer({ dest: TMP_DIR, limits: { fileSize: 50 * 1024 * 1024 } });
const fixName = (n) => Buffer.from(n, 'latin1').toString('utf8');
const today = () => new Date().toISOString().slice(0, 10);
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(e.status || 500).json({ error: e.message }); });
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ------------------------------------------------------------------ schema tabelle
const T = {
  clienti: ['ragione_sociale', 'piva', 'cf', 'indirizzo', 'email', 'pec', 'telefono', 'referente', 'tipo', 'pa_attiva', 'codice_ufficio', 'note'],
  fornitori: ['ragione_sociale', 'piva', 'cf', 'indirizzo', 'email', 'pec', 'telefono', 'referente', 'note'],
  commesse: ['codice', 'cliente_id', 'oggetto', 'stato', 'data_apertura', 'note', 'pa_attiva', ...PA_FIELDS],
  preventivi: ['commessa_id', 'cliente_id', 'riferimento', 'data', 'oggetto', 'destinatario', 'intro', 'criteri_fornitura', 'pagamento', 'disponibilita', 'consegna', 'validita', 'spese_spedizione', 'note', 'iva_percent', 'iva_nota', 'stato'],
  ordini: ['tipo', 'numero', 'data', 'commessa_id', 'cliente_id', 'fornitore_id', 'importo', 'stato', 'note'],
  ddt: ['numero', 'data', 'tipo', 'commessa_id', 'ordine_id', 'cliente_id', 'fornitore_id', 'stato', 'origine', 'note'],
  fatture: ['tipo', 'numero', 'data', 'scadenza', 'commessa_id', 'cliente_id', 'fornitore_id', 'ordine_id', 'imponibile', 'iva', 'totale', 'note'],
  spese: ['commessa_id', 'data', 'descrizione', 'categoria', 'importo', 'fornitore_id', 'note'],
  pagamenti: ['fattura_id', 'data', 'importo', 'note'],
};
const NUM = new Set(['importo', 'imponibile', 'iva', 'totale', 'iva_percent', 'qta', 'prezzo_acquisto', 'prezzo_vendita', 'prezzo_cliente']);
const BOOL = new Set(['pa_attiva']);

function pick(body, cols) {
  const o = {};
  for (const c of cols) {
    if (!(c in body)) continue;
    let v = body[c];
    if (v === '' || v === undefined) v = null;
    if (NUM.has(c) && v != null) v = parseNum(v);
    if (BOOL.has(c)) v = v ? 1 : 0;
    o[c] = v;
  }
  return o;
}
const insert = (table, o) => {
  const k = Object.keys(o);
  if (!k.length) return Number(run(`INSERT INTO ${table} DEFAULT VALUES`).lastInsertRowid);
  return Number(run(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...Object.values(o)).lastInsertRowid);
};
const update = (table, id, o) => {
  const k = Object.keys(o);
  if (k.length) run(`UPDATE ${table} SET ${k.map((c) => `${c} = ?`).join(',')} WHERE id = ?`, ...Object.values(o), id);
};

// ------------------------------------------------------------------ timeline
const TIPO_LABEL = {
  preventivo: 'Preventivo', ordine_cliente: 'Ordine cliente', ordine_fornitore: 'Ordine fornitore', ddt: 'DDT',
  fattura_cliente: 'Fattura cliente', fattura_fornitore: 'Fattura fornitore', spesa: 'Spesa', excel: 'File Excel',
  contratto: 'Contratto', altro: 'Documento', allegato: 'Allegato',
};
export function timeline(commessa_id, data, tipo, testo, extra = {}) {
  if (!commessa_id) return;
  run('INSERT INTO timeline (commessa_id, data, tipo, testo, documento_id, ref_entita, ref_id) VALUES (?,?,?,?,?,?,?)',
    commessa_id, data || today(), tipo, testo, extra.documento_id ?? null, extra.ref_entita ?? null, extra.ref_id ?? null);
}
const nomeForn = (id) => id ? get('SELECT ragione_sociale r FROM fornitori WHERE id = ?', id)?.r : null;

function timelineEntita(entita, id, r, extra = {}) {
  const e = { ref_entita: entita, ref_id: id, ...extra };
  if (entita === 'ordini') {
    if (r.tipo === 'cliente') timeline(r.commessa_id, r.data, 'ordine_cliente', `Ordine cliente${r.numero ? ' ' + r.numero : ''} ricevuto`, e);
    else timeline(r.commessa_id, r.data, 'ordine_fornitore', `Ordine fornitore${r.numero ? ' ' + r.numero : ''} inviato${nomeForn(r.fornitore_id) ? ' a ' + nomeForn(r.fornitore_id) : ''}`, e);
  } else if (entita === 'ddt') {
    timeline(r.commessa_id, r.data, 'ddt', `DDT ${r.origine || 'WebDesk'} n. ${r.numero || '—'} ${r.tipo === 'entrata' ? 'in entrata' : 'in uscita'} registrato`, e);
  } else if (entita === 'fatture') {
    timeline(r.commessa_id, r.data, r.tipo === 'cliente' ? 'fattura_cliente' : 'fattura_fornitore',
      r.tipo === 'cliente' ? `Fattura cliente ${r.numero || ''} emessa` : `Fattura fornitore ${r.numero || ''} registrata`, e);
  } else if (entita === 'spese') {
    timeline(r.commessa_id, r.data, 'spesa', `Spesa registrata: ${r.descrizione || ''}`, e);
  }
}

// ------------------------------------------------------------------ lookup / dashboard
app.get('/api/lookup', wrap((req, res) => {
  res.json({
    clienti: all('SELECT id, ragione_sociale, piva, tipo, pa_attiva FROM clienti ORDER BY ragione_sociale'),
    fornitori: all('SELECT id, ragione_sociale, piva FROM fornitori ORDER BY ragione_sociale'),
    commesse: all('SELECT id, codice, oggetto, cliente_id FROM commesse ORDER BY codice DESC'),
    stati: STATI_COMMESSA, campi_riga: CAMPI_RIGA.map(({ key, label }) => ({ key, label })), pa_fields: PA_FIELDS,
  });
}));

app.get('/api/dashboard', wrap((req, res) => {
  const commesse = all("SELECT id FROM commesse WHERE stato != 'chiusa'").map((c) => riepilogoCommessa(c.id));
  const sum = (k) => round2(commesse.reduce((s, c) => s + (c[k] || 0), 0));
  const scadenze = all(`SELECT f.*, c.codice, COALESCE(cl.ragione_sociale, fo.ragione_sociale) soggetto,
      f.totale - COALESCE((SELECT SUM(importo) FROM pagamenti p WHERE p.fattura_id = f.id), 0) AS residuo
      FROM fatture f LEFT JOIN commesse c ON c.id = f.commessa_id LEFT JOIN clienti cl ON cl.id = f.cliente_id
      LEFT JOIN fornitori fo ON fo.id = f.fornitore_id WHERE f.scadenza IS NOT NULL
      AND f.totale - COALESCE((SELECT SUM(importo) FROM pagamenti p WHERE p.fattura_id = f.id), 0) > 0.005
      ORDER BY f.scadenza LIMIT 10`);
  res.json({
    commesse_aperte: commesse.length, preventivato: sum('preventivato'), venduto: sum('venduto'), speso: sum('speso'),
    da_pagare: sum('da_pagare'), da_incassare: sum('da_incassare'),
    con_documenti_mancanti: commesse.filter((c) => c.documenti_mancanti.length).map((c) => ({ id: c.commessa.id, codice: c.commessa.codice, mancanti: c.documenti_mancanti })),
    scadenze,
    ultimi: all('SELECT t.*, c.codice FROM timeline t JOIN commesse c ON c.id = t.commessa_id ORDER BY t.created_at DESC, t.id DESC LIMIT 12'),
  });
}));

// ------------------------------------------------------------------ CRUD generico
const LIST_SQL = {
  clienti: 'SELECT * FROM clienti ORDER BY ragione_sociale',
  fornitori: 'SELECT * FROM fornitori ORDER BY ragione_sociale',
  ordini: `SELECT o.*, c.codice, COALESCE(cl.ragione_sociale, fo.ragione_sociale) soggetto FROM ordini o
    LEFT JOIN commesse c ON c.id = o.commessa_id LEFT JOIN clienti cl ON cl.id = o.cliente_id LEFT JOIN fornitori fo ON fo.id = o.fornitore_id ORDER BY o.data DESC, o.id DESC`,
};
for (const t of ['clienti', 'fornitori', 'ordini', 'ddt', 'fatture', 'spese', 'pagamenti']) {
  app.get(`/api/${t}`, wrap((req, res) => {
    const where = [], p = [];
    for (const k of ['commessa_id', 'cliente_id', 'fornitore_id', 'fattura_id', 'tipo']) if (req.query[k] && T[t].includes(k)) { where.push(`${k} = ?`); p.push(req.query[k]); }
    let sql = LIST_SQL[t] || `SELECT * FROM ${t}`;
    if (where.length) {
      const base = sql.replace(/ ORDER BY.*$/s, '');
      sql = base + (/\bWHERE\b/.test(base) ? ' AND ' : ' WHERE ') + where.map((w) => (t === 'ordini' ? 'o.' : '') + w).join(' AND ') + (sql.match(/ ORDER BY.*$/s)?.[0] || '');
    }
    res.json(all(sql, ...p));
  }));
  app.get(`/api/${t}/:id`, wrap((req, res) => {
    const r = get(`SELECT * FROM ${t} WHERE id = ?`, req.params.id);
    if (!r) throw bad('Non trovato', 404);
    if (t === 'ddt') r.righe = all('SELECT * FROM ddt_righe WHERE ddt_id = ?', r.id);
    if (t === 'fatture') r.pagamenti = all('SELECT * FROM pagamenti WHERE fattura_id = ? ORDER BY data', r.id);
    res.json(r);
  }));
  app.post(`/api/${t}`, wrap((req, res) => {
    const o = pick(req.body, T[t]);
    if (t === 'clienti' || t === 'fornitori') if (!o.ragione_sociale) throw bad('Ragione sociale obbligatoria');
    if (t === 'fatture' && o.totale == null) o.totale = round2((o.imponibile || 0) + (o.iva || 0));
    const id = tx(() => {
      const id = insert(t, o);
      if (t === 'ddt') for (const r of req.body.righe || []) run('INSERT INTO ddt_righe (ddt_id, codice, descrizione, qta) VALUES (?,?,?,?)', id, r.codice || null, r.descrizione || null, parseNum(r.qta) ?? 1);
      timelineEntita(t, id, o);
      if (t === 'pagamenti') {
        const f = get('SELECT * FROM fatture WHERE id = ?', o.fattura_id);
        if (f) timeline(f.commessa_id, o.data, 'pagamento', `${f.tipo === 'cliente' ? 'Incasso' : 'Pagamento'} di ${o.importo?.toLocaleString('it-IT', { minimumFractionDigits: 2 })} € — fattura ${f.numero || ''}`, { ref_entita: 'fatture', ref_id: f.id });
      }
      return id;
    });
    res.status(201).json(get(`SELECT * FROM ${t} WHERE id = ?`, id));
  }));
  app.put(`/api/${t}/:id`, wrap((req, res) => {
    tx(() => {
      update(t, req.params.id, pick(req.body, T[t]));
      if (t === 'ddt' && Array.isArray(req.body.righe)) {
        run('DELETE FROM ddt_righe WHERE ddt_id = ?', req.params.id);
        for (const r of req.body.righe) run('INSERT INTO ddt_righe (ddt_id, codice, descrizione, qta) VALUES (?,?,?,?)', req.params.id, r.codice || null, r.descrizione || null, parseNum(r.qta) ?? 1);
      }
    });
    res.json(get(`SELECT * FROM ${t} WHERE id = ?`, req.params.id));
  }));
  app.delete(`/api/${t}/:id`, wrap((req, res) => {
    tx(() => {
      run('DELETE FROM doc_links WHERE entita = ? AND entita_id = ?', t, req.params.id);
      run('DELETE FROM timeline WHERE ref_entita = ? AND ref_id = ?', t, req.params.id);
      run(`DELETE FROM ${t} WHERE id = ?`, req.params.id);
    });
    res.json({ ok: true });
  }));
}

// ------------------------------------------------------------------ commesse
function prossimoCodice() {
  const yy = String(new Date().getFullYear()).slice(2);
  const max = all("SELECT codice FROM commesse WHERE codice LIKE ?", `WEB-%-${yy}`)
    .map((r) => Number(r.codice.split('-')[1])).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
  return `WEB-${String(max + 1).padStart(4, '0')}-${yy}`;
}
app.get('/api/commesse/prossimo-codice', wrap((req, res) => res.json({ codice: prossimoCodice() })));

app.get('/api/commesse', wrap((req, res) => {
  const list = all(`SELECT c.*, cl.ragione_sociale cliente FROM commesse c LEFT JOIN clienti cl ON cl.id = c.cliente_id ORDER BY c.data_apertura DESC, c.id DESC`);
  res.json(list.map((c) => {
    const r = riepilogoCommessa(c.id);
    return { ...c, preventivato: r.preventivato, venduto: r.venduto, speso: r.speso, margine_reale: r.margine_reale, margine_previsto: r.margine_previsto, da_pagare: r.da_pagare, da_incassare: r.da_incassare, mancanti: r.documenti_mancanti.length };
  }));
}));

app.post('/api/commesse', wrap((req, res) => {
  const o = pick(req.body, T.commesse);
  if (!o.codice) o.codice = prossimoCodice();
  if (get('SELECT 1 FROM commesse WHERE codice = ?', o.codice)) throw bad(`Esiste già una commessa con codice ${o.codice}`, 409);
  o.data_apertura ||= today();
  o.stato ||= 'preventivo';
  const id = tx(() => {
    const id = insert('commesse', o);
    timeline(id, o.data_apertura, 'commessa', `Commessa ${o.codice} aperta`, { ref_entita: 'commesse', ref_id: id });
    return id;
  });
  res.status(201).json(get('SELECT * FROM commesse WHERE id = ?', id));
}));

app.put('/api/commesse/:id', wrap((req, res) => {
  const prima = get('SELECT stato FROM commesse WHERE id = ?', req.params.id);
  const o = pick(req.body, T.commesse);
  tx(() => {
    update('commesse', req.params.id, o);
    if (o.stato && prima && o.stato !== prima.stato) timeline(Number(req.params.id), today(), 'stato', `Stato commessa: ${o.stato.replace('_', ' ')}`);
  });
  res.json(get('SELECT * FROM commesse WHERE id = ?', req.params.id));
}));

app.delete('/api/commesse/:id', wrap((req, res) => {
  tx(() => {
    run("DELETE FROM doc_links WHERE entita = 'commesse' AND entita_id = ?", req.params.id);
    run('DELETE FROM commesse WHERE id = ?', req.params.id);
  });
  res.json({ ok: true });
}));

app.get('/api/commesse/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const r = riepilogoCommessa(id);
  if (!r) throw bad('Commessa non trovata', 404);
  const cliente = r.commessa.cliente_id ? get('SELECT * FROM clienti WHERE id = ?', r.commessa.cliente_id) : null;
  res.json({
    ...r, cliente,
    preventivi_lista: all('SELECT * FROM preventivi WHERE commessa_id = ? ORDER BY data DESC, id DESC', id).map((p) => ({ ...p, ...riepilogoPreventivo(p.id) })),
    ordini: all(`SELECT o.*, COALESCE(cl.ragione_sociale, fo.ragione_sociale) soggetto FROM ordini o LEFT JOIN clienti cl ON cl.id = o.cliente_id LEFT JOIN fornitori fo ON fo.id = o.fornitore_id WHERE o.commessa_id = ? ORDER BY o.data, o.id`, id),
    ddt: all(`SELECT d.*, o.numero ordine_numero, COALESCE(cl.ragione_sociale, fo.ragione_sociale) soggetto FROM ddt d LEFT JOIN ordini o ON o.id = d.ordine_id LEFT JOIN clienti cl ON cl.id = d.cliente_id LEFT JOIN fornitori fo ON fo.id = d.fornitore_id WHERE d.commessa_id = ? ORDER BY d.data, d.id`, id)
      .map((d) => ({ ...d, righe: all('SELECT * FROM ddt_righe WHERE ddt_id = ?', d.id) })),
    fatture: all(`SELECT f.*, COALESCE(cl.ragione_sociale, fo.ragione_sociale) soggetto,
        COALESCE((SELECT SUM(importo) FROM pagamenti p WHERE p.fattura_id = f.id), 0) pagato FROM fatture f
        LEFT JOIN clienti cl ON cl.id = f.cliente_id LEFT JOIN fornitori fo ON fo.id = f.fornitore_id WHERE f.commessa_id = ? ORDER BY f.data, f.id`, id),
    spese: all('SELECT s.*, fo.ragione_sociale fornitore FROM spese s LEFT JOIN fornitori fo ON fo.id = s.fornitore_id WHERE s.commessa_id = ? ORDER BY s.data', id),
    documenti: documentiDi('commesse', id),
    timeline: all('SELECT * FROM timeline WHERE commessa_id = ? ORDER BY data, id', id),
  });
}));

app.post('/api/commesse/:id/timeline', wrap((req, res) => {
  if (!req.body.testo) throw bad('Testo obbligatorio');
  timeline(Number(req.params.id), parseDate(req.body.data) || today(), 'nota', req.body.testo);
  res.status(201).json({ ok: true });
}));
app.delete('/api/timeline/:id', wrap((req, res) => { run("DELETE FROM timeline WHERE id = ? AND tipo = 'nota'", req.params.id); res.json({ ok: true }); }));

// ------------------------------------------------------------------ preventivi e righe
app.get('/api/preventivi', wrap((req, res) => {
  const w = req.query.commessa_id ? 'WHERE p.commessa_id = ?' : '';
  const rows = all(`SELECT p.*, c.codice commessa, cl.ragione_sociale cliente FROM preventivi p LEFT JOIN commesse c ON c.id = p.commessa_id
    LEFT JOIN clienti cl ON cl.id = p.cliente_id ${w} ORDER BY p.data DESC, p.id DESC`, ...(w ? [req.query.commessa_id] : []));
  res.json(rows.map((p) => ({ ...p, ...riepilogoPreventivo(p.id) })));
}));
app.post('/api/preventivi', wrap((req, res) => {
  const o = pick(req.body, T.preventivi);
  if (o.commessa_id) {
    const c = get('SELECT * FROM commesse WHERE id = ?', o.commessa_id);
    o.cliente_id ??= c.cliente_id; o.oggetto ??= c.oggetto; o.riferimento ??= c.codice;
    if (o.destinatario == null && o.cliente_id) o.destinatario = get('SELECT ragione_sociale r FROM clienti WHERE id = ?', o.cliente_id)?.r;
  }
  o.data ||= today();
  const id = tx(() => {
    const id = insert('preventivi', o);
    timeline(o.commessa_id, o.data, 'preventivo', `Preventivo ${o.riferimento || ''} creato`, { ref_entita: 'preventivi', ref_id: id });
    return id;
  });
  res.status(201).json(get('SELECT * FROM preventivi WHERE id = ?', id));
}));
app.get('/api/preventivi/:id', wrap((req, res) => {
  const p = get('SELECT * FROM preventivi WHERE id = ?', req.params.id);
  if (!p) throw bad('Preventivo non trovato', 404);
  res.json({
    ...p, righe: all('SELECT * FROM righe WHERE preventivo_id = ? ORDER BY pos, id', p.id), riepilogo: riepilogoPreventivo(p.id),
    commessa: p.commessa_id ? get('SELECT * FROM commesse WHERE id = ?', p.commessa_id) : null,
    cliente: p.cliente_id ? get('SELECT * FROM clienti WHERE id = ?', p.cliente_id) : null,
    documenti: documentiDi('preventivi', p.id),
  });
}));
app.put('/api/preventivi/:id', wrap((req, res) => {
  const prima = get('SELECT stato, commessa_id, riferimento FROM preventivi WHERE id = ?', req.params.id);
  tx(() => {
    update('preventivi', req.params.id, pick(req.body, T.preventivi));
    if (Array.isArray(req.body.righe)) salvaRighe(Number(req.params.id), req.body.righe);
    if (req.body.stato && prima && req.body.stato !== prima.stato) timeline(prima.commessa_id, today(), 'preventivo', `Preventivo ${prima.riferimento || ''}: ${req.body.stato}`, { ref_entita: 'preventivi', ref_id: Number(req.params.id) });
  });
  res.json({ ...get('SELECT * FROM preventivi WHERE id = ?', req.params.id), righe: all('SELECT * FROM righe WHERE preventivo_id = ? ORDER BY pos, id', req.params.id), riepilogo: riepilogoPreventivo(Number(req.params.id)) });
}));
app.delete('/api/preventivi/:id', wrap((req, res) => {
  tx(() => {
    run("DELETE FROM doc_links WHERE entita = 'preventivi' AND entita_id = ?", req.params.id);
    run("DELETE FROM timeline WHERE ref_entita = 'preventivi' AND ref_id = ?", req.params.id);
    run('DELETE FROM preventivi WHERE id = ?', req.params.id);
  });
  res.json({ ok: true });
}));

const RIGA_COLS = ['codice', 'descrizione', 'qta', 'prezzo_acquisto', 'prezzo_vendita', 'prezzo_cliente', 'fornitore_id', 'note'];
function salvaRighe(prevId, righe) {
  run('DELETE FROM righe WHERE preventivo_id = ?', prevId);
  righe.forEach((r, i) => {
    const o = pick(r, RIGA_COLS);
    o.qta ??= 1;
    insert('righe', { ...o, preventivo_id: prevId, pos: i + 1 });
  });
}

// ------------------------------------------------------------------ documenti
function documentiDi(entita, id) {
  return all(`SELECT d.*, (SELECT COUNT(*) FROM documenti x WHERE x.gruppo = d.gruppo) n_versioni FROM documenti d
    JOIN doc_links l ON l.documento_id = d.id WHERE l.entita = ? AND l.entita_id = ? AND d.corrente = 1 ORDER BY COALESCE(d.data_documento, d.data_caricamento) DESC, d.id DESC`, entita, id)
    .map((d) => ({ ...d, links: all('SELECT entita, entita_id FROM doc_links WHERE documento_id = ?', d.id).map(descriviLink) }));
}

const ENTITA_OK = new Set(['commesse', 'clienti', 'fornitori', 'preventivi', 'ordini', 'ddt', 'fatture', 'spese']);
const DOC_COLS = ['tipologia', 'data_documento', 'numero_documento', 'note', 'nome_file'];

function salvaFile(tmpPath, nome) {
  const safe = nome.replace(/[^\w.\- ()àèéìòùÀÈÉÌÒÙ]/g, '_');
  const rel = `${crypto.randomUUID().slice(0, 8)}-${safe}`;
  fs.renameSync(tmpPath, path.join(FILES_DIR, rel));
  return rel;
}

function descriviLink(l) {
  const q = {
    commesse: 'SELECT codice t FROM commesse WHERE id = ?', clienti: 'SELECT ragione_sociale t FROM clienti WHERE id = ?',
    fornitori: 'SELECT ragione_sociale t FROM fornitori WHERE id = ?', preventivi: 'SELECT riferimento t FROM preventivi WHERE id = ?',
    ordini: 'SELECT numero t FROM ordini WHERE id = ?', ddt: 'SELECT numero t FROM ddt WHERE id = ?', fatture: 'SELECT numero t FROM fatture WHERE id = ?',
    spese: 'SELECT descrizione t FROM spese WHERE id = ?',
  }[l.entita];
  return { ...l, label: q ? get(q, l.entita_id)?.t : null };
}

app.get('/api/documenti', wrap((req, res) => {
  const w = ['d.corrente = 1'], p = [];
  let j = '';
  if (req.query.entita && req.query.id) { j = 'JOIN doc_links l ON l.documento_id = d.id'; w.push('l.entita = ? AND l.entita_id = ?'); p.push(req.query.entita, req.query.id); }
  if (req.query.tipologia) { w.push('d.tipologia = ?'); p.push(req.query.tipologia); }
  if (req.query.q) { w.push('(d.nome_file LIKE ? OR d.numero_documento LIKE ? OR d.note LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
  const rows = all(`SELECT DISTINCT d.*, (SELECT COUNT(*) FROM documenti x WHERE x.gruppo = d.gruppo) n_versioni FROM documenti d ${j} WHERE ${w.join(' AND ')} ORDER BY d.data_caricamento DESC, d.id DESC LIMIT 500`, ...p);
  res.json(rows.map((d) => ({ ...d, links: all('SELECT entita, entita_id FROM doc_links WHERE documento_id = ?', d.id).map(descriviLink) })));
}));

app.get('/api/documenti/:id', wrap((req, res) => {
  const d = get('SELECT * FROM documenti WHERE id = ?', req.params.id);
  if (!d) throw bad('Documento non trovato', 404);
  res.json({
    ...d, dati_estratti: d.dati_estratti ? JSON.parse(d.dati_estratti) : null,
    links: all('SELECT entita, entita_id FROM doc_links WHERE documento_id = ?', d.id).map(descriviLink),
    versioni: all('SELECT id, versione, nome_file, data_caricamento, corrente FROM documenti WHERE gruppo = ? ORDER BY versione DESC', d.gruppo),
  });
}));

app.get('/api/documenti/:id/file', wrap((req, res) => {
  const d = get('SELECT * FROM documenti WHERE id = ?', req.params.id);
  if (!d) throw bad('Documento non trovato', 404);
  const p = path.join(FILES_DIR, d.file_path);
  if (!fs.existsSync(p)) throw bad('File non presente su disco', 404);
  res.setHeader('Content-Type', d.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.nome_file)}`);
  fs.createReadStream(p).pipe(res);
}));

// Anteprima del file ancora in area temporanea (prima della conferma)
app.get('/api/documenti/temp/:token', wrap((req, res) => {
  const t = path.join(TMP_DIR, path.basename(req.params.token));
  if (!fs.existsSync(t + '.json')) throw bad('File temporaneo scaduto', 404);
  const meta = JSON.parse(fs.readFileSync(t + '.json', 'utf8'));
  res.setHeader('Content-Type', meta.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.nome)}`);
  fs.createReadStream(t).pipe(res);
}));

// Contenuto tabellare di un documento Excel/CSV già archiviato (per la visualizzazione)
app.get('/api/documenti/:id/tabella', wrap(async (req, res) => {
  const d = get('SELECT * FROM documenti WHERE id = ?', req.params.id);
  if (!d) throw bad('Documento non trovato', 404);
  const sheets = await leggiTabelle(path.join(FILES_DIR, d.file_path), d.nome_file);
  res.json(sheets.map((s) => ({ nome: s.nome, rows: s.rows.slice(0, 500) })));
}));

// 1) CARICAMENTO + ESTRAZIONE: salva in area temporanea e propone i dati (mai obbligatorio)
app.post('/api/documenti/analizza', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw bad('Nessun file');
  const nome = fixName(req.file.originalname);
  const token = path.basename(req.file.path);
  fs.writeFileSync(req.file.path + '.json', JSON.stringify({ nome, mime: req.file.mimetype }));
  let estratti = {};
  try { estratti = await analizzaDocumento(req.file.path, nome, req.file.mimetype); } catch (e) { console.warn('estrazione fallita', e.message); }
  res.json({ token, nome_file: nome, dimensione: req.file.size, mime: req.file.mimetype, estratti });
}));

function creaEntitaDaDocumento(crea, d, commessa_id) {
  const base = { commessa_id, numero: d.numero_documento || null, data: d.data_documento || today() };
  if (crea === 'ddt') {
    const o = { ...base, tipo: d.ddt_tipo || 'uscita', ordine_id: d.ordine_id || null, cliente_id: d.cliente_id || null, fornitore_id: d.fornitore_id || null, stato: 'emesso', origine: 'WebDesk', note: d.note || null };
    const id = insert('ddt', o);
    for (const r of d.righe || []) run('INSERT INTO ddt_righe (ddt_id, codice, descrizione, qta) VALUES (?,?,?,?)', id, r.codice || null, r.descrizione || null, parseNum(r.qta) ?? 1);
    return { entita: 'ddt', id, row: o };
  }
  if (crea === 'ordine_cliente' || crea === 'ordine_fornitore') {
    const tipo = crea === 'ordine_cliente' ? 'cliente' : 'fornitore';
    const o = { ...base, tipo, numero: d.numero_ordine || d.numero_documento || null, cliente_id: tipo === 'cliente' ? d.cliente_id || null : null, fornitore_id: tipo === 'fornitore' ? d.fornitore_id || null : null, importo: parseNum(d.imponibile ?? d.importo), stato: 'aperto', note: d.note || null };
    return { entita: 'ordini', id: insert('ordini', o), row: o };
  }
  if (crea === 'fattura_cliente' || crea === 'fattura_fornitore') {
    const tipo = crea === 'fattura_cliente' ? 'cliente' : 'fornitore';
    const imponibile = parseNum(d.imponibile ?? d.importo) || 0, iva = parseNum(d.iva) || 0;
    const o = { ...base, tipo, scadenza: parseDate(d.scadenza), cliente_id: tipo === 'cliente' ? d.cliente_id || null : null, fornitore_id: tipo === 'fornitore' ? d.fornitore_id || null : null, ordine_id: d.ordine_id || null, imponibile, iva, totale: parseNum(d.totale) ?? round2(imponibile + iva), note: d.note || null };
    return { entita: 'fatture', id: insert('fatture', o), row: o };
  }
  if (crea === 'spesa') {
    const o = { commessa_id, data: base.data, descrizione: d.descrizione || d.note || 'Spesa', categoria: d.categoria || null, importo: parseNum(d.importo ?? d.totale) || 0, fornitore_id: d.fornitore_id || null, note: null };
    return { entita: 'spese', id: insert('spese', o), row: o };
  }
  return null;
}

// 2) CONFERMA: salva il file originale, collega, (opzionale) crea il dato strutturato, aggiorna timeline
app.post('/api/documenti/conferma', wrap((req, res) => {
  const b = req.body;
  const tmp = path.join(TMP_DIR, path.basename(b.token || ''));
  if (!b.token || !fs.existsSync(tmp)) throw bad('File temporaneo scaduto: ricaricare il documento');
  const meta = JSON.parse(fs.readFileSync(tmp + '.json', 'utf8'));
  const dati = b.dati || {};
  const out = tx(() => {
    for (const k of ['cliente', 'fornitore']) {
      const n = b[`nuovo_${k}`];
      if (n?.ragione_sociale) dati[`${k}_id`] = insert(k === 'cliente' ? 'clienti' : 'fornitori', pick(n, T[k === 'cliente' ? 'clienti' : 'fornitori']));
    }
    const commessa_id = b.commessa_id ? Number(b.commessa_id) : null;
    const tipologia = dati.tipologia || 'altro';
    const stat = fs.statSync(tmp);
    const rel = salvaFile(tmp, b.nome_file || meta.nome);
    fs.rmSync(tmp + '.json', { force: true });
    const docId = insert('documenti', {
      gruppo: crypto.randomUUID(), versione: 1, corrente: 1, nome_file: b.nome_file || meta.nome, file_path: rel, mime: meta.mime, dimensione: stat.size,
      tipologia, data_documento: parseDate(dati.data_documento), numero_documento: dati.numero_documento || null, note: dati.note || null,
      dati_estratti: JSON.stringify(b.estratti || {}),
    });
    const link = (entita, id) => id && run('INSERT OR IGNORE INTO doc_links (documento_id, entita, entita_id) VALUES (?,?,?)', docId, entita, id);
    link('commesse', commessa_id); link('clienti', dati.cliente_id); link('fornitori', dati.fornitore_id);
    link('ordini', dati.ordine_id); link('preventivi', dati.preventivo_id);
    const ent = b.crea ? creaEntitaDaDocumento(b.crea, dati, commessa_id) : null;
    if (ent) {
      link(ent.entita, ent.id);
      timelineEntita(ent.entita, ent.id, ent.row, { documento_id: docId });
    } else if (commessa_id) {
      const lab = TIPO_LABEL[tipologia] || 'Documento';
      timeline(commessa_id, dati.data_documento || today(), tipologia, `${lab}${dati.numero_documento ? ' ' + dati.numero_documento : ''} caricato — ${b.nome_file || meta.nome}`, { documento_id: docId });
    }
    for (const l of b.collega || []) if (ENTITA_OK.has(l.entita)) link(l.entita, Number(l.entita_id));
    return { id: docId, entita: ent };
  });
  res.status(201).json(out);
}));

// Annulla un caricamento in anteprima
app.delete('/api/documenti/temp/:token', wrap((req, res) => {
  const t = path.join(TMP_DIR, path.basename(req.params.token));
  fs.rmSync(t, { force: true }); fs.rmSync(t + '.json', { force: true });
  res.json({ ok: true });
}));

app.put('/api/documenti/:id', wrap((req, res) => {
  const o = pick(req.body, DOC_COLS);
  if (o.data_documento) o.data_documento = parseDate(o.data_documento);
  update('documenti', req.params.id, o);
  res.json(get('SELECT * FROM documenti WHERE id = ?', req.params.id));
}));

app.post('/api/documenti/:id/collega', wrap((req, res) => {
  const { entita, entita_id } = req.body;
  if (!ENTITA_OK.has(entita)) throw bad('Elemento non valido');
  run('INSERT OR IGNORE INTO doc_links (documento_id, entita, entita_id) VALUES (?,?,?)', req.params.id, entita, entita_id);
  const d = get('SELECT * FROM documenti WHERE id = ?', req.params.id);
  if (entita === 'commesse') timeline(Number(entita_id), d.data_documento, d.tipologia, `${TIPO_LABEL[d.tipologia] || 'Documento'} collegato: ${d.nome_file}`, { documento_id: d.id });
  res.json({ ok: true });
}));
app.delete('/api/documenti/:id/collega/:entita/:eid', wrap((req, res) => {
  run('DELETE FROM doc_links WHERE documento_id = ? AND entita = ? AND entita_id = ?', req.params.id, req.params.entita, req.params.eid);
  res.json({ ok: true });
}));

// Sostituzione con storico delle versioni
app.post('/api/documenti/:id/versione', upload.single('file'), wrap((req, res) => {
  const old = get('SELECT * FROM documenti WHERE id = ?', req.params.id);
  if (!old) throw bad('Documento non trovato', 404);
  if (!req.file) throw bad('Nessun file');
  const nome = fixName(req.file.originalname);
  const out = tx(() => {
    const rel = salvaFile(req.file.path, nome);
    const next = get('SELECT MAX(versione) v FROM documenti WHERE gruppo = ?', old.gruppo).v + 1;
    run('UPDATE documenti SET corrente = 0 WHERE gruppo = ?', old.gruppo);
    const id = insert('documenti', {
      gruppo: old.gruppo, versione: next, corrente: 1, nome_file: nome, file_path: rel, mime: req.file.mimetype, dimensione: req.file.size,
      tipologia: old.tipologia, data_documento: old.data_documento, numero_documento: old.numero_documento, note: old.note,
    });
    run('INSERT INTO doc_links (documento_id, entita, entita_id) SELECT ?, entita, entita_id FROM doc_links WHERE documento_id = ?', id, old.id);
    for (const l of all("SELECT entita_id FROM doc_links WHERE documento_id = ? AND entita = 'commesse'", id)) timeline(l.entita_id, today(), old.tipologia, `Nuova versione (v${next}) di ${old.nome_file}`, { documento_id: id });
    return id;
  });
  res.status(201).json({ id: out });
}));

app.delete('/api/documenti/:id', wrap((req, res) => {
  const d = get('SELECT * FROM documenti WHERE id = ?', req.params.id);
  if (!d) throw bad('Documento non trovato', 404);
  const tutte = req.query.tutte ? all('SELECT * FROM documenti WHERE gruppo = ?', d.gruppo) : [d];
  tx(() => {
    for (const x of tutte) {
      run('DELETE FROM documenti WHERE id = ?', x.id);
      fs.rmSync(path.join(FILES_DIR, x.file_path), { force: true });
    }
    // se è stata eliminata la versione corrente, ripristina la precedente
    if (d.corrente && !req.query.tutte) {
      const prev = get('SELECT id FROM documenti WHERE gruppo = ? ORDER BY versione DESC LIMIT 1', d.gruppo);
      if (prev) run('UPDATE documenti SET corrente = 1 WHERE id = ?', prev.id);
    }
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ importazione Excel / CSV
app.post('/api/import/parse', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw bad('Nessun file');
  const nome = fixName(req.file.originalname);
  if (!/\.(xlsx|csv)$/i.test(nome)) throw bad('Formato non supportato: usare .xlsx o .csv');
  const token = path.basename(req.file.path);
  fs.writeFileSync(req.file.path + '.json', JSON.stringify({ nome, mime: req.file.mimetype }));
  const sheets = await leggiTabelle(req.file.path, nome);
  if (!sheets.length) throw bad('Il file non contiene dati');
  res.json({ token, nome_file: nome, fogli: sheets.map((s) => ({ ...s, rows: s.rows.slice(0, 2000) })), campi: CAMPI_RIGA.map(({ key, label }) => ({ key, label })) });
}));

app.post('/api/import/conferma', wrap((req, res) => {
  const { token, commessa_id, preventivo_id, righe, modalita = 'aggiungi' } = req.body;
  const tmp = path.join(TMP_DIR, path.basename(token || ''));
  if (!token || !fs.existsSync(tmp)) throw bad('File temporaneo scaduto: ricaricare il file');
  if (!Array.isArray(righe) || !righe.length) throw bad('Nessuna riga da importare');
  const meta = JSON.parse(fs.readFileSync(tmp + '.json', 'utf8'));
  const out = tx(() => {
    let prevId = preventivo_id ? Number(preventivo_id) : null;
    const cid = commessa_id ? Number(commessa_id) : get('SELECT commessa_id c FROM preventivi WHERE id = ?', prevId)?.c;
    if (!prevId) {
      const c = get('SELECT * FROM commesse WHERE id = ?', cid);
      if (!c) throw bad('Selezionare una commessa o un preventivo');
      prevId = insert('preventivi', { commessa_id: cid, cliente_id: c.cliente_id, riferimento: c.codice, oggetto: c.oggetto, data: today(), stato: 'bozza' });
    }
    if (modalita === 'sostituisci') run('DELETE FROM righe WHERE preventivo_id = ?', prevId);
    let pos = get('SELECT COALESCE(MAX(pos),0) p FROM righe WHERE preventivo_id = ?', prevId).p;
    const fornCache = new Map();
    for (const r of righe) {
      const o = pick(r, RIGA_COLS.filter((c) => c !== 'fornitore_id'));
      if (o.prezzo_vendita == null && o.prezzo_cliente == null && r.prezzo_totale != null && o.qta) o.prezzo_vendita = round2(parseNum(r.prezzo_totale) / o.qta);
      o.qta ??= 1;
      if (r.fornitore) {
        const n = String(r.fornitore).trim();
        if (!fornCache.has(n)) fornCache.set(n, get('SELECT id FROM fornitori WHERE lower(ragione_sociale) = lower(?)', n)?.id ?? insert('fornitori', { ragione_sociale: n }));
        o.fornitore_id = fornCache.get(n);
      }
      insert('righe', { ...o, preventivo_id: prevId, pos: ++pos });
    }
    const rel = salvaFile(tmp, meta.nome);
    fs.rmSync(tmp + '.json', { force: true });
    const docId = insert('documenti', { gruppo: crypto.randomUUID(), nome_file: meta.nome, file_path: rel, mime: meta.mime, dimensione: fs.statSync(path.join(FILES_DIR, rel)).size, tipologia: 'excel', data_documento: today(), note: `Importate ${righe.length} righe` });
    run('INSERT INTO doc_links (documento_id, entita, entita_id) VALUES (?,?,?)', docId, 'preventivi', prevId);
    if (cid) { run('INSERT OR IGNORE INTO doc_links (documento_id, entita, entita_id) VALUES (?,?,?)', docId, 'commesse', cid); }
    timeline(cid, today(), 'excel', `Excel ${meta.nome} importato: ${righe.length} righe`, { documento_id: docId, ref_entita: 'preventivi', ref_id: prevId });
    return { preventivo_id: prevId, commessa_id: cid, documento_id: docId, righe: righe.length };
  });
  res.status(201).json(out);
}));

// ------------------------------------------------------------------ avvio
const PORT = process.env.PORT || 3000;
app.use((req, res) => res.status(404).json({ error: 'Non trovato' }));

export { app };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { seedSeVuoto } = await import('./seed.js');
  if (!process.env.NO_SEED) await seedSeVuoto();
  app.listen(PORT, () => console.log(`Blu3 Gestionale in ascolto su http://localhost:${PORT}`));
}
````

## FILE: server/seed.js

````js
// Dati di esempio: la commessa reale WEB-0052-26 (Missione bilaterale di supporto in Niger).
// I prezzi di acquisto NON sono presenti nel documento cliente e restano vuoti: vanno inseriti da Blu3.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, get, run, tx, FILES_DIR } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ins = (t, o) => Number(run(`INSERT INTO ${t} (${Object.keys(o).join(',')}) VALUES (${Object.keys(o).map(() => '?').join(',')})`, ...Object.values(o)).lastInsertRowid);

export async function seedSeVuoto() {
  if (get('SELECT COUNT(*) n FROM commesse').n > 0) return false;
  const pdf = path.join(here, '..', 'seed', 'WEB0052-26_NIGER_MATERIALE_INFORMATICO.pdf');
  tx(() => {
    const cliente = ins('clienti', {
      ragione_sociale: 'MISSIONE BILATERALE DI SUPPORTO IN NIGER', tipo: 'pa', pa_attiva: 1,
      note: 'Soggetto istituzionale — IVA non imponibile (art. 8 e art. 72 DPR 633/1972)',
    });
    const commessa = ins('commesse', {
      codice: 'WEB-0052-26', cliente_id: cliente, oggetto: 'Quotazione per fornitura hardware allegato A',
      stato: 'preventivo', data_apertura: '2026-06-25', pa_attiva: 1,
    });
    const prev = ins('preventivi', {
      commessa_id: commessa, cliente_id: cliente, riferimento: 'WEB-0052-26', data: '2026-06-25',
      oggetto: 'Quotazione per fornitura hardware allegato A', destinatario: 'MISSIONE BILATERALE DI SUPPORTO IN NIGER',
      intro: 'Spett.le Reparto,\n\ncon la presente trasmettiamo la nostra migliore quotazione economica relativa alla fornitura richiesta.\n\nLa proposta allegata è stata predisposta sulla base delle specifiche indicate e comprende le condizioni economiche e commerciali attualmente disponibili.\n\nRestiamo a disposizione per eventuali chiarimenti, approfondimenti tecnici o modifiche dell’offerta secondo le Vostre esigenze.\n\nIn attesa di un cortese riscontro, porgiamo distinti saluti.',
      criteri_fornitura: 'IVA 22% non imponibile ai sensi dell’art. 8, comma 1, lettera a) e art. 72, comma 1, lettera f) del D.P.R. 633/1972',
      pagamento: 'Vs. solito', disponibilita: '30 GG data ordine', consegna: 'come da vs indicazioni', validita: '30 giorni',
      spese_spedizione: 'incluse', iva_percent: 0, iva_nota: 'iva esente ai sensi dell\'art.72 del DPR n.633/1972', stato: 'inviato',
    });
    const righe = [
      ['', 'Cisco catalyst 9300(C9300-24S-A)', 1, 10749],
      ['', 'Cisco catalyst 9200L (C9200L-48T-4X-A)', 1, 5100],
      ['', 'Cisco Catalyst 8300-1N1S-6T', 1, 4319],
      ['13G00009GE', 'Lenovo ThinkCentre Neo 55s SFF 13G00009GE - AMD Ryzen 7 250, 16 GB di RAM DDR5, SSD da 512 GB, scheda grafica AMD Radeon 780M', 7, 735],
      ['E24-40', 'LENOVO THINKCENTRE TIO24 GEN 5 60,45CM 23,8INCH si offre Lenovo ThinkVision E24-40 - FHD, 100Hz', 15, 129],
      ['83HF00FSIX', 'LENOVO V15 G4 IRU INTEL CORE I5-13420H COMPUTER PORTATILE 39,6CM (15.6") FULL HD 16GB DDR4-SDRAM 512GB SSD WI-FI 6 (802.11AX) WINDOWS 11 PRO NORDIC NERO tipo 83HF00FSIX', 3, 595],
      ['SMC1500I-2UC', 'UPS APC SMC1500I-2UC (Caratteristiche: 1.5 kVA - 900W - 170-300V - 50/60Hz - 459J - 432x477x86mm - 28.64kg – Black)', 3, 895],
      ['PMNN4807A', 'Batterie per apparati radio MOTOROLA Codice batterie: PMNN4807A', 30, 145],
      ['OLS3000EA-DE', 'SAI UPS online Cyberpower OLS3000EA-DE 3000VA 2700W con 4 prese Schuko 2 prese IEC C13', 2, 799.5],
    ];
    righe.forEach(([codice, descrizione, qta, pv], i) => {
      // codici estratti dalla descrizione quando non esiste una colonna dedicata
      const m = descrizione.match(/\(([A-Z0-9-]{6,})\)/);
      ins('righe', { preventivo_id: prev, pos: i + 1, codice: codice || m?.[1] || null, descrizione, qta, prezzo_vendita: pv });
    });

    const rel = `${crypto.randomUUID().slice(0, 8)}-WEB0052-26_NIGER_MATERIALE_INFORMATICO.pdf`;
    fs.copyFileSync(pdf, path.join(FILES_DIR, rel));
    const doc = ins('documenti', {
      gruppo: crypto.randomUUID(), nome_file: 'WEB0052-26_NIGER_MATERIALE_INFORMATICO.pdf', file_path: rel, mime: 'application/pdf',
      dimensione: fs.statSync(pdf).size, tipologia: 'preventivo', data_documento: '2026-06-25', numero_documento: 'WEB-0052-26',
      note: 'Quotazione originale Blu3 inviata al cliente',
    });
    for (const [e, id] of [['commesse', commessa], ['clienti', cliente], ['preventivi', prev]]) ins('doc_links', { documento_id: doc, entita: e, entita_id: id });
    ins('timeline', { commessa_id: commessa, data: '2026-06-25', tipo: 'commessa', testo: 'Commessa WEB-0052-26 aperta', ref_entita: 'commesse', ref_id: commessa });
    ins('timeline', { commessa_id: commessa, data: '2026-06-25', tipo: 'preventivo', testo: 'Preventivo WEB-0052-26 caricato — WEB0052-26_NIGER_MATERIALE_INFORMATICO.pdf', documento_id: doc, ref_entita: 'preventivi', ref_id: prev });
  });
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log((await seedSeVuoto()) ? 'Dati di esempio creati.' : 'Il database contiene già dati: nessuna modifica.');
}
````

## FILE: public/index.html

````html
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Blu3 Gestionale</title>
  <link rel="icon" type="image/png" href="/img/logo-blu3.png">
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <div class="shell">
    <aside class="side" id="side">
      <a class="brand" href="#/">
        <span class="logo"><img src="/img/logo-blu3.png" alt="Blu3 Srl"></span>
        <span class="brand-text"><b>Blu3 Srl</b><small>Gestionale interno</small></span>
      </a>
      <nav id="nav">
        <a href="#/" data-nav="dashboard"><i>▦</i>Cruscotto</a>
        <a href="#/commesse" data-nav="commesse"><i>◫</i>Commesse</a>
        <a href="#/documenti" data-nav="documenti"><i>❏</i>Documenti</a>
        <a href="#/clienti" data-nav="clienti"><i>☺</i>Clienti</a>
        <a href="#/fornitori" data-nav="fornitori"><i>⚙</i>Fornitori</a>
      </nav>
      <div class="side-foot">
        <button class="btn light block" data-act="carica-doc">⤒ Carica documento</button>
        <small>Società di Servizi Informatici e Tecnologici<br>Codice NATO AE428 · ISO 9001:2015</small>
      </div>
    </aside>
    <main class="main">
      <header class="top">
        <button class="btn ghost menu-btn" data-act="menu">☰</button>
        <input id="search" type="search" placeholder="Cerca commessa, cliente o documento…" autocomplete="off">
        <div id="search-res" class="search-res" hidden></div>
      </header>
      <div id="view" class="view"></div>
    </main>
  </div>
  <div id="modal-root"></div>
  <div id="toast" class="toast" hidden></div>
  <script type="module" src="/js/app.js"></script>
</body>
</html>
````

## FILE: public/css/app.css

````css
/* Identità visiva Blu3: blu navy del logo (corona d'alloro) + azzurro delle sfere, testo su fondo chiaro */
:root {
  --navy: #1b1f6b; --navy-2: #272d8a; --navy-d: #11144a; --sky: #4f86d6; --sky-l: #e8effb;
  --bg: #f3f5fa; --card: #fff; --line: #dfe3ee; --text: #1c2040; --muted: #6a7092;
  --ok: #1d8a5b; --ok-bg: #e3f5ec; --warn: #b7791f; --warn-bg: #fdf3dd; --bad: #c0392b; --bad-bg: #fbe7e4;
  --radius: 10px; --shadow: 0 1px 3px rgba(20, 25, 80, .08), 0 4px 14px rgba(20, 25, 80, .05);
  font-family: "Century Gothic", "Questrial", "Segoe UI", system-ui, -apple-system, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.45; }
h1, h2, h3 { margin: 0; color: var(--navy); font-weight: 600; }
h1 { font-size: 22px; } h2 { font-size: 16px; } h3 { font-size: 14px; }
a { color: var(--navy-2); text-decoration: none; } a:hover { text-decoration: underline; }
small, .muted { color: var(--muted); }

.shell { display: grid; grid-template-columns: 236px 1fr; min-height: 100vh; }
.side { background: linear-gradient(180deg, var(--navy) 0%, var(--navy-d) 100%); color: #fff; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; }
.brand { display: flex; align-items: center; gap: 12px; padding: 18px 16px; color: #fff; text-decoration: none !important; }
.brand .logo { width: 56px; height: 56px; border-radius: 50%; background: #fff; display: grid; place-items: center; flex: none; overflow: hidden; box-shadow: 0 0 0 3px rgba(255,255,255,.18); }
.brand .logo img { width: 52px; height: 52px; object-fit: contain; mix-blend-mode: multiply; }
.brand-text b { display: block; font-size: 17px; letter-spacing: .3px; } .brand-text small { color: #b9c3f5; font-size: 11px; }
#nav { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
#nav a { color: #d7defc; padding: 10px 12px; border-radius: 8px; display: flex; gap: 10px; align-items: center; text-decoration: none; }
#nav a i { font-style: normal; width: 18px; text-align: center; opacity: .8; }
#nav a:hover { background: rgba(255,255,255,.08); } #nav a.on { background: rgba(255,255,255,.16); color: #fff; font-weight: 600; }
.side-foot { margin-top: auto; padding: 14px; display: grid; gap: 12px; }
.side-foot small { color: #9aa6e6; font-size: 10.5px; line-height: 1.4; }

.main { min-width: 0; }
.top { position: sticky; top: 0; z-index: 20; background: rgba(243,245,250,.92); backdrop-filter: blur(6px); padding: 12px 24px; display: flex; gap: 10px; border-bottom: 1px solid var(--line); }
.top input { flex: 1; max-width: 520px; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: #fff; font: inherit; }
.menu-btn { display: none; }
.search-res { position: absolute; top: 52px; left: 24px; width: min(520px, calc(100vw - 48px)); background: #fff; border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); max-height: 60vh; overflow: auto; }
.search-res a { display: block; padding: 9px 14px; color: var(--text); border-bottom: 1px solid var(--line); } .search-res a:hover { background: var(--sky-l); text-decoration: none; }
.view { padding: 22px 24px 60px; max-width: 1280px; }

.page-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.page-head .grow { flex: 1; min-width: 240px; } .page-head p { margin: 4px 0 0; }
.crumbs { font-size: 12px; margin-bottom: 4px; }

.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; }
.card + .card, .grid + .card, .card + .grid { margin-top: 16px; } .grid > .card { margin-top: 0; }
.card-h { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; } .card-h h2 { flex: 1; }
.grid { display: grid; gap: 14px; } .g2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); } .g3 { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.kpi { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; box-shadow: var(--shadow); border-top: 3px solid var(--navy); }
.kpi .q { font-size: 11.5px; color: var(--muted); }
.kpi .v { font-size: 22px; font-weight: 700; color: var(--navy); margin: 2px 0; white-space: nowrap; }
.kpi .s { font-size: 12px; color: var(--muted); }
.kpi.good { border-top-color: var(--ok); } .kpi.good .v { color: var(--ok); } .kpi.warn { border-top-color: #e0a526; } .kpi.bad { border-top-color: var(--bad); } .kpi.bad .v { color: var(--bad); }
.kpi.sky { border-top-color: var(--sky); }

.btn { font: inherit; border: 1px solid var(--navy); background: var(--navy); color: #fff; border-radius: 8px; padding: 7px 14px; cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--navy-2); } .btn.sec { background: #fff; color: var(--navy); } .btn.sec:hover { background: var(--sky-l); }
.btn.ghost { background: transparent; color: var(--navy); border-color: transparent; } .btn.ghost:hover { background: var(--sky-l); }
.btn.light { background: #fff; color: var(--navy); border-color: #fff; } .btn.light:hover { background: var(--sky-l); }
.btn.danger { background: #fff; color: var(--bad); border-color: #e5b3ad; } .btn.danger:hover { background: var(--bad-bg); }
.btn.sm { padding: 3px 9px; font-size: 12.5px; } .btn.block { width: 100%; } .btn:disabled { opacity: .5; cursor: not-allowed; }

table { border-collapse: collapse; width: 100%; }
th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); font-weight: 600; padding: 8px 10px; border-bottom: 2px solid var(--line); white-space: nowrap; }
td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:hover { background: #fafbfe; } tr.click { cursor: pointer; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tw { overflow-x: auto; }
tfoot td { font-weight: 700; border-top: 2px solid var(--line); border-bottom: 0; }
.empty { text-align: center; padding: 28px; color: var(--muted); }

.badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; background: var(--sky-l); color: var(--navy-2); white-space: nowrap; }
.badge.ok { background: var(--ok-bg); color: var(--ok); } .badge.warn { background: var(--warn-bg); color: var(--warn); } .badge.bad { background: var(--bad-bg); color: var(--bad); } .badge.gray { background: #eceef5; color: var(--muted); }
.chip { display: inline-block; padding: 1px 8px; border: 1px solid var(--line); border-radius: 6px; font-size: 11.5px; margin: 1px 3px 1px 0; background: #fff; color: var(--text); }
.auto { font-size: 10.5px; color: var(--sky); margin-left: 6px; font-weight: 600; }

.tabs { display: flex; gap: 2px; border-bottom: 2px solid var(--line); margin: 6px 0 16px; overflow-x: auto; }
.tabs a { padding: 9px 15px; color: var(--muted); border-bottom: 3px solid transparent; margin-bottom: -2px; white-space: nowrap; text-decoration: none !important; }
.tabs a.on { color: var(--navy); border-color: var(--navy); font-weight: 600; } .tabs a:hover { color: var(--navy); }
.tabs .n { background: var(--sky-l); border-radius: 999px; padding: 0 7px; font-size: 11px; margin-left: 4px; color: var(--navy-2); }

.stepper { display: flex; gap: 0; margin: 4px 0 14px; flex-wrap: wrap; }
.stepper button { flex: 1; min-width: 100px; border: 1px solid var(--line); background: #fff; padding: 7px 8px; font: inherit; font-size: 12px; color: var(--muted); cursor: pointer; }
.stepper button:first-child { border-radius: 8px 0 0 8px; } .stepper button:last-child { border-radius: 0 8px 8px 0; }
.stepper button.done { background: var(--sky-l); color: var(--navy-2); } .stepper button.cur { background: var(--navy); color: #fff; border-color: var(--navy); font-weight: 600; }

label.f { display: block; font-size: 12px; color: var(--muted); margin-bottom: 10px; }
label.f > span { display: block; margin-bottom: 3px; }
input, select, textarea { font: inherit; color: var(--text); width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 7px; background: #fff; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--sky); outline-offset: -1px; border-color: var(--sky); }
input[type=checkbox] { width: auto; } textarea { min-height: 70px; resize: vertical; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 0 14px; } .form-grid .full { grid-column: 1 / -1; }
.chk { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); margin: 6px 0 12px; }
.pa-box { background: var(--sky-l); border: 1px dashed var(--sky); border-radius: 8px; padding: 12px 12px 2px; margin-bottom: 12px; }
.pa-box h3 { margin-bottom: 8px; }

.modal-bg { position: fixed; inset: 0; background: rgba(15, 18, 60, .5); display: flex; justify-content: center; align-items: flex-start; padding: 4vh 12px; overflow: auto; z-index: 50; }
.modal { background: #fff; border-radius: 12px; width: min(720px, 100%); box-shadow: 0 20px 60px rgba(10, 12, 50, .4); }
.modal.wide { width: min(1180px, 100%); } .modal.xl { width: min(1280px, 100%); }
.modal-h { display: flex; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line); background: var(--sky-l); border-radius: 12px 12px 0 0; }
.modal-h h2 { flex: 1; } .modal-b { padding: 18px; } .modal-f { padding: 12px 18px; border-top: 1px solid var(--line); display: flex; gap: 8px; justify-content: flex-end; background: #fafbfe; border-radius: 0 0 12px 12px; }
.x { background: none; border: 0; font-size: 22px; cursor: pointer; color: var(--muted); line-height: 1; }

.toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--navy); color: #fff; padding: 10px 18px; border-radius: 8px; z-index: 99; box-shadow: var(--shadow); }
.toast.err { background: var(--bad); }

.split { display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; } .split iframe, .split .pv { width: 100%; height: 72vh; border: 1px solid var(--line); border-radius: 8px; background: #f7f7fa; }
.pv { overflow: auto; padding: 8px; } .pv img { max-width: 100%; }
.drop { border: 2px dashed var(--sky); border-radius: 12px; padding: 40px 20px; text-align: center; background: var(--sky-l); cursor: pointer; }
.drop.over { background: #d6e4fb; } .drop b { color: var(--navy); font-size: 16px; }

.tl { position: relative; margin: 6px 0 0 14px; padding-left: 26px; border-left: 2px solid var(--line); }
.tl .it { position: relative; padding: 0 0 18px; } .tl .it::before { content: ""; position: absolute; left: -33px; top: 3px; width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 3px solid var(--navy); }
.tl .it.preventivo::before { border-color: var(--sky); } .tl .it.fattura_cliente::before, .tl .it.pagamento::before { border-color: var(--ok); } .tl .it.fattura_fornitore::before, .tl .it.spesa::before { border-color: #e0a526; } .tl .it.nota::before { border-color: #aaa; }
.tl .d { font-weight: 700; color: var(--navy); font-size: 13px; } .tl .t { margin-top: 1px; }

.pill-list { display: flex; flex-wrap: wrap; gap: 6px; }
.alert { padding: 10px 14px; border-radius: 8px; background: var(--warn-bg); color: #7a5410; margin-bottom: 14px; }
.alert.ok { background: var(--ok-bg); color: var(--ok); } .alert.info { background: var(--sky-l); color: var(--navy); }
.kv { display: grid; grid-template-columns: 150px 1fr; gap: 4px 12px; font-size: 13px; } .kv dt { color: var(--muted); } .kv dd { margin: 0; }
details.menu { position: relative; display: inline-block; } details.menu summary { list-style: none; cursor: pointer; } details.menu summary::-webkit-details-marker { display: none; }
details.menu .dd { position: absolute; right: 0; z-index: 10; background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); min-width: 190px; padding: 4px; }
details.menu .dd button { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 7px 10px; font: inherit; cursor: pointer; border-radius: 6px; } details.menu .dd button:hover { background: var(--sky-l); }

/* editor righe preventivo */
.rows input { padding: 5px 7px; } .rows td { padding: 5px 6px; } .rows .w-q { width: 66px; } .rows .w-p { width: 104px; } .rows .w-c { width: 130px; }
.rows .rn td { border-top: 0; padding-top: 0; } .rows .rn input { font-size: 12px; background: #fafbfe; }
.margin-pos { color: var(--ok); } .margin-neg { color: var(--bad); }
.totbar { display: flex; gap: 22px; flex-wrap: wrap; justify-content: flex-end; padding: 12px 6px 0; } .totbar div { text-align: right; } .totbar b { display: block; font-size: 18px; color: var(--navy); }

/* anteprima / stampa preventivo (struttura simile al documento Blu3) */
.paper { background: #fff; width: 794px; max-width: 100%; margin: 0 auto 16px; padding: 38px 52px 30px; color: #1a1f6b; font-size: 12.5px; line-height: 1.5; position: relative; min-height: 1060px; box-shadow: var(--shadow); display: flex; flex-direction: column; }
.paper .ph { display: flex; gap: 18px; align-items: center; margin-bottom: 40px; } .paper .ph img { width: 96px; } .paper .ph p { margin: 0; font-size: 11.5px; }
.paper .dest { margin: 26px 0 26px 50%; } .paper .ogg { font-weight: 700; font-style: italic; margin: 0 0 22px 20px; }
.paper .intro { white-space: pre-line; } .paper .crit { margin-top: 22px; } .paper .crit h4 { margin: 0 0 4px; color: #c0392b; text-decoration: underline; font-style: italic; }
.paper .crit dl { display: grid; grid-template-columns: 160px 1fr; margin: 0; gap: 1px 8px; } .paper .crit dt { font-weight: 700; } .paper .crit dd { margin: 0; }
.paper table th { font-size: 10.5px; color: #1a1f6b; border: 1px solid #1a1f6b; text-align: center; background: #f2f4fb; } .paper table td { border: 1px solid #1a1f6b; padding: 5px 7px; vertical-align: middle; }
.paper .ptot { margin-top: 18px; display: grid; grid-template-columns: 1fr auto; gap: 4px 30px; font-weight: 700; } .paper .ptot span:nth-child(even) { text-align: right; }
.paper .pf { margin-top: auto; padding-top: 18px; text-align: center; font-size: 10.5px; border-top: 1px solid #1a1f6b; } .paper .pf p { margin: 1px 0; }
.paper .rnota { display: block; font-size: 11px; font-style: italic; color: #555; }

@media print {
  body { background: #fff; } .shell, #toast, .modal-bg > .modal > .modal-h, .modal-f { display: none !important; }
  .modal-bg { position: static; background: #fff; padding: 0; } .modal { box-shadow: none; width: 100%; } .modal-b { padding: 0; }
  .paper { box-shadow: none; margin: 0; width: 100%; page-break-after: always; min-height: 0; height: 270mm; } .noprint { display: none !important; }
}

@media (max-width: 860px) {
  .shell { grid-template-columns: 1fr; } .side { position: fixed; z-index: 40; width: 250px; transform: translateX(-100%); transition: transform .2s; } .side.open { transform: none; }
  .menu-btn { display: block; } .view { padding: 16px 14px 60px; } .split { grid-template-columns: 1fr; } .top { padding: 10px 14px; }
}
````

## FILE: public/js/lib.js

````js
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
````

## FILE: public/js/docs.js

````js
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
````

## FILE: public/js/importer.js

````js
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
````

## FILE: public/js/preventivo.js

````js
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
````

## FILE: public/js/app.js

````js
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
````
