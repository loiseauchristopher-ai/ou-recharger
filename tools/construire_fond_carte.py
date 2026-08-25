# -*- coding: utf-8 -*-
"""Simplifie le contour des departements francais pour le fond de carte canvas.

Le trace ne sert que de repere visuel : on peut se permettre Douglas-Peucker
agressif et 4 decimales (~11 m de precision).
"""
import json
import sys


def perp(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return ((x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2) ** 0.5


def douglas_peucker(pts, eps):
    if len(pts) < 3:
        return pts
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = perp(pts[i], pts[0], pts[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax <= eps:
        return [pts[0], pts[-1]]
    return douglas_peucker(pts[:idx + 1], eps)[:-1] + douglas_peucker(pts[idx:], eps)


def main(src, dest, eps=0.01):
    sys.setrecursionlimit(100000)
    d = json.load(open(src, encoding="utf-8"))
    traces, avant, apres = [], 0, 0
    for f in d["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            anneau = poly[0]                      # contour exterieur seulement
            avant += len(anneau)
            s = douglas_peucker([tuple(p) for p in anneau], eps)
            if len(s) < 4:
                continue
            apres += len(s)
            traces.append([[round(x, 4), round(y, 4)] for x, y in s])
    json.dump(traces, open(dest, "w", encoding="utf-8"), separators=(",", ":"))
    print("contours %d -> %d points (%d traces)" % (avant, apres, len(traces)))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 0.01)
