# DESIGN.md: Buy House in Italy

Direzione data dal committente, seguita dalle decisioni prese, una riga ciascuna.

## Direzione

Dal brief iniziale:
- Identità: un servizio personale di property finding per acquirenti stranieri, gestito da Oikos Immobiliare. Progettato attorno al brief del buyer.
- Carattere: competente, personale, internazionale. Sobrio, mai "portale".
- Tipografia: serif elegante per i titoli, sans leggibile per il testo.
- Atmosfera: premium, molta aria, immagini grandi, solo micro-interazioni leggere.

Revisioni del 15 ottobre 2026 (sostituiscono le indicazioni precedenti dove diverse):
- Il sito serve prima di tutto a capire cosa vuole il cliente: nessun catalogo di immobili.
- Palette elegante: bianco, vaniglia, giallo oro.
- Ispirazione: il sito di Oikos Immobiliare (oikosimmobiliare.biz): fondo bianco, oro come unico accento, titoli in Prata, molta aria.
- Lingua italiana aggiunta.
- Possibilità di passare dal tema chiaro a quello scuro.
- Foto della Puglia senza copyright al posto dei segnaposto.
- Tutto il sito in italiano, intervista compresa, così chi sceglie IT resta in italiano su ogni pagina.
- Team: Flavio Moretto, Alessandra Toniolo, Diego Moretto.
- Revisione del 16 ottobre 2026: logo Oikos Immobiliare e foto del team forniti dal committente.
- Revisione del 16 ottobre 2026 (home): la home deve essere semplice e minimale e far capire subito che il sito serve a dire cosa vuoi. Titolo scelto dal committente: "Dicci cosa vuoi."
- Revisione del 20 ottobre 2026: il sito si apre sempre nel tema chiaro.
- Revisione del 20 ottobre 2026 (Dove comprare): al posto della griglia di schede, una mappa interattiva dell'Italia; con il cursore ci si sposta sulle regioni e si seleziona, con nomi e informazioni di ogni regione.

Dial: ENERGY 2 / RHYTHM 3 / MOTION 1 (la home è una sola schermata, quindi il RHYTHM vale per le altre pagine)

## Decisioni e motivazioni

