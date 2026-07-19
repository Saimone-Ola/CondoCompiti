#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CondoCompiti — Gestionale compiti per studio di amministrazione condominiale.

Tutto in locale: nessun cloud, nessun servizio esterno, nessuna telemetria.
I dati restano sul disco di questo computer, nel file dati/dati.json.
Richiede solo Python 3 (nessuna libreria da installare).

Avvio:  python3 avvia_server.py            (oppure doppio clic sugli script Avvia-*)
"""

import hashlib
import json
import os
import re
import secrets
import shutil
import socket
import sys
import threading
import time
import webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

CARTELLA = os.path.dirname(os.path.abspath(__file__))
CARTELLA_WEB = os.path.join(CARTELLA, "web")
# I dati vivono nella cartella personale dell'utente, NON in quella del programma:
# così si può aggiornare l'app sostituendo la cartella e i dati vengono ritrovati.
CARTELLA_DATI = os.path.join(os.path.expanduser("~"), "CondoCompiti")
FILE_DATI = os.path.join(CARTELLA_DATI, "dati.json")
# Posizione usata dalle prime versioni (dentro la cartella del programma).
FILE_DATI_VECCHIO = os.path.join(CARTELLA, "dati", "dati.json")
PORTA_BASE = 8420
DURATA_SESSIONE = 12 * 3600  # secondi
MAX_RIGHE_REGISTRO = 500

STATI = ["Da iniziare", "In corso", "In attesa", "Completato", "Archiviato"]
PRIORITA = ["Bassa", "Media", "Alta", "Urgente"]
CATEGORIE = ["Assemblea", "Contabilità/Rate", "Manutenzione", "Comunicazioni",
             "Adempimenti/Pratiche", "Legale", "Altro"]
ESITI = ["Completato regolarmente", "Completato con osservazioni", "Non completato"]

MODELLI = {
    "assemblea": {
        "nome": "Preparazione assemblea",
        "descrizione": "Dalla convocazione al verbale: tutti i passaggi per preparare un'assemblea.",
        "etichetta_data": "Data dell'assemblea",
        "compiti": [
            {"titolo": "Predisporre ordine del giorno e documenti", "categoria": "Assemblea",
             "priorita": "Alta", "giorni": -21,
             "istruzioni": "Preparare l'ordine del giorno con i punti da deliberare e raccogliere i documenti da allegare alla convocazione."},
            {"titolo": "Inviare le convocazioni ai condòmini", "categoria": "Comunicazioni",
             "priorita": "Alta", "giorni": -15,
             "istruzioni": "Inviare la convocazione a tutti i condòmini (raccomandata, PEC o consegna a mano) nel rispetto dei termini di legge."},
            {"titolo": "Preparare situazione contabile e riparti", "categoria": "Contabilità/Rate",
             "priorita": "Media", "giorni": -7,
             "istruzioni": "Predisporre i prospetti contabili e i riparti da presentare in assemblea."},
            {"titolo": "Predisporre sala, deleghe e foglio presenze", "categoria": "Assemblea",
             "priorita": "Media", "giorni": -1,
             "istruzioni": "Verificare la disponibilità della sala, stampare il foglio presenze e i moduli per le deleghe."},
            {"titolo": "Redigere e inviare il verbale", "categoria": "Assemblea",
             "priorita": "Alta", "giorni": 7,
             "istruzioni": "Redigere il verbale dell'assemblea e inviarlo a tutti i condòmini."},
        ],
    },
    "chiusura": {
        "nome": "Chiusura esercizio",
        "descrizione": "Consuntivo, preventivo e assemblea di approvazione a fine esercizio.",
        "etichetta_data": "Data di chiusura dell'esercizio",
        "compiti": [
            {"titolo": "Raccogliere fatture e giustificativi", "categoria": "Contabilità/Rate",
             "priorita": "Media", "giorni": 7,
             "istruzioni": "Raccogliere tutte le fatture e i giustificativi di spesa dell'esercizio chiuso e verificare che non manchi nulla."},
            {"titolo": "Verificare quote e situazione morosità", "categoria": "Contabilità/Rate",
             "priorita": "Alta", "giorni": 15,
             "istruzioni": "Controllare i versamenti dei condòmini e predisporre l'elenco delle posizioni non in regola."},
            {"titolo": "Redigere consuntivo e riparto", "categoria": "Contabilità/Rate",
             "priorita": "Alta", "giorni": 20,
             "istruzioni": "Redigere il rendiconto consuntivo con il riparto delle spese tra i condòmini."},
            {"titolo": "Predisporre preventivo del nuovo esercizio", "categoria": "Contabilità/Rate",
             "priorita": "Media", "giorni": 25,
             "istruzioni": "Preparare il bilancio preventivo del nuovo esercizio con il relativo piano di riparto."},
            {"titolo": "Convocare l'assemblea di approvazione", "categoria": "Assemblea",
             "priorita": "Alta", "giorni": 30,
             "istruzioni": "Fissare la data e inviare la convocazione dell'assemblea per l'approvazione di consuntivo e preventivo."},
        ],
    },
    "morosita": {
        "nome": "Gestione morosità",
        "descrizione": "Dal sollecito bonario all'eventuale pratica legale.",
        "etichetta_data": "Data di avvio della pratica",
        "compiti": [
            {"titolo": "Verificare le posizioni e conteggiare gli arretrati", "categoria": "Contabilità/Rate",
             "priorita": "Alta", "giorni": 3,
             "istruzioni": "Controllare gli estratti conto dei condòmini in ritardo e predisporre il conteggio aggiornato degli arretrati."},
            {"titolo": "Inviare il sollecito bonario", "categoria": "Comunicazioni",
             "priorita": "Alta", "giorni": 7,
             "istruzioni": "Inviare ai condòmini morosi un sollecito bonario con il dettaglio delle somme dovute."},
            {"titolo": "Inviare sollecito formale / messa in mora", "categoria": "Legale",
             "priorita": "Alta", "giorni": 21,
             "istruzioni": "Se il pagamento non è arrivato, inviare la messa in mora a mezzo raccomandata o PEC."},
            {"titolo": "Valutare la pratica con il legale", "categoria": "Legale",
             "priorita": "Media", "giorni": 35,
             "istruzioni": "Trasmettere la documentazione al legale per la valutazione del decreto ingiuntivo."},
        ],
    },
    "incarico": {
        "nome": "Affidamento incarico tecnico",
        "descrizione": "Dai preventivi alla verifica dei lavori affidati a una ditta o a un tecnico.",
        "etichetta_data": "Data di avvio della pratica",
        "compiti": [
            {"titolo": "Definire l'intervento e fare il sopralluogo", "categoria": "Manutenzione",
             "priorita": "Media", "giorni": 5,
             "istruzioni": "Definire con precisione l'intervento necessario ed effettuare un sopralluogo, con foto se utile."},
            {"titolo": "Richiedere i preventivi (almeno 3)", "categoria": "Manutenzione",
             "priorita": "Alta", "giorni": 12,
             "istruzioni": "Richiedere almeno tre preventivi comparabili a ditte o tecnici qualificati."},
            {"titolo": "Comparare i preventivi e preparare la proposta", "categoria": "Manutenzione",
             "priorita": "Media", "giorni": 20,
             "istruzioni": "Predisporre un prospetto di confronto dei preventivi con la proposta da sottoporre al condominio."},
            {"titolo": "Comunicare l'esito e affidare l'incarico", "categoria": "Comunicazioni",
             "priorita": "Media", "giorni": 27,
             "istruzioni": "Comunicare l'esito della scelta e formalizzare l'incarico alla ditta o al tecnico selezionato."},
            {"titolo": "Verificare l'esecuzione dei lavori", "categoria": "Manutenzione",
             "priorita": "Media", "giorni": 45,
             "istruzioni": "Controllare l'andamento e la corretta esecuzione dei lavori, segnalando eventuali problemi."},
        ],
    },
}

LUCCHETTO = threading.Lock()
DATI = None          # caricati in memoria all'avvio, salvati a ogni modifica
SESSIONI = {}        # token -> {"utente_id", "scade"}


# ----------------------------------------------------------------------------
# Archivio dati (file JSON locale)
# ----------------------------------------------------------------------------

def hash_pin(pin, sale):
    return hashlib.sha256((sale + pin).encode("utf-8")).hexdigest()


def nuovo_utente(id_, nome, ruolo, pin, attivo=True):
    sale = secrets.token_hex(8)
    return {"id": id_, "nome": nome, "ruolo": ruolo, "attivo": attivo,
            "sale": sale, "pin": hash_pin(pin, sale)}


def struttura_vuota():
    return {
        "versione": 1,
        "impostazioni": {"nome_studio": "Studio di Amministrazione Condominiale",
                         "registro_attivo": True},
        "contatori": {"utente": 0, "condominio": 0, "compito": 0},
        "utenti": [],
        "condomini": [],
        "compiti": [],
        "registro": [],
    }


def salva_dati():
    """Scrittura atomica: prima su file temporaneo, poi sostituzione."""
    os.makedirs(CARTELLA_DATI, exist_ok=True)
    provvisorio = FILE_DATI + ".tmp"
    with open(provvisorio, "w", encoding="utf-8") as f:
        json.dump(DATI, f, ensure_ascii=False, indent=1)
    os.replace(provvisorio, FILE_DATI)


def carica_dati():
    global DATI
    if not os.path.exists(FILE_DATI) and os.path.exists(FILE_DATI_VECCHIO):
        # Migrazione dalle prime versioni, che salvavano dentro la cartella
        # del programma: l'originale resta dov'è come copia di sicurezza.
        os.makedirs(CARTELLA_DATI, exist_ok=True)
        shutil.copy2(FILE_DATI_VECCHIO, FILE_DATI)
    if os.path.exists(FILE_DATI):
        with open(FILE_DATI, "r", encoding="utf-8") as f:
            DATI = json.load(f)
    else:
        # Primo avvio: archivio vuoto. Il titolare crea il proprio utente
        # dalla schermata di benvenuto dell'app.
        DATI = struttura_vuota()
        salva_dati()


def registra(chi, azione):
    if DATI["impostazioni"].get("registro_attivo", True):
        DATI["registro"].insert(0, {"quando": datetime.now().isoformat(timespec="minutes"),
                                    "chi": chi, "azione": azione})
        del DATI["registro"][MAX_RIGHE_REGISTRO:]


def prossimo_id(tipo):
    DATI["contatori"][tipo] = DATI["contatori"].get(tipo, 0) + 1
    return DATI["contatori"][tipo]


def trova(elenco, id_):
    for elemento in elenco:
        if elemento["id"] == id_:
            return elemento
    return None


def utente_pubblico(u):
    return {"id": u["id"], "nome": u["nome"], "ruolo": u["ruolo"], "attivo": u["attivo"]}


def tocca_compito(compito, utente):
    compito["modificato_il"] = datetime.now().isoformat(timespec="minutes")
    compito["modificato_da"] = utente["nome"]


def pin_valido(pin):
    return bool(re.fullmatch(r"\d{4,8}", pin or ""))


# ----------------------------------------------------------------------------
# Rete locale
# ----------------------------------------------------------------------------

def indirizzi_lan():
    """Indirizzi IP di questo computer sulla rete locale (nessun dato viene inviato)."""
    ips = set()
    for sonda in ("192.168.255.255", "10.255.255.255"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((sonda, 1))  # su UDP connect() non trasmette nulla
            ips.add(s.getsockname()[0])
            s.close()
        except OSError:
            pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


# ----------------------------------------------------------------------------
# Server HTTP
# ----------------------------------------------------------------------------

class ErroreApi(Exception):
    def __init__(self, codice, messaggio):
        self.codice = codice
        self.messaggio = messaggio


class Gestore(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CondoCompiti"
    porta = PORTA_BASE

    def log_message(self, formato, *argomenti):  # console pulita
        pass

    # --- risposte -----------------------------------------------------------

    def _intestazioni_comuni(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")

    def rispondi_json(self, dati, codice=200, cookie=None):
        corpo = json.dumps(dati, ensure_ascii=False).encode("utf-8")
        self.send_response(codice)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self._intestazioni_comuni()
        self.end_headers()
        self.wfile.write(corpo)

    def rispondi_file(self, percorso):
        tipi = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
                ".png": "image/png", ".ico": "image/x-icon"}
        estensione = os.path.splitext(percorso)[1].lower()
        with open(percorso, "rb") as f:
            corpo = f.read()
        self.send_response(200)
        self.send_header("Content-Type", tipi.get(estensione, "application/octet-stream"))
        self.send_header("Content-Length", str(len(corpo)))
        if estensione == ".html":
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; style-src 'self' 'unsafe-inline'; "
                             "img-src 'self' data:; connect-src 'self'")
        self._intestazioni_comuni()
        self.end_headers()
        self.wfile.write(corpo)

    def _leggi_corpo_grezzo(self):
        # Va sempre letto tutto il corpo, anche se il gestore non lo usa:
        # byte non letti romperebbero la richiesta successiva sulla stessa connessione.
        lunghezza = int(self.headers.get("Content-Length") or 0)
        if lunghezza > 20 * 1024 * 1024:
            self.close_connection = True
            raise ErroreApi(413, "File troppo grande.")
        self.corpo_grezzo = self.rfile.read(lunghezza) if lunghezza else b""

    def leggi_corpo(self):
        if not getattr(self, "corpo_grezzo", b""):
            return {}
        try:
            return json.loads(self.corpo_grezzo.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ErroreApi(400, "Dati non validi.")

    # --- sessioni -----------------------------------------------------------

    def utente_corrente(self):
        cookie = self.headers.get("Cookie") or ""
        token = None
        for pezzo in cookie.split(";"):
            nome, _, valore = pezzo.strip().partition("=")
            if nome == "cc_sessione":
                token = valore
        sessione = SESSIONI.get(token)
        if not sessione or sessione["scade"] < time.time():
            SESSIONI.pop(token, None)
            return None
        sessione["scade"] = time.time() + DURATA_SESSIONE
        utente = trova(DATI["utenti"], sessione["utente_id"])
        if not utente or not utente["attivo"]:
            return None
        return utente

    def richiedi_accesso(self, ruolo=None):
        utente = self.utente_corrente()
        if not utente:
            raise ErroreApi(401, "Accesso scaduto: entra di nuovo con il tuo nome e PIN.")
        if ruolo and utente["ruolo"] != ruolo:
            raise ErroreApi(403, "Operazione riservata al titolare.")
        return utente

    # --- instradamento ------------------------------------------------------

    def do_GET(self):
        self.gestisci("GET")

    def do_POST(self):
        self.gestisci("POST")

    def do_PUT(self):
        self.gestisci("PUT")

    def do_DELETE(self):
        self.gestisci("DELETE")

    def gestisci(self, metodo):
        percorso = unquote(self.path.split("?", 1)[0])
        try:
            if percorso.startswith("/api/"):
                self._leggi_corpo_grezzo()
                with LUCCHETTO:
                    self.gestisci_api(metodo, percorso)
            elif metodo == "GET":
                self.gestisci_statico(percorso)
            else:
                raise ErroreApi(404, "Pagina non trovata.")
        except ErroreApi as errore:
            self.rispondi_json({"errore": errore.messaggio}, errore.codice)
        except BrokenPipeError:
            pass
        except Exception:
            self.rispondi_json({"errore": "Errore interno del programma."}, 500)

    def gestisci_statico(self, percorso):
        if percorso == "/":
            percorso = "/index.html"
        completo = os.path.normpath(os.path.join(CARTELLA_WEB, percorso.lstrip("/")))
        if not completo.startswith(CARTELLA_WEB) or not os.path.isfile(completo):
            raise ErroreApi(404, "Pagina non trovata.")
        self.rispondi_file(completo)

    def gestisci_api(self, metodo, percorso):
        pezzi = percorso.strip("/").split("/")[1:]  # senza "api"
        rotta = (metodo, pezzi[0] if pezzi else "")

        if rotta == ("GET", "utenti-accesso"):
            return self.api_utenti_accesso()
        if rotta == ("POST", "primo-avvio"):
            return self.api_primo_avvio()
        if rotta == ("POST", "accesso"):
            return self.api_accesso()
        if rotta == ("POST", "uscita"):
            return self.api_uscita()
        if rotta == ("GET", "dati"):
            return self.api_dati()
        if pezzi[0] == "compiti":
            return self.api_compiti(metodo, pezzi)
        if pezzi[0] == "condomini":
            return self.api_condomini(metodo, pezzi)
        if pezzi[0] == "utenti":
            return self.api_utenti(metodo, pezzi)
        if rotta == ("POST", "modelli") and len(pezzi) == 2:
            return self.api_modello(pezzi[1])
        if rotta == ("GET", "esporta"):
            return self.api_esporta()
        if rotta == ("POST", "importa"):
            return self.api_importa()
        if rotta == ("POST", "azzera"):
            return self.api_azzera()
        if rotta == ("PUT", "impostazioni"):
            return self.api_impostazioni()
        if rotta == ("POST", "registro-azzera"):
            return self.api_registro_azzera()
        raise ErroreApi(404, "Funzione non trovata.")

    # --- accesso ------------------------------------------------------------

    def api_utenti_accesso(self):
        elenco = [utente_pubblico(u) for u in DATI["utenti"] if u["attivo"]]
        self.rispondi_json({"utenti": elenco,
                            "nome_studio": DATI["impostazioni"]["nome_studio"],
                            "primo_avvio": not DATI["utenti"]})

    def api_primo_avvio(self):
        """Prima configurazione: crea l'utente titolare quando non esiste nessuno."""
        if DATI["utenti"]:
            raise ErroreApi(403, "La configurazione iniziale è già stata fatta.")
        corpo = self.leggi_corpo()
        nome = (corpo.get("nome") or "").strip()
        pin = str(corpo.get("pin") or "")
        if not nome:
            raise ErroreApi(400, "Scrivi il tuo nome.")
        if not pin_valido(pin):
            raise ErroreApi(400, "Il PIN deve essere di 4-8 cifre.")
        nome_studio = (corpo.get("nome_studio") or "").strip()
        if nome_studio:
            DATI["impostazioni"]["nome_studio"] = nome_studio
        titolare = nuovo_utente(prossimo_id("utente"), nome, "titolare", pin)
        DATI["utenti"].append(titolare)
        registra(nome, "Prima configurazione: creato l'utente titolare")
        salva_dati()
        token = secrets.token_hex(24)
        SESSIONI[token] = {"utente_id": titolare["id"], "scade": time.time() + DURATA_SESSIONE}
        cookie = "cc_sessione=%s; Path=/; HttpOnly; SameSite=Lax" % token
        self.rispondi_json({"utente": utente_pubblico(titolare)}, cookie=cookie)

    def api_accesso(self):
        corpo = self.leggi_corpo()
        utente = trova(DATI["utenti"], corpo.get("utente_id"))
        pin = str(corpo.get("pin") or "")
        if not utente or not utente["attivo"] or hash_pin(pin, utente["sale"]) != utente["pin"]:
            time.sleep(0.5)  # rallenta i tentativi ripetuti
            raise ErroreApi(401, "PIN non corretto. Riprova.")
        token = secrets.token_hex(24)
        SESSIONI[token] = {"utente_id": utente["id"], "scade": time.time() + DURATA_SESSIONE}
        cookie = "cc_sessione=%s; Path=/; HttpOnly; SameSite=Lax" % token
        self.rispondi_json({"utente": utente_pubblico(utente)}, cookie=cookie)

    def api_uscita(self):
        cookie = self.headers.get("Cookie") or ""
        for pezzo in cookie.split(";"):
            nome, _, valore = pezzo.strip().partition("=")
            if nome == "cc_sessione":
                SESSIONI.pop(valore, None)
        self.rispondi_json({"fatto": True},
                           cookie="cc_sessione=; Path=/; Max-Age=0")

    def api_dati(self):
        utente = self.richiedi_accesso()
        capo = utente["ruolo"] == "titolare"
        compiti = DATI["compiti"] if capo else \
            [c for c in DATI["compiti"] if c["assegnato_a"] == utente["id"]]
        risposta = {
            "utente": utente_pubblico(utente),
            "utenti": [utente_pubblico(u) for u in DATI["utenti"]],
            "condomini": DATI["condomini"],
            "compiti": compiti,
            "impostazioni": DATI["impostazioni"],
        }
        if capo:
            risposta["modelli"] = {chiave: {"nome": m["nome"], "descrizione": m["descrizione"],
                                            "etichetta_data": m["etichetta_data"],
                                            "n_compiti": len(m["compiti"])}
                                   for chiave, m in MODELLI.items()}
            risposta["registro"] = DATI["registro"][:100]
            risposta["rete"] = ["http://%s:%d" % (ip, self.porta) for ip in indirizzi_lan()]
            risposta["percorso_dati"] = FILE_DATI
        self.rispondi_json(risposta)

    # --- compiti ------------------------------------------------------------

    def api_compiti(self, metodo, pezzi):
        if metodo == "POST" and len(pezzi) == 1:
            return self.compito_crea()
        if len(pezzi) < 2 or not pezzi[1].isdigit():
            raise ErroreApi(404, "Compito non trovato.")
        compito = trova(DATI["compiti"], int(pezzi[1]))
        if not compito:
            raise ErroreApi(404, "Compito non trovato.")
        azione = pezzi[2] if len(pezzi) > 2 else ""
        if metodo == "PUT" and not azione:
            return self.compito_modifica(compito)
        if metodo == "DELETE" and not azione:
            return self.compito_elimina(compito)
        if metodo == "POST" and azione == "riscontro":
            return self.compito_riscontro(compito)
        if metodo == "POST" and azione == "nota":
            return self.compito_nota(compito)
        if metodo == "POST" and azione == "visto":
            return self.compito_visto(compito)
        raise ErroreApi(404, "Funzione non trovata.")

    def _controlla_campi_compito(self, corpo):
        titolo = (corpo.get("titolo") or "").strip()
        if not titolo:
            raise ErroreApi(400, "Il titolo del compito è obbligatorio.")
        if not trova(DATI["condomini"], corpo.get("condominio_id")):
            raise ErroreApi(400, "Scegli il condominio.")
        assegnato = trova(DATI["utenti"], corpo.get("assegnato_a"))
        if not assegnato or not assegnato["attivo"]:
            raise ErroreApi(400, "Scegli il collaboratore a cui assegnare il compito.")
        if corpo.get("categoria") not in CATEGORIE:
            raise ErroreApi(400, "Categoria non valida.")
        if corpo.get("priorita") not in PRIORITA:
            raise ErroreApi(400, "Priorità non valida.")

    def compito_crea(self):
        utente = self.richiedi_accesso("titolare")
        corpo = self.leggi_corpo()
        self._controlla_campi_compito(corpo)
        adesso = datetime.now().isoformat(timespec="minutes")
        compito = {
            "id": prossimo_id("compito"),
            "titolo": corpo["titolo"].strip(),
            "condominio_id": corpo["condominio_id"],
            "categoria": corpo["categoria"],
            "istruzioni": (corpo.get("istruzioni") or "").strip(),
            "assegnato_a": corpo["assegnato_a"],
            "assegnato_da": utente["id"],
            "data_assegnazione": date.today().isoformat(),
            "scadenza": corpo.get("scadenza") or None,
            "priorita": corpo["priorita"],
            "stato": "Da iniziare",
            "esito": "", "nota_ritorno": "", "data_completamento": None,
            "riscontri": [], "da_vedere": False, "nota_da_leggere": False,
            "creato_il": adesso, "modificato_il": adesso, "modificato_da": utente["nome"],
        }
        DATI["compiti"].append(compito)
        registra(utente["nome"], "Creato il compito «%s»" % compito["titolo"])
        salva_dati()
        self.rispondi_json({"compito": compito})

    def compito_modifica(self, compito):
        utente = self.richiedi_accesso()
        corpo = self.leggi_corpo()
        capo = utente["ruolo"] == "titolare"
        if not capo and compito["assegnato_a"] != utente["id"]:
            raise ErroreApi(403, "Questo compito non è assegnato a te.")

        if capo:
            self._controlla_campi_compito({**compito, **corpo})
            for campo in ("titolo", "condominio_id", "categoria", "istruzioni",
                          "assegnato_a", "scadenza", "priorita"):
                if campo in corpo:
                    valore = corpo[campo]
                    compito[campo] = valore.strip() if isinstance(valore, str) else valore
        campi_stato = ("stato", "esito") if capo else ("stato", "esito")
        for campo in campi_stato:
            if campo in corpo:
                if campo == "stato" and corpo["stato"] not in STATI:
                    raise ErroreApi(400, "Stato non valido.")
                if campo == "esito" and corpo["esito"] not in ESITI + [""]:
                    raise ErroreApi(400, "Esito non valido.")
                if campo == "stato" and not capo and corpo["stato"] == "Archiviato":
                    raise ErroreApi(403, "Solo il titolare può archiviare un compito.")
                compito[campo] = corpo[campo]

        if compito["stato"] in ("Completato", "Archiviato"):
            compito["data_completamento"] = compito["data_completamento"] or date.today().isoformat()
        else:
            compito["data_completamento"] = None
            compito["esito"] = ""
        if not capo and corpo.get("stato") == "Completato":
            compito["da_vedere"] = True
        tocca_compito(compito, utente)
        registra(utente["nome"], "Modificato il compito «%s»" % compito["titolo"])
        salva_dati()
        self.rispondi_json({"compito": compito})

    def compito_riscontro(self, compito):
        utente = self.richiedi_accesso()
        capo = utente["ruolo"] == "titolare"
        if not capo and compito["assegnato_a"] != utente["id"]:
            raise ErroreApi(403, "Questo compito non è assegnato a te.")
        corpo = self.leggi_corpo()
        testo = (corpo.get("testo") or "").strip()
        stato = corpo.get("stato")
        esito = corpo.get("esito")
        if not testo and not stato:
            raise ErroreApi(400, "Scrivi il riscontro oppure aggiorna lo stato.")
        if stato:
            if stato not in STATI:
                raise ErroreApi(400, "Stato non valido.")
            if stato == "Archiviato" and not capo:
                raise ErroreApi(403, "Solo il titolare può archiviare un compito.")
            compito["stato"] = stato
        if compito["stato"] in ("Completato", "Archiviato"):
            if esito in ESITI:
                compito["esito"] = esito
            compito["data_completamento"] = compito["data_completamento"] or date.today().isoformat()
        else:
            compito["data_completamento"] = None
            compito["esito"] = ""
        if testo:
            compito["riscontri"].append({
                "quando": datetime.now().isoformat(timespec="minutes"),
                "autore": utente["nome"],
                "problema": bool(corpo.get("problema")),
                "testo": testo,
            })
        if not capo:
            compito["da_vedere"] = True
        tocca_compito(compito, utente)
        dettaglio = " (completato)" if compito["stato"] == "Completato" else ""
        registra(utente["nome"], "Riscontro sul compito «%s»%s" % (compito["titolo"], dettaglio))
        salva_dati()
        self.rispondi_json({"compito": compito})

    def compito_nota(self, compito):
        utente = self.richiedi_accesso("titolare")
        corpo = self.leggi_corpo()
        compito["nota_ritorno"] = (corpo.get("testo") or "").strip()
        compito["nota_da_leggere"] = bool(compito["nota_ritorno"])
        tocca_compito(compito, utente)
        registra(utente["nome"], "Nota di ritorno sul compito «%s»" % compito["titolo"])
        salva_dati()
        self.rispondi_json({"compito": compito})

    def compito_visto(self, compito):
        utente = self.richiedi_accesso()
        if utente["ruolo"] == "titolare":
            compito["da_vedere"] = False
        elif compito["assegnato_a"] == utente["id"]:
            compito["nota_da_leggere"] = False
        salva_dati()
        self.rispondi_json({"compito": compito})

    def compito_elimina(self, compito):
        utente = self.richiedi_accesso("titolare")
        DATI["compiti"].remove(compito)
        registra(utente["nome"], "Eliminato il compito «%s»" % compito["titolo"])
        salva_dati()
        self.rispondi_json({"fatto": True})

    # --- modelli ricorrenti -------------------------------------------------

    def api_modello(self, chiave):
        utente = self.richiedi_accesso("titolare")
        modello = MODELLI.get(chiave)
        if not modello:
            raise ErroreApi(404, "Modello non trovato.")
        corpo = self.leggi_corpo()
        condominio = trova(DATI["condomini"], corpo.get("condominio_id"))
        assegnato = trova(DATI["utenti"], corpo.get("assegnato_a"))
        if not condominio:
            raise ErroreApi(400, "Scegli il condominio.")
        if not assegnato or not assegnato["attivo"]:
            raise ErroreApi(400, "Scegli il collaboratore.")
        try:
            base = date.fromisoformat(corpo.get("data_base") or "")
        except ValueError:
            raise ErroreApi(400, "Indica la data di riferimento.")
        adesso = datetime.now().isoformat(timespec="minutes")
        creati = []
        for voce in modello["compiti"]:
            compito = {
                "id": prossimo_id("compito"),
                "titolo": voce["titolo"],
                "condominio_id": condominio["id"],
                "categoria": voce["categoria"],
                "istruzioni": voce["istruzioni"],
                "assegnato_a": assegnato["id"],
                "assegnato_da": utente["id"],
                "data_assegnazione": date.today().isoformat(),
                "scadenza": (base + timedelta(days=voce["giorni"])).isoformat(),
                "priorita": voce["priorita"],
                "stato": "Da iniziare",
                "esito": "", "nota_ritorno": "", "data_completamento": None,
                "riscontri": [], "da_vedere": False, "nota_da_leggere": False,
                "creato_il": adesso, "modificato_il": adesso, "modificato_da": utente["nome"],
            }
            DATI["compiti"].append(compito)
            creati.append(compito)
        registra(utente["nome"], "Generati %d compiti dal modello «%s» per %s"
                 % (len(creati), modello["nome"], condominio["nome"]))
        salva_dati()
        self.rispondi_json({"creati": len(creati)})

    # --- anagrafiche --------------------------------------------------------

    def api_condomini(self, metodo, pezzi):
        utente = self.richiedi_accesso("titolare")
        if metodo == "POST" and len(pezzi) == 1:
            corpo = self.leggi_corpo()
            nome = (corpo.get("nome") or "").strip()
            if not nome:
                raise ErroreApi(400, "Il nome del condominio è obbligatorio.")
            condominio = {"id": prossimo_id("condominio"), "nome": nome,
                          "indirizzo": (corpo.get("indirizzo") or "").strip()}
            DATI["condomini"].append(condominio)
            registra(utente["nome"], "Aggiunto il condominio «%s»" % nome)
            salva_dati()
            return self.rispondi_json({"condominio": condominio})
        if len(pezzi) < 2 or not pezzi[1].isdigit():
            raise ErroreApi(404, "Condominio non trovato.")
        condominio = trova(DATI["condomini"], int(pezzi[1]))
        if not condominio:
            raise ErroreApi(404, "Condominio non trovato.")
        if metodo == "PUT":
            corpo = self.leggi_corpo()
            nome = (corpo.get("nome") or "").strip()
            if not nome:
                raise ErroreApi(400, "Il nome del condominio è obbligatorio.")
            condominio["nome"] = nome
            condominio["indirizzo"] = (corpo.get("indirizzo") or "").strip()
            registra(utente["nome"], "Modificato il condominio «%s»" % nome)
            salva_dati()
            return self.rispondi_json({"condominio": condominio})
        if metodo == "DELETE":
            collegati = [c for c in DATI["compiti"] if c["condominio_id"] == condominio["id"]]
            for compito in collegati:
                DATI["compiti"].remove(compito)
            DATI["condomini"].remove(condominio)
            registra(utente["nome"], "Eliminato il condominio «%s» e %d compiti collegati"
                     % (condominio["nome"], len(collegati)))
            salva_dati()
            return self.rispondi_json({"fatto": True, "compiti_eliminati": len(collegati)})
        raise ErroreApi(404, "Funzione non trovata.")

    def api_utenti(self, metodo, pezzi):
        utente = self.richiedi_accesso()
        capo = utente["ruolo"] == "titolare"

        # Cambio del proprio PIN: consentito a tutti.
        if metodo == "POST" and len(pezzi) == 2 and pezzi[1] == "mio-pin":
            corpo = self.leggi_corpo()
            nuovo = str(corpo.get("pin") or "")
            if not pin_valido(nuovo):
                raise ErroreApi(400, "Il PIN deve essere di 4-8 cifre.")
            io = trova(DATI["utenti"], utente["id"])
            io["sale"] = secrets.token_hex(8)
            io["pin"] = hash_pin(nuovo, io["sale"])
            registra(utente["nome"], "Ha cambiato il proprio PIN")
            salva_dati()
            return self.rispondi_json({"fatto": True})

        if not capo:
            raise ErroreApi(403, "Operazione riservata al titolare.")

        if metodo == "POST" and len(pezzi) == 1:
            corpo = self.leggi_corpo()
            nome = (corpo.get("nome") or "").strip()
            ruolo = corpo.get("ruolo")
            pin = str(corpo.get("pin") or "")
            if not nome:
                raise ErroreApi(400, "Il nome è obbligatorio.")
            if ruolo not in ("titolare", "dipendente"):
                raise ErroreApi(400, "Ruolo non valido.")
            if not pin_valido(pin):
                raise ErroreApi(400, "Il PIN deve essere di 4-8 cifre.")
            nuovo = nuovo_utente(prossimo_id("utente"), nome, ruolo, pin)
            DATI["utenti"].append(nuovo)
            registra(utente["nome"], "Aggiunto il collaboratore «%s»" % nome)
            salva_dati()
            return self.rispondi_json({"utente": utente_pubblico(nuovo)})

        if len(pezzi) < 2 or not pezzi[1].isdigit():
            raise ErroreApi(404, "Collaboratore non trovato.")
        soggetto = trova(DATI["utenti"], int(pezzi[1]))
        if not soggetto:
            raise ErroreApi(404, "Collaboratore non trovato.")

        def altri_titolari():
            return [u for u in DATI["utenti"]
                    if u["ruolo"] == "titolare" and u["attivo"] and u["id"] != soggetto["id"]]

        if metodo == "PUT":
            corpo = self.leggi_corpo()
            if "nome" in corpo:
                nome = (corpo.get("nome") or "").strip()
                if not nome:
                    raise ErroreApi(400, "Il nome è obbligatorio.")
                soggetto["nome"] = nome
            if "ruolo" in corpo:
                if corpo["ruolo"] not in ("titolare", "dipendente"):
                    raise ErroreApi(400, "Ruolo non valido.")
                if corpo["ruolo"] == "dipendente" and soggetto["ruolo"] == "titolare" \
                        and not altri_titolari():
                    raise ErroreApi(400, "Deve restare almeno un titolare.")
                soggetto["ruolo"] = corpo["ruolo"]
            if "attivo" in corpo:
                if not corpo["attivo"] and soggetto["ruolo"] == "titolare" and not altri_titolari():
                    raise ErroreApi(400, "Deve restare almeno un titolare attivo.")
                soggetto["attivo"] = bool(corpo["attivo"])
            if corpo.get("pin"):
                pin = str(corpo["pin"])
                if not pin_valido(pin):
                    raise ErroreApi(400, "Il PIN deve essere di 4-8 cifre.")
                soggetto["sale"] = secrets.token_hex(8)
                soggetto["pin"] = hash_pin(pin, soggetto["sale"])
            registra(utente["nome"], "Modificato il collaboratore «%s»" % soggetto["nome"])
            salva_dati()
            return self.rispondi_json({"utente": utente_pubblico(soggetto)})

        if metodo == "DELETE":
            if soggetto["id"] == utente["id"]:
                raise ErroreApi(400, "Non puoi eliminare il tuo stesso utente.")
            if soggetto["ruolo"] == "titolare" and not altri_titolari():
                raise ErroreApi(400, "Deve restare almeno un titolare.")
            for compito in DATI["compiti"]:
                if compito["assegnato_a"] == soggetto["id"]:
                    compito["assegnato_a"] = None
            DATI["utenti"].remove(soggetto)
            for token in [t for t, s in SESSIONI.items() if s["utente_id"] == soggetto["id"]]:
                SESSIONI.pop(token, None)
            registra(utente["nome"], "Eliminato il collaboratore «%s»" % soggetto["nome"])
            salva_dati()
            return self.rispondi_json({"fatto": True})
        raise ErroreApi(404, "Funzione non trovata.")

    # --- gestione dati (esporta / importa / azzera) -------------------------

    def api_esporta(self):
        self.richiedi_accesso("titolare")
        corpo = json.dumps(DATI, ensure_ascii=False, indent=1).encode("utf-8")
        nome_file = "condocompiti-backup-%s.json" % date.today().isoformat()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="%s"' % nome_file)
        self.send_header("Content-Length", str(len(corpo)))
        self._intestazioni_comuni()
        self.end_headers()
        self.wfile.write(corpo)

    def api_importa(self):
        global DATI
        utente = self.richiedi_accesso("titolare")
        corpo = self.leggi_corpo()
        nuovi = corpo.get("dati")
        if not isinstance(nuovi, dict) or \
                not all(chiave in nuovi for chiave in ("utenti", "condomini", "compiti")):
            raise ErroreApi(400, "Il file scelto non è un backup di CondoCompiti.")
        if not any(u.get("ruolo") == "titolare" and u.get("attivo")
                   for u in nuovi.get("utenti", [])):
            raise ErroreApi(400, "Il backup non contiene nessun titolare attivo.")
        base = struttura_vuota()
        for chiave in base:
            if chiave in nuovi:
                base[chiave] = nuovi[chiave]
        DATI = base
        SESSIONI.clear()
        registra(utente["nome"], "Ripristinati i dati da un file di backup")
        salva_dati()
        self.rispondi_json({"fatto": True})

    def api_azzera(self):
        global DATI
        utente = self.richiedi_accesso("titolare")
        corpo = self.leggi_corpo()
        if corpo.get("conferma") != "AZZERA":
            raise ErroreApi(400, "Conferma non valida.")
        io = trova(DATI["utenti"], utente["id"])
        nome_studio = DATI["impostazioni"]["nome_studio"]
        DATI = struttura_vuota()
        DATI["impostazioni"]["nome_studio"] = nome_studio
        DATI["contatori"]["utente"] = io["id"]
        DATI["utenti"] = [io]
        registra(utente["nome"], "Azzeramento totale dei dati")
        salva_dati()
        self.rispondi_json({"fatto": True})

    def api_impostazioni(self):
        utente = self.richiedi_accesso("titolare")
        corpo = self.leggi_corpo()
        if "nome_studio" in corpo:
            nome = (corpo.get("nome_studio") or "").strip()
            if nome:
                DATI["impostazioni"]["nome_studio"] = nome
        if "registro_attivo" in corpo:
            DATI["impostazioni"]["registro_attivo"] = bool(corpo["registro_attivo"])
        registra(utente["nome"], "Modificate le impostazioni")
        salva_dati()
        self.rispondi_json({"impostazioni": DATI["impostazioni"]})

    def api_registro_azzera(self):
        utente = self.richiedi_accesso("titolare")
        DATI["registro"] = []
        registra(utente["nome"], "Svuotato il registro attività")
        salva_dati()
        self.rispondi_json({"fatto": True})


