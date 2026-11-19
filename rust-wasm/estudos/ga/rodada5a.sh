#!/bin/bash
# Rodada 5a: curva de tamanho de população por instância (faculdade=60, media=250, grande=625 aulas)
# com o novo padrão (p_ipx=0.25, p_kempe=0.1, retry=4, unidas, componentes), em clássico e 8 ilhas.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
INSTS="$INST_DIR/faculdade-anonimizado.json $INST_DIR/media.json $INST_DIR/grande.json"
OUT="$DIR/r5a-populacao.csv"

VARS_0="padrao+pop:32,padrao+pop:64,padrao+pop:128,padrao+pop:256,padrao+pop:512,padrao+pop:1024,padrao+pop:2048"
VARS_8="padrao+pop:16,padrao+pop:32,padrao+pop:64,padrao+pop:128,padrao+pop:256,padrao+pop:512,padrao+pop:1024,padrao+pop:64+torn:4,padrao+pop:128+torn:4"

"$B" $INSTS --sementes 5 --orcamento 5 --ilhas 0 --variantes "$VARS_0" --csv --cabecalho > "$OUT"
echo "$(date +%T) população ilhas=0 concluído" >&2
"$B" $INSTS --sementes 5 --orcamento 5 --ilhas 8 --variantes "$VARS_8" --csv >> "$OUT"
echo "$(date +%T) população ilhas=8 concluído" >&2