| Decisione | Motivazione |
|---|---|
| Pagina bianca `#FFFFFF`, fasce vaniglia `#F8F1DF`, superfici `#FFFDF7` | Bianco e vaniglia richiesti; la vaniglia separa le sezioni senza introdurre un altro colore. |
| Oro Oikos `#CEA040` solo come riempimento, con testo scuro | È l'oro del sito Oikos; con testo bianco arriva a 2,4:1 e non è leggibile, con testo `#221F1A` arriva a 6,8:1. |
| Oro scuro `#7A5A10` per testi e numeri in oro | La stessa famiglia dell'oro Oikos, scurita fino a superare 4,5:1 anche sulla vaniglia. |
| Inchiostro `#221F1A`, grigio caldo `#5C564B` | Nero caldo come i testi del sito Oikos; i neutri restano nella famiglia del bianco e della vaniglia. |
| Carbone `#23211D` per footer e chiusura | Una sola superficie scura, come le foto scure dell'hero Oikos, su cui l'oro risalta. |
| Link color inchiostro con sottolineatura oro | Il marchio si vede in ogni link senza spargere l'accento su tutto il testo. |
| Oro riservato a: azione principale, segno "Must have", numeri dei temi dell'intervista, barra di avanzamento | Un accento deliberato: dove c'è oro c'è la cosa da fare o quella che conta di più. |
| Rosso scuro `#9B2C1C` solo per errori e segno "Deal breaker" | "Fuori" e "errore" condividono il significato; nessun colore decorativo in più. |
| Prata per i titoli (self-hosted, un file, 19 KB) | È il carattere dei titoli del sito Oikos: lega il servizio al marchio che lo gestisce. Un Didone, come i caratteri della tradizione tipografica italiana. |
| Font di sistema per il testo | Testo il più veloce possibile; l'identità la portano Prata e l'oro. |
| Motivo d'identità: il brief (segni Must / Nice / Deal breaker) | Il sito serve a capire cosa vuole il cliente: gli stessi tre segni compaiono nella home, nell'intervista, nel riepilogo e nell'area consulente. |
| Home su una sola schermata: la domanda "Dicci cosa vuoi.", una riga, i tre modi di rispondere, l'esempio di brief | Richiesta del committente: la home dice solo a cosa serve il sito. Servizi, zone, paesi e FAQ restano nelle loro pagine, raggiungibili dal menu e dal footer. |
| Titolo della home in Prata fino a 6rem, unico elemento grande | Un solo punto focale: la domanda. Niente foto, che le farebbe concorrenza. |
| Esempio di brief accanto ai tre modi di rispondere | Mostra cosa diventa la risposta (indispensabile, gradito, da escludere) senza bisogno di una sezione in più. |
| Nessuna scheda immobile pubblica | Richiesta del committente; gli immobili restano nel motore di matching e nell'area consulente. |
| Foto reali CC0 o di pubblico dominio, la Puglia in primo piano (trulli di Alberobello) | Richiesta del committente; il trullo è il simbolo più riconoscibile della zona in cui lavora Oikos. Nessuna foto con persone riconoscibili. |
| Raggi: 3px controlli, 8px pannelli, pillola solo per i chip di scelta | Più netti di prima, come il sito Oikos; i chip restano riconoscibili come scelte. |
| Ombra solo su ciò che sta sopra il contenuto (banner consensi, barra CTA mobile, menu lingua) | L'elevazione segnala "questo è sopra"; il resto sta piatto. |
| Tre misure di sezione | Introdurre (grande), elencare (media), collegare (piccola): il ritmo segue il contenuto. |
| Tema chiaro all'apertura, scuro solo dal pulsante nell'header | Il bianco è il marchio, quindi il sito si apre chiaro anche con il sistema operativo in modalità scura; chi preferisce lo scuro lo sceglie con un clic e ottiene carbone e oro, con gli stessi contrasti verificati. Il pulsante usa un cerchio mezzo pieno, il simbolo del contrasto, e ha sempre un'etichetta per gli screen reader. |
| Logo Oikos a sinistra, filetto, poi "Buy House in Italy" | Si legge come "Buy House in Italy di Oikos Immobiliare": il marchio dell'agenzia garantisce il servizio. La scritta "di Oikos Immobiliare" resta solo per gli screen reader, perché il logo la dice già. |
| Variante chiara del logo per i fondi scuri | Il grigio delle lettere sparisce sul carbone: nel tema scuro e nel footer diventa il colore del testo chiaro, la "k" resta oro (6,6:1 sul carbone). |
| Foto del team in cerchio, 5rem, con filetto sottile | Prendono il posto delle iniziali con la stessa forma; il filetto dà un bordo alle foto su fondo bianco. Ritagli con il viso alla stessa scala per tutti e tre. |
| MOTION 1: solo hover, focus e transizioni di stato | Micro-interazioni leggere richieste; con `prefers-reduced-motion` anche quelle si fermano. |
| Mappa delle 20 regioni in "Dove comprare" al posto delle schede con foto | Richiesta del committente; fa vedere dove sta ogni zona e copre anche le regioni senza guida, che il brief può comunque chiedere. |
| Regioni vaniglia con filetto grigio caldo, oro chiaro per quelle con una guida, oro pieno con bordo inchiostro per quella scelta | L'oro resta "la cosa che conta": la regione scelta. Il filetto `--ink-2` separa le regioni con almeno 3,8:1 in tema chiaro; in tema scuro hover e scelta si staccano dalle vicine per riempimento (4,5:1 e 7,8:1). |
| Nessun pallino sulla mappa per le guide | Il pallino oro è già il segno "Must have" del brief; per le guide bastano tinta, legenda e la parola "guida" nell'elenco. |
| Elenco dei nomi accanto alla mappa (sotto, su telefono) | È il modo di usare la mappa con tastiera e screen reader, e il bersaglio comodo per le regioni piccole (Molise, Valle d'Aosta) sul telefono. |
| All'apertura è già scelta la Puglia | È la prima guida in ordine e la zona in cui lavora Oikos; un pannello vuoto lasciava un buco accanto alla mappa. |
| Pulsante della scheda regionale secondario (bordo inchiostro) | Nella scheda l'oro è già la regione scelta; l'azione principale della pagina resta "Inizia la ricerca". |
| Confini da Natural Earth, pubblico dominio | Stessa regola delle foto: niente materiale con obblighi di attribuzione. |

## Segnaposto ancora da sostituire

- `img/favicon.svg`: quadrato verde oliva della prima palette, da sostituire con un'icona ricavata dal logo.
- Le foto attuali sono di archivio (Wikimedia Commons): quando Oikos ne avrà di proprie, si sostituiscono da `data/photos.json`.
- `[REAL DATA]`: indirizzo, P.IVA, iscrizione REA, modello di compenso, dati di mercato.
- Team: ruoli di Flavio Moretto e Alessandra Toniolo, lingue parlate da tutti e tre (`[Role]` / `[Ruolo]`).
