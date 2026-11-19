#!/bin/bash
# Rodada 3a (Fase 3): varredura das variantes de mutação compartilhada (5 sementes, 5M evals,
# ilhas=8 — modo da página — e clássico em media + grande) medindo ger/s, Mav/s e convergência.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
INSTS="$INST_DIR/media.json $INST_DIR/grande.json"
OUT="$DIR/r3-varredura.csv"

VARS="i1+m1,i1+m1+unidas,i1+m1+unidas+ativas,i1+m1+unidas+retry,i1+m1+unidas+kempe:0.02,i1+m1+unidas+kempe:0.10,i1+m1+unidas+kempe:0.25,i1+m1+unidas+kempe:0.50,i1+m1+unidas+kempe:0.25+kbloco"

"$B" $INSTS --sementes 5 --orcamento 5 --ilhas 8 --variantes "$VARS" --csv --cabecalho > "$OUT"
echo "$(date +%T) varredura ilhas=8 concluída" >&2
"$B" $INSTS --sementes 5 --orcamento 5 --ilhas 0 --variantes "i1+m1,i1+m1+unidas,i1+m1+unidas+kempe:0.02,i1+m1+unidas+kempe:0.25,i1+m1+unidas+kempe:0.50" --csv >> "$OUT"
echo "$(date +%T) varredura ilhas=0 concluída" >&2