# ----------------------------------------------------------------------------
# Avvio
# ----------------------------------------------------------------------------

def avvia():
    carica_dati()
    porta = PORTA_BASE
    server = None
    for tentativo in range(10):
        try:
            server = ThreadingHTTPServer(("0.0.0.0", porta), Gestore)
            break
        except OSError:
            porta += 1
    if server is None:
        print("ERRORE: nessuna porta libera trovata. Chiudi altri programmi e riprova.")
        sys.exit(1)
    Gestore.porta = porta

    riga = "=" * 62
    print()
    print(riga)
    print("  CondoCompiti — %s" % DATI["impostazioni"]["nome_studio"])
    print(riga)
    print()
    print("  Su QUESTO computer apri:      http://localhost:%d" % porta)
    ips = indirizzi_lan()
    if ips:
        print()
        print("  Dagli ALTRI computer dell'ufficio apri nel browser:")
        for ip in ips:
            print("      http://%s:%d" % (ip, porta))
    print()
    print("  I dati restano in questo computer, nel file:")
    print("      %s" % FILE_DATI)
    print()
    print("  Lascia aperta questa finestra mentre si lavora.")
    print("  Per chiudere il programma: premi CTRL+C oppure chiudi la finestra.")
    print(riga)

    try:
        webbrowser.open("http://localhost:%d" % porta)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nProgramma chiuso. Arrivederci.")


if __name__ == "__main__":
    avvia()
