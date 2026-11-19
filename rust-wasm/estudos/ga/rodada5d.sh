#!/bin/bash
# Rodada 5d: teste de ilhas com os novos defaults (pop=16/ilha, torn=3, div=true, p_ipx=0.25,
# p_kempe=0.1, retry=4, stag=None, migrar_elite=false), variando épocas e taxas de migração.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
OUT="$DIR/r5d-ilhas-epoca-mig.csv"

# Eixo 1: épocas (10, 25, 50, 100, 250, 500) com 2 migrantes de 16
# Eixo 2: migrantes por época (0, 1, 2, 4, 6, 8 de 16) em época 50 e época 100
# Nota: r5d-ilhas-epoca-mig.csv foi gerado quando `mig:` ainda era fração da ilha (0.0625=1, 0.125=2, ...).
VARS="padrao+epoca:10+mig:2,padrao+epoca:25+mig:2,padrao+epoca:50+mig:2,padrao+epoca:100+mig:2,padrao+epoca:250+mig:2,padrao+epoca:500+mig:2,padrao+epoca:50+mig:1,padrao+epoca:50+mig:4,padrao+epoca:50+mig:6,padrao+epoca:50+mig:8,padrao+epoca:100+mig:0,padrao+epoca:100+mig:1,padrao+epoca:100+mig:4,padrao+epoca:100+mig:8"

"$B" "$INST_DIR/faculdade-anonimizado.json" --sementes 5 --orcamento 1 --ilhas 8 --variantes "$VARS" --csv --cabecalho > "$OUT"
echo "$(date +%T) faculdade 1M concluído" >&2
"$B" "$INST_DIR/media.json" --sementes 5 --orcamento 5 --ilhas 8 --variantes "$VARS" --csv >> "$OUT"
echo "$(date +%T) media 5M concluído" >&2
"$B" "$INST_DIR/grande.json" --sementes 5 --orcamento 10 --ilhas 8 --variantes "$VARS" --csv >> "$OUT"
echo "$(date +%T) grande 10M concluído" >&2
