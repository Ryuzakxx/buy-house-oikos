#!/usr/bin/env python3
"""Draw the map of Italy's regions used on the "Where to buy" pages (development tool, standard library only).

Reads Natural Earth 1:10m admin-1 states and provinces (public domain, naturalearthdata.com), downloaded once into
~/.cache/buyhouseinitaly-map/. Natural Earth divides Italy into provinces: they are merged into the 20 regions by
dropping the borders that provinces of the same region share, projected (transverse Mercator on 12.5° E) and
simplified one border at a time, so two neighbouring regions follow the same simplified line and never open a gap.
Islands smaller than MIN_ISLAND_KM2 are left out.

Writes data/italy-regions.json: an SVG path per region in a "0 0 width height" view box, and for each region the
point farthest from its edges, where tools/build.py puts the mark of a buying guide and js/pages/italy-map.js shows
the region's name. tools/build.py draws the map from this file; run this script only to change the geometry:
python3 tools/map.py
"""
import json
import math
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "italy-regions.json"
CACHE = Path.home() / ".cache" / "buyhouseinitaly-map"
SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson"

HEIGHT = 1000          # view box height; the width follows the country's proportions
MARGIN = 6             # view box units left free around the country, so strokes on the coast are not cut
TOLERANCE_KM = 0.8     # how far a simplified border may move from the original line
MIN_ISLAND_KM2 = 30    # smaller islands and holes would be a speck of a pixel or two
EARTH_KM = 6371.0
CENTRAL_MERIDIAN = 12.5

# Natural Earth's "region" value of each region, in ISTAT order (north to south), and the key the site uses for it.
REGIONS = {
    "Piemonte": "piemonte",
    "Valle d'Aosta": "valle-d-aosta",
    "Lombardia": "lombardia",
    "Trentino-Alto Adige": "trentino-alto-adige",
    "Veneto": "veneto",
    "Friuli-Venezia Giulia": "friuli-venezia-giulia",
    "Liguria": "liguria",
    "Emilia-Romagna": "emilia-romagna",
    "Toscana": "toscana",
    "Umbria": "umbria",
    "Marche": "marche",
    "Lazio": "lazio",
    "Abruzzo": "abruzzo",
    "Molise": "molise",
    "Campania": "campania",
    "Apulia": "puglia",
    "Basilicata": "basilicata",
    "Calabria": "calabria",
    "Sicily": "sicilia",
    "Sardegna": "sardegna",
}


def source() -> dict:
    path = CACHE / SOURCE.rsplit("/", 1)[1]
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f"downloading {SOURCE}")
        with urllib.request.urlopen(SOURCE, timeout=300) as r:
            path.write_bytes(r.read())
    return json.loads(path.read_text(encoding="utf-8"))


def province_rings(data: dict) -> dict[str, list[list[tuple]]]:
    """Rings of every Italian province grouped by region, with points rounded so that shared borders match exactly."""
    rings = defaultdict(list)
    for feature in data["features"]:
        p = feature["properties"]
        if p.get("adm0_a3") != "ITA":
            continue
        key = REGIONS.get(p.get("region"))
        if key is None:
            sys.exit(f"unknown region {p.get('region')!r} for the province {p.get('name')!r}: add it to REGIONS")
        g = feature["geometry"]
        for polygon in [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]:
            for ring in polygon:
                rings[key].append([(round(x, 6), round(y, 6)) for x, y in ring])
    if missing := set(REGIONS.values()) - set(rings):
        sys.exit(f"no provinces found for {sorted(missing)}")
    return rings


def outline(rings: list[list[tuple]]) -> list[list[tuple]]:
    """Closed rings around the union of polygons that meet edge to edge: an edge drawn twice is shared and drops out."""
    count = Counter(frozenset(e) for ring in rings for e in zip(ring, ring[1:]) if e[0] != e[1])
    neighbours = defaultdict(list)
    for edge, n in count.items():
        if n % 2:
            a, b = sorted(edge)
            neighbours[a].append(b)
            neighbours[b].append(a)

    def step(a):
        b = neighbours[a].pop()
        neighbours[b].remove(a)
        return b

    # Every point keeps an even number of edges, so a walk can only end where it started.
    result = []
    for start in sorted(neighbours):
        while neighbours[start]:
            ring, point = [start], step(start)
            while point != start:
                ring.append(point)
                point = step(point)
            result.append(ring + [start])
    return result


def project(point: tuple) -> tuple[float, float]:
    """Spherical transverse Mercator on CENTRAL_MERIDIAN, in km, with y pointing south as in SVG."""
    lon, lat = point
    lam, phi = math.radians(lon - CENTRAL_MERIDIAN), math.radians(lat)
    return EARTH_KM * math.atanh(math.cos(phi) * math.sin(lam)), -EARTH_KM * math.atan2(math.tan(phi), math.cos(lam))


def fixed_points(outlines: dict) -> set:
    """Points every simplified line must keep: where three regions meet, and where a border turns into coast."""
    owners = defaultdict(set)
    for key, rings in outlines.items():
        for ring in rings:
            for edge in zip(ring, ring[1:]):
                owners[frozenset(edge)].add(key)
    sides = defaultdict(list)
    for edge, regions in owners.items():
        for point in edge:
            sides[point].append(frozenset(regions))
    return {p for p, s in sides.items() if len(s) != 2 or s[0] != s[1]}


