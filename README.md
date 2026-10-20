# Buy House in Italy

Sito statico (HTML, CSS e JavaScript vanilla, nessuna dipendenza a runtime) per il servizio di property finding di Oikos Immobiliare rivolto ad acquirenti stranieri. Il sito serve prima di tutto a capire cosa vuole il cliente: intervista (chat guidata, voce o videochiamata), wishlist strutturata in Must have / Nice to have / Deal breaker, matching con gli immobili e area consulente. Non pubblica cataloghi di immobili: gli immobili servono solo al matching e all'area consulente.

## Stato: cosa è pronto e cosa è demo

| Parte | Stato | Note |
|---|---|---|
| Pagine pubbliche (112 pagine generate, 88 indicizzabili) | Pronte, testi da rivedere | Testi fiscali e legali indicativi, con riferimento normativo e data di revisione |
| Pagine IT | Tutto il sito pubblico, compresi intervista (chat e voce), riepilogo del brief e prenotazione | L'area consulente `/internal/` resta in inglese |
| Pagine DE, FR, NL, ES | Home + guida "acquisto passo per passo" | Le altre pagine rimandano all'inglese, segnalato in modo visibile |
| Template regioni (Toscana, Sicilia, Lago di Como, Liguria, Sardegna) e nazionalità (NL, FR, CH), in inglese e italiano | Bozze `noindex` | Struttura pronta; mancano i dati locali `[REAL DATA]` |
| SEO tecnico (canonical, hreflang, sitemap, JSON-LD, robots, llms.txt) | Pronto | Cambiare `SITE_URL` (dominio di produzione) e ricostruire |
| Banner consensi e tracciamento origine lead | Pronto lato client | Il salvataggio server dei consensi va fatto nel backend |
| Chat guidata, intervista vocale, riepilogo brief, prenotazione videochiamata, contatto, form partner | Funzionanti in demo | I dati restano in `localStorage`: nessun invio a server |
| Matching | Pronto (funzioni pure, testate) | Stesse regole in produzione |
| Catalogo immobili | Assente per scelta | Nessuna scheda pubblica; i 12 immobili di esempio in `data/properties.json` alimentano solo matching e area consulente |
| Adapter Apimo, CRM, trascrizione, partner | Mock | Vedi "Collegare i servizi reali" |
| Area consulente `/internal/` | Demo | Richiede autenticazione reale prima di andare online |
| Immagini | Foto reali della Puglia e delle altre regioni, tutte CC0 o di pubblico dominio (Wikimedia Commons); foto del team fornite da Oikos | Elenco e autori in `img/photos/CREDITS.md`; si possono sostituire con foto proprie (vedi "Immagini") |
| Tema chiaro/scuro | Pronto | Pulsante nell'header (nel menu su telefono); senza scelta segue il sistema operativo |
| Privacy, Cookie, Termini | Bozze | Da far verificare a un legale |
| Team | Nomi e foto reali (Flavio Moretto, Alessandra Toniolo, Diego Moretto) | Mancano i ruoli di Flavio e Alessandra e le lingue parlate: segnaposto `[Role]` / `[Ruolo]` |
| Logo | Logo Oikos Immobiliare nell'header, nel footer e nell'area consulenti | Originale in `data/photos/logo.webp`; variante chiara per i fondi scuri generata da `tools/photos.py` |
| Indirizzo, P.IVA, compensi | Segnaposto visibili | `[REAL DATA]` |
| Testimonianze | Non mostrate | Gli spazi vuoti erano nella vecchia home; con storie reali si rimettono in una pagina con `{{testimonial-slots}}` |

## Avvio in locale

```sh
python3 -m http.server 8000
```

Aprire http://localhost:8000/ (reindirizza a `/en/`). Il server di sviluppo di Python non serve `404.html` per le pagine mancanti; gli hosting reali sì (vedi "Messa in produzione").

L'area consulente demo è su http://localhost:8000/internal/ (non linkata dal sito pubblico).

## Struttura

