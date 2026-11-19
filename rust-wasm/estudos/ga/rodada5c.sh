#!/bin/bash
# Rodada 5c: épocas diferentes (100, 500, 2000, 5000, 20000) x diversity_check (off/on)
# sobre pop=8, torn=3 (e controle em pop=16, torn=3), ilhas=8, stag:0, 5 sementes.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
OUT="$DIR/r5c-epoca-div.csv"

VARS="padrao+stag:0+pop:8+torn:3+epoca:100,padrao+stag:0+pop:8+torn:3+epoca:500,padrao+stag:0+pop:8+torn:3+epoca:2000,padrao+stag:0+pop:8+torn:3+epoca:5000,padrao+stag:0+pop:8+torn:3+epoca:20000,padrao+stag:0+pop:8+torn:3+epoca:100+div,padrao+stag:0+pop:8+torn:3+epoca:500+div,padrao+stag:0+pop:8+torn:3+epoca:2000+div,padrao+stag:0+pop:8+torn:3+epoca:5000+div,padrao+stag:0+pop:8+torn:3+epoca:20000+div,padrao+stag:0+pop:16+torn:3+epoca:500+div,padrao+stag:0+pop:16+torn:3+epoca:2000+div"

"$B" "$INST_DIR/media.json" --sementes 5 --orcamento 5 --ilhas 8 --variantes "$VARS" --csv --cabecalho > "$OUT"
echo "$(date +%T) media 5M concluído" >&2
"$B" "$INST_DIR/grande.json" --sementes 5 --orcamento 10 --ilhas 8 --variantes "$VARS" --csv >> "$OUT"
echo "$(date +%T) grande 10M concluído" >&2