def chains(ring: list, fixed: set) -> list[list]:
    """A closed ring cut at its fixed points. A ring with none starts at its smallest point, so all its copies match."""
    points = ring[:-1]
    cuts = [i for i, p in enumerate(points) if p in fixed]
    start = cuts[0] if cuts else points.index(min(points))
    points = points[start:] + points[:start] + [points[start]]
    if not cuts:
        return [points]
    result, chain = [], [points[0]]
    for p in points[1:]:
        chain.append(p)
        if p in fixed:
            result.append(chain)
            chain = [p]
    return result


def distance(p, a, b) -> float:
    """Distance from p to the segment ab."""
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    t = 0 if length == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def douglas_peucker(points: list, tolerance: float) -> list:
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        far, k = 0.0, None
        for m in range(i + 1, j):
            d = distance(points[m], points[i], points[j])
            if d > far:
                far, k = d, m
        if k is not None and far > tolerance:
            keep.add(k)
            stack += [(i, k), (k, j)]
    return [points[i] for i in sorted(keep)]


def simplifier(xy: dict, tolerance: float):
    """Simplify each border once, in one direction, and hand the same line to both regions it separates."""
    done = {}

    def simplify(chain: list) -> list:
        forward, backward = tuple(chain), tuple(reversed(chain))
        key = min(forward, backward)
        if key not in done:
            done[key] = douglas_peucker([xy[p] for p in key], tolerance)
        return done[key] if key == forward else done[key][::-1]

    return simplify


def area(ring: list) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:]))) / 2


def inside(p, ring) -> bool:
    x, y = p
    result = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            result = not result
    return result


def label_point(ring: list) -> tuple[float, float]:
    """The point inside the ring farthest from its edge, searched on a grid that narrows three times."""
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    centre = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
    span, best = max(max(xs) - min(xs), max(ys) - min(ys)) / 2, -1.0
    for _ in range(3):
        step, (cx, cy) = span / 12, centre
        for i in range(-12, 13):
            for j in range(-12, 13):
                p = (cx + i * step, cy + j * step)
                if inside(p, ring):
                    d = min(distance(p, a, b) for a, b in zip(ring, ring[1:]))
                    if d > best:
                        best, centre = d, p
        span = step * 2
    return centre


def without_repeats(ring: list) -> list:
    result = [ring[0]]
    for p in ring[1:]:
        if p != result[-1]:
            result.append(p)
    return result


def numbers(values) -> str:
    """An SVG number list: a minus sign already separates two numbers, so no space goes before it."""
    out = ""
    for v in values:
        out += f"{v}" if not out or v < 0 else f" {v}"
    return out


def svg_path(rings: list) -> str:
    """Each ring as an absolute start point and relative steps; z draws the last step back to the start."""
    parts = []
    for ring in rings:
        steps = []
        for (x1, y1), (x2, y2) in zip(ring, ring[1:-1]):
            steps += [x2 - x1, y2 - y1]
        parts.append(f"M{ring[0][0]} {ring[0][1]}l{numbers(steps)}z")
    return "".join(parts)


def main():
    provinces = province_rings(source())
    outlines = {key: outline(provinces[key]) for key in REGIONS.values()}
    fixed = fixed_points(outlines)
    xy = {p: project(p) for rings in outlines.values() for ring in rings for p in ring}
    simplify = simplifier(xy, TOLERANCE_KM)

    shapes = {}
    for key, rings in outlines.items():
        kept = []
        for ring in rings:
            points = []
            for chain in chains(ring, fixed):
                line = simplify(chain)
                points += line if not points else line[1:]
            if area(points) >= MIN_ISLAND_KM2:
                kept.append(points)
        shapes[key] = kept

    every = [p for rings in shapes.values() for ring in rings for p in ring]
    min_x, max_x = min(p[0] for p in every), max(p[0] for p in every)
    min_y, max_y = min(p[1] for p in every), max(p[1] for p in every)
    scale = (HEIGHT - 2 * MARGIN) / (max_y - min_y)
    width = round((max_x - min_x) * scale + 2 * MARGIN)

    def place(p):
        return round((p[0] - min_x) * scale + MARGIN), round((p[1] - min_y) * scale + MARGIN)

    regions = {}
    for key, rings in shapes.items():
        placed = [r for r in (without_repeats([place(p) for p in ring]) for ring in rings) if len(r) >= 4]
        x, y = label_point(max(placed, key=area))
        regions[key] = {"d": svg_path(placed), "label": [round(x), round(y)]}

    OUT.write_text(json.dumps({
        "source": "Natural Earth 1:10m admin-1 states and provinces v5.1.2, public domain. Generated by tools/map.py.",
        "width": width,
        "height": HEIGHT,
        "regions": regions,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    total = sum(len(r) for rings in shapes.values() for r in rings)
    print(f"{len(regions)} regions, {total} points, view box 0 0 {width} {HEIGHT}, {OUT.stat().st_size // 1024} KB: {OUT}")


if __name__ == "__main__":
    main()
