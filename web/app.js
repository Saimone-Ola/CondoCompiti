"use strict";
/* CondoCompiti — logica dell'interfaccia.
   Tutte le chiamate vanno solo al server locale (stessa origine): nessun servizio esterno. */

// ---------------------------------------------------------------------------
// Stato globale e costanti (allineate al server)
// ---------------------------------------------------------------------------

const S = {
  utente: null,        // utente collegato
  dati: null,          // ultimo pacchetto ricevuto da /api/dati
  vista: "bacheca",
  compitoId: null,
  origineDettaglio: "compiti",
  filtri: { ricerca: "", condominio: "", dipendente: "", stato: "", categoria: "", speciale: "" },
  periodoReport: 30,   // giorni considerati nel report del titolare (null = tutto)
  modoScadenzario: "calendario", // "calendario" (stile Outlook) oppure "elenco"
  calAnno: null, calMese: null,  // mese mostrato nel calendario (inizializzati a oggi)
  accessoScelto: null, // utente scelto nella schermata di accesso
};

const STATI = ["Da iniziare", "In corso", "In attesa", "Completato", "Archiviato"];
const PRIORITA = ["Bassa", "Media", "Alta", "Urgente"];
const CATEGORIE = ["Assemblea", "Contabilità/Rate", "Manutenzione", "Comunicazioni",
  "Adempimenti/Pratiche", "Legale", "Altro"];
const ESITI = ["Completato regolarmente", "Completato con osservazioni", "Non completato"];
const STATI_APERTI = ["Da iniziare", "In corso", "In attesa"];

const $ = (selettore) => document.querySelector(selettore);

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

function esc(testo) {
  return String(testo == null ? "" : testo)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function accento(testo) { // "In corso" -> "in-corso" per le classi CSS
  return testo.toLowerCase()
    .replaceAll(" ", "-")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]/g, "");
}

function etichettaStato(stato) {
  return `<span class="etichetta stato-${accento(stato)}">${esc(stato)}</span>`;
}
function etichettaPriorita(p) {
  return `<span class="etichetta priorita-${accento(p)}">${esc(p)}</span>`;
}

function oggiISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}

function giorniAlla(dataISO) { // negativo = scaduta
  if (!dataISO) return null;
  const [a, m, g] = dataISO.split("-").map(Number);
  const [oa, om, og] = oggiISO().split("-").map(Number);
  return Math.round((Date.UTC(a, m - 1, g) - Date.UTC(oa, om - 1, og)) / 86400000);
}

const FORMATO_DATA = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function dataBreve(dataISO) {
  if (!dataISO) return "—";
  const [a, m, g] = dataISO.split("-").map(Number);
  return FORMATO_DATA.format(new Date(a, m - 1, g));
}

function dataOra(iso) { // "2026-07-17T16:40" -> "17/07/2026 alle 16:40"
  if (!iso) return "—";
  const [data, ora] = iso.split("T");
  const [a, m, g] = data.split("-");
  return `${g}/${m}/${a}` + (ora ? ` alle ${ora.slice(0, 5)}` : "");
}

function aperto(c) { return STATI_APERTI.includes(c.stato); }

function descriviScadenza(c) {
  if (!c.scadenza) return { testo: "senza scadenza", classe: "" };
  const giorni = giorniAlla(c.scadenza);
  const quando = dataBreve(c.scadenza);
  if (!aperto(c)) return { testo: quando, classe: "" };
  if (giorni < 0) {
    const n = -giorni;
    return { testo: `SCADUTO ${n === 1 ? "da 1 giorno" : "da " + n + " giorni"} (${quando})`, classe: "scadenza-scaduta" };
  }
  if (giorni === 0) return { testo: `scade OGGI (${quando})`, classe: "scadenza-scaduta" };
  if (giorni === 1) return { testo: `scade DOMANI (${quando})`, classe: "scadenza-vicina" };
  if (giorni <= 7) return { testo: `scade tra ${giorni} giorni (${quando})`, classe: "scadenza-vicina" };
  return { testo: quando, classe: "" };
}

function nomeUtente(id) {
  const u = (S.dati.utenti || []).find((x) => x.id === id);
  return u ? u.nome : "Da riassegnare";
}
function nomeCondominio(id) {
  const c = (S.dati.condomini || []).find((x) => x.id === id);
  return c ? c.nome : "—";
}
function ultimoRiscontro(c) {
  return c.riscontri.length ? c.riscontri[c.riscontri.length - 1] : null;
}
function problemaAperto(c) {
  const r = ultimoRiscontro(c);
  return Boolean(r && r.problema && aperto(c));
}
function ordinaPerScadenza(a, b) {
  return (a.scadenza || "9999") < (b.scadenza || "9999") ? -1 : 1;
}
function sonoCapo() { return S.utente && S.utente.ruolo === "titolare"; }

// ---------------------------------------------------------------------------
// Chiamate al server locale
// ---------------------------------------------------------------------------

async function api(percorso, metodo = "GET", corpo = null) {
  const opzioni = { method: metodo, headers: {} };
  if (corpo !== null) {
    opzioni.headers["Content-Type"] = "application/json";
    opzioni.body = JSON.stringify(corpo);
  }
  let risposta;
  try {
    risposta = await fetch("/api/" + percorso, opzioni);
  } catch (e) {
    throw new Error("Il programma sul computer principale non risponde. Controlla che sia acceso.");
  }
  let dati = null;
  try { dati = await risposta.json(); } catch (e) { /* risposta senza corpo */ }
  if (!risposta.ok) {
    if (risposta.status === 401 && S.utente) { S.utente = null; mostraAccesso(); }
    throw new Error((dati && dati.errore) || "Si è verificato un errore.");
  }
  return dati;
}

async function aggiorna() { // ricarica i dati e ridisegna la vista corrente
  S.dati = await api("dati");
  S.utente = S.dati.utente;
  disegna();
}

// ---------------------------------------------------------------------------
// Avvisi e finestre di dialogo
// ---------------------------------------------------------------------------

let timerAvviso = null;
function avviso(testo, errore = false) {
  const scatola = $("#avviso");
  scatola.textContent = testo;
  scatola.classList.toggle("errore-avviso", errore);
  scatola.classList.remove("nascosto");
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => scatola.classList.add("nascosto"), 3800);
}

function apriFinestra(html) {
  $("#finestra").innerHTML = html;
  $("#velo").classList.remove("nascosto");
  const primo = $("#finestra").querySelector("input, select, textarea");
  if (primo) primo.focus();
}
function chiudiFinestra() {
  $("#velo").classList.add("nascosto");
  $("#finestra").innerHTML = "";
}
function finestraAperta() { return !$("#velo").classList.contains("nascosto"); }