```
index.html            redirect a /en/ (meta refresh + link + canonical)
404.html  robots.txt  sitemap.xml  llms.txt      generati da tools/build.py (tranne robots.txt)
en/ it/ de/ fr/ nl/ es/   pagine generate (cartella/index.html, URL puliti)
internal/             area consulente demo (noindex, Disallow in robots.txt)
content/<lingua>/     sorgenti delle pagine: front matter + HTML (+ blocco FAQ)
content/internal/     sorgenti dell'area consulente
i18n/<lingua>.json    stringhe di interfaccia (header, footer, banner, etichette)
css/                  tokens.css, base.css, layout.css, components.css, pages/*.css
js/                   main.js, api/ (adapter), core/ (modello dati), ui/, pages/
data/                 properties.json, partner-agencies.json, demo-buyers.json, demo-sales.json
img/photos/           foto in AVIF, WebP, JPEG a due larghezze + manifest.json e CREDITS.md (generati da tools/photos.py)
img/ph/               segnaposto disegnati, usati solo dove manca una foto
fonts/                Prata (unico font self-hosted, licenza OFL), lo stesso dei titoli del sito Oikos
tools/                build.py, check.py, placeholders.py, test-core.mjs, e2e.mjs, pages-audit.mjs
DESIGN.md             direzione visiva e motivazioni delle scelte
```

## Generatore (opzionale)

Le pagine HTML in `en/`, `it/`, `de/`… sono il sito: si possono pubblicare così come sono. Il generatore serve solo a non duplicare a mano header, footer, JSON-LD e sitemap.

```sh
python3 tools/build.py                                   # tutte le lingue, dominio di produzione
SITE_URL=https://staging.example.com python3 tools/build.py   # altro dominio (staging, audit)
python3 tools/build.py --langs en                        # solo inglese, per iterare più in fretta
python3 tools/check.py                                   # controlli sul risultato (vedi "Test")
```

Requisiti: Python 3.10+ (solo libreria standard). Il build cancella e riscrive le cartelle delle lingue e `internal/`; non toccare a mano i file generati.

Il CSS di ogni pagina viene inserito inline nell'`<head>` (tokens, base, layout, components più l'eventuale `css/pages/*.css` della pagina): nessuna richiesta CSS bloccante e nessun salto di layout. Il JavaScript è caricato come modulo (`type="module"`, quindi differito); ogni pagina carica solo il modulo indicato da `data-page`.

### Scrivere una pagina

File in `content/<lingua>/percorso.html`. Il percorso diventa l'URL (`content/en/services/notary.html` → `/en/services/notary/`).

```
---
type: service
parent: services
title: The Italian notary for foreign buyers | Buy House in Italy
description: Testo della meta description, massimo circa 160 caratteri.
h1: The notary
lede: Sottotitolo sotto l'H1.
related: guides/italian-notary, services/escrow
---
<h2>...</h2>
<p>...</p>
--- faq
Q: Domanda?
A: Risposta, anche su più righe, con <a href="{{link id=services/escrow}}">link</a>.
```

Chiavi del front matter:

| Chiave | Uso |
|---|---|
| `id` | Identificativo comune alle traduzioni (default: il percorso). Le pagine tradotte usano lo stesso `id` della pagina inglese |
| `slug` | URL diverso dal percorso del file |
| `type` | `home`, `service`, `region`, `nationality`, `guide`, `hub`, `page` (decide layout e JSON-LD) |
| `title`, `description`, `h1`, `lede`, `ogTitle`, `image` | Testi e meta; `image` è un nome in `img/photos/manifest.json` (o, in mancanza, in `img/ph/manifest.json`) |
| `parent`, `crumb`, `short`, `summary` | Breadcrumb ed etichette nei menu e negli elenchi |
| `order`, `phase` | Ordinamento; `phase` (find/check/pay/settle) raggruppa i servizi |
| `related` | Elenco di `id` mostrati in fondo |
| `updated`, `published` | Data di revisione (guide e pagine con dati legali) |
| `serviceType`, `region`, `country` | JSON-LD Service, immobili per regione, paese del buyer (`?country=` nei link Start e `buyerCountry`) |
| `draft: yes`, `noindex: yes` | Avviso "Draft" visibile, `noindex`, esclusione da sitemap e llms.txt |
| `wrap` | `prose` (default), `container`, `none` |
| `css`, `js` | Foglio in `css/pages/` e modulo in `js/pages/` |
| `noCtaBar: yes` | Nasconde la barra "Start your search" su mobile (home e pagine del percorso Start, che mostrano già i modi per iniziare) |

