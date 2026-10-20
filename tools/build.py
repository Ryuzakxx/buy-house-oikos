#!/usr/bin/env python3
"""Static site generator for Buy House in Italy (development tool, Python 3.10+ standard library only).

Reads   content/<lang>/**/*.html   page sources: front matter + HTML body (+ optional FAQ block)
        content/internal/*.html    consultant demo area (English only)
        i18n/<lang>.json           interface strings
        img/photos/manifest.json   photo sizes and credits, written by tools/photos.py
        img/ph/manifest.json       drawn placeholders (tools/placeholders.py), used where no photo exists
Writes  /<lang>/**/index.html, /internal/**, /index.html, /404.html, /sitemap.xml, /llms.txt

Run from anywhere:  python3 tools/build.py
The generated HTML is the site; this script is optional once the pages exist.
"""
from __future__ import annotations

import datetime
import html
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

# Production address for canonical, hreflang, sitemap and JSON-LD; SITE_URL in the environment overrides it (staging, audits).
# Its path, if any, is where the site lives on that host (a GitHub Pages project site): every link and asset URL starts with it.
SITE_URL = os.environ.get("SITE_URL", "https://ryuzakxx.github.io/buy-house-oikos").rstrip("/")
BASE_PATH = urlparse(SITE_URL).path.rstrip("/")
LANGS = ["en", "it", "de", "fr", "nl", "es"]
DEFAULT_LANG = "en"
CSS_COMMON = ["tokens.css", "base.css", "layout.css", "components.css"]
TODAY = datetime.date.today().isoformat()

PAGE_TYPES_WITH_CONSULT = {"service", "region", "nationality"}


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def at_base(path: str) -> str:
    """URL for a root-relative site path such as /en/ or /img/favicon.svg."""
    return BASE_PATH + path


def truthy(value) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def slugify(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text).lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    return re.sub(r"[\s-]+", "-", text).strip("-")[:60]


def minify_css(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};,>])\s*", r"\1", css)
    return css.replace(";}", "}").strip()




@dataclass
class Page:
    lang: str
    id: str
    slug: str
    meta: dict
    body: str
    faq: list
    source: Path | None = None

    @property
    def path(self) -> str:
        if "path" in self.meta:
            return self.meta["path"]
        return f"/{self.lang}/" + (f"{self.slug}/" if self.slug else "")

    @property
    def href(self) -> str:
        return at_base(self.path)

    @property
    def url(self) -> str:
        return SITE_URL + self.path

    @property
    def type(self) -> str:
        return self.meta.get("type", "page")

    @property
    def is_draft(self) -> bool:
        return truthy(self.meta.get("draft", ""))

    @property
    def noindex(self) -> bool:
        return truthy(self.meta.get("noindex", "")) or self.is_draft

    @property
    def h1(self) -> str:
        return self.meta.get("h1") or self.meta.get("title", "")

    @property
    def label(self) -> str:
        return self.meta.get("short") or self.h1

    @property
    def out_file(self) -> Path:
        p = self.path.lstrip("/")
        return ROOT / p if p.endswith(".html") else ROOT / p / "index.html"

    @property
    def lastmod(self) -> str:
        if self.meta.get("updated"):
            return self.meta["updated"]
        if self.source:
            return datetime.date.fromtimestamp(self.source.stat().st_mtime).isoformat()
        return TODAY


def parse_source(text: str) -> tuple[dict, str, list]:
    meta: dict = {}
    if text.startswith("---"):
        _, fm, text = text.split("---", 2)
        for line in fm.strip().splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    body, faq = text, []
    if "\n--- faq" in text:
        body, faq_block = text.split("\n--- faq", 1)
        current = None
        for line in faq_block.splitlines():
            if line.startswith("Q:"):
                current = {"q": line[2:].strip(), "a": ""}
                faq.append(current)
            elif line.startswith("A:") and current is not None:
                current["a"] = line[2:].strip()
            elif current is not None and line.strip():
                current["a"] += "\n" + line.strip()
    return meta, body.strip(), faq


class Site:
    def __init__(self):
        self.i18n = {lang: json.loads((ROOT / "i18n" / f"{lang}.json").read_text(encoding="utf-8")) for lang in LANGS}
        self.images = {}
        for folder in ("ph", "photos"):
            manifest = ROOT / "img" / folder / "manifest.json"
            if manifest.exists():
                for name, entry in json.loads(manifest.read_text(encoding="utf-8")).items():
                    self.images[name] = {"dir": folder, **entry}
        self.pages: dict[tuple[str, str], Page] = {}
        self.load_pages()
        for page in self.pages.values():
            page.faq = [{"q": q["q"], "a": expand(self, page, q["a"])} for q in page.faq]

    def t(self, lang: str) -> dict:
        return self.i18n[lang]

    def load_pages(self):
        for lang in LANGS + ["internal"]:
            base = CONTENT / lang
            if not base.exists():
                continue
            for src in sorted(base.rglob("*.html")):
                meta, body, faq = parse_source(src.read_text(encoding="utf-8"))
                rel = src.relative_to(base).with_suffix("").as_posix()
                page_lang = DEFAULT_LANG if lang == "internal" else lang
                slug = meta.get("slug", "" if rel == "home" else rel)
                pid = meta.get("id", "home" if rel == "home" else (f"internal/{rel}" if lang == "internal" else slug))
                if lang == "internal":
                    meta.setdefault("layout", "internal")
                    meta.setdefault("noindex", "yes")
                key = (page_lang, pid)
                if key in self.pages:
                    sys.exit(f"duplicate page id {key} in {src}")
                self.pages[key] = Page(page_lang, pid, slug, meta, body, faq, src)

    def get(self, lang: str, pid: str) -> Page | None:
        return self.pages.get((lang, pid))

    def resolve(self, lang: str, pid: str) -> Page | None:
        """The page in this language, else the English one."""
        return self.get(lang, pid) or self.get(DEFAULT_LANG, pid)

    def of_type(self, lang: str, ptype: str) -> list[Page]:
        pages = [p for (l, _), p in self.pages.items() if l == lang and p.type == ptype]
        if not pages and lang != DEFAULT_LANG:
            pages = self.of_type(DEFAULT_LANG, ptype)
        return sorted(pages, key=lambda p: (int(p.meta.get("order", 100)), p.label))

    def translations(self, page: Page) -> dict[str, Page]:
        if page.meta.get("layout") == "internal" or page.id == "404":
            return {}
        return {lang: p for lang in LANGS if (p := self.get(lang, page.id)) and not p.noindex}

    def label(self, lang: str, page: Page) -> tuple[str, str]:
        """Label and one-line description for linking to `page` from a `lang` page."""
        override = self.t(lang).get("pages", {}).get(page.id, {})
        return (override.get("label") or page.label, override.get("desc") or page.meta.get("summary", ""))


