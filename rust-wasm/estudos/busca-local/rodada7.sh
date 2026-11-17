#!/bin/bash
# Rodada 7: várias cadeias em paralelo (pool do rayon = número de cadeias, como na página).
# Kempe 0,02 já é o padrão. Mesmas sementes e orçamento das rodadas 4 a 6.
B=$(dirname "$0")/../../target/release/examples/grade_busca_local
OUT=$(dirname "$0")/r7.csv
: > $OUT; CAB=--cabecalho
run() {
    nome=$1; cadeias=$2; shift 2
    RAYON_NUM_THREADS=$cadeias $B $CAB --nome "$nome" --cadeias $cadeias --instancias media,grande,real-tecnico-v3-blocos --primeira-semente 101 --sementes 8 --segundos 16 --parar-no-valido "$@" >> $OUT; CAB=
    RAYON_NUM_THREADS=$cadeias $B --nome "$nome" --cadeias $cadeias --instancias real-tecnico-v4-dias --primeira-semente 101 --sementes 12 --segundos 16 --parar-no-valido "$@" >> $OUT
    echo "$(date +%T) $nome" >&2
}
run c1 1
run c2_atual 2
run c4_atual 4
run c4_espalhado 4 --fatores 1:0.2:4:0.5
run c4_iguais 4 --fatores 1:1:1:1
run c4_curtos 4 --fatores 0.2:0.2:0.2:0.2
run c2_opostos 2 --fatores 0.2:4
echo fim >&2