Segnaposto nel corpo: `{{link id=...}}`, `{{start-paths}}`, `{{brief-example}}`, `{{picture name=... alt="..." sizes="..." eager}}`, `{{regions-grid}}`, `{{countries}}`, `{{services-grouped level=2}}`, `{{pages type=guide style=cols}}`, `{{consult}}`, `{{legal-note}}`, `{{testimonial-slots}}`, `{{faq}}`. Un `id` sconosciuto blocca il build: i link interni non possono rompersi.

### Aggiungere una lingua

Vedi `i18n/README.md`.

## Immagini

Le foto dei luoghi vengono da Wikimedia Commons e sono tutte **CC0 o di pubblico dominio**: si possono usare senza permessi né attribuzione. Le foto della Puglia (regione, intestazione della pagina Puglia, immagine di condivisione) sono di Alberobello; le altre regioni hanno una foto propria. La home non mostra più foto: `hero-puglia` resta generata ma non è usata da nessuna pagina, e si può cancellare (file in `img/photos/` e voce in `data/photos.json`) o riusare. Autori e link sono in `img/photos/CREDITS.md`.

Le gestisce `tools/photos.py`, che legge `data/photos.json` (nome dello slot, file su Commons o file locale, proporzioni, larghezze, punto da tenere al centro del ritaglio, `zoom` per stringere il ritaglio). Per le voci `commons` rilegge a ogni esecuzione licenza e autore da Commons e **si ferma se un file non è CC0 o pubblico dominio**, poi scarica l'originale in `~/.cache/buyhouseinitaly-photos/`. Le voci `file` usano originali forniti da Oikos, tenuti in `data/photos/` (fuori da `img/photos/`, che contiene solo file generati). Per ogni voce ritaglia e produce AVIF, WebP e JPEG. Richiede `ffmpeg` con libaom, `ffprobe` e `cwebp`.

Le foto del team (`team-flavio`, `team-alessandra`, `team-diego`) sono ritagli quadrati degli originali in `data/photos/`; quello di Alessandra è stretto sul viso per lasciare fuori il cartello di un altro marchio presente nella foto. Per rifare solo alcune voci: `python3 tools/photos.py --only team-flavio,team-diego` (aggiorna `manifest.json` senza toccare le altre).

Il logo (`data/photos/logo.webp`, voce `logo` in `data/photos.json`) viene copiato in `img/logo/oikos-immobiliare.webp`, insieme a una variante per i fondi scuri (`-light.webp`) in cui il grigio delle lettere diventa il colore del testo chiaro e la "k" resta oro. L'header mostra una delle due varianti a seconda del tema; il footer, sempre scuro, usa la variante chiara. Per un logo nuovo: sostituire il file e lanciare `python3 tools/photos.py --only logo`.

Ogni immagine viene servita con `<picture>`, `srcset`, `width`/`height` espliciti e `loading="lazy"` (tranne quella in cima alla pagina Puglia, segnata `eager`, che ha `fetchpriority="high"`).

Per usare foto proprie (per esempio di immobili o del team Oikos): sostituire la voce in `data/photos.json` e rilanciare `tools/photos.py`, oppure salvare file con lo stesso nome e le stesse larghezze in `img/photos/` e aggiornare `manifest.json`. Poi ricostruire e aggiornare i testi `alt` nei file di contenuto. I segnaposto disegnati di `tools/placeholders.py` (in `img/ph/`) restano solo come riserva per slot senza foto.