LOGO = f'<img class="brand__logo-img{{cls}}" src="{BASE_PATH}/img/logo/oikos-immobiliare{{variant}}.webp" width="289" height="174" alt="" loading="lazy">'


def brand_logo(on_dark_only: bool = False) -> str:
    # Both variants are lazy, so the one hidden by the theme CSS is never downloaded.
    if on_dark_only:
        return f'<span class="brand__logo">{LOGO.format(cls="", variant="-light")}</span>'
    return (f'<span class="brand__logo">{LOGO.format(cls=" brand__logo-img--light-bg", variant="")}'
            f'{LOGO.format(cls=" brand__logo-img--dark-bg", variant="-light")}</span>')


def picture(site: Site, name: str, alt: str, sizes: str, eager: bool = False, cls: str = "") -> str:
    entry = site.images[name]
    widths = entry["widths"]
    big = widths[-1]

    folder = entry["dir"]

    def srcset(ext):
        return ", ".join(f"{BASE_PATH}/img/{folder}/{name}-{w['w']}.{ext} {w['w']}w" for w in widths)

    loading = ' fetchpriority="high"' if eager else ' loading="lazy"'
    cls_attr = f' class="{cls}"' if cls else ""
    return (f'<picture{cls_attr}>'
            f'<source type="image/avif" srcset="{srcset("avif")}" sizes="{sizes}">'
            f'<source type="image/webp" srcset="{srcset("webp")}" sizes="{sizes}">'
            f'<img src="{BASE_PATH}/img/{folder}/{name}-{big["w"]}.jpg" srcset="{srcset("jpg")}" sizes="{sizes}" '
            f'width="{big["w"]}" height="{big["h"]}" alt="{esc(alt)}"{loading} decoding="async">'
            f'</picture>')


def en_hint(site: Site, lang: str, target: Page) -> str:
    if lang == DEFAULT_LANG or target.lang == lang:
        return ""
    t = site.t(lang)
    return f' <abbr class="lang-hint" title="{esc(t["enHintTitle"])}">{esc(t["enHint"])}</abbr>'


def link_attrs(lang: str, target: Page) -> str:
    return f' hreflang="{target.lang}"' if target.lang != lang else ""


def start_paths(site: Site, lang: str, extra_query: str = "") -> str:
    t = site.t(lang)["cta"]
    rows = []
    for pid, title, note, primary in (("start/chat", t["chat"], t["chatNote"], True),
                                      ("start/voice", t["voice"], t["voiceNote"], False),
                                      ("start/webcall", t["call"], t["callNote"], False)):
        target = site.resolve(lang, pid)
        hint = f' <span class="path__lang">({esc(t["inEnglish"])})</span>' if target.lang != lang else ""
        cls = "path path--primary" if primary else "path"
        rows.append(f'<li><a class="{cls}" href="{target.href}{extra_query}"{link_attrs(lang, target)}>'
                    f'<span class="path__title">{esc(title)}{hint}</span>'
                    f'<span class="path__note">{esc(note)}</span>'
                    f'<span class="path__mark" aria-hidden="true">›</span></a></li>')
    return '<ul class="paths">' + "".join(rows) + "</ul>"


# Index under the map: the regions in ISTAT order, in the three groups Italians use.
ITALY_GROUPS = {
    "north": ("piemonte", "valle-d-aosta", "lombardia", "trentino-alto-adige", "veneto", "friuli-venezia-giulia", "liguria", "emilia-romagna"),
    "centre": ("toscana", "umbria", "marche", "lazio"),
    "south": ("abruzzo", "molise", "campania", "puglia", "basilicata", "calabria", "sicilia", "sardegna"),
}


