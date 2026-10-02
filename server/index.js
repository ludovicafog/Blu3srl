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