Da cancellare a mano: i file `img/ph/prop-*` e `img/ph/interior-*` (84 file) servivano alle schede immobile, ora rimosse, e non sono più usati né elencati in `manifest.json`. Anche gli altri file di `img/ph/` non sono più mostrati, perché ogni slot ha una foto: si possono tenere come riserva o cancellare.

`img/favicon.svg` è ancora un segnaposto: un quadrato verde oliva rimasto dalla prima palette, da sostituire con un'icona ricavata dal logo.

## Modello dati della wishlist

```js
{
  mustHave:     [{ key: 'region', op: 'in',  value: ['puglia'] }, { key: 'price', op: 'lte', value: 900000 }],
  niceToHave:   [{ key: 'seaView', op: 'eq', value: true }],
  dealBreakers: [{ key: 'condition', op: 'in', value: ['move-in', 'light-refresh'] }],
  context:      { use: 'Holiday home', timeline: 'In 3 to 6 months', mortgage: 'No, buying with my own funds', notes: '...' },
  status: 'draft' | 'submitted' | 'confirmed'
}
```

Chiavi dei criteri (`js/core/wishlist.js`, `CRITERIA`): `region`, `price`, `type`, `bedrooms`, `bathrooms`, `condition`, `pool`, `poolOrSpace`, `land` (m²), `seaView`, `distanceSea`, `distanceAirport`, `distanceTown` (km).

Regole di matching (`js/api/matching.js`, funzioni pure):
- un deal breaker non soddisfatto esclude l'immobile (un dato mancante non esclude: viene segnato "da verificare");
- punteggio 0-100 = media pesata, must have peso 3, nice to have peso 1;
- ogni must have mancato del tutto moltiplica il punteggio per 0,7;
- soglia di "compatibile" 60, usata sia nel messaggio al buyer sia nell'area consulente;
- prezzo e distanze oltre il limite ricevono un credito parziale (20% di tolleranza sul prezzo, 50% sulle distanze);
- ogni risultato spiega i criteri soddisfatti, parziali, mancati e da verificare.

Il feedback dopo una proposta o una visita (`applyFeedback`) aggiorna il brief: per esempio "too far from the sea" porta la distanza dal mare tra i must have e la stringe al 60% della distanza dell'immobile rifiutato.

## Collegare i servizi reali

Tutti gli adapter in `js/api/` sono asincroni e restituiscono già le forme definitive: per passare alla produzione si sostituisce il corpo delle funzioni con chiamate a un backend, senza toccare le pagine.

**Apimo** (`js/api/apimo.js`). Il browser non deve mai vedere le credenziali Apimo. Creare un endpoint backend (per esempio `/api/properties`) che chiama l'API REST di Apimo lato server con provider id e token, unisce i feed delle agenzie partner con il loro `partnerAgencyId` e restituisce JSON; puntare `SOURCE` a quell'endpoint e adattare `normalize()` ai campi reali dell'account (i nomi in `data/properties.json` imitano un export Apimo ma vanno verificati sulla documentazione Apimo). In produzione quell'endpoint deve essere accessibile solo all'area consulente: il sito pubblico non mostra immobili, e il conteggio "case che corrispondono" nel riepilogo del brief va calcolato lato server.

**CRM** (`js/api/crm.js`). Stesse funzioni (`createBuyer`, `getBuyer`, `listBuyers`, `updateBuyer`, `updateWishlist`, `addInteraction`, `addBooking`, `addTranscript`, `findBuyerByEmail`) chiamate verso il backend, che scrive nel CRM scelto. Il modello completo del buyer è documentato in testa al file.

**Trascrizione e LLM** (`js/api/transcription.js`). `transcribeRecording()` va sostituita da un job backend che, solo con consenso alla registrazione, invia l'audio a un servizio di speech-to-text. `generateWishlistFromTranscript(text)` oggi usa regole e parole chiave; in produzione il backend chiede a un modello linguistico di compilare la stessa struttura `{ mustHave, niceToHave, dealBreakers, context, evidence }` tramite JSON schema, con le citazioni (`evidence`) a supporto. Il consulente rivede sempre la proposta prima di sostituire il brief.