def italy_map(site: Site, lang: str) -> str:
    """Map of the regions (data/italy-regions.json, drawn by tools/map.py), one panel per region and an index of names.
    The first region with a guide (by "order") is shown when the page opens, so the panel is never empty.
    Without JavaScript every panel shows and the names jump to them; js/pages/italy-map.js shows one panel at a time."""
    t = site.t(lang).get("italy") or site.t(DEFAULT_LANG)["italy"]
    geo = json.loads((ROOT / "data" / "italy-regions.json").read_text(encoding="utf-8"))
    if sorted(k for keys in ITALY_GROUPS.values() for k in keys) != sorted(geo["regions"]):
        sys.exit("ITALY_GROUPS and data/italy-regions.json list different regions")
    guides = {p.meta["mapRegion"]: site.resolve(lang, p.id) for p in site.of_type(DEFAULT_LANG, "region") if p.meta.get("mapRegion")}
    first = next(iter(guides), next(iter(geo["regions"])))
    start = site.resolve(lang, "start")
    info = t["regions"]
    ids = {key: slugify(info[key]["name"]) for key in geo["regions"]}
    swatch = '<span class="italy__swatch" aria-hidden="true"></span>'

    shapes, cards = [], []
    for key, shape in geo["regions"].items():
        region, guide = info[key], guides.get(key)
        x, y = shape["label"]
        cls = "italy__region" + (" has-guide" if guide else "") + (" is-current" if key == first else "")
        shapes.append((key == first, f'<a class="{cls}" href="#{ids[key]}" tabindex="-1" data-region="{key}" data-x="{x}" data-y="{y}">'
                                     f'<path d="{shape["d"]}"/></a>'))
        facts = "".join(f"<div><dt>{esc(t[f])}</dt><dd>{esc(region[f])}</dd></div>" for f in ("capital", "airports", "homes"))
        if guide:
            status = f'<p class="region-info__guide">{swatch}{esc(t["legend"])}</p>'
            action = (f'<a class="btn" href="{guide.href}"{link_attrs(lang, guide)}>'
                      f'{esc(region.get("guide", t["guideLink"]))}{en_hint(site, lang, guide)}</a>')
        else:
            status = ""
            action = f'<p>{esc(t["noGuide"])}</p><a class="btn" href="{start.href}"{link_attrs(lang, start)}>{esc(t["brief"])}</a>'
        current = " is-current" if key == first else ""
        cards.append(f'<article class="region-info{current}" id="{ids[key]}" data-region="{key}" aria-labelledby="{ids[key]}-name">'
                     f'<h3 id="{ids[key]}-name" tabindex="-1">{esc(region["name"])}</h3>{status}<p>{esc(region["text"])}</p>'
                     f'<dl class="region-info__facts">{facts}</dl><div class="region-info__action">{action}</div></article>')

    groups = []
    for group, keys in ITALY_GROUPS.items():
        items = []
        for key in keys:
            tag = (f'<span class="italy__tag" aria-hidden="true">{esc(t["tag"])}</span>'
                   f'<span class="visually-hidden"> ({esc(t["listGuide"])})</span>') if key in guides else ""
            current = ' aria-current="true"' if key == first else ""
            items.append(f'<li><a href="#{ids[key]}" data-region="{key}"{current}>{esc(info[key]["name"])}{tag}</a></li>')
        groups.append(f'<div class="italy__group"><h3>{esc(t["groups"][group])}</h3><ul>{"".join(items)}</ul></div>')

    # The chosen region is drawn last, so the neighbours do not cover its outline (the sort keeps the others in order).
    drawn = "".join(markup for _, markup in sorted(shapes, key=lambda s: s[0]))
    width, height = geo["width"], geo["height"]
    return (f'<section class="italy" data-italy data-guide-label="{esc(t["legend"])}" aria-labelledby="italy-title">'
            f'<h2 id="italy-title" class="visually-hidden">{esc(t["heading"])}</h2>'
            f'<div class="italy__figure"><div class="italy__map">'
            f'<svg class="italy__svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" aria-hidden="true" focusable="false">'
            f'<g>{drawn}</g></svg><p class="italy__tip" aria-hidden="true" hidden></p></div>'
            f'<p class="italy__legend" aria-hidden="true">{swatch}{esc(t["legend"])}</p></div>'
            f'<div class="italy__panel">{"".join(cards)}</div>'
            f'<nav class="italy__index" aria-label="{esc(t["listLabel"])}">{"".join(groups)}</nav></section>')


def countries_list(site: Site, lang: str) -> str:
    items = []
    for page in site.of_type(lang, "nationality"):
        label, desc = site.label(lang, page)
        items.append(f'<li><a href="{page.href}"{link_attrs(lang, page)}><span class="countries__name">{esc(label)}{en_hint(site, lang, page)}</span>'
                     f'<span class="countries__note">{esc(desc)}</span></a></li>')
    return '<ul class="countries">' + "".join(items) + "</ul>"


def services_grouped(site: Site, lang: str, level: int = 3) -> str:
    phases = site.t(lang).get("phases") or site.t(DEFAULT_LANG)["phases"]
    services = site.of_type(DEFAULT_LANG, "service")
    out = []
    for key, phase in phases.items():
        rows = []
        for page in [s for s in services if s.meta.get("phase") == key]:
            target = site.resolve(lang, page.id)
            label, desc = site.label(lang, target)
            rows.append(f'<li><a href="{target.href}"{link_attrs(lang, target)}><span class="service-rows__name">{esc(label)}{en_hint(site, lang, target)}</span>'
                        f'<span class="service-rows__desc">{esc(desc)}</span></a></li>')
        out.append(f'<div class="phase"><h{level}>{esc(phase["title"])} <span>{esc(phase["note"])}</span></h{level}>'
                   f'<ul class="service-rows">{"".join(rows)}</ul></div>')
    return '<div class="phases">' + "".join(out) + "</div>"


def pages_list(site: Site, lang: str, args: dict) -> str:
    if "ids" in args:
        pages = [p for pid in args["ids"].split(",") if (p := site.resolve(lang, pid.strip()))]
    else:
        pages = site.of_type(lang, args["type"])
    cls = "link-list link-list--cols" if args.get("style") == "cols" else "link-list"
    items = []
    for page in pages:
        label, desc = site.label(lang, page)
        desc_html = f'<span class="link-list__desc">{esc(desc)}</span>' if desc else ""
        items.append(f'<li><a href="{page.href}"{link_attrs(lang, page)}><span class="link-list__title">{esc(label)}{en_hint(site, lang, page)}</span>{desc_html}</a></li>')
    return f'<ul class="{cls}">' + "".join(items) + "</ul>"


def brief_example(site: Site, lang: str) -> str:
    b = site.t(lang)["briefExample"]
    rows = "".join(f'<div class="brief__row"><dt><span class="mark mark--{k}">{esc(b[k + "Label"])}</span></dt><dd>{esc(b[k])}</dd></div>'
                   for k in ("must", "nice", "never"))
    return (f'<figure class="brief" aria-label="{esc(b["title"])}"><figcaption class="brief__title">{esc(b["title"])} '
            f'<small>{esc(b["note"])}</small></figcaption><dl class="brief__list">{rows}</dl></figure>')


def consult_box(site: Site, lang: str, heading: str = "h2") -> str:
    t = site.t(lang)["consult"]
    call = site.resolve(lang, "start/webcall")
    chat = site.resolve(lang, "start/chat")
    return (f'<aside class="consult" aria-labelledby="consult-title"><div class="consult__text">'
            f'<{heading} id="consult-title">{esc(t["title"])}</{heading}><p>{esc(t["text"])}</p></div>'
            f'<div class="consult__actions"><a class="btn btn--primary" href="{call.href}"{link_attrs(lang, call)}>{esc(t["call"])}</a>'
            f'<a class="btn" href="{chat.href}"{link_attrs(lang, chat)}>{esc(t["chat"])}</a></div></aside>')


