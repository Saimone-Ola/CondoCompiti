# CondoCompiti — Gestione dei compiti dello studio

Programma semplice per assegnare i compiti ai collaboratori e ricevere i loro
riscontri. **Tutto resta in locale**: nessun cloud, nessun servizio esterno,
nessuna connessione a internet. Funziona anche completamente offline.

## Guida di avvio in 5 righe

1. Sul computer principale dello studio fai **doppio clic su `Avvia-Windows.bat`** (su Mac: `Avvia-Mac.command`).
2. Si apre una **finestra nera: lasciala aperta**, è il programma in funzione (il browser si apre da solo).
3. Nella finestra nera leggi l'**indirizzo per gli altri computer** (es. `http://192.168.1.25:8420`).
4. Sugli **altri computer, tablet o telefoni** dell'ufficio apri il browser e scrivi quell'indirizzo: non serve installare nulla.
5. Al **primo avvio** l'app ti dà il benvenuto: **crea l'accesso del titolare** (il tuo nome + un PIN a tua scelta). Dalle volte successive si entra **toccando il proprio nome** e scrivendo il proprio PIN.

> Serve solo Python 3 sul computer principale (sul Mac è già presente; su Windows
> si installa una sola volta da python.org, spuntando "Add python.exe to PATH").
> Al primo avvio Windows può chiedere l'autorizzazione per la rete: premi «Consenti accesso».

## Dove sono salvati i dati e come fare il backup

- Tutti i dati (condomìni, collaboratori, compiti, riscontri) sono in **un unico
  file su questo computer**, nella cartella personale dell'utente:
  `CondoCompiti/dati.json` (es. su Windows `C:\Users\TuoNome\CondoCompiti\dati.json`).
  Il percorso esatto è mostrato in **Impostazioni** e nella finestra nera all'avvio.
  Nessun dato esce mai dal computer dello studio.
- **Backup**: entra come titolare, vai in **Impostazioni → Esporta tutti i dati**
  e salva il file scaricato su una chiavetta USB (consigliato una volta a settimana).
  In alternativa basta copiare il file `dati/dati.json`.
- **Ripristino**: Impostazioni → **Importa / ripristina da backup** e scegli il file salvato.
- **Aggiornare il programma senza perdere nulla**: scarica la nuova versione, estrai la
  cartella e avviala come sempre. I dati **non stanno nella cartella del programma**, quindi
  la nuova versione li ritrova automaticamente; la vecchia cartella si può cestinare.
- **Cancellazione** (diritto alla cancellazione): ogni compito, condominio o
  collaboratore ha il suo bottone «Elimina»; per azzerare tutto c'è
  Impostazioni → **Cancella tutti i dati**.

## Primi passi consigliati

1. Al primo avvio crea l'accesso del **titolare** (nome + PIN) e, se vuoi, il nome dello studio.
2. In **Anagrafiche** aggiungi i tuoi **collaboratori** (ognuno con il suo nome e il suo PIN)
   e i tuoi **condomìni**: la Bacheca ti guida con i «Primi passi».
3. Dalla **Bacheca** crea i compiti, anche con i **modelli ricorrenti** (assemblea,
   chiusura esercizio, morosità, incarico tecnico).
4. Ogni scheda compito ha il bottone **🖨 Stampa** per chi preferisce lavorare su carta.
5. In **Impostazioni** trovi backup, ripristino, cancellazione dati e il registro attività.