**Partner e storni** (`js/api/partners.js`). Agenzie, accordi firmati (con la percentuale reale), vendite e richieste di partnership vanno nel backend. La percentuale (1% di default, modificabile nell'area consulente) è indicativa e visibile solo in `/internal/partners/`.

**Videochiamate**. Gli slot demo sono feriali dalle 09:00 alle 17:30 ora italiana (`js/pages/webcall.js`); in produzione arrivano dai calendari dei consulenti. Servono anche: email di conferma con link video, registrazione solo se `recordingConsent` è vero, conservazione delle registrazioni secondo l'informativa.

**Form**. Senza JavaScript i form mostrano un avviso; in produzione dare a ogni form un `action` verso il backend, così funzionano anche senza JS.

## Tema chiaro e scuro

Senza una scelta il sito segue il tema del sistema operativo. Il pulsante nell'header (su telefono dentro il menu) passa da chiaro a scuro e salva la scelta sul dispositivo (`bhi.theme`, elencato nella Cookie Policy come necessario). Uno script inline nell'`<head>` applica la scelta prima che la pagina venga disegnata, così non si vede mai un lampo del tema sbagliato. I colori scuri sono in `css/tokens.css`, in due blocchi identici: uno per `data-theme="dark"`, uno per il sistema operativo scuro senza scelta esplicita.

## Consensi e origine del lead

- Il banner (`js/ui/consent.js`) offre "Reject all", "Accept all" e "Choose" con pari evidenza; le scelte (necessari, origine visita, pubblicità) sono salvate in `localStorage` (`bhi.consent.v1`) e scadono dopo 6 mesi. Riapribile dal footer ("Cookie settings").
- Nessuno script di tracciamento è presente. Per aggiungerne uno senza violare il consenso, inserirlo inerte: `<script type="text/plain" data-consent="analytics" data-src="https://..."></script>`; viene attivato solo dopo il consenso della categoria. Aggiornare la Cookie Policy.
- `js/ui/lead-source.js` legge a ogni visita UTM, `gclid`/`fbclid`, referrer esterno e landing page, li tiene in memoria e li salva (`bhi.lead.v1`) solo per le categorie consentite: UTM, referrer e landing con "Visit source", gli ID dei clic pubblicitari con "Advertising". Revocando il consenso i dati vengono cancellati. `getLeadSource()` è allegato a ogni invio (brief, prenotazione, contatto, partner) e all'avvio dell'intervista; contiene anche `buyerCountry` (dalle pagine per nazionalità o dal parametro `?country=` dei link "Start").
- Ogni consenso dei form (trattamento dati, registrazione e trascrizione, marketing) è salvato separatamente con data e testo esatto mostrato.

## SEO

- `canonical`, `hreflang` reciproci con `x-default`, Open Graph e Twitter card su ogni pagina; breadcrumb visibili e in JSON-LD.
- JSON-LD: `RealEstateAgent` (sitewide), `WebSite` (home), `WebPage`/`AboutPage`/`ContactPage`/`CollectionPage`, `BreadcrumbList`, `FAQPage`, `Service`, `Article`. Niente `RealEstateListing`, perché non ci sono più schede immobile pubbliche.
- `sitemap.xml` con alternate hreflang (solo pagine indicizzabili), `robots.txt` con riferimento alla sitemap, `llms.txt` generato dagli stessi metadati.
- Bozze, pagine personali (brief, conferma) e area interna sono `noindex` e fuori dalla sitemap.

## Test

```sh
python3 tools/check.py      # link e ancore, id duplicati, tag, H1 e gerarchia titoli, title/description unici e lunghezza,
                            # canonical, hreflang reciproci, JSON-LD, img con width/height/alt, sitemap, llms.txt, trattini lunghi
node tools/test-core.mjs    # 17 test unitari: matching, intervista, voce in inglese e italiano, trascrizione, feedback, storni, fusi orari
```

I test nel browser usano `puppeteer-core` installato fuori dal progetto (il sito non ha dipendenze npm):

```sh
mkdir -p ~/.cache/oikos-tools && cd ~/.cache/oikos-tools && npm i puppeteer-core lighthouse @puppeteer/browsers
npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/oikos-tools/browsers
# dalla cartella del progetto, con il server su 127.0.0.1:8765:
TOOLS_DIR=~/.cache/oikos-tools CHROME=<percorso di chrome-headless-shell> node tools/e2e.mjs        # 28 percorsi cliccati
TOOLS_DIR=~/.cache/oikos-tools CHROME=<...> node tools/pages-audit.mjs                             # errori console e overflow, 390 e 1280 px
```

Risultati dell'ultima esecuzione (16 ottobre 2026): `check.py` 0 problemi su 113 pagine e 88 URL in sitemap; 17/17 test unitari; 28/28 percorsi end-to-end (compresi navigazione e chat in italiano), senza errori in console; 0 problemi di console o overflow orizzontale su tutte le pagine a 320, 360, 390, 768, 1024 e 1280 px; Lighthouse 95-100 in tutte le categorie, mobile e desktop, su home IT, Chi siamo IT e EN, Puglia, Servizi, chat, videochiamata e guida imposte in italiano (performance su mobile: home 99 dopo la versione minimale, videochiamata 95; build con `SITE_URL` locale).

## Messa in produzione: cosa serve lato backend

1. **Dominio**: impostare `SITE_URL` in `tools/build.py` (o variabile d'ambiente) e in `robots.txt`, poi ricostruire.
2. **Autenticazione per `/internal/`** (accesso consulenti con account personali, idealmente SSO o 2FA), oppure spostare l'area consulente in un'applicazione separata. Oggi è protetta solo da `noindex` e `Disallow`, cioè non protetta.
3. **API**: proxy Apimo, CRM, invio dei form, prenotazioni con calendari reali, email transazionali.
4. **Consensi**: archivio server dei consensi (chi, cosa, quando, testo mostrato) e gestione delle richieste GDPR (accesso, cancellazione).
5. **Videochiamate**: piattaforma video, registrazione solo con consenso, trascrizione, conservazione e cancellazione secondo l'informativa.
6. **Hosting**: servire `404.html` per le pagine mancanti (Netlify e GitHub Pages lo fanno da soli; Apache `ErrorDocument 404 /404.html`; Nginx `error_page 404 /404.html;`), HTTPS, compressione, cache lunga per `img/` e `fonts/`, intestazioni di sicurezza. Per una Content Security Policy stretta: il sito usa un solo script inline (aggiunge la classe `js` a `<html>` e applica il tema scelto) più i blocchi JSON-LD; servono il suo hash o un nonce.
7. **Contenuti**: compilare i `[REAL DATA]`, far verificare a un legale Privacy, Cookie e Termini, far rivedere i testi fiscali e legali e aggiornare la data `updated`; completare i template e togliere `draft`.

## Limiti noti

- L'intervista (chat, voce), il riepilogo del brief e la prenotazione esistono in inglese e italiano. In tedesco, francese, olandese e spagnolo portano alla versione inglese, segnalata; per tradurli basta aggiungere un dizionario in `js/i18n/` e le pagine `content/<lingua>/` (vedi `i18n/README.md`).
- Il riconoscimento delle risposte a voce capisce inglese e italiano (`SPOKEN` in `js/core/interview.js`).
- L'intervista vocale funziona dove esiste SpeechRecognition (Chrome, Edge, Safari); altrove porta alla chat. In Chrome l'audio è elaborato dai server di Google: è scritto nella pagina e nell'informativa.
- `generateWishlistFromTranscript` riconosce solo frasi in inglese e formulazioni comuni: è una dimostrazione del flusso, non un estrattore affidabile.
