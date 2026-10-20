#!/usr/bin/env python3
"""Download and prepare the site photos (development tool).

Reads data/photos.json. Entries with "commons" are checked on Wikimedia Commons (CC0 or public domain only, else
it stops) and downloaded into ~/.cache/buyhouseinitaly-photos/<name>/; entries with "file" use a photo supplied by
Oikos, kept in data/photos/. Each one is cropped to the slot's aspect ratio around the focus point ("zoom" > 1 crops
tighter) and written as AVIF, WebP and JPEG at each width to img/photos/, plus manifest.json and CREDITS.md.
tools/build.py prefers these photos over the drawn placeholders in img/ph/ for the same name.

Needs ffmpeg (with libaom) and cwebp. The "logo" entry is copied to img/logo/ with a light variant for dark backgrounds.
Run: python3 tools/photos.py [--only name,name,logo]
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img" / "photos"
CACHE = Path.home() / ".cache" / "buyhouseinitaly-photos"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "BuyHouseInItalySiteBuild/1.0 (https://buyhouseinitaly.example; image licence check)"}
FREE_LICENCES = {"cc0", "public domain"}


def commons_info(title: str) -> dict:
    params = {"action": "query", "format": "json", "titles": title, "prop": "imageinfo", "iiprop": "url|size|extmetadata"}
    req = urllib.request.Request(f"{API}?{urllib.parse.urlencode(params)}", headers=UA)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                page = next(iter(json.load(r)["query"]["pages"].values()))
            break
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(10 * (attempt + 1))
    ii = page["imageinfo"][0]
    md = ii["extmetadata"]
    text = lambda key: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", md.get(key, {}).get("value", ""))).strip()
    return {
        "title": title, "url": ii["url"].split("?")[0], "page": ii["descriptionurl"], "width": ii["width"], "height": ii["height"],
        "licence": text("LicenseShortName"), "author": text("Artist") or text("Credit"),
    }


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def crop_box(w, h, aspect, focus, zoom=1):
    target = aspect[0] / aspect[1]
    if w / h > target:
        cw, ch = round(h * target / zoom), round(h / zoom)
    else:
        cw, ch = round(w / zoom), round(w / target / zoom)
    x = min(max(round(focus[0] * w - cw / 2), 0), w - cw)
    y = min(max(round(focus[1] * h - ch / 2), 0), h - ch)
    return cw, ch, x, y


def image_size(path: Path) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", str(path)], check=True, capture_output=True, text=True).stdout
    w, h = out.strip().split(",")[:2]
    return int(w), int(h)


def supplied_info(photo: dict) -> tuple[dict, Path]:
    original = ROOT / photo["file"]
    if not original.exists():
        sys.exit(f"{photo['name']}: {photo['file']} not found")
    w, h = image_size(original)
    return {"page": photo["file"], "width": w, "height": h, "licence": "supplied", "author": photo["credit"]}, original


def commons_original(photo: dict) -> tuple[dict, Path]:
    info = commons_info(photo["commons"])
    time.sleep(2)
    if info["licence"].lower() not in FREE_LICENCES:
        sys.exit(f"{photo['commons']}: licence is {info['licence']!r}, not CC0 or public domain")
    folder = CACHE / photo["name"]
    folder.mkdir(parents=True, exist_ok=True)
    original = folder / ("original" + Path(urllib.parse.urlparse(info["url"]).path).suffix.lower())
    if not original.exists():
        with urllib.request.urlopen(urllib.request.Request(info["url"], headers=UA), timeout=120) as r, open(original, "wb") as fh:
            fh.write(r.read())
        time.sleep(2)
    return info, original


def credits_text(spec: list, manifest: dict) -> str:
    commons, supplied = [], []
    for photo in spec:
        entry = manifest.get(photo["name"])
        if not entry:
            continue
        if "commons" in photo:
            commons.append(f"- `{photo['name']}`: [{photo['commons'][5:]}]({entry['source']}), {entry['author']}, {entry['licence']}")
        else:
            supplied.append(f"- `{photo['name']}`: `{entry['source']}`, {entry['author']}")
    return ("# Photo credits\n\n## Wikimedia Commons\n\nIn the public domain or released under CC0: no attribution is required. "
            "Authors are listed anyway, as a courtesy and to keep the source traceable.\n\n" + "\n".join(commons) + "\n\n"
            "## Supplied by Oikos Immobiliare\n\nOriginals in `data/photos/`. Not from a free-licence archive: ask Oikos before using them anywhere else.\n\n"
            + "\n".join(supplied) + "\n")


def logo(spec: dict):
    """Copies the logo and writes a variant for dark backgrounds: neutral (grey) pixels take the light text colour."""
    src, out = ROOT / spec["file"], ROOT / spec["out"]
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, out.with_suffix(".webp"))
    r, g, b = (int(spec["lightText"][i:i + 2], 16) for i in (1, 3, 5))
    grey = "lt(max(max(r(X,Y),g(X,Y)),b(X,Y))-min(min(r(X,Y),g(X,Y)),b(X,Y)),40)"
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "light.png"
        run(["ffmpeg", "-y", "-i", str(src), "-vf",
             f"format=rgba,geq=r='if({grey},{r},r(X,Y))':g='if({grey},{g},g(X,Y))':b='if({grey},{b},b(X,Y))':a='alpha(X,Y)'", str(png)])
        run(["cwebp", "-quiet", "-q", "90", "-alpha_q", "100", str(png), "-o", f"{out}-light.webp"])
    print("ok logo", out.with_suffix(".webp").relative_to(ROOT), f"{out.relative_to(ROOT)}-light.webp")


def main():
    for tool in ("ffmpeg", "ffprobe", "cwebp"):
        if not shutil.which(tool):
            sys.exit(f"missing tool: {tool}")
    data = json.loads((ROOT / "data" / "photos.json").read_text(encoding="utf-8"))
    spec = data["photos"]
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    if not only or "logo" in only:
        logo(data["logo"])
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if only and manifest_path.exists() else {}
    for photo in spec:
        if only and photo["name"] not in only:
            continue
        info, original = supplied_info(photo) if "file" in photo else commons_original(photo)
        cw, ch, x, y = crop_box(info["width"], info["height"], photo["aspect"], photo["focus"], photo.get("zoom", 1))
        entry = {"aspect": round(photo["aspect"][0] / photo["aspect"][1], 4), "widths": [], "dir": "photos",
                 "source": info["page"], "author": info["author"], "licence": info["licence"]}
        with tempfile.TemporaryDirectory() as tmp:
            for w in photo["widths"]:
                h = round(w * photo["aspect"][1] / photo["aspect"][0])
                png = Path(tmp) / f"{w}.png"
                run(["ffmpeg", "-y", "-i", str(original), "-vf", f"crop={cw}:{ch}:{x}:{y},scale={w}:{h}:flags=lanczos", str(png)])
                base = OUT / f"{photo['name']}-{w}"
                run(["cwebp", "-quiet", "-q", "78", str(png), "-o", f"{base}.webp"])
                run(["ffmpeg", "-y", "-i", str(png), "-c:v", "libaom-av1", "-still-picture", "1", "-crf", "32", "-pix_fmt", "yuv420p", f"{base}.avif"])
                run(["ffmpeg", "-y", "-i", str(png), "-q:v", "4", f"{base}.jpg"])
                entry["widths"].append({"w": w, "h": h})
        manifest[photo["name"]] = entry
        print("ok", photo["name"], info["licence"], info["author"])
    ordered = {p["name"]: manifest[p["name"]] for p in spec if p["name"] in manifest}
    manifest_path.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (OUT / "CREDITS.md").write_text(credits_text(spec, ordered), encoding="utf-8")


if __name__ == "__main__":
    main()
