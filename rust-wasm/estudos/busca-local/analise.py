import csv, sys, statistics as st, math
from collections import defaultdict, OrderedDict
rows = []
for f in sys.argv[1:]:
    rows += list(csv.DictReader(open(f)))
g = OrderedDict()
for r in rows: g.setdefault((r['variante'], r['instancia']), []).append(r)
inst = list(OrderedDict.fromkeys(r['instancia'] for r in rows))
def med(xs):
    xs = sorted(xs); n = len(xs)
    if n == 0: return math.nan
    return xs[n//2] if n % 2 else (xs[n//2-1] + xs[n//2]) / 2
var = list(OrderedDict.fromkeys(r['variante'] for r in rows))
for i in inst:
    print(f"\n== {i}")
    print(f"{'variante':22} {'n':>3} {'válid':>5} {'mov→válido(med)':>16} {'s→válido(med)':>13} {'custo med':>11} {'obs med':>7} {'c2':>9} {'c8':>9} {'Mmov/s':>7}")
    for v in var:
        rs = g.get((v, i))
        if not rs: continue
        ok = [r for r in rs if r['valido_s']]
        mv = med([int(r['valido_mov']) if r['valido_s'] else math.inf for r in rs])
        tv = med([float(r['valido_s']) if r['valido_s'] else math.inf for r in rs])
        custo = med([float(r['custo']) for r in rs]); obs = med([int(r['observacoes']) if r['valido_s'] else math.inf for r in rs])
        c2 = med([float(r['c2']) for r in rs if r['c2']]); c8 = med([float(r['c8']) for r in rs if r['c8']])
        rate = sum(int(r['movimentos']) for r in rs) / sum(float(r['segundos']) for r in rs) / 1e6
        print(f"{v:22} {len(rs):3} {len(ok):5} {mv:16,.0f} {tv:13.2f} {custo:11.4f} {obs:7} {c2:9.4f} {c8:9.4f} {rate:7.2f}".replace("inf", "  ∞"))
