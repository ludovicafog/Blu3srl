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
