#!/usr/bin/env python3
"""Generate labelled placeholder images (development tool).

Each placeholder is drawn as SVG, rasterised with rsvg-convert and encoded to AVIF (ffmpeg/libaom),
WebP (cwebp) and JPEG (ffmpeg) at two widths. Output: img/ph/<name>-<width>.<ext> plus
img/ph/manifest.json, which tools/build.py reads for width/height and srcset.

To use real photos instead, put files with the same names and widths in img/ph/ (or change the
paths in manifest.json) and rebuild. Every placeholder carries a visible "Placeholder" label.
"""
import json
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img" / "ph"

SKY = "#F6EEDB"
SUN = "#EBCB7E"
SEA = "#A9BCBB"
SEA_DEEP = "#7F9796"
HILL = ["#D8D0AE", "#B9B18A", "#99946D", "#77744F"]
STONE = "#FFFBF2"
ROOF = "#B98A4A"
OCHRE = "#DDBB74"
DARK = "#3B362C"


def hills(rng, w, h, base, amp, color, steps=6):
    pts = []
    for i in range(steps + 1):
        x = w * i / steps
        y = base + rng.uniform(-amp, amp)
        pts.append((x, y))
    d = f"M0,{h} L0,{pts[0][1]:.0f} "
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        cx = (x0 + x1) / 2
        d += f"C{cx:.0f},{y0:.0f} {cx:.0f},{y1:.0f} {x1:.0f},{y1:.0f} "
    d += f"L{w},{h} Z"
    return f'<path d="{d}" fill="{color}"/>'


