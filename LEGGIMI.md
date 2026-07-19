# CondoCompiti — Gestione dei compiti dello studio

Programma semplice per assegnare i compiti ai collaboratori e ricevere i loro
riscontri. **Tutto resta in locale**: nessun cloud, nessun servizio esterno,
nessuna connessione a internet. Funziona anche completamente offline.

## Guida di avvio in 5 righe (Windows, niente da installare)

1. Sul computer principale dello studio scarica **`CondoCompiti.exe`** da
   https://github.com/Saimone-Ola/CondoCompiti/releases/latest e mettilo dove vuoi (es. sul Desktop).
2. **Doppio clic**: si apre una **finestra nera, lasciala aperta** (è il programma) e il browser parte da solo.
   Se Windows mostra l'avviso «PC protetto da Windows»: **Ulteriori informazioni → Esegui comunque**;
   se il firewall chiede l'autorizzazione: **Consenti accesso**.
3. Nella finestra nera leggi l'**indirizzo per gli altri computer** (es. `http://192.168.1.25:8420`).
4. Sugli **altri computer, tablet o telefoni** dell'ufficio apri il browser e scrivi quell'indirizzo: non serve installare nulla.
5. Al **primo avvio** l'app ti dà il benvenuto: **crea l'accesso del titolare** (il tuo nome + un PIN a tua scelta). Dalle volte successive si entra **toccando il proprio nome** e scrivendo il proprio PIN.

> **In alternativa** (Mac, oppure se preferisci non usare l'exe): scarica il codice ZIP,
> estrailo e fai doppio clic su `Avvia-Mac.command` (Mac) o `Avvia-Windows.bat` (Windows;
> richiede Python 3, da installare una sola volta da python.org spuntando
> "Add python.exe to PATH").

## Se dagli altri computer la pagina non si apre

Quasi sempre è il **firewall di Windows sul computer principale**. In ordine:

1. Sul computer principale controlla che la **finestra nera sia aperta** e che lì
   `http://localhost:8420` funzioni: se sì, l'app è a posto.
2. Sull'altro computer scrivi l'indirizzo **esattamente** come mostrato nella
   finestra nera: con `http://` davanti e `:8420` in fondo
   (es. `http://192.168.1.25:8420`), **niente https**. Se la finestra mostra più
   indirizzi, provali tutti.
3. Sul computer principale esegui una volta **`Ripara-Firewall.bat`** con
   clic destro → **Esegui come amministratore** (è nella cartella del programma
   e tra i file scaricabili della Release): autorizza CondoCompiti nel firewall.
4. Controlla che i due computer siano sulla **stessa rete dello studio**
   (stesso router/Wi‑Fi: niente rete "ospiti" e niente hotspot del telefono).
5. In alternativa al punto 3: Impostazioni di Windows → **Rete e Internet** →
   proprietà della rete in uso → imposta **Rete privata**.

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
