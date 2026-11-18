"""Resumo da grade da busca local: agrupamento atual x regras diretas. Uso: python3 analise.py r1.csv"""
import csv
import statistics
import sys
from collections import defaultdict

linhas = list(csv.DictReader(open(sys.argv[1])))
por = defaultdict(list)
for r in linhas:
    por[(r["instancia"], r["variante"])].append(r)

variantes = list(dict.fromkeys(r["variante"] for r in linhas))
instancias = list(dict.fromkeys(r["instancia"] for r in linhas))
print(f"{'instância':<24}{'variante':<10}{'válidos':>8}{'mediana s':>11}{'pior s':>9}{'mediana Mmov':>14}{'Mmov/s':>8}")
for inst in instancias:
    for v in variantes:
        rs = por.get((inst, v))
        if not rs:
            continue
        ok = [r for r in rs if r["valido_s"]]
        tempos = sorted(float(r["valido_s"]) for r in ok)
        movs = sorted(int(r["valido_mov"]) / 1e6 for r in ok)
        vazao = statistics.median(int(r["movimentos"]) / float(r["segundos"]) / 1e6 for r in rs)
        med = f"{statistics.median(tempos):.2f}" if tempos else "-"
        pior = f"{tempos[-1]:.2f}" if len(tempos) == len(rs) else "-"
        mm = f"{statistics.median(movs):.2f}" if movs else "-"
        print(f"{inst:<24}{v:<10}{len(ok):>5}/{len(rs):<2}{med:>11}{pior:>9}{mm:>14}{vazao:>8.2f}")
    print()

print("Por semente (s até válido; '-' = não chegou):")
for inst in instancias:
    print(inst)
    for v in variantes:
        rs = sorted(por.get((inst, v), []), key=lambda r: int(r["semente"]))
        print(f"  {v:<10}" + " ".join(f"{float(r['valido_s']):6.2f}" if r["valido_s"] else "     -" for r in rs))
