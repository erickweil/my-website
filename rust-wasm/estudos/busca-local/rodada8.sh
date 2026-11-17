#!/bin/bash
# Rodada 8: confirmação dos fatores [1, 0.5, 0.2, 4] com sementes novas (201+).
# Kempe 0,02 já é o padrão. Mesmas sementes e orçamento das rodadas 4 a 6.
B=$(dirname "$0")/../../target/release/examples/grade_busca_local
OUT=$(dirname "$0")/r8.csv
: > $OUT; CAB=--cabecalho
run() {
    nome=$1; cadeias=$2; shift 2
    RAYON_NUM_THREADS=$cadeias $B $CAB --nome "$nome" --cadeias $cadeias --instancias media,grande,real-tecnico-v3-blocos --primeira-semente 201 --sementes 8 --segundos 16 --parar-no-valido "$@" >> $OUT; CAB=
    RAYON_NUM_THREADS=$cadeias $B --nome "$nome" --cadeias $cadeias --instancias real-tecnico-v4-dias --primeira-semente 201 --sementes 12 --segundos 16 --parar-no-valido "$@" >> $OUT
    echo "$(date +%T) $nome" >&2
}
run c4_atual 4
run c4_novo 4 --fatores 1:0.5:0.2:4
run c2_novo 2 --fatores 1:0.5:0.2:4
echo fim >&2