def legal_note(site: Site, page: Page) -> str:
    t = site.t(page.lang)
    date = page.meta.get("updated", "")
    stamp = f' <span>{esc(t["updated"])}: <time datetime="{date}">{date}</time>.</span>' if date else ""
    return (f'<div class="note note--legal" role="note"><span class="note__title">{esc(t["legalNote"]["title"])}</span>'
            f'<p>{esc(t["legalNote"]["text"])}{stamp}</p></div>')


def testimonial_slots(site: Site, lang: str) -> str:
    slots = site.t(lang)["testimonials"]
    return '<div class="slots">' + "".join(f'<div class="slot"><p><strong>{esc(s["title"])}</strong></p><p>{esc(s["text"])}</p></div>' for s in slots) + "</div>"


def faq_section(site: Site, page: Page) -> str:
    if not page.faq:
        return ""
    t = site.t(page.lang)
    items = "".join(f'<details><summary>{esc(q["q"])}</summary><div class="faq__answer"><p>{q["a"]}</p></div></details>' for q in page.faq)
    aside = page.meta.get("faqIntro", "")
    aside_html = f"<p>{aside}</p>" if aside else ""
    return (f'<section class="section section--s" aria-labelledby="faq-title"><div class="container faq-layout">'
            f'<div><h2 id="faq-title">{esc(page.meta.get("faqTitle", t["faqTitle"]))}</h2>{aside_html}</div>'
            f'<div class="faq">{items}</div></div></section>')


def related_section(site: Site, page: Page) -> str:
    ids = [i.strip() for i in page.meta.get("related", "").split(",") if i.strip()]
    if not ids:
        return ""
    return (f'<section class="related" aria-labelledby="related-title"><div class="container">'
            f'<h2 id="related-title">{esc(site.t(page.lang)["related"])}</h2>'
            f'{pages_list(site, page.lang, {"ids": ",".join(ids), "style": "cols"})}</div></section>')


TOKEN = re.compile(r"\{\{\s*([a-z-]+)([^}]*)\}\}")
ARG = re.compile(r'([a-z]+)(?:="([^"]*)"|=(\S+))?')


def expand(site: Site, page: Page, text: str) -> str:
    lang = page.lang

    def handle(m: re.Match) -> str:
        name = m.group(1)
        args = {a.group(1): (a.group(2) if a.group(2) is not None else (a.group(3) or "yes")) for a in ARG.finditer(m.group(2))}
        if name == "start-paths":
            country = page.meta.get("country")
            return start_paths(site, lang, f"?country={country}" if country else "")
        if name == "brief-example":
            return brief_example(site, lang)
        if name == "picture":
            return picture(site, args["name"], args.get("alt", ""), args.get("sizes", "100vw"), "eager" in args, args.get("class", ""))
        if name == "italy-map":
            return italy_map(site, lang)
        if name == "countries":
            return countries_list(site, lang)
        if name == "services-grouped":
            return services_grouped(site, lang, int(args.get("level", 3)))
        if name == "pages":
            return pages_list(site, lang, args)
        if name == "consult":
            return consult_box(site, lang, args.get("heading", "h2"))
        if name == "legal-note":
            return legal_note(site, page)
        if name == "testimonial-slots":
            return testimonial_slots(site, lang)
        if name == "faq":
            return faq_section(site, page)
        if name == "link":
            target = site.resolve(args.get("lang", lang), args["id"])
            if target is None:
                sys.exit(f"{page.source}: link to unknown page id {args['id']}")
            return target.href
        if name == "today":
            return TODAY
        sys.exit(f"{page.source}: unknown token {name}")

    return TOKEN.sub(handle, text)


def add_heading_ids(body: str) -> tuple[str, list[tuple[str, str]]]:
    toc, used = [], set()

    def repl(m):
        attrs, inner = m.group(1), m.group(2)
        found = re.search(r'id="([^"]+)"', attrs)
        hid = found.group(1) if found else slugify(inner)
        while hid in used:
            hid += "-2"
        used.add(hid)
        toc.append((hid, re.sub(r"<[^>]+>", "", inner)))
        return m.group(0) if found else f'<h2 id="{hid}"{attrs}>{inner}</h2>'

    return re.sub(r"<h2([^>]*)>(.*?)</h2>", repl, body, flags=re.S), toc




ORG_ID = SITE_URL + "/#organization"
WEBSITE_ID = SITE_URL + "/#website"


def organization() -> dict:
    return {
        "@type": "RealEstateAgent",
        "@id": ORG_ID,
        "name": "Buy House in Italy",
        "url": f"{SITE_URL}/{DEFAULT_LANG}/",
        "description": "Property-finding service for international buyers purchasing a home in Italy.",
        "parentOrganization": {"@type": "Organization", "name": "Oikos Immobiliare", "logo": f"{SITE_URL}/img/logo/oikos-immobiliare.webp",
                               "founder": {"@type": "Person", "name": "Diego Moretto"}},
        "employee": [{"@type": "Person", "name": n, "image": f"{SITE_URL}/img/photos/team-{key}-288.jpg"}
                     for n, key in (("Flavio Moretto", "flavio"), ("Alessandra Toniolo", "alessandra"), ("Diego Moretto", "diego"))],
        "areaServed": {"@type": "Country", "name": "Italy"},
    }


def breadcrumbs(site: Site, page: Page) -> list[tuple[str, str]]:
    trail = []
    parent_id = page.meta.get("parent")
    while parent_id:
        parent = site.get(page.lang, parent_id)
        if parent is None:
            break
        trail.insert(0, (parent.meta.get("crumb") or parent.label, parent.path))
        parent_id = parent.meta.get("parent")
    home = site.get(page.lang, "home")
    crumbs = [(site.t(page.lang)["breadcrumb"]["home"], home.path)] + trail
    current = page.meta.get("crumb") or page.label
    return crumbs + [(current, page.path)]