def olive_tree(x, y, s):
    return (f'<rect x="{x - 2 * s:.0f}" y="{y:.0f}" width="{4 * s:.0f}" height="{18 * s:.0f}" fill="{DARK}"/>'
            f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="{22 * s:.0f}" ry="{14 * s:.0f}" fill="#99946D"/>')


def cypress(x, y, s):
    return f'<ellipse cx="{x:.0f}" cy="{y - 40 * s:.0f}" rx="{7 * s:.0f}" ry="{42 * s:.0f}" fill="{DARK}"/>'


def trullo(x, y, s):
    return (f'<rect x="{x - 30 * s:.0f}" y="{y - 40 * s:.0f}" width="{60 * s:.0f}" height="{40 * s:.0f}" fill="{STONE}"/>'
            f'<path d="M{x - 32 * s:.0f},{y - 40 * s:.0f} L{x:.0f},{y - 100 * s:.0f} L{x + 32 * s:.0f},{y - 40 * s:.0f} Z" fill="#8C8170"/>'
            f'<rect x="{x - 8 * s:.0f}" y="{y - 26 * s:.0f}" width="{16 * s:.0f}" height="{26 * s:.0f}" rx="{8 * s:.0f}" fill="{DARK}"/>')


def farmhouse(x, y, s, wall=STONE):
    return (f'<rect x="{x - 80 * s:.0f}" y="{y - 70 * s:.0f}" width="{160 * s:.0f}" height="{70 * s:.0f}" fill="{wall}"/>'
            f'<path d="M{x - 90 * s:.0f},{y - 70 * s:.0f} L{x:.0f},{y - 105 * s:.0f} L{x + 90 * s:.0f},{y - 70 * s:.0f} Z" fill="{ROOF}"/>'
            + "".join(f'<rect x="{x + dx * s:.0f}" y="{y - 52 * s:.0f}" width="{14 * s:.0f}" height="{20 * s:.0f}" fill="{DARK}"/>'
                      for dx in (-60, -25, 10, 45)))


def villa_arches(x, y, s):
    out = f'<rect x="{x - 110 * s:.0f}" y="{y - 90 * s:.0f}" width="{220 * s:.0f}" height="{90 * s:.0f}" fill="{OCHRE}"/>'
    out += f'<rect x="{x - 118 * s:.0f}" y="{y - 98 * s:.0f}" width="{236 * s:.0f}" height="{10 * s:.0f}" fill="{ROOF}"/>'
    for i in range(5):
        ax = x - 88 * s + i * 44 * s
        out += f'<rect x="{ax - 12 * s:.0f}" y="{y - 60 * s:.0f}" width="{24 * s:.0f}" height="{60 * s:.0f}" rx="{12 * s:.0f}" fill="{DARK}"/>'
    return out


def town(rng, x0, x1, y, s, colors):
    out = ""
    x = x0
    while x < x1:
        w = rng.uniform(30, 60) * s
        hgt = rng.uniform(50, 120) * s
        out += f'<rect x="{x:.0f}" y="{y - hgt:.0f}" width="{w:.0f}" height="{hgt:.0f}" fill="{rng.choice(colors)}"/>'
        for wy in range(int(y - hgt + 14 * s), int(y - 12 * s), int(26 * s) or 1):
            out += f'<rect x="{x + w / 2 - 4 * s:.0f}" y="{wy}" width="{8 * s:.0f}" height="{12 * s:.0f}" fill="{DARK}" opacity="0.7"/>'
        x += w + 2 * s
    return out


def scene(kind, w, h, seed):
    rng = random.Random(seed)
    s = w / 1200
    el = [f'<rect width="{w}" height="{h}" fill="{SKY}"/>',
          f'<circle cx="{w * rng.uniform(0.6, 0.85):.0f}" cy="{h * 0.2:.0f}" r="{60 * s:.0f}" fill="{SUN}"/>']
    if kind == "puglia":
        el.append(f'<rect y="{h * 0.42:.0f}" width="{w}" height="{h * 0.08:.0f}" fill="{SEA}"/>')
        el.append(hills(rng, w, h, h * 0.5, 12 * s, HILL[0]))
        el.append(hills(rng, w, h, h * 0.62, 18 * s, HILL[1]))
        for i in range(3):
            el.append(trullo(w * (0.25 + i * 0.12), h * 0.66 + i * 4 * s, s * 1.1))
        for i in range(7):
            el.append(olive_tree(w * rng.uniform(0.05, 0.95), h * rng.uniform(0.74, 0.86), s * rng.uniform(1.0, 1.6)))
    elif kind == "tuscany":
        el.append(hills(rng, w, h, h * 0.42, 30 * s, HILL[0], 4))
        el.append(hills(rng, w, h, h * 0.55, 40 * s, HILL[1], 5))
        el.append(farmhouse(w * 0.6, h * 0.58, s))
        for i in range(8):
            el.append(cypress(w * (0.12 + i * 0.05), h * (0.66 + i * 0.012), s * 1.2))
        el.append(hills(rng, w, h, h * 0.8, 20 * s, HILL[2], 4))
    elif kind == "sicily":
        el.append(f'<path d="M{w * 0.45:.0f},{h * 0.45:.0f} L{w * 0.62:.0f},{h * 0.18:.0f} L{w * 0.66:.0f},{h * 0.19:.0f} L{w * 0.85:.0f},{h * 0.45:.0f} Z" fill="#9C9479"/>')
        el.append(f'<rect y="{h * 0.45:.0f}" width="{w}" height="{h * 0.15:.0f}" fill="{SEA}"/>')
        el.append(hills(rng, w, h, h * 0.62, 14 * s, HILL[1]))
        el.append(town(rng, w * 0.05, w * 0.55, h * 0.72, s, [OCHRE, STONE, "#E8D3A2"]))
        el.append(hills(rng, w, h, h * 0.85, 10 * s, HILL[2]))
    elif kind == "lake-como":
        for i in range(4):
            px = w * (i * 0.3 - 0.05)
            el.append(f'<path d="M{px:.0f},{h * 0.55:.0f} L{px + w * 0.2:.0f},{h * rng.uniform(0.12, 0.25):.0f} L{px + w * 0.42:.0f},{h * 0.55:.0f} Z" fill="{HILL[1] if i % 2 else HILL[2]}"/>')
        el.append(f'<rect y="{h * 0.55:.0f}" width="{w}" height="{h * 0.25:.0f}" fill="{SEA_DEEP}"/>')
        el.append(villa_arches(w * 0.35, h * 0.8, s))
        el.append(f'<rect y="{h * 0.8:.0f}" width="{w}" height="{h * 0.2:.0f}" fill="{HILL[3]}"/>')
    elif kind == "liguria":
        el.append(f'<rect y="{h * 0.5:.0f}" width="{w}" height="{h * 0.5:.0f}" fill="{SEA}"/>')
        el.append(f'<path d="M0,{h * 0.15:.0f} C{w * 0.3:.0f},{h * 0.2:.0f} {w * 0.5:.0f},{h * 0.5:.0f} {w * 0.7:.0f},{h:.0f} L0,{h} Z" fill="{HILL[2]}"/>')
        for row in range(4):
            el.append(town(rng, w * 0.02, w * (0.35 + row * 0.07), h * (0.42 + row * 0.15), s * 0.9,
                           [OCHRE, "#CFA36A", "#E8D3A2", STONE, "#D9B07A"]))
    elif kind == "sardinia":
        el.append(f'<rect y="{h * 0.38:.0f}" width="{w}" height="{h * 0.62:.0f}" fill="{SEA}"/>')
        el.append(f'<rect y="{h * 0.6:.0f}" width="{w}" height="{h * 0.4:.0f}" fill="#9FB3AE"/>')
        el.append(f'<path d="M0,{h * 0.75:.0f} C{w * 0.3:.0f},{h * 0.7:.0f} {w * 0.6:.0f},{h * 0.82:.0f} {w},{h * 0.78:.0f} L{w},{h} L0,{h} Z" fill="#E8D9B5"/>')
        for i in range(6):
            r = rng.uniform(30, 80) * s
            el.append(f'<ellipse cx="{w * rng.uniform(0.0, 0.4):.0f}" cy="{h * rng.uniform(0.6, 0.85):.0f}" rx="{r * 1.4:.0f}" ry="{r:.0f}" fill="#B9A98C"/>')
        el.append(villa_arches(w * 0.75, h * 0.62, s * 0.7))
    elif kind == "interior":
        el = [f'<rect width="{w}" height="{h}" fill="{STONE}"/>',
              f'<rect x="{w * 0.3:.0f}" y="{h * 0.12:.0f}" width="{w * 0.4:.0f}" height="{h * 0.62:.0f}" rx="{w * 0.2:.0f}" fill="{SKY}"/>',
              f'<rect x="{w * 0.3:.0f}" y="{h * 0.5:.0f}" width="{w * 0.4:.0f}" height="{h * 0.24:.0f}" fill="{SEA if seed % 2 else HILL[1]}"/>',
              f'<rect x="{w * 0.3:.0f}" y="{h * 0.12:.0f}" width="{w * 0.4:.0f}" height="{h * 0.62:.0f}" rx="{w * 0.2:.0f}" fill="none" stroke="#C9B998" stroke-width="{18 * s:.0f}"/>',
              f'<rect y="{h * 0.74:.0f}" width="{w}" height="{h * 0.26:.0f}" fill="#D8BE92"/>',
              f'<rect x="{w * 0.08:.0f}" y="{h * 0.6:.0f}" width="{w * 0.18:.0f}" height="{h * 0.16:.0f}" fill="{HILL[2]}"/>',
              f'<rect x="{w * 0.74:.0f}" y="{h * 0.56:.0f}" width="{w * 0.08:.0f}" height="{h * 0.2:.0f}" fill="{ROOF}"/>']
    return el


def svg(kind, w, h, seed, label, right=False):
    s = w / 1200
    body = "".join(scene(kind, w, h, seed))
    fs = max(14, round(22 * s))
    pad = max(8, round(16 * s))
    tag_w = round(len(label) * fs * 0.56 + pad * 2)
    tag_h = round(fs * 1.9)
    x0 = w - tag_w - pad if right else pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}'
            f'<rect x="{x0}" y="{h - tag_h - pad}" width="{tag_w}" height="{tag_h}" rx="4" fill="#221F1A" opacity="0.82"/>'
            f'<text x="{x0 + pad}" y="{h - pad - tag_h * 0.32:.0f}" font-family="DejaVu Sans, sans-serif" font-size="{fs}" fill="#FFFDF8">{label}</text>'
            "</svg>")


