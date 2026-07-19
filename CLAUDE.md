# CondoCompiti — guida per chi aggiorna il codice

Gestionale per uno studio di amministrazione condominiale: il titolare assegna
compiti, i dipendenti danno il riscontro. Utenti finali poco tecnici, abituati
alla carta.

## Vincoli non negoziabili

1. **Tutto in locale (impostazione GDPR)**: nessuna chiamata a internet, nessun
   CDN, nessuna libreria esterna, nessuna telemetria. L'app deve funzionare
   completamente offline. Il frontend ha una CSP `default-src 'self'`.
2. **Zero dipendenze**: il server è solo Python 3 stdlib (`avvia_server.py`,
   unico file); il frontend è HTML/CSS/JS vanilla in `web/`. Non aggiungere
   pacchetti pip/npm.
3. **Interfaccia in italiano**, testo grande, semplice: poche schermate, deve
   funzionare bene anche da telefono e in stampa.
4. **Compatibilità dei dati**: l'archivio è un unico JSON in
   `~/CondoCompiti/dati.json` (posizione vecchia, ancora migrata al volo:
   `./dati/dati.json`). Lo studio ha dati reali: ogni modifica allo schema deve
   continuare a leggere i file esistenti (migrazione in `carica_dati()`, mai
   richiedere azzeramenti).

## Architettura

- `avvia_server.py`: HTTP server (ThreadingHTTPServer) su porta 8420+, API JSON
  sotto `/api/`, file statici da `web/`, sessioni in memoria via cookie
  `cc_sessione`, PIN hash+sale, scrittura atomica del JSON sotto lock.
- `web/app.js`: SPA con stato globale `S`, una funzione `vista*()` per
  schermata (bacheca, compiti, dettaglio, scadenzario con calendario, report,
  anagrafiche, impostazioni), stampa via `#area-stampa` + `@media print`.
- Ruoli: `titolare` vede tutto; `dipendente` riceve dal server SOLO i propri
  compiti. Le viste Report/Anagrafiche/Impostazioni sono del solo titolare.
- Primo avvio senza utenti → schermata di benvenuto (`/api/primo-avvio`).

## Convenzioni

- Codice e identificatori in italiano, come l'esistente.
- Branch di lavoro `claude/*`; `main` è la versione stabile che l'utente
  scarica come ZIP. Si porta su `main` solo su richiesta dell'utente.
- Ogni riga di corpo delle richieste API va sempre letta (vedi
  `_leggi_corpo_grezzo`): evita di rompere il keep-alive.

## Verifica prima di ogni push

1. `python3 -c "import ast; ast.parse(open('avvia_server.py').read())"` e
   `node --check web/app.js`.
2. Avvia `python3 avvia_server.py` e prova i flussi toccati con Playwright
   (Chromium in `/opt/pw-browsers/chromium`): accesso titolare e dipendente,
   riscontro, e le viste modificate, anche a 390px di larghezza.
3. Verifica che non parta nessuna richiesta fuori da `localhost`.
4. Prova sempre con un `dati.json` di una versione precedente per confermare
   la retrocompatibilità.
