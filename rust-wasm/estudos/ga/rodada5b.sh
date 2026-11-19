#!/bin/bash
# Rodada 5b: ponta baixa de população (4..32 por ilha, ilhas=8) x torneio (2, 3, 4, 6, 10)
# COM max_stagnation DESATIVADO (stag:0), para isolar o efeito puro de pop e torneio.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
B="$DIR/../../target/release/examples/bench_operadores_horario"
INST_DIR="$DIR/../../tests/instancias"
INSTS="$INST_DIR/media.json $INST_DIR/grande.json"
OUT="$DIR/r5b-pop-baixa-sem-stag.csv"
OUT10="$DIR/r5b-grande-10m.csv"

VARS="padrao+stag:0+pop:4+torn:2,padrao+stag:0+pop:4+torn:3,padrao+stag:0+pop:8+torn:2,padrao+stag:0+pop:8+torn:3,padrao+stag:0+pop:8+torn:4,padrao+stag:0+pop:8+torn:6,padrao+stag:0+pop:12+torn:3,padrao+stag:0+pop:16+torn:2,padrao+stag:0+pop:16+torn:3,padrao+stag:0+pop:16+torn:4,padrao+stag:0+pop:16+torn:6,padrao+stag:0+pop:16+torn:10,padrao+stag:0+pop:24+torn:3,padrao+stag:0+pop:32+torn:3,padrao+stag:0+pop:32+torn:10"

"$B" $INSTS --sementes 5 --orcamento 5 --ilhas 8 --variantes "$VARS" --csv --cabecalho > "$OUT"
echo "$(date +%T) varredura 5M sem stag concluída" >&2

# Teste em 10M avaliações em grande com os pontos mais promissores (também sem stag)
VARS10="padrao+stag:0+pop:8+torn:2,padrao+stag:0+pop:8+torn:3,padrao+stag:0+pop:16+torn:2,padrao+stag:0+pop:16+torn:3,padrao+stag:0+pop:16+torn:4"
"$B" "$INST_DIR/grande.json" --sementes 5 --orcamento 10 --ilhas 8 --variantes "$VARS10" --csv --cabecalho > "$OUT10"
echo "$(date +%T) grande 10M sem stag concluído" >&2
