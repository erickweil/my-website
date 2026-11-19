#!/bin/bash
# Rodada 3b (Portão da Fase 3): confirmação em 10 sementes, 10M avaliações, 3 instâncias,
# clássico (ilhas=0) e ilhas=8, comparável diretamente com r0-base.csv.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
INSTS="$INST_DIR/faculdade-anonimizado.json $INST_DIR/media.json $INST_DIR/grande.json"
OUT="$DIR/r3-portao.csv"

VARS="i1+m1+unidas+kempe:0.02,i1+m1+unidas+kempe:0.25+retry"

"$B" $INSTS --sementes 10 --orcamento 10 --ilhas 0 --variantes "$VARS" --csv --cabecalho > "$OUT"
echo "$(date +%T) portão ilhas=0 concluído" >&2
"$B" $INSTS --sementes 10 --orcamento 10 --ilhas 8 --variantes "$VARS" --csv >> "$OUT"
echo "$(date +%T) portão ilhas=8 concluído" >&2