def jsonld(site: Site, page: Page) -> str:
    t = site.t(page.lang)
    graph = [organization()]
    page_type = {"about": "AboutPage", "contact": "ContactPage", "hub": "CollectionPage"}.get(page.meta.get("schema", page.type), "WebPage")
    webpage = {
        "@type": page_type, "@id": page.url + "#webpage", "url": page.url, "name": page.meta.get("title", ""),
        "description": page.meta.get("description", ""), "inLanguage": page.lang, "isPartOf": {"@id": WEBSITE_ID},
    }
    if page.id == "home":
        graph.append({"@type": "WebSite", "@id": WEBSITE_ID, "url": SITE_URL + "/", "name": t["site"]["name"],
                      "inLanguage": LANGS, "publisher": {"@id": ORG_ID}})
        webpage["about"] = {"@id": ORG_ID}
    else:
        crumbs = breadcrumbs(site, page)
        graph.append({"@type": "BreadcrumbList", "@id": page.url + "#breadcrumb", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": SITE_URL + path} for i, (name, path) in enumerate(crumbs)]})
        webpage["breadcrumb"] = {"@id": page.url + "#breadcrumb"}
    graph.append(webpage)

    if page.type == "service":
        graph.append({"@type": "Service", "@id": page.url + "#service", "name": page.h1, "serviceType": page.meta.get("serviceType", page.h1),
                      "description": page.meta.get("description", ""), "url": page.url, "provider": {"@id": ORG_ID},
                      "areaServed": {"@type": "Country", "name": "Italy"},
                      "audience": {"@type": "Audience", "audienceType": "International buyers of residential property in Italy"}})
    if page.type == "guide":
        graph.append({"@type": "Article", "@id": page.url + "#article", "headline": page.h1, "description": page.meta.get("description", ""),
                      "inLanguage": page.lang, "datePublished": page.meta.get("published", page.meta.get("updated", TODAY)),
                      "dateModified": page.meta.get("updated", TODAY), "author": {"@id": ORG_ID}, "publisher": {"@id": ORG_ID},
                      "mainEntityOfPage": {"@id": page.url + "#webpage"}, "image": og_image(site, page)})
    if page.faq:
        graph.append({"@type": "FAQPage", "@id": page.url + "#faq", "url": page.url, "inLanguage": page.lang, "mainEntity": [
            {"@type": "Question", "name": q["q"], "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", q["a"])}}
            for q in page.faq]})
    data = {"@context": "https://schema.org", "@graph": graph}
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def og_image(site: Site, page: Page) -> str:
    name = page.meta.get("image", "og-default")
    entry = site.images[name]
    return f"{SITE_URL}/img/{entry['dir']}/{name}-{entry['widths'][-1]['w']}.jpg"




def css_for(page: Page) -> str:
    files = list(CSS_COMMON) + [f"pages/{n.strip()}.css" for n in page.meta.get("css", "").split(",") if n.strip()]
    css = "".join(minify_css((ROOT / "css" / f).read_text(encoding="utf-8")) for f in files)
    # Inline CSS resolves url() against the page, so root-relative font and image URLs need the base path too.
    return re.sub(r"""url\((["']?)/""", lambda m: f"url({m.group(1)}{BASE_PATH}/", css)


def head(site: Site, page: Page) -> str:
    t = site.t(page.lang)
    title = page.meta.get("title", t["site"]["name"])
    desc = page.meta.get("description", t["site"]["description"])
    tags = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        f"<title>{esc(title)}</title>",
        f'<meta name="description" content="{esc(desc)}">',
        f'<link rel="canonical" href="{page.url}">',
    ]
    if page.noindex:
        tags.append('<meta name="robots" content="noindex, follow">')
    else:
        alts = site.translations(page)
        if len(alts) > 1 or page.lang != DEFAULT_LANG:
            for lang, alt in alts.items():
                tags.append(f'<link rel="alternate" hreflang="{lang}" href="{alt.url}">')
            if DEFAULT_LANG in alts:
                tags.append(f'<link rel="alternate" hreflang="x-default" href="{alts[DEFAULT_LANG].url}">')
    image = og_image(site, page)
    og_type = "article" if page.type == "guide" else "website"
    tags += [
        f'<meta property="og:type" content="{og_type}">',
        f'<meta property="og:site_name" content="{esc(t["site"]["name"])}">',
        f'<meta property="og:title" content="{esc(page.meta.get("ogTitle", page.h1))}">',
        f'<meta property="og:description" content="{esc(desc)}">',
        f'<meta property="og:url" content="{page.url}">',
        f'<meta property="og:image" content="{image}">',
        f'<meta property="og:locale" content="{t["locale"]}">',
    ]
    for lang in site.translations(page):
        if lang != page.lang:
            tags.append(f'<meta property="og:locale:alternate" content="{site.t(lang)["locale"]}">')
    tags += [
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(page.meta.get("ogTitle", page.h1))}">',
        f'<meta name="twitter:description" content="{esc(desc)}">',
        f'<meta name="twitter:image" content="{image}">',
        '<meta name="theme-color" content="#ffffff" data-light="#ffffff" data-dark="#15130f">',
        f'<link rel="icon" href="{BASE_PATH}/img/favicon.svg" type="image/svg+xml">',
        f'<link rel="preload" href="{BASE_PATH}/fonts/prata-latin.woff2" as="font" type="font/woff2" crossorigin>',
        f"<style>{css_for(page)}</style>",
        THEME_SCRIPT,
        f'<script type="module" src="{BASE_PATH}/js/main.js"></script>',
        f'<script type="application/ld+json">{jsonld(site, page)}</script>',
    ]
    return "\n".join(tags)


# Runs before first paint: marks JS support and applies a theme chosen earlier, so the wrong theme never flashes.
THEME_SCRIPT = ("<script>(function(d){if('noModule' in HTMLScriptElement.prototype)d.classList.add('js');"
                "try{var t=JSON.parse(localStorage.getItem('bhi.theme'));if(t==='light'||t==='dark')d.dataset.theme=t}catch(e){}})"
                "(document.documentElement)</script>")