IMAGES = [
    # name, kind, aspect (w/h), seed, label, widths
    ("hero-puglia", "puglia", 4 / 5, 3, "Placeholder photo: Ostuni, Puglia", (480, 960)),
    ("region-puglia", "puglia", 3 / 2, 11, "Placeholder photo: Puglia", (640, 1280)),
    ("region-tuscany", "tuscany", 3 / 2, 12, "Placeholder photo: Tuscany", (640, 1280)),
    ("region-sicily", "sicily", 3 / 2, 13, "Placeholder photo: Sicily", (640, 1280)),
    ("region-lake-como", "lake-como", 3 / 2, 14, "Placeholder photo: Lake Como", (640, 1280)),
    ("region-liguria", "liguria", 3 / 2, 15, "Placeholder photo: Liguria", (640, 1280)),
    ("region-sardinia", "sardinia", 3 / 2, 16, "Placeholder photo: Sardinia", (640, 1280)),
    ("og-default", "puglia", 1200 / 630, 5, "Placeholder image: Buy House in Italy", (1200,)),
]



def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    only = sys.argv[1:]
    for tool in ("rsvg-convert", "cwebp", "ffmpeg"):
        if not shutil.which(tool):
            sys.exit(f"missing tool: {tool}")
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        existing = json.loads((OUT / "manifest.json").read_text()) if only and (OUT / "manifest.json").exists() else {}
        manifest.update(existing)
        for name, kind, aspect, seed, label, widths in IMAGES:
            if only and name not in only:
                continue
            entry = {"aspect": round(aspect, 4), "widths": [], "label": label}
            for w in widths:
                h = round(w / aspect)
                src = tmp / f"{name}-{w}.svg"
                png = tmp / f"{name}-{w}.png"
                src.write_text(svg(kind, w, h, seed, label, right=name.startswith("hero")), encoding="utf-8")
                run(["rsvg-convert", "-w", str(w), "-h", str(h), "-o", str(png), str(src)])
                base = OUT / f"{name}-{w}"
                run(["cwebp", "-quiet", "-q", "78", str(png), "-o", f"{base}.webp"])
                run(["ffmpeg", "-y", "-i", str(png), "-c:v", "libaom-av1", "-still-picture", "1", "-crf", "34",
                     "-pix_fmt", "yuv420p", f"{base}.avif"])
                run(["ffmpeg", "-y", "-i", str(png), "-q:v", "4", f"{base}.jpg"])
                entry["widths"].append({"w": w, "h": h})
            manifest[name] = entry
            print("ok", name)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
