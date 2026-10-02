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