def theme_toggle(label: str) -> str:
    icon = ('<svg class="theme-toggle__icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">'
            '<circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/>'
            '<path d="M10 2a8 8 0 0 1 0 16z" fill="currentColor"/></svg>')
    return (f'<button class="theme-toggle" type="button" aria-pressed="false" data-theme-toggle title="{esc(label)}">'
            f'{icon}<span class="theme-toggle__label">{esc(label)}</span></button>')


def header(site: Site, page: Page) -> str:
    t = site.t(page.lang)
    lang = page.lang
    home = site.get(lang, "home")
    nav_items = []
    active = page.meta.get("nav") or page.id.split("/")[0]
    for item in t["nav"]:
        target = site.resolve(lang, item["id"])
        if target is None:
            continue
        current = ' aria-current="page"' if (active == item["id"] or page.id == item["id"]) else ""
        title = f' title="{esc(t["enHintTitle"])}"' if target.lang != lang else ""
        nav_items.append(f'<li><a href="{target.href}"{link_attrs(lang, target)}{title}{current}>{esc(item["label"])}{en_hint(site, lang, target)}</a></li>')

    lang_items = []
    translations = {l: site.get(l, page.id) for l in LANGS}
    for l in LANGS:
        tr = translations[l]
        name = site.t(l)["name"]
        if tr is not None and tr.meta.get("layout") != "internal":
            note, href = "", tr.href
        else:
            note = f' <small lang="{lang}">({esc(t["langMenu"]["notTranslated"])})</small>'
            href = site.get(l, "home").href
        current = ' aria-current="true"' if l == lang else ""
        lang_items.append(f'<li><a href="{href}" hreflang="{l}" lang="{l}"{current}><span>{esc(name)}</span>{note}</a></li>')

    start = site.resolve(lang, "start")
    return f"""<header class="site-header">
<div class="container site-header__inner">
<a class="brand" href="{home.href}">{brand_logo()}<span class="brand__text"><span class="brand__name">{esc(t["site"]["name"])}</span><span class="brand__by visually-hidden">{esc(t["site"]["by"])}</span></span></a>
<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav"><span class="menu-toggle__bars" aria-hidden="true"><span></span><span></span><span></span></span>{esc(t["a11y"]["menu"])}</button>
<nav id="site-nav" class="site-nav" aria-label="{esc(t["a11y"]["mainNav"])}"><ul>{"".join(nav_items)}</ul></nav>
<details class="lang"><summary><span class="visually-hidden">{esc(t["a11y"]["language"])}: </span>{lang.upper()}</summary><ul class="lang__menu">{"".join(lang_items)}</ul></details>
{theme_toggle(t["a11y"]["darkTheme"])}
<a class="btn btn--primary header-cta" href="{start.href}"{link_attrs(lang, start)}>{esc(t["cta"]["start"])}</a>
</div>
</header>"""


def breadcrumb_nav(site: Site, page: Page) -> str:
    crumbs = breadcrumbs(site, page)
    items = []
    for i, (name, path) in enumerate(crumbs):
        if i == len(crumbs) - 1:
            items.append(f'<li aria-current="page">{esc(name)}</li>')
        else:
            items.append(f'<li><a href="{at_base(path)}">{esc(name)}</a></li>')
    return f'<nav class="breadcrumb" aria-label="{esc(site.t(page.lang)["a11y"]["breadcrumb"])}"><ol>{"".join(items)}</ol></nav>'


def footer(site: Site, page: Page) -> str:
    t = site.t(page.lang)
    lang = page.lang
    f = t["footer"]

    def group(key, pages, extra=""):
        if not pages:
            return ""
        all_en = lang != DEFAULT_LANG and all(p.lang == DEFAULT_LANG for p in pages)
        note = f'<p class="footer-links__note">{esc(f["enNote"])}</p>' if all_en else ""
        items = "".join(f'<li><a href="{p.href}"{link_attrs(lang, p)}>{esc(site.label(lang, p)[0])}</a>{"" if all_en else en_hint(site, lang, p)}</li>' for p in pages)
        cls = f"footer-links__{key}"
        return f'<div class="{cls}"><h2>{esc(f["groups"][key])}</h2>{note}<ul>{items}{extra}</ul></div>'

    services = [site.resolve(lang, p.id) for p in site.of_type(DEFAULT_LANG, "service")]
    regions = [site.resolve(lang, p.id) for p in site.of_type(DEFAULT_LANG, "region")]
    buyers = [site.resolve(lang, p.id) for p in site.of_type(DEFAULT_LANG, "nationality")]
    guides = [site.resolve(lang, p.id) for p in site.of_type(DEFAULT_LANG, "guide")]
    company = [p for pid in ("how-it-works", "about", "partner-agencies", "contact") if (p := site.resolve(lang, pid))]
    legal = [p for pid in ("privacy", "cookies", "terms") if (p := site.resolve(lang, pid))]
    cookie_btn = f'<li><button type="button" class="link-button" data-open-consent>{esc(f["cookieSettings"])}</button></li>'
    home = site.get(lang, "home")
    year = datetime.date.today().year
    return f"""<footer class="site-footer">
<div class="container">
<div class="footer-top">
<p class="footer-statement">{esc(f["statement"])}</p>
<div class="footer-company">
<a class="brand" href="{home.href}">{brand_logo(on_dark_only=True)}<span class="brand__text"><span class="brand__name">{esc(t["site"]["name"])}</span><span class="brand__by visually-hidden">{esc(t["site"]["by"])}</span></span></a>
<p>{esc(f["company"])}</p>
<p><span class="ph">{esc(f["address"])}</span></p>
<p><span class="ph">{esc(f["vat"])}</span></p>
<p><span class="ph">{esc(f["registration"])}</span></p>
</div>
</div>
<div class="footer-links">
{group("services", services)}
{group("regions", regions)}
{group("buyers", buyers)}
{group("guides", guides)}
{group("company", company)}
</div>
<div class="footer-bottom">
<p>© {year} {esc(f["copyright"])}</p>
<ul class="footer-legal">{"".join(f'<li><a href="{p.href}"{link_attrs(lang, p)}>{esc(site.label(lang, p)[0])}</a></li>' for p in legal)}{cookie_btn}</ul>
</div>
</div>
</footer>"""


