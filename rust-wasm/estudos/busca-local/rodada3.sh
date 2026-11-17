#!/bin/bash
# Rodada 2: lista curta que cresce ao estacionar (H1) e p_bloco (H2). Para ao ficar válido.
B=$(dirname "$0")/../../target/release/examples/grade_busca_local
OUT=$(dirname "$0")/r3.csv
: > $OUT; CAB=--cabecalho
run() {
    nome=$1; shift
    $B $CAB --nome "$nome" --instancias media,grande,real-tecnico-v3-blocos --sementes 4 --segundos 12 --parar-no-valido "$@" >> $OUT; CAB=
    $B --nome "$nome" --instancias real-tecnico-v4-dias --sementes 8 --segundos 12 --parar-no-valido "$@" >> $OUT
    echo "$(date +%T) $nome" >&2
}
run l1000_rec --lista 1000 --recomecar
run l1000_rec_sm30 --lista 1000 --recomecar --listas-sem-melhora 30
run l1000_rec_sm300 --lista 1000 --recomecar --listas-sem-melhora 300
run l2500_rec --lista 2500 --recomecar
run l5000_rec --recomecar
run l1000_rec_x2 --lista 1000 --recomecar --crescer 2 --lista-max 32000
run l10000 --lista 10000
run l40000 --lista 40000
echo fim >&2
