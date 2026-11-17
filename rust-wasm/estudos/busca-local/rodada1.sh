#!/bin/bash
# Rodada 1: um parâmetro por vez. Uma execução de cada vez (sem paralelismo).
B=$(dirname "$0")/../../target/release/examples/grade_busca_local
OUT=$(dirname "$0")/r1.csv
COMUM="--instancias media,grande,real-tecnico-v3-blocos,real-tecnico-v4-dias --sementes 4 --segundos 8"
$B --cabecalho --nome base $COMUM > $OUT
run() { nome=$1; shift; $B --nome "$nome" $COMUM "$@" >> $OUT; echo "$(date +%T) $nome" >&2; }
for v in 1000 2500 10000 20000; do run lista=$v --lista $v; done
for v in 0 0.25 0.75 1; do run p_bloco=$v --p-bloco $v; done
for v in 25 50 200 400; do run sem_melhora=$v --listas-sem-melhora $v; done
for v in 1 3 12; do run folgas=$v --folgas $v; done
for v in 0.01 0.02 0.1 0.2; do run folga_q=$v --folga-qualidade $v; done
run sair_validos=0 --sair-dos-validos 0
run classica --classica
run partida=aleatoria --partida aleatoria
echo fim >&2