def consent_banner(site: Site, page: Page) -> str:
    c = site.t(page.lang)["consent"]
    policy = site.resolve(page.lang, "cookies")
    return f"""<section class="consent" id="consent" hidden aria-labelledby="consent-title" data-saved="{esc(c["saved"])}">
<h2 id="consent-title">{esc(c["title"])}</h2>
<p>{esc(c["text"])}</p>
<form id="consent-form">
<fieldset class="consent__choices" id="consent-choices" hidden>
<legend class="visually-hidden">{esc(c["title"])}</legend>
<label class="check"><input type="checkbox" checked disabled><span><strong>{esc(c["necessary"])}</strong>{esc(c["necessaryText"])}</span></label>
<label class="check"><input type="checkbox" name="analytics"><span><strong>{esc(c["analytics"])}</strong>{esc(c["analyticsText"])}</span></label>
<label class="check"><input type="checkbox" name="marketing"><span><strong>{esc(c["marketing"])}</strong>{esc(c["marketingText"])}</span></label>
</fieldset>
<div class="consent__actions">
<button type="button" class="btn" data-consent="reject">{esc(c["rejectAll"])}</button>
<button type="button" class="btn" data-consent="accept">{esc(c["acceptAll"])}</button>
<button type="button" class="btn btn--quiet" data-consent="choose" aria-expanded="false" aria-controls="consent-choices">{esc(c["choose"])}</button>
<button type="submit" class="btn" data-consent="save" hidden>{esc(c["save"])}</button>
</div>
</form>
<p class="consent__policy"><a href="{policy.href}"{link_attrs(page.lang, policy)}>{esc(c["policy"])}</a></p>
</section>
<p class="visually-hidden" role="status" id="consent-status"></p>"""


# Pages the scripts link to, resolved for the page's language (English where no translation exists).
SCRIPT_LINK_IDS = ("start", "start/chat", "start/voice", "start/wishlist", "start/webcall", "start/webcall/confirmed", "privacy", "contact", "how-it-works")


def site_links(site: Site, page: Page) -> str:
    links = {pid: target.href for pid in SCRIPT_LINK_IDS if (target := site.resolve(page.lang, pid))}
    return f'<script type="application/json" id="site-links">{json.dumps(links, separators=(",", ":"))}</script>'


def cta_bar(site: Site, page: Page) -> str:
    start = site.resolve(page.lang, "start")
    country = page.meta.get("country")
    query = f"?country={country}" if country else ""
    return f'<div class="cta-bar"><a class="btn btn--primary" href="{start.href}{query}"{link_attrs(page.lang, start)}>{esc(site.t(page.lang)["cta"]["start"])}</a></div>'


def page_hero(site: Site, page: Page) -> str:
    t = site.t(page.lang)
    lede = f'<p class="page-hero__lede">{page.meta["lede"]}</p>' if page.meta.get("lede") else ""
    meta = ""
    if page.type == "guide" and page.meta.get("updated"):
        meta = f'<p class="page-hero__meta">{esc(t["updated"])}: <time datetime="{page.meta["updated"]}">{page.meta["updated"]}</time></p>'
    draft = ""
    if page.is_draft:
        draft = f'<div class="draft-note" role="note"><p><strong>{esc(t["draft"]["title"])}.</strong> {esc(t["draft"]["text"])}</p></div>'
    cls = "page-hero page-hero--wide" if page.meta.get("heroWide") else "page-hero"
    return f'<header class="{cls}"><h1>{page.h1}</h1>{lede}{meta}{draft}</header>'


def main_content(site: Site, page: Page) -> str:
    body = expand(site, page, page.body)
    layout = page.meta.get("layout", "default")
    if page.type == "home" or layout == "bare":
        return body + ("" if "{{faq}}" in page.body else faq_section(site, page))

    top = f'<div class="container">{breadcrumb_nav(site, page)}{page_hero(site, page)}</div>'
    consult = ""
    if "{{consult" not in page.body and page.type in PAGE_TYPES_WITH_CONSULT:
        consult = consult_box(site, page.lang)
    if page.type == "guide":
        body, toc = add_heading_ids(body)
        toc_items = "".join(f'<li><a href="#{hid}">{esc(text)}</a></li>' for hid, text in toc)
        tc = site.t(page.lang)["toc"]
        aside = f'<nav class="article__aside toc" aria-label="{esc(tc)}"><details open><summary>{esc(tc)}</summary><ol>{toc_items}</ol></details></nav>'
        guide_consult = "" if "{{consult" in page.body else consult_box(site, page.lang)
        article = f'<div class="container article">{aside}<div class="article__body prose">{legal_note(site, page)}{body}{guide_consult}</div></div>'
        return top + article + faq_section(site, page) + related_section(site, page)
    wrap = page.meta.get("wrap", "prose")
    if wrap == "prose":
        content = f'<div class="container"><div class="prose">{body}</div>{consult}</div>'
    elif wrap == "container":
        content = f'<div class="container">{body}{consult}</div>'
    else:
        content = body + (f'<div class="container">{consult}</div>' if consult else "")
    tail = "" if "{{faq}}" in page.body else faq_section(site, page)
    return top + content + tail + related_section(site, page)


def internal_frame(site: Site, page: Page) -> str:
    links = [("internal/index", "Buyers"), ("internal/partners", "Partners and sales")]
    nav = "".join(
        f'<li><a href="{site.get(DEFAULT_LANG, pid).href}"{" aria-current=\"page\"" if page.id == pid or page.meta.get("nav") == pid else ""}>{label}</a></li>'
        for pid, label in links)
    body = expand(site, page, page.body)
    return f"""<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header internal-header">
<div class="container site-header__inner">
<a class="brand" href="{BASE_PATH}/internal/">{brand_logo()}<span class="brand__text"><span class="brand__name">Consultant area</span><span class="brand__by">Demo, no login yet</span></span></a>
<nav class="internal-nav" aria-label="Consultant area"><ul>{nav}</ul></nav>
{theme_toggle("Dark theme")}
</div>
</header>
<main id="main">{body}</main>"""


