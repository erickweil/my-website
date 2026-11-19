#!/bin/bash
# Rodada 4 (Fase 4): taxa de crossover (0%, 25%, 50%, 75%, 90%) com e sem IPX (componentes conexos),
# usando o padrão da Fase 3 (i1+m1+unidas+kempe:0.1+retry), 1M avaliações, 10 sementes, 3 instâncias.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
INSTS="$INST_DIR/faculdade-anonimizado.json $INST_DIR/media.json $INST_DIR/grande.json"
OUT="$DIR/r4-crossover.csv"

VARS="padrao+cxr:0.0,padrao+cx:comp_ipx+cxr:0.25,padrao+cx:comp_ipx+cxr:0.50,padrao+cx:comp_ipx+cxr:0.75,padrao+cx:comp_ipx+cxr:0.90,padrao+cx:comp+cxr:0.25,padrao+cx:comp+cxr:0.50,padrao+cx:comp+cxr:0.75,padrao+cx:comp+cxr:0.90"

"$B" $INSTS --sementes 10 --orcamento 1 --ilhas 0 --variantes "$VARS" --csv --cabecalho > "$OUT"
echo "$(date +%T) crossover ilhas=0 concluído" >&2
"$B" $INSTS --sementes 10 --orcamento 1 --ilhas 8 --variantes "$VARS" --csv >> "$OUT"
echo "$(date +%T) crossover ilhas=8 concluído" >&2
