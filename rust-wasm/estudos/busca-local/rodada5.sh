#!/bin/bash
# Rodada 5: troca de colunas e cadeia de Kempe (mesmas sementes e orçamento da rodada 4).
B=$(dirname "$0")/../../target/release/examples/grade_busca_local
OUT=$(dirname "$0")/r5.csv
: > $OUT; CAB=--cabecalho
run() {
    nome=$1; shift
    $B $CAB --nome "$nome" --instancias media,grande,real-tecnico-v3-blocos --primeira-semente 101 --sementes 8 --segundos 16 --parar-no-valido "$@" >> $OUT; CAB=
    $B --nome "$nome" --instancias real-tecnico-v4-dias --primeira-semente 101 --sementes 12 --segundos 16 --parar-no-valido "$@" >> $OUT
    echo "$(date +%T) $nome" >&2
}
run coluna.02 --p-coluna 0.02
run coluna.1 --p-coluna 0.1
run kempe.02 --p-kempe 0.02
run kempe.1 --p-kempe 0.1
run kempe.3 --p-kempe 0.3
run coluna.05_kempe.1 --p-coluna 0.05 --p-kempe 0.1
echo fim >&2
