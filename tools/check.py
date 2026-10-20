#!/usr/bin/env python3
"""Checks the built site (development tool, standard library only). Run after tools/build.py.

Reports broken internal links and anchors, duplicate ids, unbalanced tags, heading problems,
duplicate titles and descriptions, canonical and hreflang errors, invalid JSON-LD, images
without size or alt, sitemap mismatches and any em or en dash in visible text or source strings.
Exit code 1 if anything fails.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import BASE_PATH, LANGS, ROOT, SITE_URL as SITE  # noqa: E402  same settings as the build
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
OPTIONAL_END = {"p", "li", "dt", "dd", "option", "tr", "td", "th", "thead", "tbody", "tfoot"}
DASHES = re.compile("[—–]")


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.ids, self.headings, self.imgs, self.alternates = [], [], [], [], {}
        self.stack, self.errors, self.text = [], [], []
        self.title = self.description = self.canonical = None
        self.robots = ""
        self.jsonld, self._in = [], None
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag not in VOID:
            self.stack.append(tag)
        if "id" in a:
            self.ids.append(a["id"])
        for key in ("href", "src"):
            if a.get(key):
                self.links.append(a[key])
        if a.get("srcset"):
            self.links += [part.strip().split(" ")[0] for part in a["srcset"].split(",")]
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.headings.append(int(tag[1]))
        if tag == "img":
            self.imgs.append(a)
        if tag == "meta" and a.get("name") == "description":
            self.description = a.get("content")
        if tag == "meta" and a.get("name") == "robots":
            self.robots = a.get("content", "")
        if tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        if tag == "link" and a.get("rel") == "alternate" and a.get("hreflang"):
            self.alternates[a["hreflang"]] = a["href"]
        if tag == "title":
            self._in = "title"
        if tag == "script" and a.get("type") == "application/ld+json":
            self._in = "jsonld"
        if tag in {"script", "style"}:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag in {"script", "style"}:
            self._skip -= 1
        while self.stack and self.stack[-1] != tag and self.stack[-1] in OPTIONAL_END:
            self.stack.pop()
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errors.append(f"unexpected </{tag}> (open: {self.stack[-3:]})")
        self._in = None

    def handle_data(self, data):
        if self._in == "title":
            self.title = (self.title or "") + data
        elif self._in == "jsonld":
            self.jsonld.append(data)
        elif not self._skip:
            self.text.append(data)


def built_pages():
    files = [p for d in LANGS + ["internal"] for p in (ROOT / d).rglob("index.html")]
    return files + [ROOT / "404.html", ROOT / "index.html"]


def url_of(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    return "/" + (rel[: -len("index.html")] if rel.endswith("index.html") else rel)


def site_path(url_path: str) -> str | None:
    """The path below BASE_PATH (/en/ for /base/en/), or None when the URL is outside the site."""
    return url_path[len(BASE_PATH):] if url_path.startswith(BASE_PATH + "/") else None


def target_exists(url_path: str) -> bool:
    rel = site_path(url_path)
    if rel is None:
        return False
    p = ROOT / rel.lstrip("/")
    return p.is_file() or (p / "index.html").is_file()


def main():
    problems = defaultdict(list)
    parsed = {}
    for f in built_pages():
        page = Page()
        page.feed(f.read_text(encoding="utf-8"))
        parsed[url_of(f)] = page

    titles, descriptions = defaultdict(list), defaultdict(list)
    for url, p in parsed.items():
        err = problems[url].append
        for e in p.errors:
            err(e)
        if p.stack and p.stack != ["html"]:
            leftover = [t for t in p.stack if t not in OPTIONAL_END | {"html", "body", "head"}]
            if leftover:
                err(f"unclosed tags: {leftover}")
        dupes = {i for i in p.ids if p.ids.count(i) > 1}
        if dupes:
            err(f"duplicate ids: {sorted(dupes)}")
        for link in p.links:
            u = urlparse(link)
            if u.scheme or link.startswith(("mailto:", "tel:", "data:", "blob:")):
                continue
            if link.startswith("#"):
                if link[1:] and link[1:] not in p.ids:
                    err(f"missing anchor {link}")
                continue
            if link.startswith("/") and not target_exists(u.path):
                err(f"broken link {link}")
        for img in p.imgs:
            if "width" not in img or "height" not in img:
                err(f"img without width/height: {img.get('src')}")
            if "alt" not in img:
                err(f"img without alt: {img.get('src')}")
        text = "".join(p.text)
        if DASHES.search(text) or DASHES.search(p.title or "") or DASHES.search(p.description or ""):
            err("em or en dash in text (R-02)")
        if url == "/":
            continue
        if p.headings.count(1) != 1:
            err(f"{p.headings.count(1)} h1 elements")
        for prev, cur in zip(p.headings, p.headings[1:]):
            if cur > prev + 1:
                err(f"heading level skips from h{prev} to h{cur}")
                break
        for raw in p.jsonld:
            try:
                data = json.loads(raw)
                types = [n.get("@type") for n in data.get("@graph", [])]
                if "BreadcrumbList" in types:
                    bl = next(n for n in data["@graph"] if n.get("@type") == "BreadcrumbList")
                    if [i["position"] for i in bl["itemListElement"]] != list(range(1, len(bl["itemListElement"]) + 1)):
                        err("breadcrumb positions out of order")
            except (json.JSONDecodeError, StopIteration) as e:
                err(f"invalid JSON-LD: {e}")
        if not p.title:
            err("missing <title>")
        if "noindex" not in p.robots:
            titles[p.title].append(url)
            descriptions[p.description].append(url)
            if p.canonical != SITE + url:
                err(f"canonical {p.canonical} != {SITE + url}")
            if not p.description:
                err("missing meta description")
            elif not 50 <= len(p.description) <= 170:
                err(f"description length {len(p.description)}")
            for lang, href in p.alternates.items():
                other = parsed.get(site_path(urlparse(href).path))
                if other is None:
                    err(f"hreflang {lang} points to missing page {href}")
                elif other.alternates != p.alternates:
                    err(f"hreflang set differs on {href}")
            if p.alternates and "x-default" not in p.alternates:
                err("hreflang without x-default")

    for value, urls in list(titles.items()) + list(descriptions.items()):
        if len(urls) > 1:
            problems[urls[0]].append(f"duplicate title/description shared with {urls[1:]}")

    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    locs = [loc.text for loc in ET.parse(ROOT / "sitemap.xml").getroot().findall("s:url/s:loc", ns)]
    for loc in locs:
        path = site_path(urlparse(loc).path)
        if path not in parsed:
            problems["sitemap.xml"].append(f"missing page {loc}")
        elif "noindex" in parsed[path].robots:
            problems["sitemap.xml"].append(f"noindex page listed {loc}")
    indexable = {u for u, p in parsed.items() if "noindex" not in p.robots and u not in {"/"}}
    for u in sorted(indexable - {site_path(urlparse(l).path) for l in locs}):
        problems["sitemap.xml"].append(f"indexable page not listed {u}")

    for line in (ROOT / "llms.txt").read_text(encoding="utf-8").splitlines():
        for m in re.finditer(r"\((https://[^)]+)\)", line):
            if not target_exists(urlparse(m.group(1)).path):
                problems["llms.txt"].append(f"broken link {m.group(1)}")

    sources = list((ROOT / "content").rglob("*.html")) + list((ROOT / "i18n").glob("*.json")) + list((ROOT / "js").rglob("*.js")) + [ROOT / "llms.txt"]
    for src in sources:
        for n, line in enumerate(src.read_text(encoding="utf-8").splitlines(), 1):
            if DASHES.search(line):
                problems[str(src.relative_to(ROOT))].append(f"line {n}: em or en dash (R-02)")

    total = 0
    for where, items in sorted(problems.items()):
        for item in items:
            print(f"{where}: {item}")
            total += 1
    print(f"\nchecked {len(parsed)} pages, {len(locs)} sitemap URLs: {total} problems")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
