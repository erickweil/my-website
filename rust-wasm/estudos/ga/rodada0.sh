#!/bin/bash
# Rodada 0 (Fase 0): linha de base do GA atual (clássico e 8 ilhas) nas 3 instâncias de referência.
# Mac mini M1 (8 núcleos: 4P + 4E), binário nativo --release com -C target-cpu=native.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
INSTS="$INST_DIR/faculdade-anonimizado.json $INST_DIR/media.json $INST_DIR/grande.json"
OUT="$DIR/r0-base.csv"

"$B" $INSTS --sementes 10 --orcamento 10 --ilhas 0 --variantes originais,i1+m1 --csv --cabecalho > "$OUT"
echo "$(date +%T) ilhas=0 concluído" >&2
"$B" $INSTS --sementes 10 --orcamento 10 --ilhas 8 --variantes originais,i1+m1 --csv >> "$OUT"
echo "$(date +%T) ilhas=8 concluído" >&2