async function esegui(azione, messaggioOk) {
  try {
    const esito = await azione();
    if (messaggioOk) avviso(typeof messaggioOk === "function" ? messaggioOk(esito) : messaggioOk);
    return esito;
  } catch (errore) {
    avviso(errore.message, true);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Schermata di accesso
// ---------------------------------------------------------------------------

async function mostraAccesso() {
  $("#app").classList.add("nascosto");
  $("#schermata-accesso").classList.remove("nascosto");
  $("#accesso-passo-pin").classList.add("nascosto");
  $("#accesso-passo-nome").classList.remove("nascosto");
  let elenco;
  try {
    elenco = await api("utenti-accesso");
  } catch (e) {
    $("#accesso-utenti").innerHTML = `<p class="errore">${esc(e.message)}</p>`;
    return;
  }
  $("#accesso-titolo").textContent = elenco.nome_studio || "CondoCompiti";
  $("#accesso-domanda").classList.remove("nascosto");
  if (elenco.primo_avvio) { mostraPrimoAvvio(); return; }
  const ordinati = [...elenco.utenti].sort((a, b) =>
    (a.ruolo === b.ruolo ? a.nome.localeCompare(b.nome) : a.ruolo === "titolare" ? -1 : 1));
  $("#accesso-utenti").innerHTML = ordinati.map((u) => `
    <button class="accesso-utente" data-id="${u.id}" data-nome="${esc(u.nome)}">
      <span>${esc(u.nome)}</span>
      <span class="ruolo">${u.ruolo === "titolare" ? "Titolare" : "Dipendente"}</span>
    </button>`).join("") ||
    `<p class="vuoto">Nessun utente. Contatta chi ha installato il programma.</p>`;
  $("#accesso-utenti").querySelectorAll(".accesso-utente").forEach((bottone) => {
    bottone.addEventListener("click", () => {
      S.accessoScelto = Number(bottone.dataset.id);
      $("#accesso-nome-scelto").textContent = bottone.dataset.nome;
      $("#accesso-passo-nome").classList.add("nascosto");
      $("#accesso-passo-pin").classList.remove("nascosto");
      $("#accesso-errore").classList.add("nascosto");
      $("#accesso-pin").value = "";
      $("#accesso-pin").focus();
    });
  });
}

function mostraPrimoAvvio() {
  // Nessun utente ancora: il titolare crea qui il proprio accesso.
  $("#accesso-passo-pin").classList.add("nascosto");
  $("#accesso-passo-nome").classList.remove("nascosto");
  $("#accesso-domanda").classList.add("nascosto");
  $("#accesso-utenti").innerHTML = `
    <div style="text-align:left">
      <p class="accesso-istruzione" style="text-align:center;margin-top:0">
        <b>Benvenuto!</b> È il primo avvio:<br>crea l'accesso del titolare.</p>
      <label for="pa-studio">Nome dello studio</label>
      <input id="pa-studio" style="width:100%" placeholder="Es.: Studio Rossi Amministrazioni">
      <label for="pa-nome">Il tuo nome (titolare) *</label>
      <input id="pa-nome" style="width:100%" placeholder="Es.: Franca">
      <label for="pa-pin">Scegli un PIN (4-8 cifre) *</label>
      <input id="pa-pin" type="password" inputmode="numeric" maxlength="8" style="width:100%" autocomplete="off">
      <label for="pa-pin2">Ripeti il PIN *</label>
      <input id="pa-pin2" type="password" inputmode="numeric" maxlength="8" style="width:100%" autocomplete="off">
      <p id="pa-errore" class="errore nascosto"></p>
      <div class="accesso-bottoni">
        <button id="pa-inizia" class="bottone primario" style="width:100%">Inizia a usare l'app</button>
      </div>
      <p class="accesso-nota" style="margin-top:1rem">I collaboratori li aggiungerai dopo,
      dalla pagina <b>Anagrafiche</b>: ognuno avrà il suo nome e il suo PIN.</p>
    </div>`;
  const errore = (testo) => {
    const riga = $("#pa-errore");
    riga.textContent = testo;
    riga.classList.remove("nascosto");
  };
  $("#pa-inizia").addEventListener("click", async () => {
    const pin = $("#pa-pin").value.trim();
    if (pin !== $("#pa-pin2").value.trim()) { errore("I due PIN non coincidono: riprova."); return; }
    try {
      await api("primo-avvio", "POST", {
        nome: $("#pa-nome").value,
        pin,
        nome_studio: $("#pa-studio").value,
      });
      await caricaEMostra();
      avviso("Benvenuto! Ora aggiungi condomìni e collaboratori dalla pagina Anagrafiche.");
    } catch (e) {
      errore(e.message);
    }
  });
  $("#pa-nome").focus();
}

async function entra() {
  const pin = $("#accesso-pin").value.trim();
  try {
    await api("accesso", "POST", { utente_id: S.accessoScelto, pin });
    $("#accesso-pin").value = "";
    await caricaEMostra();
  } catch (errore) {
    const riga = $("#accesso-errore");
    riga.textContent = errore.message;
    riga.classList.remove("nascosto");
    $("#accesso-pin").value = "";
    $("#accesso-pin").focus();
  }
}

async function caricaEMostra() {
  S.dati = await api("dati");
  S.utente = S.dati.utente;
  S.vista = "bacheca";
  S.compitoId = null;
  $("#schermata-accesso").classList.add("nascosto");
  $("#app").classList.remove("nascosto");
  disegna();
}

// ---------------------------------------------------------------------------
// Struttura dell'app: testata, navigazione, viste
// ---------------------------------------------------------------------------

function disegna() {
  if (!S.utente) return;
  $("#testata-studio").textContent = S.dati.impostazioni.nome_studio;
  document.title = S.dati.impostazioni.nome_studio + " — CondoCompiti";
  $("#testata-nome").textContent = S.utente.nome + (sonoCapo() ? " (titolare)" : "");
  disegnaNavigazione();
  const viste = {
    bacheca: vistaBacheca,
    compiti: vistaCompiti,
    dettaglio: vistaDettaglio,
    scadenzario: vistaScadenzario,
    report: vistaReport,
    anagrafiche: vistaAnagrafiche,
    impostazioni: vistaImpostazioni,
  };
  (viste[S.vista] || vistaBacheca)();
}

function disegnaNavigazione() {
  const novita = sonoCapo()
    ? S.dati.compiti.filter((c) => c.da_vedere).length
    : S.dati.compiti.filter((c) => c.nota_da_leggere).length;
  const voci = [
    ["bacheca", "Bacheca"],
    ["compiti", "Compiti", novita],
    ["scadenzario", "Scadenzario"],
  ];
  if (sonoCapo()) voci.push(["report", "Report"], ["anagrafiche", "Anagrafiche"], ["impostazioni", "Impostazioni"]);
  const attiva = S.vista === "dettaglio" ? "compiti" : S.vista;
  $("#navigazione").innerHTML = voci.map(([nome, testo, pallino]) => `
    <button class="scheda-nav ${nome === attiva ? "attiva" : ""}" data-vista="${nome}">
      ${testo}${pallino ? `<span class="pallino">${pallino}</span>` : ""}
    </button>`).join("");
  $("#navigazione").querySelectorAll(".scheda-nav").forEach((b) =>
    b.addEventListener("click", () => vai(b.dataset.vista)));
}

function vai(vista) {
  S.vista = vista;
  if (vista !== "dettaglio") S.compitoId = null;
  disegna();
  window.scrollTo(0, 0);
  // Ricarica i dati dal computer principale, così le novità inserite dagli
  // altri computer compaiono appena si cambia pagina (oltre che ogni minuto).
  aggiorna().catch(() => {});
}

function apriCompito(id, origine) {
  S.compitoId = id;
  S.origineDettaglio = origine || (S.vista === "dettaglio" ? S.origineDettaglio : S.vista);
  S.vista = "dettaglio";
  disegna();
  window.scrollTo(0, 0);
}

function collegaRigheCompito(contenitore, origine) {
  contenitore.querySelectorAll(".riga-compito").forEach((riga) =>
    riga.addEventListener("click", () => apriCompito(Number(riga.dataset.id), origine)));
}

function rigaCompito(c, opzioni = {}) {
  const scad = descriviScadenza(c);
  const novita = sonoCapo()
    ? (c.da_vedere ? `<span class="etichetta etichetta-novita">Nuovo riscontro</span>` : "")
    : (c.nota_da_leggere ? `<span class="etichetta etichetta-novita">Nota del titolare</span>` : "");
  const problema = problemaAperto(c) ? `<span class="etichetta etichetta-problema">⚠ Problema segnalato</span>` : "";
  return `
    <button class="riga-compito ${c.da_vedere && sonoCapo() ? "novita" : ""}" data-id="${c.id}">
      <div class="titolo-compito">${esc(c.titolo)}</div>
      <div class="sotto">
        ${opzioni.condominio === false ? "" : `<span>🏢 ${esc(nomeCondominio(c.condominio_id))}</span>`}
        ${sonoCapo() ? `<span>👤 ${esc(nomeUtente(c.assegnato_a))}</span>` : ""}
        <span class="${scad.classe}">📅 ${esc(scad.testo)}</span>
        ${etichettaStato(c.stato)} ${etichettaPriorita(c.priorita)} ${novita} ${problema}
      </div>
    </button>`;
}

// ---------------------------------------------------------------------------
// Bacheca
// ---------------------------------------------------------------------------

function vistaBacheca() {
  const compiti = S.dati.compiti;
  const apertiTutti = compiti.filter(aperto);
  const scaduti = apertiTutti.filter((c) => c.scadenza && giorniAlla(c.scadenza) < 0);
  const inScadenza = apertiTutti.filter((c) => {
    const g = c.scadenza ? giorniAlla(c.scadenza) : null;
    return g !== null && g >= 0 && g <= 7;
  });
  const completati = compiti.filter((c) => c.stato === "Completato");

  const daVedere = sonoCapo()
    ? compiti.filter((c) => c.da_vedere).sort(ordinaPerScadenza)
    : compiti.filter((c) => c.nota_da_leggere).sort(ordinaPerScadenza);
  const prossime = apertiTutti.filter((c) => c.scadenza).sort(ordinaPerScadenza).slice(0, 6);
  const prioritari = apertiTutti
    .filter((c) => c.priorita === "Urgente" || c.priorita === "Alta")
    .sort((a, b) => (a.priorita === b.priorita ? ordinaPerScadenza(a, b) : a.priorita === "Urgente" ? -1 : 1))
    .slice(0, 6);

  const contatore = (classe, numero, titolo, speciale) => `
    <button class="contatore ${classe}" data-speciale="${speciale}">
      <div class="numero">${numero}</div><div class="titolo">${titolo}</div>
    </button>`;

  const riquadroCompiti = (titolo, elenco, vuoto) => `
    <div class="riquadro">
      <h2>${titolo}</h2>
      ${elenco.length ? elenco.map((c) => rigaCompito(c)).join("") : `<p class="vuoto">${vuoto}</p>`}
    </div>`;

  const modelli = sonoCapo() ? `
    <div class="riquadro">
      <h2>⚡ Modelli ricorrenti</h2>
      <p class="secondario-testo" style="margin-top:0;color:var(--testo-tenue)">
        Con un clic crei una serie di compiti già pronti, con scadenze calcolate in automatico.</p>
      ${Object.entries(S.dati.modelli).map(([chiave, m]) => `
        <div class="modello">
          <div><div class="nome">${esc(m.nome)}</div>
          <div class="descr">${esc(m.descrizione)} (${m.n_compiti} compiti)</div></div>
          <button class="bottone primario piccolo" data-modello="${chiave}">Genera compiti</button>
        </div>`).join("")}
    </div>` : "";

  const primiPassi = sonoCapo() &&
    (!S.dati.condomini.length || S.dati.utenti.length < 2 || !compiti.length) ? `
    <div class="riquadro">
      <h2>👋 Primi passi</h2>
      <p style="margin-top:0;color:var(--testo-tenue)">Tre passaggi e lo studio è operativo:</p>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap">
        <button class="bottone ${S.dati.condomini.length ? "secondario" : "primario"}" id="pp-condominio">
          ${S.dati.condomini.length ? "✔ Condomìni inseriti" : "1. Aggiungi un condominio"}</button>
        <button class="bottone ${S.dati.utenti.length > 1 ? "secondario" : "primario"}" id="pp-utente">
          ${S.dati.utenti.length > 1 ? "✔ Collaboratori aggiunti" : "2. Aggiungi un collaboratore"}</button>
        <button class="bottone ${compiti.length ? "secondario" : "primario"}" id="pp-compito">
          ${compiti.length ? "✔ Primo compito creato" : "3. Crea il primo compito"}</button>
      </div>
    </div>` : "";

  $("#contenuto").innerHTML = `
    <div class="intestazione-vista">
      <h1>Bacheca — ${sonoCapo() ? "tutti i compiti dello studio" : "i tuoi compiti"}</h1>
      ${sonoCapo() ? `<div class="azioni"><button class="bottone primario" id="bacheca-nuovo">+ Nuovo compito</button></div>` : ""}
    </div>
    ${primiPassi}
    <div class="contatori">
      ${contatore("aperti", apertiTutti.length, "Compiti aperti", "aperti")}
      ${contatore("in-scadenza", inScadenza.length, "In scadenza (7 giorni)", "in-scadenza")}
      ${contatore("scaduti", scaduti.length, "Scaduti", "scaduti")}
      ${contatore("completati", completati.length, "Completati", "completati")}
    </div>
    <div class="colonne-bacheca">
      ${riquadroCompiti(sonoCapo() ? "🔔 Da vedere: nuovi riscontri e completati" : "🔔 Note del titolare da leggere",
        daVedere, sonoCapo() ? "Nessuna novità da vedere." : "Nessuna nuova nota.")}
      ${riquadroCompiti("📅 Prossime scadenze", prossime, "Nessuna scadenza in vista.")}
      ${riquadroCompiti("❗ Compiti prioritari", prioritari, "Nessun compito urgente o ad alta priorità.")}
      ${modelli}
    </div>`;

  collegaRigheCompito($("#contenuto"), "bacheca");
  $("#contenuto").querySelectorAll(".contatore").forEach((b) =>
    b.addEventListener("click", () => {
      S.filtri = { ricerca: "", condominio: "", dipendente: "", stato: "", categoria: "", speciale: b.dataset.speciale };
      vai("compiti");
    }));
  $("#contenuto").querySelectorAll("[data-modello]").forEach((b) =>
    b.addEventListener("click", () => finestraModello(b.dataset.modello)));
  const nuovo = $("#bacheca-nuovo");
  if (nuovo) nuovo.addEventListener("click", () => finestraCompito(null));
  const passi = [["#pp-condominio", () => finestraCondominio(null)],
    ["#pp-utente", () => finestraUtente(null)], ["#pp-compito", () => finestraCompito(null)]];
  for (const [id, azione] of passi) {
    const bottone = $(id);
    if (bottone) bottone.addEventListener("click", azione);
  }
}

// ---------------------------------------------------------------------------
// Elenco compiti
// ---------------------------------------------------------------------------

const NOMI_SPECIALI = {
  "aperti": "Solo compiti aperti", "in-scadenza": "In scadenza entro 7 giorni",
  "scaduti": "Solo scaduti", "completati": "Solo completati",
};

function filtraCompiti() {
  const f = S.filtri;
  const testo = f.ricerca.trim().toLowerCase();
  return S.dati.compiti.filter((c) => {
    if (f.speciale === "aperti" && !aperto(c)) return false;
    if (f.speciale === "scaduti" && !(aperto(c) && c.scadenza && giorniAlla(c.scadenza) < 0)) return false;
    if (f.speciale === "in-scadenza") {
      const g = c.scadenza ? giorniAlla(c.scadenza) : null;
      if (!(aperto(c) && g !== null && g >= 0 && g <= 7)) return false;
    }
    if (f.speciale === "completati" && c.stato !== "Completato") return false;
    if (f.condominio && c.condominio_id !== Number(f.condominio)) return false;
    if (f.dipendente && c.assegnato_a !== Number(f.dipendente)) return false;
    if (f.stato) { if (c.stato !== f.stato) return false; }
    else if (!f.speciale && c.stato === "Archiviato") return false;
    if (f.categoria && c.categoria !== f.categoria) return false;
    if (testo) {
      const dentro = (c.titolo + " " + c.istruzioni + " " + nomeCondominio(c.condominio_id) + " " +
        nomeUtente(c.assegnato_a) + " " + c.riscontri.map((r) => r.testo).join(" ")).toLowerCase();
      if (!dentro.includes(testo)) return false;
    }
    return true;
  });
}

function pesoStato(c) {
  if (aperto(c)) return 0;
  return c.stato === "Completato" ? 1 : 2;
}

function vistaCompiti() {
  const f = S.filtri;
  const opzioni = (elenco, scelto, tutti) =>
    `<option value="">${tutti}</option>` + elenco.map((v) =>
      `<option value="${esc(v[0])}" ${String(v[0]) === String(scelto) ? "selected" : ""}>${esc(v[1])}</option>`).join("");

  const attivi = S.dati.utenti.filter((u) => u.attivo);
  $("#contenuto").innerHTML = `
    <div class="intestazione-vista">
      <h1>Compiti${sonoCapo() ? "" : " assegnati a te"}</h1>
      <div class="azioni">
        <button class="bottone secondario" id="stampa-registro">🖨 Stampa registro</button>
        ${sonoCapo() ? `<button class="bottone primario" id="compiti-nuovo">+ Nuovo compito</button>` : ""}
      </div>
    </div>
    <div class="filtri">
      <input type="search" id="filtro-ricerca" placeholder="🔍 Cerca nel titolo, nelle istruzioni…" value="${esc(f.ricerca)}">
      <select id="filtro-condominio">${opzioni(S.dati.condomini.map((c) => [c.id, c.nome]), f.condominio, "Tutti i condomìni")}</select>
      ${sonoCapo() ? `<select id="filtro-dipendente">${opzioni(attivi.map((u) => [u.id, u.nome]), f.dipendente, "Tutti i collaboratori")}</select>` : ""}
      <select id="filtro-stato">${opzioni(STATI.map((s) => [s, "Stato: " + s]), f.stato, "Tutti gli stati (senza archiviati)")}</select>
      <select id="filtro-categoria">${opzioni(CATEGORIE.map((c) => [c, c]), f.categoria, "Tutte le categorie")}</select>
      ${f.speciale ? `<button class="bottone secondario piccolo" id="filtro-speciale-via">${esc(NOMI_SPECIALI[f.speciale] || f.speciale)} ✕</button>` : ""}
    </div>
    <div id="elenco-compiti"></div>`;

  const aggiornaElenco = () => {
    const trovati = filtraCompiti();
    const perCondominio = new Map();
    for (const c of trovati) {
      if (!perCondominio.has(c.condominio_id)) perCondominio.set(c.condominio_id, []);
      perCondominio.get(c.condominio_id).push(c);
    }
    const gruppi = [...perCondominio.entries()]
      .sort((a, b) => nomeCondominio(a[0]).localeCompare(nomeCondominio(b[0])));
    $("#elenco-compiti").innerHTML = gruppi.length ? gruppi.map(([idCond, elenco]) => `
      <div class="gruppo-condominio">
        <h2><span>🏢 ${esc(nomeCondominio(idCond))}</span>
            <span class="conta">${elenco.length} ${elenco.length === 1 ? "compito" : "compiti"}</span></h2>
        ${elenco.sort((a, b) => pesoStato(a) - pesoStato(b) || ordinaPerScadenza(a, b))
          .map((c) => rigaCompito(c, { condominio: false })).join("")}
      </div>`).join("")
      : `<p class="vuoto">Nessun compito corrisponde ai filtri scelti.</p>`;
    collegaRigheCompito($("#elenco-compiti"), "compiti");
  };
  aggiornaElenco();

  $("#filtro-ricerca").addEventListener("input", (e) => { f.ricerca = e.target.value; aggiornaElenco(); });
  for (const [id, campo] of [["#filtro-condominio", "condominio"], ["#filtro-dipendente", "dipendente"],
    ["#filtro-stato", "stato"], ["#filtro-categoria", "categoria"]]) {
    const sel = $(id);
    if (sel) sel.addEventListener("change", (e) => { f[campo] = e.target.value; aggiornaElenco(); });
  }
  const viaSpeciale = $("#filtro-speciale-via");
  if (viaSpeciale) viaSpeciale.addEventListener("click", () => { f.speciale = ""; vistaCompiti(); });
  const nuovo = $("#compiti-nuovo");
  if (nuovo) nuovo.addEventListener("click", () => finestraCompito(null));
  $("#stampa-registro").addEventListener("click", () => stampaRegistro(filtraCompiti()));
}

// ---------------------------------------------------------------------------
// Dettaglio del compito (con riscontro e nota di ritorno)
// ---------------------------------------------------------------------------

function vistaDettaglio() {
  const c = S.dati.compiti.find((x) => x.id === S.compitoId);
  if (!c) { vai("compiti"); return; }
  const capo = sonoCapo();
  const scad = descriviScadenza(c);
  const posso = capo || c.assegnato_a === S.utente.id;

  // Aprendo il compito, la novità risulta "vista"
  if ((capo && c.da_vedere) || (!capo && c.nota_da_leggere)) {
    api(`compiti/${c.id}/visto`, "POST", {}).then(() => {
      if (capo) c.da_vedere = false; else c.nota_da_leggere = false;
      disegnaNavigazione();
    }).catch(() => {});
  }

  const dato = (nome, valore, classe = "") => `
    <div class="dato"><div class="nome-dato">${nome}</div>
    <div class="valore-dato ${classe}">${valore}</div></div>`;

  const riscontriHtml = c.riscontri.length ? c.riscontri.map((r) => `
    <div class="riscontro ${r.problema ? "problema" : ""}">
      <span class="chi">${esc(r.autore)}</span>
      <span class="quando-riscontro"> — ${dataOra(r.quando)}</span>
      ${r.problema ? `<span class="etichetta etichetta-problema">⚠ Problema</span>` : ""}
      <div class="testo">${esc(r.testo)}</div>
    </div>`).join("") : `<p class="vuoto">Ancora nessun riscontro.</p>`;

  const statiForm = capo ? STATI : STATI.filter((s) => s !== "Archiviato");
  const formRiscontro = posso ? `
    <div class="riquadro">
      <h2>✍️ ${capo ? "Aggiorna il compito" : "Dai il tuo riscontro"}</h2>
      <label for="riscontro-stato">A che punto è il compito?</label>
      <select id="riscontro-stato">
        ${statiForm.map((s) => `<option ${s === c.stato ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <label for="riscontro-testo">Cosa è stato fatto / a che punto sei <span class="facoltativo">(spiegalo con parole tue)</span></label>
      <textarea id="riscontro-testo" rows="4" placeholder="Es.: Ho inviato 28 convocazioni su 30, mancano due indirizzi…"></textarea>
      <label class="spunta" style="font-weight:600">
        <input type="checkbox" id="riscontro-problema"> C'è un problema da segnalare al titolare
      </label>
      <div id="riscontro-esito-blocco" class="${["Completato", "Archiviato"].includes(c.stato) ? "" : "nascosto"}">
        <label for="riscontro-esito">Esito del lavoro</label>
        <select id="riscontro-esito">
          <option value="">— scegli l'esito —</option>
          ${ESITI.map((e2) => `<option ${e2 === c.esito ? "selected" : ""}>${e2}</option>`).join("")}
        </select>
      </div>
      <div class="finestra-bottoni" style="justify-content:flex-start">
        <button class="bottone primario" id="riscontro-invia">Salva il riscontro</button>
      </div>
    </div>` : "";

  const notaHtml = capo ? `
    <div class="riquadro">
      <h2>💬 Nota di ritorno per ${esc(nomeUtente(c.assegnato_a))}</h2>
      <textarea id="nota-testo" rows="3" placeholder="Es.: Va bene, ricordati di allegare l'estratto conto…">${esc(c.nota_ritorno)}</textarea>
      <div class="finestra-bottoni" style="justify-content:flex-start">
        <button class="bottone primario" id="nota-salva">Salva la nota</button>
      </div>
    </div>`
    : (c.nota_ritorno ? `
    <div class="riquadro">
      <h2>💬 Nota di ritorno del titolare</h2>
      <div class="nota-ritorno">${esc(c.nota_ritorno)}</div>
    </div>` : "");

  $("#contenuto").innerHTML = `
    <div class="intestazione-vista">
      <button class="bottone secondario" id="dettaglio-indietro">← Torna all'elenco</button>
      <div class="azioni">
        <button class="bottone secondario" id="dettaglio-stampa">🖨 Stampa scheda</button>
        ${capo ? `<button class="bottone secondario" id="dettaglio-modifica">✏️ Modifica</button>` : ""}
        ${capo && c.stato === "Completato" ? `<button class="bottone secondario" id="dettaglio-archivia">🗂 Archivia</button>` : ""}
        ${capo ? `<button class="bottone pericolo" id="dettaglio-elimina">Elimina</button>` : ""}
      </div>
    </div>
    <div class="riquadro">
      <div class="dettaglio-testa"><div>
        <h1>${esc(c.titolo)}</h1>
        <div class="dettaglio-etichette">
          ${etichettaStato(c.stato)} ${etichettaPriorita(c.priorita)}
          <span class="etichetta etichetta-categoria">${esc(c.categoria)}</span>
          ${problemaAperto(c) ? `<span class="etichetta etichetta-problema">⚠ Problema segnalato</span>` : ""}
        </div>
      </div><div style="color:var(--testo-tenue)">Compito n. ${c.id}</div></div>
      <div class="griglia-dati">
        ${dato("Condominio", "🏢 " + esc(nomeCondominio(c.condominio_id)))}
        ${dato("Assegnato a", "👤 " + esc(nomeUtente(c.assegnato_a)))}
        ${dato("Assegnato da", esc(nomeUtente(c.assegnato_da)) + " il " + dataBreve(c.data_assegnazione))}
        ${dato("Scadenza", esc(scad.testo), scad.classe)}
        ${c.data_completamento ? dato("Completato il", dataBreve(c.data_completamento)) : ""}
        ${c.esito ? dato("Esito", esc(c.esito)) : ""}
      </div>
      <div class="nome-dato" style="font-size:.85rem;color:var(--testo-tenue);font-weight:700;text-transform:uppercase">Istruzioni del titolare</div>
      <div class="blocco-testo">${c.istruzioni ? esc(c.istruzioni) : "—"}</div>
      <p style="color:var(--testo-tenue);font-size:.88rem;margin-bottom:0">
        Ultima modifica: ${dataOra(c.modificato_il)} (${esc(c.modificato_da)})</p>
    </div>
    <div class="riquadro">
      <h2>📣 Riscontri${c.riscontri.length ? ` (${c.riscontri.length})` : ""}</h2>
      ${riscontriHtml}
    </div>
    ${formRiscontro}
    ${notaHtml}`;

  $("#dettaglio-indietro").addEventListener("click", () => vai(S.origineDettaglio));
  $("#dettaglio-stampa").addEventListener("click", () => stampaScheda(c));

  if (posso) {
    const selStato = $("#riscontro-stato");
    selStato.addEventListener("change", () => {
      $("#riscontro-esito-blocco").classList.toggle("nascosto",
        !["Completato", "Archiviato"].includes(selStato.value));
    });
    $("#riscontro-invia").addEventListener("click", async () => {
      const corpo = {
        testo: $("#riscontro-testo").value,
        stato: selStato.value,
        problema: $("#riscontro-problema").checked,
      };
      const esito = $("#riscontro-esito");
      if (esito && !esito.closest(".nascosto") && esito.value) corpo.esito = esito.value;
      const ok = await esegui(() => api(`compiti/${c.id}/riscontro`, "POST", corpo), "Riscontro salvato. Grazie!");
      if (ok) aggiorna();
    });
  }
  if (capo) {
    $("#nota-salva").addEventListener("click", async () => {
      const ok = await esegui(() => api(`compiti/${c.id}/nota`, "POST", { testo: $("#nota-testo").value }),
        "Nota salvata: il collaboratore la vedrà evidenziata.");
      if (ok) aggiorna();
    });
    $("#dettaglio-modifica").addEventListener("click", () => finestraCompito(c));
    const archivia = $("#dettaglio-archivia");
    if (archivia) archivia.addEventListener("click", async () => {
      const ok = await esegui(() => api(`compiti/${c.id}`, "PUT", { stato: "Archiviato" }), "Compito archiviato.");
      if (ok) { await aggiorna(); }
    });
    $("#dettaglio-elimina").addEventListener("click", async () => {
      if (!confirm(`Eliminare per sempre il compito «${c.titolo}»?\nL'operazione non si può annullare.`)) return;
      const ok = await esegui(() => api(`compiti/${c.id}`, "DELETE"), "Compito eliminato.");
      if (ok) { await aggiorna(); vai(S.origineDettaglio); }
    });
  }
}

