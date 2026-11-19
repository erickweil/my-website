#!/bin/bash
# Rodada 5e: mais ilhas além dos núcleos (8, 16, 32, 64 ilhas) com pop=16/ilha,
# epoca=200, migracao=1 (absoluto), migrar_elite=false — 10 sementes, 3 instâncias.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
OUT="$DIR/r5e-num-ilhas.csv"

primeiro=1
for ilhas in 8 16 32 64; do
    cab=""
    if [ "$primeiro" = "1" ]; then
        cab="--cabecalho"
        primeiro=0
        "$B" "$INST_DIR/faculdade-anonimizado.json" --sementes 10 --orcamento 1 --ilhas "$ilhas" --variantes padrao --csv $cab > "$OUT"
    else
        "$B" "$INST_DIR/faculdade-anonimizado.json" --sementes 10 --orcamento 1 --ilhas "$ilhas" --variantes padrao --csv >> "$OUT"
    fi
    "$B" "$INST_DIR/media.json" --sementes 10 --orcamento 5 --ilhas "$ilhas" --variantes padrao --csv >> "$OUT"
    "$B" "$INST_DIR/grande.json" --sementes 10 --orcamento 10 --ilhas "$ilhas" --variantes padrao --csv >> "$OUT"
    echo "$(date +%T) ilhas=$ilhas concluído" >&2
done
