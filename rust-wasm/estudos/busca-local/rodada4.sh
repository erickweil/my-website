#!/bin/bash
# Rodada 4: confirmação com sementes novas (101+), mais sementes na v4.
B=$(dirname "$0")/../../target/release/examples/grade_busca_local
OUT=$(dirname "$0")/r4.csv
: > $OUT; CAB=--cabecalho
run() {
    nome=$1; shift
    $B $CAB --nome "$nome" --instancias media,grande,real-tecnico-v3-blocos --primeira-semente 101 --sementes 8 --segundos 16 --parar-no-valido "$@" >> $OUT; CAB=
    $B --nome "$nome" --instancias real-tecnico-v4-dias --primeira-semente 101 --sementes 12 --segundos 16 --parar-no-valido "$@" >> $OUT
    echo "$(date +%T) $nome" >&2
}
run base
run l1000 --lista 1000
run l20000 --lista 20000
run l1000_rec_x2 --lista 1000 --recomecar --crescer 2 --lista-max 32000
echo fim >&2
