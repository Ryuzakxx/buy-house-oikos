# Lingue e traduzioni

Ogni lingua ha due parti:

1. `i18n/<codice>.json`: le stringhe di interfaccia usate dal generatore (header, menu, breadcrumb, footer, banner dei consensi, etichette delle schede immobile, box "Talk to a consultant", note legali).
2. `content/<codice>/`: le pagine tradotte, con lo stesso `id` della pagina inglese corrispondente.

L'inglese (`en`) è la lingua principale e il riferimento per `x-default`.

## Cosa c'è oggi

| Lingua | Interfaccia | Pagine tradotte |
|---|---|---|
| en | completa | tutte |
| it | completa | tutte le pagine pubbliche (servizi, regioni, nazionalità, guide, intervista, legali); resta in inglese solo l'area consulente |
| de | completa | home, `guides/buying-process` → `/de/ratgeber/immobilienkauf-in-italien-schritt-fuer-schritt/` |
| fr | completa | home, `guides/buying-process` → `/fr/guides/acheter-un-bien-en-italie-etape-par-etape/` |
| nl | completa | home, `guides/buying-process` → `/nl/gidsen/huis-kopen-in-italie-stap-voor-stap/` |
| es | completa | home, `guides/buying-process` → `/es/guias/comprar-vivienda-en-italia-paso-a-paso/` |

Quando una pagina non esiste in una lingua:
- menu, footer e link puntano alla versione inglese, con `hreflang="en"` e il segno "EN" (nel footer, la nota "Pages in English" tradotta);
- il selettore lingua porta alla home di quella lingua, con la nota "(home page)";
- `hreflang` e sitemap elencano solo le versioni che esistono davvero, sempre reciproche.

## Aggiungere una lingua (esempio: portoghese)

1. Copiare `i18n/en.json` in `i18n/pt.json` e tradurre i valori (non le chiavi). Impostare `lang`, `name` ("Português"), `locale` (`pt_PT`).
2. Nella sezione `pages` del file JSON indicare `label` e, per servizi, regioni e nazionalità, `desc` delle pagine inglesi a cui la nuova lingua rimanda: sono i testi mostrati nei menu, nel footer e negli elenchi della home.
3. Aggiungere `"pt"` a `LANGS` in `tools/build.py`.
4. Creare `content/pt/home.html` (copiare la home inglese e tradurre) e le altre pagine. Ogni pagina tradotta dichiara nel front matter l'`id` della pagina inglese, per esempio `id: guides/buying-process`; il percorso del file decide l'URL, quindi gli slug possono essere tradotti.
5. Eseguire `python3 tools/build.py` e `python3 tools/check.py`.

## Tradurre una pagina in una lingua esistente

Creare il file in `content/<codice>/` con `id` uguale alla pagina inglese. Al build successivo `hreflang`, selettore lingua, sitemap e `og:locale:alternate` si aggiornano da soli su tutte le versioni.

## Stringhe del JavaScript

Le pagine interattive leggono i testi da un dizionario per lingua: `js/i18n/en.js` e `js/i18n/it.js`. `js/core/i18n.js` sceglie il dizionario da `<html lang>` (le lingue senza dizionario usano l'inglese) ed espone:

- `t('chiave.annidata', { variabile })` per i testi, con le variabili tra graffe (`'Domanda {n} di {total}'`);
- `link('start/wishlist')` per i link tra le pagine dell'intervista, letti dal blocco `#site-links` che il generatore inserisce in ogni pagina con i percorsi della lingua corrente;
- `LOCALE` e `SPEECH_LANG` per date, numeri, valuta e riconoscimento vocale.

Il riconoscimento delle risposte a voce ha regole per lingua (numeri, "qualsiasi", priorità, sinonimi): `SPOKEN` in `js/core/interview.js`. I messaggi di validazione dei form sono in `js/ui/forms.js`, in tutte e sei le lingue. L'area consulente resta in inglese.

Per tradurre l'intervista in un'altra lingua:
1. copiare `js/i18n/en.js` in `js/i18n/<codice>.js`, tradurre i valori e registrarlo in `js/core/i18n.js`;
2. aggiungere le regole vocali in `SPOKEN` (altrimenti la voce usa quelle inglesi);
3. creare le sei pagine `content/<codice>/` con gli `id` `start`, `start/chat`, `start/voice`, `start/wishlist`, `start/webcall`, `start/webcall/confirmed`, mantenendo gli stessi `id` HTML dei form inglesi.

## Regole di scrittura

- Niente trattini lunghi (em dash, en dash): `tools/check.py` li segnala in contenuti, JSON e JavaScript.
- In francese usare lo spazio indivisibile prima di `? ! : ;`.
- Nessun dato inventato: cifre e fatti solo con fonte; altrimenti `[REAL DATA]`.
- I termini giuridici italiani (proposta d'acquisto, compromesso, caparra confirmatoria, rogito, codice fiscale) restano in italiano in tutte le lingue, spiegati alla prima occorrenza.
