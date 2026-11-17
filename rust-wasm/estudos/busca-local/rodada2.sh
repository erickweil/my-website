#!/bin/bash
# Rodada 2: lista curta que cresce ao estacionar (H1) e p_bloco (H2). Para ao ficar válido.
B=$(dirname "$0")/../../target/release/examples/grade_busca_local
OUT=$(dirname "$0")/r2.csv
: > $OUT; CAB=--cabecalho
run() {
    nome=$1; shift
    $B $CAB --nome "$nome" --instancias media,grande,real-tecnico-v3-blocos --sementes 4 --segundos 12 --parar-no-valido "$@" >> $OUT; CAB=
    $B --nome "$nome" --instancias real-tecnico-v4-dias --sementes 8 --segundos 12 --parar-no-valido "$@" >> $OUT
    echo "$(date +%T) $nome" >&2
}
run base
run l1000 --lista 1000
run l20000 --lista 20000
run l20000_pb.25 --lista 20000 --p-bloco 0.25
run l1000_x2 --lista 1000 --crescer 2 --lista-max 32000
run l1000_x2_sm25 --lista 1000 --crescer 2 --lista-max 32000 --listas-sem-melhora 25
run l1000_x2_sm10 --lista 1000 --crescer 2 --lista-max 32000 --listas-sem-melhora 10
run l1000_x4 --lista 1000 --crescer 4 --lista-max 64000
run l2500_x2 --lista 2500 --crescer 2 --lista-max 32000
run l1000_x2_pb.25 --lista 1000 --crescer 2 --lista-max 32000 --p-bloco 0.25
echo fim >&2