def render(site: Site, page: Page) -> str:
    t = site.t(page.lang)
    is_internal = page.meta.get("layout") == "internal"
    show_cta = not is_internal and not truthy(page.meta.get("noCtaBar", ""))
    attrs = [f'data-lang="{page.lang}"', f'data-page-id="{esc(page.id)}"']
    if page.meta.get("js"):
        attrs.append(f'data-page="{page.meta["js"]}"')
    if page.meta.get("country"):
        attrs.append(f'data-buyer-country="{page.meta["country"]}"')
    classes = []
    if show_cta:
        classes.append("has-cta-bar")
    if is_internal:
        classes.append("is-internal")
    cls = f' class="{" ".join(classes)}"' if classes else ""
    if is_internal:
        body = internal_frame(site, page)
    else:
        body = "\n".join([
            f'<a class="skip-link" href="#main">{esc(t["a11y"]["skip"])}</a>',
            header(site, page),
            f'<main id="main">{main_content(site, page)}</main>',
            footer(site, page),
            cta_bar(site, page) if show_cta else "",
            consent_banner(site, page),
            site_links(site, page),
        ])
    return f"""<!doctype html>
<html lang="{page.lang}" dir="{t["dir"]}">
<head>
{head(site, page)}
</head>
<body {" ".join(attrs)}{cls}>
{body}
</body>
</html>
"""




def root_redirect(site: Site) -> str:
    links = "".join(f'<li><a href="{BASE_PATH}/{l}/" hreflang="{l}" lang="{l}">{esc(site.t(l)["name"])}</a></li>' for l in LANGS)
    alts = "".join(f'<link rel="alternate" hreflang="{l}" href="{SITE_URL}/{l}/">' for l in LANGS)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Buy House in Italy</title>
<meta name="description" content="{esc(site.t("en")["site"]["description"])}">
<meta http-equiv="refresh" content="0; url={BASE_PATH}/en/">
<link rel="canonical" href="{SITE_URL}/en/">
{alts}<link rel="alternate" hreflang="x-default" href="{SITE_URL}/en/">
<link rel="icon" href="{BASE_PATH}/img/favicon.svg" type="image/svg+xml">
<style>body{{font:1.125rem/1.6 system-ui,sans-serif;background:#fff;color:#221f1a;margin:0;padding:2rem 1rem}}main{{max-width:30rem;margin:auto}}a{{color:#221f1a;text-decoration-color:#cea040}}</style>
</head>
<body>
<main>
<h1>Buy House in Italy</h1>
<p><a href="{BASE_PATH}/en/">Continue to the English site</a>, or choose a language:</p>
<ul>{links}</ul>
</main>
</body>
</html>
"""


def sitemap(site: Site) -> str:
    rows = []
    for page in sorted(site.pages.values(), key=lambda p: p.path):
        if page.noindex:
            continue
        alts = site.translations(page)
        links = ""
        if len(alts) > 1:
            links = "".join(f'<xhtml:link rel="alternate" hreflang="{l}" href="{a.url}"/>' for l, a in alts.items())
            if DEFAULT_LANG in alts:
                links += f'<xhtml:link rel="alternate" hreflang="x-default" href="{alts[DEFAULT_LANG].url}"/>'
        rows.append(f"<url><loc>{page.url}</loc><lastmod>{page.lastmod}</lastmod>{links}</url>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
            + "\n".join(rows) + "\n</urlset>\n")


def llms_txt(site: Site) -> str:
    def section(title, pages):
        lines = [f"- [{'Home' if p.id == 'home' else p.h1}]({p.url}): {p.meta.get('description', '')}" for p in pages if not p.noindex]
        return f"## {title}\n\n" + "\n".join(lines) + "\n" if lines else ""

    en = DEFAULT_LANG
    core = [p for pid in ("home", "start", "services", "about", "partner-agencies", "contact") if (p := site.get(en, pid))]
    other_langs = ", ".join(f"{site.t(l)['name']} ({SITE_URL}/{l}/)" for l in LANGS if l != en)
    return f"""# Buy House in Italy

> Property-finding service for international buyers who want to purchase a home in Italy, run by the Italian estate agency Oikos Immobiliare. The buyer describes what they want; a consultant turns it into a written wishlist (must haves, nice to haves, deal breakers), finds matching properties through Oikos, partner agencies and other sources, and coordinates the purchase up to the notary deed and after-sale services.

Key points:
- The site exists to understand what the buyer wants. It publishes no property catalogue: properties are matched privately against each buyer's brief.
- Ways to start: a guided chat interview, a voice interview, or a video call with a consultant.
- If no property in the database matches, the search continues through partner agencies, colleagues and other sources.
- Legal and tax figures on the guides are indicative and must be confirmed with a notary, lawyer or tax adviser.
- Other languages: {other_langs}.

{section("Start here", core)}
{section("Services", site.of_type(en, "service"))}
{section("Guides", site.of_type(en, "guide"))}
{section("Where to buy", site.of_type(en, "region"))}
{section("Buying from abroad", site.of_type(en, "nationality"))}
## Optional

- [Privacy policy]({site.get(en, "privacy").url})
- [Cookie policy]({site.get(en, "cookies").url})
- [Terms of service]({site.get(en, "terms").url})
"""


def clean_outputs():
    for d in LANGS + ["internal"]:
        target = ROOT / d
        if target.exists():
            shutil.rmtree(target)


def main():
    global LANGS
    if "--langs" in sys.argv:
        LANGS = sys.argv[sys.argv.index("--langs") + 1].split(",")
    site = Site()
    clean_outputs()
    for page in site.pages.values():
        out = page.out_file
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render(site, page), encoding="utf-8")
    (ROOT / "index.html").write_text(root_redirect(site), encoding="utf-8")
    (ROOT / "sitemap.xml").write_text(sitemap(site), encoding="utf-8")
    (ROOT / "llms.txt").write_text(llms_txt(site), encoding="utf-8")
    indexable = sum(1 for p in site.pages.values() if not p.noindex)
    print(f"built {len(site.pages)} pages ({indexable} indexable) into {ROOT}")


if __name__ == "__main__":
    main()
