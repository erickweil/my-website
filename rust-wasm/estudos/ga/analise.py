import csv, sys, math
from collections import OrderedDict

rows = []
for f in sys.argv[1:]:
    with open(f) as fh:
        rows += list(csv.DictReader(fh))

def med(xs):
    xs = sorted(xs)
    n = len(xs)
    if n == 0:
        return math.nan
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2

g = OrderedDict()
for r in rows:
    chave = (f"{r['variante']} (ilhas={r['ilhas']})", r['instancia'])
    g.setdefault(chave, []).append(r)

insts = list(OrderedDict.fromkeys(r['instancia'] for r in rows))
vars_ = list(OrderedDict.fromkeys(f"{r['variante']} (ilhas={r['ilhas']})" for r in rows))

for i in insts:
    print(f"\n== {i}")
    print(f"{'variante':36} {'n':>3} {'vál':>4} {'aval→vál(med)':>14} {'s→vál':>7} {'fit med':>8} {'melhor':>8} {'s/exec':>7} {'ger/s':>8} {'Mav/s':>6}")
    for v in vars_:
        rs = g.get((v, i))
        if not rs:
            continue
        ok = [r for r in rs if r['valido_s']]
        av = med([int(r['valido_aval']) for r in ok]) if ok else math.nan
        tv = med([float(r['valido_s']) for r in ok]) if ok else math.nan
        fits = [float(r['fitness']) for r in rs]
        fmed, fmel = med(fits), max(fits)
        tot_s = max(sum(float(r['segundos']) for r in rs), 1e-9)
        s_exec = tot_s / len(rs)
        rate = sum(int(r['avaliacoes']) for r in rs) / tot_s / 1e6
        if all(r.get('geracoes') for r in rs):
            ger_s = f"{sum(int(r['geracoes']) for r in rs) / tot_s:8.1f}"
        else:
            ger_s = f"{'-':>8}"
        av_s = f"{av:14,.0f}" if not math.isnan(av) else f"{'-':>14}"
        tv_s = f"{tv:7.2f}" if not math.isnan(tv) else f"{'-':>7}"
        print(f"{v:36} {len(rs):3} {len(ok):4} {av_s} {tv_s} {fmed:8.1f} {fmel:8.1f} {s_exec:7.2f} {ger_s} {rate:6.2f}")