// ---------------------------------------------------------------------------
// Scadenzario
// ---------------------------------------------------------------------------

const NOMI_GIORNI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const FORMATO_MESE = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
const FORMATO_DATA_LUNGA = new Intl.DateTimeFormat("it-IT",
  { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function isoDaData(data) {
  return data.getFullYear() + "-" + String(data.getMonth() + 1).padStart(2, "0") +
    "-" + String(data.getDate()).padStart(2, "0");
}

function classeChip(c) {
  if (c.stato === "Completato") return "cal-fatto";
  if (aperto(c) && giorniAlla(c.scadenza) < 0) return "cal-scaduto";
  return "cal-" + accento(c.priorita);
}

function calendarioHtml() {
  const oggi = oggiISO();
  const perGiorno = new Map();
  for (const c of S.dati.compiti) {
    if (!c.scadenza || c.stato === "Archiviato") continue;
    if (!perGiorno.has(c.scadenza)) perGiorno.set(c.scadenza, []);
    perGiorno.get(c.scadenza).push(c);
  }
  const primo = new Date(S.calAnno, S.calMese, 1);
  const scarto = (primo.getDay() + 6) % 7; // giorni prima del lunedì
  const giorniNelMese = new Date(S.calAnno, S.calMese + 1, 0).getDate();
  const settimane = Math.ceil((scarto + giorniNelMese) / 7);

  let celle = "";
  for (let i = 0; i < settimane * 7; i++) {
    const data = new Date(S.calAnno, S.calMese, 1 - scarto + i);
    const iso = isoDaData(data);
    const fuoriMese = data.getMonth() !== S.calMese;
    const festivo = data.getDay() === 0 || data.getDay() === 6;
    const del = (perGiorno.get(iso) || []).sort((a, b) => pesoStato(a) - pesoStato(b));
    const visibili = del.slice(0, 3);
    celle += `
      <div class="cal-giorno ${fuoriMese ? "cal-fuori" : ""} ${festivo ? "cal-festivo" : ""} ${iso === oggi ? "cal-oggi" : ""}">
        <div class="cal-numero">${data.getDate()}</div>
        ${visibili.map((c) => `
          <button class="cal-chip ${classeChip(c)}" data-id="${c.id}"
            title="${esc(c.titolo)} — ${esc(nomeCondominio(c.condominio_id))}">
            ${c.stato === "Completato" ? "✔ " : ""}${esc(c.titolo)}
          </button>`).join("")}
        ${del.length > 3 ? `<button class="cal-piu" data-giorno="${iso}">+ altri ${del.length - 3}</button>` : ""}
      </div>`;
  }
  return `
    <div class="scorri-calendario"><div class="calendario">
      ${NOMI_GIORNI.map((g) => `<div class="cal-intesta">${g}</div>`).join("")}
      ${celle}
    </div></div>
    <div class="cal-legenda">
      <span>Colori:</span>
      <span class="cal-chip cal-urgente">Urgente</span>
      <span class="cal-chip cal-alta">Alta</span>
      <span class="cal-chip cal-media">Media</span>
      <span class="cal-chip cal-bassa">Bassa</span>
      <span class="cal-chip cal-scaduto">Scaduto</span>
      <span class="cal-chip cal-fatto">✔ Completato</span>
    </div>`;
}

function finestraGiorno(iso) {
  const del = S.dati.compiti
    .filter((c) => c.scadenza === iso && c.stato !== "Archiviato")
    .sort((a, b) => pesoStato(a) - pesoStato(b));
  const [a, m, g] = iso.split("-").map(Number);
  apriFinestra(`
    <h2>📅 ${FORMATO_DATA_LUNGA.format(new Date(a, m - 1, g))}</h2>
    ${del.length ? del.map((c) => rigaCompito(c)).join("") : `<p class="vuoto">Nessun compito in scadenza.</p>`}
    <div class="finestra-bottoni"><button class="bottone secondario" id="fg-chiudi">Chiudi</button></div>`);
  $("#fg-chiudi").addEventListener("click", chiudiFinestra);
  $("#finestra").querySelectorAll(".riga-compito").forEach((riga) =>
    riga.addEventListener("click", () => { chiudiFinestra(); apriCompito(Number(riga.dataset.id), "scadenzario"); }));
}

function vistaScadenzario() {
  if (S.calAnno === null) {
    const adesso = new Date();
    S.calAnno = adesso.getFullYear();
    S.calMese = adesso.getMonth();
  }
  const calendario = S.modoScadenzario === "calendario";

  const apertiTutti = S.dati.compiti.filter(aperto);
  const conScadenza = apertiTutti.filter((c) => c.scadenza).sort(ordinaPerScadenza);
  const scaduti = conScadenza.filter((c) => giorniAlla(c.scadenza) < 0);
  const settimana = conScadenza.filter((c) => { const g = giorniAlla(c.scadenza); return g >= 0 && g <= 7; });
  const dopo = conScadenza.filter((c) => giorniAlla(c.scadenza) > 7);
  const senza = apertiTutti.filter((c) => !c.scadenza);

  const sezione = (classe, titolo, elenco) => elenco.length ? `
    <h2 class="${classe}">${titolo} (${elenco.length})</h2>
    ${elenco.map((c) => rigaCompito(c)).join("")}` : "";

  const corpoElenco = `
    <div class="sezione-scadenze">
      ${sezione("rosso", "🔴 Scaduti", scaduti)}
      ${sezione("arancio", "🟠 Entro 7 giorni", settimana)}
      ${sezione("blu", "🔵 Più avanti", dopo)}
      ${sezione("blu", "⚪ Senza scadenza", senza)}
      ${conScadenza.length + senza.length === 0 ? `<p class="vuoto">Nessun compito aperto: tutto in ordine!</p>` : ""}
    </div>`;

  const corpoCalendario = `
    <div class="cal-testa">
      <div class="cal-navigazione">
        <button class="bottone secondario piccolo" id="cal-precedente" title="Mese precedente">◀</button>
        <span class="cal-mese-titolo">${FORMATO_MESE.format(new Date(S.calAnno, S.calMese, 1))}</span>
        <button class="bottone secondario piccolo" id="cal-successivo" title="Mese successivo">▶</button>
      </div>
      <button class="bottone secondario piccolo" id="cal-oggi-bottone">Vai a oggi</button>
    </div>
    ${calendarioHtml()}
    ${senza.length ? `<p class="vuoto" style="margin-top:.6rem">Nota: ${senza.length === 1 ?
      "1 compito aperto è senza scadenza e non compare" : senza.length + " compiti aperti sono senza scadenza e non compaiono"} nel calendario (vedi l'Elenco).</p>` : ""}`;

  $("#contenuto").innerHTML = `
    <div class="intestazione-vista">
      <h1>Scadenzario${sonoCapo() ? "" : " — i tuoi compiti"}</h1>
      <div class="azioni">
        <button class="bottone ${calendario ? "primario" : "secondario"}" id="modo-calendario">📅 Calendario</button>
        <button class="bottone ${calendario ? "secondario" : "primario"}" id="modo-elenco">☰ Elenco</button>
      </div>
    </div>
    ${calendario ? corpoCalendario : corpoElenco}`;

  $("#modo-calendario").addEventListener("click", () => { S.modoScadenzario = "calendario"; vistaScadenzario(); });
  $("#modo-elenco").addEventListener("click", () => { S.modoScadenzario = "elenco"; vistaScadenzario(); });

  if (calendario) {
    $("#cal-precedente").addEventListener("click", () => {
      S.calMese--; if (S.calMese < 0) { S.calMese = 11; S.calAnno--; }
      vistaScadenzario();
    });
    $("#cal-successivo").addEventListener("click", () => {
      S.calMese++; if (S.calMese > 11) { S.calMese = 0; S.calAnno++; }
      vistaScadenzario();
    });
    $("#cal-oggi-bottone").addEventListener("click", () => {
      const adesso = new Date();
      S.calAnno = adesso.getFullYear(); S.calMese = adesso.getMonth();
      vistaScadenzario();
    });
    $("#contenuto").querySelectorAll(".cal-chip[data-id]").forEach((chip) =>
      chip.addEventListener("click", () => apriCompito(Number(chip.dataset.id), "scadenzario")));
    $("#contenuto").querySelectorAll(".cal-piu").forEach((b) =>
      b.addEventListener("click", () => finestraGiorno(b.dataset.giorno)));
  } else {
    collegaRigheCompito($("#contenuto"), "scadenzario");
  }
}

// ---------------------------------------------------------------------------
// Report del titolare
// ---------------------------------------------------------------------------

const PERIODI_REPORT = [[7, "Ultimi 7 giorni"], [30, "Ultimi 30 giorni"],
  [90, "Ultimi 3 mesi"], [null, "Dall'inizio"]];

function datiReport() {
  const giorni = S.periodoReport;
  const nelPeriodo = (dataISO) => {
    if (!dataISO) return false;
    if (giorni === null) return true;
    const differenza = giorniAlla(dataISO.slice(0, 10)); // negativo = passato
    return differenza <= 0 && -differenza <= giorni;
  };
  const compiti = S.dati.compiti;
  const apertiTutti = compiti.filter(aperto);
  const scaduti = apertiTutti.filter((c) => c.scadenza && giorniAlla(c.scadenza) < 0);
  const problemi = compiti.filter(problemaAperto);
  const conclusi = compiti.filter((c) =>
    (c.stato === "Completato" || c.stato === "Archiviato") && nelPeriodo(c.data_completamento));
  const conclusiTardi = conclusi.filter((c) => c.scadenza && c.data_completamento > c.scadenza);
  const riscontri = [];
  for (const c of compiti) {
    for (const r of c.riscontri) if (nelPeriodo(r.quando)) riscontri.push({ ...r, compito: c });
  }
  riscontri.sort((a, b) => (a.quando < b.quando ? 1 : -1));

  const perCollaboratore = S.dati.utenti
    .filter((u) => u.attivo || compiti.some((c) => c.assegnato_a === u.id))
    .map((u) => {
      const suoi = (elenco) => elenco.filter((c) => c.assegnato_a === u.id);
      const suoiRiscontri = riscontri.filter((r) => r.autore === u.nome);
      return {
        utente: u,
        aperti: suoi(apertiTutti).length,
        scaduti: suoi(scaduti).length,
        problemi: suoi(problemi).length,
        conclusi: suoi(conclusi).length,
        tardi: suoi(conclusiTardi).length,
        ultimoRiscontro: suoiRiscontri.length ? suoiRiscontri[0].quando : null,
      };
    });
  const perCondominio = S.dati.condomini.map((cond) => {
    const del = (elenco) => elenco.filter((c) => c.condominio_id === cond.id);
    return { condominio: cond, aperti: del(apertiTutti).length, scaduti: del(scaduti).length,
      problemi: del(problemi).length, conclusi: del(conclusi).length };
  });
  const esiti = {};
  for (const e of ESITI) esiti[e] = conclusi.filter((c) => c.esito === e).length;
  const daTenereDocchio = [...new Set([...scaduti, ...problemi])].sort(ordinaPerScadenza);
  return { apertiTutti, scaduti, problemi, conclusi, conclusiTardi, riscontri,
    perCollaboratore, perCondominio, esiti, daTenereDocchio };
}

function nomePeriodo() {
  return PERIODI_REPORT.find(([g]) => g === S.periodoReport)[1].toLowerCase();
}

function tabellaCollaboratori(r, classe) {
  return `
    <div class="scorri-tabella"><table class="${classe}">
      <thead><tr><th>Collaboratore</th><th class="numero-cella">Aperti</th>
      <th class="numero-cella">Scaduti</th><th class="numero-cella">Problemi</th>
      <th class="numero-cella">Completati</th><th class="numero-cella">di cui in ritardo</th>
      <th>Ultimo riscontro</th></tr></thead>
      <tbody>${r.perCollaboratore.map((riga) => `
        <tr>
          <td><b>${esc(riga.utente.nome)}</b>${riga.utente.ruolo === "titolare" ? " (titolare)" : ""}${riga.utente.attivo ? "" : " — non attivo"}</td>
          <td class="numero-cella">${riga.aperti}</td>
          <td class="numero-cella ${riga.scaduti ? "cattivo" : ""}">${riga.scaduti}</td>
          <td class="numero-cella ${riga.problemi ? "cattivo" : ""}">${riga.problemi}</td>
          <td class="numero-cella ${riga.conclusi ? "buono" : ""}">${riga.conclusi}</td>
          <td class="numero-cella ${riga.tardi ? "cattivo" : ""}">${riga.tardi}</td>
          <td>${riga.ultimoRiscontro ? dataOra(riga.ultimoRiscontro) : "—"}</td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function tabellaCondomini(r, classe) {
  return `
    <div class="scorri-tabella"><table class="${classe}">
      <thead><tr><th>Condominio</th><th class="numero-cella">Aperti</th>
      <th class="numero-cella">Scaduti</th><th class="numero-cella">Problemi</th>
      <th class="numero-cella">Completati</th></tr></thead>
      <tbody>${r.perCondominio.map((riga) => `
        <tr>
          <td><b>${esc(riga.condominio.nome)}</b></td>
          <td class="numero-cella">${riga.aperti}</td>
          <td class="numero-cella ${riga.scaduti ? "cattivo" : ""}">${riga.scaduti}</td>
          <td class="numero-cella ${riga.problemi ? "cattivo" : ""}">${riga.problemi}</td>
          <td class="numero-cella ${riga.conclusi ? "buono" : ""}">${riga.conclusi}</td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function vistaReport() {
  if (!sonoCapo()) { vai("bacheca"); return; }
  const r = datiReport();
  const esitiTesto = ESITI.map((e) => `${e}: <b>${r.esiti[e]}</b>`).join(" · ");

  $("#contenuto").innerHTML = `
    <div class="intestazione-vista">
      <h1>Report dello studio</h1>
      <div class="azioni">
        <select id="report-periodo">${PERIODI_REPORT.map(([g, nome]) =>
          `<option value="${g === null ? "" : g}" ${g === S.periodoReport ? "selected" : ""}>${nome}</option>`).join("")}</select>
        <button class="bottone secondario" id="report-stampa">🖨 Stampa report</button>
      </div>
    </div>

    <div class="contatori">
      <div class="contatore aperti"><div class="numero">${r.apertiTutti.length}</div><div class="titolo">Compiti aperti oggi</div></div>
      <div class="contatore scaduti"><div class="numero">${r.scaduti.length}</div><div class="titolo">Scaduti da recuperare</div></div>
      <div class="contatore in-scadenza"><div class="numero">${r.problemi.length}</div><div class="titolo">Problemi segnalati</div></div>
      <div class="contatore completati"><div class="numero">${r.conclusi.length}</div><div class="titolo">Completati (${nomePeriodo()})</div></div>
    </div>

    <div class="riquadro">
      <h2>👥 Lavoro per collaboratore <span class="facoltativo" style="font-weight:400">(completati: ${nomePeriodo()})</span></h2>
      ${r.perCollaboratore.length ? tabellaCollaboratori(r, "tabella") : `<p class="vuoto">Nessun collaboratore.</p>`}
    </div>

    <div class="riquadro">
      <h2>🏢 Lavoro per condominio <span class="facoltativo" style="font-weight:400">(completati: ${nomePeriodo()})</span></h2>
      ${r.perCondominio.length ? tabellaCondomini(r, "tabella") : `<p class="vuoto">Nessun condominio.</p>`}
    </div>

    <div class="riquadro">
      <h2>✅ Esiti dei compiti completati (${nomePeriodo()})</h2>
      <p style="margin:.2rem 0">${esitiTesto}${r.conclusiTardi.length ? ` — completati oltre la scadenza: <b class="cattivo" style="color:var(--rosso)">${r.conclusiTardi.length}</b>` : ""}</p>
    </div>

    <div class="riquadro">
      <h2>⚠️ Da tenere d'occhio: scaduti e problemi</h2>
      ${r.daTenereDocchio.length ? r.daTenereDocchio.slice(0, 10).map((c) => rigaCompito(c)).join("")
        : `<p class="vuoto">Niente da segnalare: nessun compito scaduto e nessun problema aperto.</p>`}
    </div>

    <div class="riquadro">
      <h2>📣 Ultimi riscontri ricevuti (${nomePeriodo()})</h2>
      ${r.riscontri.length ? r.riscontri.slice(0, 12).map((x) => `
        <button class="riga-compito ${x.problema ? "novita" : ""}" data-id="${x.compito.id}">
          <div class="titolo-compito">${esc(x.autore)} — ${esc(x.compito.titolo)}</div>
          <div class="sotto"><span>🏢 ${esc(nomeCondominio(x.compito.condominio_id))}</span>
            <span>${dataOra(x.quando)}</span>
            ${x.problema ? `<span class="etichetta etichetta-problema">⚠ Problema</span>` : ""}</div>
        </button>`).join("") : `<p class="vuoto">Nessun riscontro nel periodo scelto.</p>`}
    </div>`;

  collegaRigheCompito($("#contenuto"), "report");
  $("#report-periodo").addEventListener("change", (e) => {
    S.periodoReport = e.target.value === "" ? null : Number(e.target.value);
    vistaReport();
  });
  $("#report-stampa").addEventListener("click", stampaReportStudio);
}

function stampaReportStudio() {
  const r = datiReport();
  const esitiTesto = ESITI.map((e) => `${e}: <b>${r.esiti[e]}</b>`).join(" — ");
  eseguiStampa(`
    ${intestazioneStampa("Report dello studio (" + nomePeriodo() + ")")}
    <div class="stampa-sezione">
      <div class="nome-sezione">Situazione generale</div>
      <div class="stampa-testo">Compiti aperti oggi: <b>${r.apertiTutti.length}</b> —
        di cui scaduti: <b>${r.scaduti.length}</b> — problemi segnalati: <b>${r.problemi.length}</b> —
        completati nel periodo: <b>${r.conclusi.length}</b> (oltre la scadenza: ${r.conclusiTardi.length})<br>
        Esiti: ${esitiTesto}</div>
    </div>
    <div class="stampa-sezione">
      <div class="nome-sezione">Lavoro per collaboratore</div>
      ${tabellaCollaboratori(r, "stampa-tabella")}
    </div>
    <div class="stampa-sezione">
      <div class="nome-sezione">Lavoro per condominio</div>
      ${tabellaCondomini(r, "stampa-tabella")}
    </div>
    <div class="stampa-sezione">
      <div class="nome-sezione">Da tenere d'occhio (scaduti e problemi)</div>
      ${r.daTenereDocchio.length ? `<table class="stampa-tabella"><thead>
        <tr><th>Compito</th><th>Condominio</th><th>Assegnato a</th><th>Scadenza</th><th>Stato</th></tr></thead>
        <tbody>${r.daTenereDocchio.map((c) => `<tr>
          <td>${esc(c.titolo)}${problemaAperto(c) ? " ⚠" : ""}</td>
          <td>${esc(nomeCondominio(c.condominio_id))}</td>
          <td>${esc(nomeUtente(c.assegnato_a))}</td>
          <td>${c.scadenza ? dataBreve(c.scadenza) : "—"}</td>
          <td>${esc(c.stato)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="stampa-testo">Niente da segnalare.</div>`}
    </div>
    <div class="stampa-pie">Report generato con CondoCompiti — i dati restano sul computer dello studio.</div>`);
}

// ---------------------------------------------------------------------------
// Anagrafiche (solo titolare)
// ---------------------------------------------------------------------------

function pannelloCollaboratori() {
  const apertiPerUtente = (id) => S.dati.compiti.filter((c) => c.assegnato_a === id && aperto(c)).length;
  return `
    <div class="riquadro">
      <h2>👥 Collaboratori e PIN <button class="bottone primario piccolo utente-nuovo">+ Aggiungi</button></h2>
      ${S.dati.utenti.map((u) => `
        <div class="riga-elemento ${u.attivo ? "" : "non-attivo"}">
          <div><div class="principale">${esc(u.nome)}</div>
          <div class="secondario-testo">${u.ruolo === "titolare" ? "Titolare" : "Dipendente"}${u.attivo ? "" : " · non attivo"} · ${apertiPerUtente(u.id)} compiti aperti</div></div>
          <div class="azioni-riga">
            <button class="bottone secondario piccolo" data-modifica-utente="${u.id}">Modifica</button>
            <button class="bottone secondario piccolo" data-pin-utente="${u.id}">Cambia PIN</button>
            ${u.id !== S.utente.id ? `<button class="bottone pericolo piccolo" data-elimina-utente="${u.id}">Elimina</button>` : ""}
          </div>
        </div>`).join("")}
      <p class="nota-informativa">Con <b>+ Aggiungi</b> crei un collaboratore: gli basterà
      scegliere il proprio nome e digitare il suo PIN per entrare. Per chi lascia lo studio usa
      <b>Modifica → non attivo</b> (i compiti passati restano intestati a lui) oppure
      <b>Elimina</b> per la cancellazione definitiva.</p>
    </div>`;
}

function collegaPannelloCollaboratori() {
  const radice = $("#contenuto");
  radice.querySelectorAll(".utente-nuovo").forEach((b) =>
    b.addEventListener("click", () => finestraUtente(null)));
  radice.querySelectorAll("[data-modifica-utente]").forEach((b) =>
    b.addEventListener("click", () =>
      finestraUtente(S.dati.utenti.find((u) => u.id === Number(b.dataset.modificaUtente)))));
  radice.querySelectorAll("[data-pin-utente]").forEach((b) =>
    b.addEventListener("click", () =>
      finestraPin(S.dati.utenti.find((u) => u.id === Number(b.dataset.pinUtente)))));
  radice.querySelectorAll("[data-elimina-utente]").forEach((b) =>
    b.addEventListener("click", async () => {
      const u = S.dati.utenti.find((x) => x.id === Number(b.dataset.eliminaUtente));
      if (!confirm(`Eliminare definitivamente «${u.nome}»?\nI suoi compiti resteranno, da riassegnare.`)) return;
      const ok = await esegui(() => api(`utenti/${u.id}`, "DELETE"), "Collaboratore eliminato.");
      if (ok) aggiorna();
    }));
}

function vistaAnagrafiche() {
  if (!sonoCapo()) { vai("bacheca"); return; }
  const apertiPerCondominio = (id) => S.dati.compiti.filter((c) => c.condominio_id === id && aperto(c)).length;

  $("#contenuto").innerHTML = `
    <div class="intestazione-vista"><h1>Anagrafiche</h1></div>
    <div class="riquadro">
      <h2>🏢 Condomìni <button class="bottone primario piccolo" id="condominio-nuovo">+ Aggiungi</button></h2>
      ${S.dati.condomini.length ? S.dati.condomini.map((c) => `
        <div class="riga-elemento">
          <div><div class="principale">${esc(c.nome)}</div>
          <div class="secondario-testo">${esc(c.indirizzo || "")}${c.indirizzo ? " · " : ""}${apertiPerCondominio(c.id)} compiti aperti</div></div>
          <div class="azioni-riga">
            <button class="bottone secondario piccolo" data-modifica-condominio="${c.id}">Modifica</button>
            <button class="bottone pericolo piccolo" data-elimina-condominio="${c.id}">Elimina</button>
          </div>
        </div>`).join("") : `<p class="vuoto">Nessun condominio inserito.</p>`}
    </div>
    ${pannelloCollaboratori()}`;

  collegaPannelloCollaboratori();
  $("#condominio-nuovo").addEventListener("click", () => finestraCondominio(null));
  $("#contenuto").querySelectorAll("[data-modifica-condominio]").forEach((b) =>
    b.addEventListener("click", () =>
      finestraCondominio(S.dati.condomini.find((c) => c.id === Number(b.dataset.modificaCondominio)))));
  $("#contenuto").querySelectorAll("[data-elimina-condominio]").forEach((b) =>
    b.addEventListener("click", async () => {
      const c = S.dati.condomini.find((x) => x.id === Number(b.dataset.eliminaCondominio));
      const collegati = S.dati.compiti.filter((x) => x.condominio_id === c.id).length;
      if (!confirm(`Eliminare il condominio «${c.nome}»?` +
        (collegati ? `\nVerranno eliminati anche i suoi ${collegati} compiti.` : "") +
        `\nL'operazione non si può annullare.`)) return;
      const ok = await esegui(() => api(`condomini/${c.id}`, "DELETE"), "Condominio eliminato.");
      if (ok) aggiorna();
    }));
}

// ---------------------------------------------------------------------------
// Impostazioni (solo titolare)
// ---------------------------------------------------------------------------

function vistaImpostazioni() {
  if (!sonoCapo()) { vai("bacheca"); return; }
  const imp = S.dati.impostazioni;
  const registro = S.dati.registro || [];

  $("#contenuto").innerHTML = `
    <div class="intestazione-vista"><h1>Impostazioni</h1></div>

    <div class="riquadro">
      <h2>🌐 Accesso dagli altri computer dell'ufficio</h2>
      <p>Sugli altri computer (o tablet e telefoni) collegati alla <b>stessa rete</b> dello studio,
      apri il browser e scrivi uno di questi indirizzi:</p>
      <div>${(S.dati.rete || []).map((i) => `<span class="indirizzo-rete">${esc(i)}</span>`).join("") ||
        `<span class="vuoto">Indirizzo di rete non rilevato: guarda la finestra nera del programma.</span>`}</div>
      <p class="nota-informativa" style="margin-bottom:0">Non serve installare nulla sugli altri computer:
      basta il browser. I dati non escono mai da questo computer.</p>
    </div>

    ${pannelloCollaboratori()}

    <div class="riquadro">
      <h2>💾 Copia di sicurezza e dati</h2>
      <p>Tutti i dati sono in un unico file su questo computer:<br>
      <b>${esc(S.dati.percorso_dati || "")}</b><br>
      <span style="color:var(--testo-tenue)">Il file resta al suo posto anche quando aggiorni
      il programma sostituendo la sua cartella: la nuova versione lo ritrova da sola.</span></p>
      <div class="azioni-riga" style="display:flex;gap:.6rem;flex-wrap:wrap">
        <button class="bottone primario" id="dati-esporta">⬇ Esporta tutti i dati (backup)</button>
        <button class="bottone secondario" id="dati-importa">⬆ Importa / ripristina da backup</button>
        <input type="file" id="dati-file" accept=".json,application/json" class="nascosto">
        <button class="bottone pericolo" id="dati-azzera">🗑 Cancella tutti i dati</button>
      </div>
      <p class="nota-informativa" style="margin-top:.8rem;margin-bottom:0">
      <b>Consiglio:</b> una volta a settimana premi «Esporta tutti i dati» e salva il file
      su una chiavetta USB. Per ripristinare, usa «Importa» e scegli quel file.
      Per cancellare un singolo condominio, collaboratore o compito, usa il bottone
      «Elimina» accanto all'elemento.</p>
    </div>

    <div class="riquadro">
      <h2>📒 Registro attività</h2>
      <label class="spunta"><input type="checkbox" id="registro-attivo" ${imp.registro_attivo ? "checked" : ""}>
        Annota chi crea o modifica i compiti e quando (tracciabilità)</label>
      ${imp.registro_attivo ? (registro.length ? registro.slice(0, 40).map((r) => `
        <div class="registro-riga"><span class="quando-registro">${dataOra(r.quando)}</span>
        <span><b>${esc(r.chi)}</b> — ${esc(r.azione)}</span></div>`).join("") :
        `<p class="vuoto">Il registro è vuoto.</p>`) :
        `<p class="vuoto">Il registro è spento: non viene annotato nulla.</p>`}
      ${registro.length ? `<div style="margin-top:.7rem">
        <button class="bottone pericolo piccolo" id="registro-svuota">Svuota il registro</button></div>` : ""}
    </div>

    <div class="riquadro">
      <h2>🏷 Nome dello studio</h2>
      <input id="impostazioni-nome-studio" value="${esc(imp.nome_studio)}" style="max-width:26rem;width:100%">
      <div class="finestra-bottoni" style="justify-content:flex-start">
        <button class="bottone primario" id="impostazioni-salva-nome">Salva</button>
      </div>
    </div>`;

  collegaPannelloCollaboratori();

  $("#dati-esporta").addEventListener("click", () => {
    const collegamento = document.createElement("a");
    collegamento.href = "/api/esporta";
    collegamento.download = "";
    document.body.appendChild(collegamento);
    collegamento.click();
    collegamento.remove();
    avviso("Backup scaricato: conservalo in un posto sicuro (es. chiavetta USB).");
  });
  $("#dati-importa").addEventListener("click", () => $("#dati-file").click());
  $("#dati-file").addEventListener("change", async (evento) => {
    const file = evento.target.files[0];
    evento.target.value = "";
    if (!file) return;
    let contenuto;
    try { contenuto = JSON.parse(await file.text()); }
    catch (e) { avviso("Il file scelto non è un backup valido.", true); return; }
    if (!confirm(`Ripristinare i dati dal file «${file.name}»?\n` +
      `ATTENZIONE: i dati attuali verranno SOSTITUITI da quelli del backup.`)) return;
    const ok = await esegui(() => api("importa", "POST", { dati: contenuto }));
    if (ok) {
      avviso("Dati ripristinati. Ora entra di nuovo con nome e PIN.");
      setTimeout(() => location.reload(), 1600);
    }
  });
  $("#dati-azzera").addEventListener("click", async () => {
    const risposta = prompt("Questa operazione CANCELLA TUTTI I DATI (condomìni, compiti, collaboratori).\n" +
      "Resterà solo il tuo utente. Non si può annullare.\n\nPer confermare scrivi: AZZERA");
    if (risposta === null) return;
    if (risposta.trim().toUpperCase() !== "AZZERA") { avviso("Cancellazione annullata.", true); return; }
    const ok = await esegui(() => api("azzera", "POST", { conferma: "AZZERA" }), "Tutti i dati sono stati cancellati.");
    if (ok) aggiorna();
  });

  $("#registro-attivo").addEventListener("change", async (e) => {
    const ok = await esegui(() => api("impostazioni", "PUT", { registro_attivo: e.target.checked }));
    if (ok) aggiorna();
  });
  const svuota = $("#registro-svuota");
  if (svuota) svuota.addEventListener("click", async () => {
    if (!confirm("Svuotare il registro attività?")) return;
    const ok = await esegui(() => api("registro-azzera", "POST", {}), "Registro svuotato.");
    if (ok) aggiorna();
  });
  $("#impostazioni-salva-nome").addEventListener("click", async () => {
    const ok = await esegui(() => api("impostazioni", "PUT",
      { nome_studio: $("#impostazioni-nome-studio").value }), "Nome dello studio salvato.");
    if (ok) aggiorna();
  });
}

// ---------------------------------------------------------------------------
// Finestre: compito, modello, condominio, utente, PIN
// ---------------------------------------------------------------------------

function opzioniSelect(elenco, scelto) {
  return elenco.map((v) =>
    `<option value="${esc(v[0])}" ${String(v[0]) === String(scelto) ? "selected" : ""}>${esc(v[1])}</option>`).join("");
}

function finestraCompito(compito) {
  const nuovo = !compito;
  const attivi = S.dati.utenti.filter((u) => u.attivo);
  apriFinestra(`
    <h2>${nuovo ? "Nuovo compito" : "Modifica compito"}</h2>
    <label for="fc-titolo">Titolo del compito *</label>
    <input id="fc-titolo" value="${esc(compito ? compito.titolo : "")}" placeholder="Es.: Inviare le convocazioni per l'assemblea">
    <div class="campo-doppio">
      <div><label for="fc-condominio">Condominio *</label>
      <select id="fc-condominio">${opzioniSelect(S.dati.condomini.map((c) => [c.id, c.nome]), compito ? compito.condominio_id : "")}</select></div>
      <div><label for="fc-assegnato">Assegnato a *</label>
      <select id="fc-assegnato">${opzioniSelect(attivi.map((u) => [u.id, u.nome]), compito ? compito.assegnato_a : "")}</select></div>
    </div>
    <div class="campo-doppio">
      <div><label for="fc-categoria">Categoria</label>
      <select id="fc-categoria">${opzioniSelect(CATEGORIE.map((c) => [c, c]), compito ? compito.categoria : "Altro")}</select></div>
      <div><label for="fc-priorita">Priorità</label>
      <select id="fc-priorita">${opzioniSelect(PRIORITA.map((p) => [p, p]), compito ? compito.priorita : "Media")}</select></div>
    </div>
    <label for="fc-scadenza">Scadenza <span class="facoltativo">(facoltativa)</span></label>
    <input id="fc-scadenza" type="date" value="${esc(compito ? compito.scadenza || "" : "")}">
    <label for="fc-istruzioni">Istruzioni per il collaboratore</label>
    <textarea id="fc-istruzioni" rows="4" placeholder="Scrivi cosa va fatto, come e con quali documenti…">${esc(compito ? compito.istruzioni : "")}</textarea>
    <div class="finestra-bottoni">
      <button class="bottone secondario" id="fc-annulla">Annulla</button>
      <button class="bottone primario" id="fc-salva">${nuovo ? "Crea il compito" : "Salva le modifiche"}</button>
    </div>`);

  $("#fc-annulla").addEventListener("click", chiudiFinestra);
  $("#fc-salva").addEventListener("click", async () => {
    const corpo = {
      titolo: $("#fc-titolo").value,
      condominio_id: Number($("#fc-condominio").value) || null,
      assegnato_a: Number($("#fc-assegnato").value) || null,
      categoria: $("#fc-categoria").value,
      priorita: $("#fc-priorita").value,
      scadenza: $("#fc-scadenza").value || null,
      istruzioni: $("#fc-istruzioni").value,
    };
    const ok = await esegui(
      () => nuovo ? api("compiti", "POST", corpo) : api(`compiti/${compito.id}`, "PUT", corpo),
      nuovo ? "Compito creato e assegnato." : "Compito aggiornato.");
    if (ok) { chiudiFinestra(); aggiorna(); }
  });
}

function finestraModello(chiave) {
  const modello = S.dati.modelli[chiave];
  const attivi = S.dati.utenti.filter((u) => u.attivo);
  apriFinestra(`
    <h2>⚡ ${esc(modello.nome)}</h2>
    <p>${esc(modello.descrizione)}<br>Verranno creati <b>${modello.n_compiti} compiti</b> già pronti,
    con scadenze calcolate dalla data indicata. Potrai poi modificarli o riassegnarli uno per uno.</p>
    <div class="campo-doppio">
      <div><label for="fm-condominio">Condominio *</label>
      <select id="fm-condominio">${opzioniSelect(S.dati.condomini.map((c) => [c.id, c.nome]), "")}</select></div>
      <div><label for="fm-assegnato">Assegna i compiti a *</label>
      <select id="fm-assegnato">${opzioniSelect(attivi.map((u) => [u.id, u.nome]), "")}</select></div>
    </div>
    <label for="fm-data">${esc(modello.etichetta_data)} *</label>
    <input id="fm-data" type="date" value="${oggiISO()}">
    <div class="finestra-bottoni">
      <button class="bottone secondario" id="fm-annulla">Annulla</button>
      <button class="bottone primario" id="fm-genera">Genera i compiti</button>
    </div>`);
  $("#fm-annulla").addEventListener("click", chiudiFinestra);
  $("#fm-genera").addEventListener("click", async () => {
    const condominio = Number($("#fm-condominio").value) || null;
    const esito = await esegui(() => api(`modelli/${chiave}`, "POST", {
      condominio_id: condominio,
      assegnato_a: Number($("#fm-assegnato").value) || null,
      data_base: $("#fm-data").value,
    }), (r) => `Creati ${r.creati} compiti dal modello «${modello.nome}».`);
    if (esito) {
      chiudiFinestra();
      S.filtri = { ricerca: "", condominio: String(condominio), dipendente: "", stato: "", categoria: "", speciale: "" };
      await aggiorna();
      vai("compiti");
    }
  });
}

function finestraCondominio(condominio) {
  const nuovo = !condominio;
  apriFinestra(`
    <h2>${nuovo ? "Nuovo condominio" : "Modifica condominio"}</h2>
    <label for="fd-nome">Nome del condominio *</label>
    <input id="fd-nome" value="${esc(condominio ? condominio.nome : "")}" placeholder="Es.: Condominio Traiano">
    <label for="fd-indirizzo">Indirizzo <span class="facoltativo">(facoltativo)</span></label>
    <input id="fd-indirizzo" value="${esc(condominio ? condominio.indirizzo : "")}" placeholder="Es.: Via Appia 12">
    <div class="finestra-bottoni">
      <button class="bottone secondario" id="fd-annulla">Annulla</button>
      <button class="bottone primario" id="fd-salva">${nuovo ? "Aggiungi" : "Salva"}</button>
    </div>`);
  $("#fd-annulla").addEventListener("click", chiudiFinestra);
  $("#fd-salva").addEventListener("click", async () => {
    const corpo = { nome: $("#fd-nome").value, indirizzo: $("#fd-indirizzo").value };
    const ok = await esegui(
      () => nuovo ? api("condomini", "POST", corpo) : api(`condomini/${condominio.id}`, "PUT", corpo),
      nuovo ? "Condominio aggiunto." : "Condominio aggiornato.");
    if (ok) { chiudiFinestra(); aggiorna(); }
  });
}

function finestraUtente(utente) {
  const nuovo = !utente;
  apriFinestra(`
    <h2>${nuovo ? "Nuovo collaboratore" : "Modifica collaboratore"}</h2>
    <label for="fu-nome">Nome *</label>
    <input id="fu-nome" value="${esc(utente ? utente.nome : "")}" placeholder="Es.: Luca">
    <p class="nota-informativa">Basta il nome (o nome e iniziale): servono solo i dati indispensabili.</p>
    <label for="fu-ruolo">Ruolo</label>
    <select id="fu-ruolo">
      <option value="dipendente" ${utente && utente.ruolo === "dipendente" ? "selected" : ""}>Dipendente</option>
      <option value="titolare" ${utente && utente.ruolo === "titolare" ? "selected" : ""}>Titolare</option>
    </select>
    ${nuovo ? `
      <label for="fu-pin">PIN di accesso (4-8 cifre) *</label>
      <input id="fu-pin" inputmode="numeric" maxlength="8" placeholder="Es.: 1234">` : `
      <label class="spunta"><input type="checkbox" id="fu-attivo" ${utente.attivo ? "checked" : ""}>
      Utente attivo (può entrare e ricevere compiti)</label>`}
    <div class="finestra-bottoni">
      <button class="bottone secondario" id="fu-annulla">Annulla</button>
      <button class="bottone primario" id="fu-salva">${nuovo ? "Aggiungi" : "Salva"}</button>
    </div>`);
  $("#fu-annulla").addEventListener("click", chiudiFinestra);
  $("#fu-salva").addEventListener("click", async () => {
    const corpo = { nome: $("#fu-nome").value, ruolo: $("#fu-ruolo").value };
    if (nuovo) corpo.pin = $("#fu-pin").value.trim();
    else corpo.attivo = $("#fu-attivo").checked;
    const ok = await esegui(
      () => nuovo ? api("utenti", "POST", corpo) : api(`utenti/${utente.id}`, "PUT", corpo),
      nuovo ? "Collaboratore aggiunto: ora può entrare con il suo PIN." : "Collaboratore aggiornato.");
    if (ok) { chiudiFinestra(); aggiorna(); }
  });
}

function finestraPin(utente) {
  const mio = utente.id === S.utente.id;
  apriFinestra(`
    <h2>Cambia PIN — ${esc(utente.nome)}</h2>
    <label for="fp-pin">Nuovo PIN (4-8 cifre)</label>
    <input id="fp-pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
    <label for="fp-pin2">Ripeti il nuovo PIN</label>
    <input id="fp-pin2" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
    <div class="finestra-bottoni">
      <button class="bottone secondario" id="fp-annulla">Annulla</button>
      <button class="bottone primario" id="fp-salva">Salva il PIN</button>
    </div>`);
  $("#fp-annulla").addEventListener("click", chiudiFinestra);
  $("#fp-salva").addEventListener("click", async () => {
    const pin = $("#fp-pin").value.trim();
    if (pin !== $("#fp-pin2").value.trim()) { avviso("I due PIN non coincidono: riprova.", true); return; }
    const ok = await esegui(
      () => mio && !sonoCapo() ? api("utenti/mio-pin", "POST", { pin }) : api(`utenti/${utente.id}`, "PUT", { pin }),
      "PIN aggiornato: usalo dal prossimo accesso.");
    if (ok) chiudiFinestra();
  });
}

// ---------------------------------------------------------------------------
// Stampa "a misura di carta"
// ---------------------------------------------------------------------------

function eseguiStampa(html) {
  $("#area-stampa").innerHTML = html;
  document.body.classList.add("modalita-stampa");
  const pulisci = () => {
    document.body.classList.remove("modalita-stampa");
    $("#area-stampa").innerHTML = "";
    window.removeEventListener("afterprint", pulisci);
  };
  window.addEventListener("afterprint", pulisci);
  setTimeout(() => { window.print(); setTimeout(pulisci, 1500); }, 50);
}

function intestazioneStampa(tipoDocumento) {
  return `
    <div class="stampa-intestazione">
      <span class="studio">${esc(S.dati.impostazioni.nome_studio)}</span>
      <span class="doc">${tipoDocumento} — stampato il ${dataBreve(oggiISO())}</span>
    </div>`;
}

function stampaScheda(c) {
  const scad = descriviScadenza(c);
  const righeVuote = `<div class="riga-scrittura"></div>`.repeat(7);
  const riscontri = c.riscontri.map((r) => `
    <div class="stampa-riscontro"><b>${esc(r.autore)}</b> — ${dataOra(r.quando)}
    ${r.problema ? " — ⚠ PROBLEMA SEGNALATO" : ""}<div class="stampa-testo">${esc(r.testo)}</div></div>`).join("");

  eseguiStampa(`
    ${intestazioneStampa("Scheda compito n. " + c.id)}
    <div class="stampa-titolo">${esc(c.titolo)}</div>
    <div class="stampa-griglia">
      <div class="voce"><b>Condominio:</b> ${esc(nomeCondominio(c.condominio_id))}</div>
      <div class="voce"><b>Categoria:</b> ${esc(c.categoria)}</div>
      <div class="voce"><b>Assegnato a:</b> ${esc(nomeUtente(c.assegnato_a))}</div>
      <div class="voce"><b>Assegnato da:</b> ${esc(nomeUtente(c.assegnato_da))}</div>
      <div class="voce"><b>Data assegnazione:</b> ${dataBreve(c.data_assegnazione)}</div>
      <div class="voce"><b>Scadenza:</b> ${esc(scad.testo)}</div>
      <div class="voce"><b>Priorità:</b> ${esc(c.priorita)}</div>
      <div class="voce"><b>Stato attuale:</b> ${esc(c.stato)}${c.esito ? " — " + esc(c.esito) : ""}</div>
    </div>
    <div class="stampa-sezione">
      <div class="nome-sezione">Istruzioni del titolare</div>
      <div class="stampa-testo">${c.istruzioni ? esc(c.istruzioni) : "—"}</div>
    </div>
    ${c.riscontri.length ? `<div class="stampa-sezione">
      <div class="nome-sezione">Riscontri già registrati</div>${riscontri}</div>` : ""}
    ${c.nota_ritorno ? `<div class="stampa-sezione">
      <div class="nome-sezione">Nota di ritorno del titolare</div>
      <div class="stampa-testo">${esc(c.nota_ritorno)}</div></div>` : ""}
    <div class="stampa-sezione">
      <div class="nome-sezione">Riscontro del collaboratore (da compilare a mano)</div>
      ${righeVuote}
      <div class="stampa-caselle">
        <span>Esito: &nbsp; ☐ Completato regolarmente</span>
        <span>☐ Completato con osservazioni</span>
        <span>☐ Non completato</span>
      </div>
    </div>
    <div class="stampa-firma">
      <div class="campo-firma">Data</div>
      <div class="campo-firma">Firma del collaboratore</div>
      <div class="campo-firma">Visto del titolare</div>
    </div>`);
}

function stampaRegistro(compiti) {
  const perCondominio = new Map();
  for (const c of compiti) {
    if (!perCondominio.has(c.condominio_id)) perCondominio.set(c.condominio_id, []);
    perCondominio.get(c.condominio_id).push(c);
  }
  const gruppi = [...perCondominio.entries()]
    .sort((a, b) => nomeCondominio(a[0]).localeCompare(nomeCondominio(b[0])));
  const righe = gruppi.map(([idCond, elenco]) => `
    <tr><td colspan="6" class="stampa-gruppo">🏢 ${esc(nomeCondominio(idCond))}</td></tr>
    ${elenco.sort((a, b) => pesoStato(a) - pesoStato(b) || ordinaPerScadenza(a, b)).map((c) => `
      <tr>
        <td>${esc(c.titolo)}<br><small>${esc(c.categoria)}</small></td>
        <td>${esc(nomeUtente(c.assegnato_a))}</td>
        <td>${c.scadenza ? dataBreve(c.scadenza) : "—"}</td>
        <td>${esc(c.priorita)}</td>
        <td>${esc(c.stato)}</td>
        <td>${esc(c.esito || "")}</td>
      </tr>`).join("")}`).join("");

  eseguiStampa(`
    ${intestazioneStampa("Registro dei compiti")}
    <table class="stampa-tabella">
      <thead><tr><th>Compito</th><th>Assegnato a</th><th>Scadenza</th>
      <th>Priorità</th><th>Stato</th><th>Esito</th></tr></thead>
      <tbody>${righe || `<tr><td colspan="6">Nessun compito da stampare.</td></tr>`}</tbody>
    </table>
    <div class="stampa-pie">${compiti.length} compiti stampati · CondoCompiti</div>`);
}

// ---------------------------------------------------------------------------
// Avvio e collegamenti generali
// ---------------------------------------------------------------------------

$("#accesso-entra").addEventListener("click", entra);
$("#accesso-pin").addEventListener("keydown", (e) => { if (e.key === "Enter") entra(); });
$("#accesso-indietro").addEventListener("click", () => {
  $("#accesso-passo-pin").classList.add("nascosto");
  $("#accesso-passo-nome").classList.remove("nascosto");
});

$("#bottone-esci").addEventListener("click", async () => {
  try { await api("uscita", "POST", {}); } catch (e) { /* comunque usciamo */ }
  S.utente = null;
  S.dati = null;
  mostraAccesso();
});

$("#velo").addEventListener("click", (e) => { if (e.target.id === "velo") chiudiFinestra(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && finestraAperta()) chiudiFinestra(); });

// Aggiornamento automatico ogni minuto (per vedere i nuovi riscontri senza fare nulla)
setInterval(async () => {
  if (!S.utente || finestraAperta() || document.hidden) return;
  if (S.vista === "dettaglio") return;
  const attivo = document.activeElement;
  if (attivo && ["INPUT", "TEXTAREA", "SELECT"].includes(attivo.tagName)) return;
  try { await aggiorna(); } catch (e) { /* riproveremo al prossimo giro */ }
}, 60000);

// All'apertura: se c'è già una sessione valida entriamo subito, altrimenti accesso
(async function avvio() {
  try {
    await caricaEMostra();
  } catch (e) {
    mostraAccesso();
  }
})();
