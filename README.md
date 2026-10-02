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
