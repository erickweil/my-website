#!/bin/bash
# Rodada 6: cadeia de Kempe de blocos (mesmas sementes e orçamento das rodadas 4 e 5).
B=$(dirname "$0")/../../target/release/examples/grade_busca_local
OUT=$(dirname "$0")/r6.csv
: > $OUT; CAB=--cabecalho
run() {
    nome=$1; shift
    $B $CAB --nome "$nome" --instancias media,grande,real-tecnico-v3-blocos --primeira-semente 101 --sementes 8 --segundos 16 --parar-no-valido "$@" >> $OUT; CAB=
    $B --nome "$nome" --instancias real-tecnico-v4-dias --primeira-semente 101 --sementes 12 --segundos 16 --parar-no-valido "$@" >> $OUT
    echo "$(date +%T) $nome" >&2
}
run kblocos.05 --p-kempe 0.05 --kempe-de-blocos
run kblocos.2 --p-kempe 0.2 --kempe-de-blocos
run kblocos.4 --p-kempe 0.4 --kempe-de-blocos
echo fim >&2
