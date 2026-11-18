# Estudo dos parâmetros da busca local — 17/11/2026

> Execução do `plano-benchmark-busca-local.md`. Rust nativo `--release`, uma cadeia, uma execução
> por vez (sem processos em paralelo), cerca de 1h25 de CPU em quatro rodadas. Programa:
> `rust-wasm/examples/grade_busca_local.rs`; scripts, CSVs e análise em
> `rust-wasm/estudos/busca-local/` (`python3 analise.py r4.csv`).

**Resumo.** O único parâmetro que importa é o comprimento da lista do late acceptance. Ele troca
velocidade por constância: o número de movimentos até um horário válido cresce em proporção à
lista, e lista curta é rápida mas às vezes demora muito. Na instância difícil (v4), nenhuma
configuração de uma cadeia passou de ~50% de sucesso em 16 s, e as vantagens que apareceram com 8
sementes não se repetiram com sementes novas. O que funciona é combinar cadeias com listas
diferentes: elas falham em sementes diferentes, e quatro juntas resolveriam 11 de 12. Os
mecanismos de folga e de volta ao melhor quadro não fazem diferença mensurável.

---

## 1. Rodadas

| Rodada | Pergunta | Sementes | Orçamento | Duração |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Cada parâmetro sozinho importa? (23 variantes) | 1–4 | 8 s | 29 min |
| 2 | H1: lista curta que cresce; H2: `p_bloco` 0,25 | 1–4 (v4: 1–8) | 12 s, para ao ficar válido | 21 min |
| 3 | H3: recomeçar de um quadro novo; listas 10000 e 40000 | iguais à 2 | iguais à 2 | 16 min |
| 4 | Confirmação com sementes novas | 101–108 (v4: 101–112) | 16 s, para ao ficar válido | 17 min |

Instâncias: `media` (10 turmas) e `grande` (25), sintéticas e sem regras de qualidade;
`real-tecnico-v3-blocos` e `real-tecnico-v4-dias` (19 turmas, 614 aulas cada). A v4 é a única em
que o padrão não chega sempre a válido.

## 2. Rodada 1 — um parâmetro por vez

Mediana do tempo até válido (s) e, na v4, quantas de 4 sementes chegaram lá em 8 s:

| Variante | média | grande | v3 | v4 |
| :--- | ---: | ---: | ---: | ---: |
| padrão (lista 5000) | 0,28 | 0,80 | 1,63 | 0/4 |
| lista 1000 | **0,08** | **0,46** | **0,34** | 1/4 |
| lista 20000 | 0,94 | 2,42 | 6,06 | **4/4** |
| `p_bloco` 0 | 0,24 | 2,14 | 1,63 (31 obs.) | 0/4 |
| `p_bloco` 0,25 / 0,75 / 1 | ≈ padrão | ≈ padrão | ≈ padrão | 3/4, 1/4, 1/4 |
| lista clássica | 1,37 | não chega | 2,39 | 1/4 |
| `listas_sem_melhora`, `folgas`, `folga_de_qualidade`, `sair_dos_validos` | = padrão | = padrão | = padrão | 0–1/4 |
| partida aleatória | idêntico ao padrão (`random_genes` já monta os blocos) | | | |

Fase de qualidade (v3): todas as variantes chegam a custo 0,0078 = 21 observações em ~2 s e
ficam nele até o fim. Nenhum parâmetro mudou isso, exceto `p_bloco` 0 (pior, 31).

## 3. Hipóteses e o que os números disseram

**H1 — começar com lista curta e dobrá-la a cada vez que estaciona pega o melhor dos dois.**
Refutada. Nas fáceis fica tão rápida quanto a lista 1000; na v4, 1 de 8 (a lista 20000 tinha dado
6 de 8 nas mesmas sementes). Crescer a lista depois de estacionar volta ao mesmo poço (custo 40 =
2 violações): o que a lista longa traz é uma descida lenta desde o início, não tolerância tardia.

**H2 — `p_bloco` 0,25 é melhor que 0,5.** Refutada: empate nas fáceis, igual ou pior na v4
combinado com outras listas. Fica 0,5; só 0 é claramente ruim (sem mover blocos inteiros, os
blocos se desfazem).

**H3 — recomeçar de um quadro novo ao estacionar sem horário válido.** Mista. Na v4, de 3 para
até 5 de 8. Nas fáceis é perigosa: com lista 1000 e o limite padrão (100 listas sem melhora), a
grande deixa de chegar a válido, porque a tentativa é cortada no platô do fim da descida. Só é
segura com um limite bem maior que a descida inteira.

**H4 (formulada na rodada 3) — movimentos até válido ≈ k × lista.** Confirmada. A partir de lista
2500, a razão fica quase constante em cada instância:

| Instância | 2500 | 5000 | 10000 | 20000 | 40000 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| média | 300 | 295 | 267 | 253 | 254 |
| grande | 1050* | 950 | 733 | 739 | 652 |
| v3 | 687 | 666 | 633 | 634 | 638 |

(movimentos até válido ÷ lista; *uma semente não chegou.) Como a busca é determinística por
semente, essa conta não tem ruído de tempo. Consequência: com uma cadeia, dobrar a lista dobra o
tempo até válido nas instâncias fáceis.

## 4. Confirmação com sementes novas (rodada 4)

| Variante | média | grande | v3 | v4 (16 s) |
| :--- | ---: | ---: | ---: | ---: |
| padrão (5000) | 0,25 | 0,94 | 1,45 | 6/12 |
| lista 1000 | **0,08** | 1,90 (7/8) | **0,30** | 7/12 |
| lista 20000 | 0,95 | 2,25 | 6,00 | 6/12 |
| lista 1000, recomeça, dobra até 32000 | **0,08** | 3,68 | 0,36 | 6/12 |

Tempo até válido por semente na grande, que mostra a diferença de variância:

| Variante | sementes 101–108 (s) |
| :--- | :--- |
| lista 1000 | 12,9 · 0,30 · 2,86 · 0,94 · 0,56 · 4,96 · — · 0,26 |
| padrão | 1,19 · 0,81 · 1,06 · 1,17 · 0,69 · 5,95 · 0,73 · 0,80 |
| lista 20000 | 2,17 · 2,19 · 2,32 · 2,43 · 3,49 · 2,07 · 2,30 · 2,03 |

O que se confirmou e o que não:

- **A vantagem da lista 20000 na v4 (6/8 contra 3/8) não se repetiu**: com 12 sementes novas,
  todas as variantes ficaram entre 6 e 7 de 12. Era ruído de amostra pequena.
- **Lista curta é rápida e instável; lista longa é lenta e constante.** Na grande, a lista 1000 vai
  de 0,26 s a mais de 16 s; a 20000 fica sempre entre 2,0 e 3,5 s.
- **As falhas são de sementes diferentes em cada variante.** Tomando, em cada semente, o melhor
  tempo entre variantes (como se fossem cadeias em paralelo):

| Cadeias combinadas | v4: chegam a válido | mediana |
| :--- | ---: | ---: |
| uma (qualquer) | 6–7/12 | — |
| 5000 + 1000 | 9/12 | 2,7 s |
| 1000 + 20000 | 11/12 | 6,4 s |
| 5000 + 1000 + 20000 + recomeço | 11/12 | 2,8 s |

  É uma estimativa (as variantes da mesma semente partem do mesmo quadro inicial), mas aponta na
  direção certa.

## 5. Teorias

1. **A lista é o botão de velocidade × constância.** Movimentos até válido ≈ k × lista, com k
   próprio da instância (≈ 250 a 700 aqui). Lista curta: rápida na mediana, cauda longa. Lista
   longa: lenta e previsível.
2. **Nas instâncias difíceis, o sucesso de uma cadeia é questão de semente**, perto de 50% em
   16 s na v4, qualquer que seja a configuração testada. Mais cadeias independentes rendem mais
   que ajustar uma.
3. **Diversidade de listas entre as cadeias** junta as duas vantagens: a curta resolve depressa
   quando acerta, a longa garante as outras.
4. **Folga e volta ao melhor quadro não ajudam** na fase das obrigatórias nem na de qualidade
   (efeito abaixo do ruído em todas as instâncias). Recomeçar do zero só ajuda com limite longo.
5. **A fase de qualidade da v3 tem um piso de 21 observações** que nenhuma configuração passou, e
   que chega em ~2 s. Provavelmente estrutural (a regra do intervalo vale para qualquer disciplina,
   ver `situacao-gerador-horario.md` §4).

## 6. Recomendações

- **Não mudar o padrão de uma cadeia** (lista 5000): é o meio-termo, e nenhuma alternativa ganhou
  em todas as instâncias com sementes novas.
- **Espalhar mais as listas das cadeias na página.** Eram `FATORES_DA_LISTA = [1, 0,5, 2, 1]`
  (5000, 2500, 10000, 5000). Feito depois de medir com várias cadeias de verdade: ver §8, que
  levou a `[1, 0,5, 0,2, 4]`.
- **Simplificar:** os parâmetros de folga (`listas_sem_melhora`, `folgas`, `folga_de_qualidade`,
  `sair_dos_validos`) podem ficar fixos; o crescimento da lista e o recomeço ficam no código como
  opções desligadas, para estudos futuros.
- **Para a v4 e parecidas:** investigar o poço de 2 violações (quais aulas, quais regras) e
  vizinhanças que o atravessem (`KempeChain`, troca de coluna), em vez de mais ajuste de
  parâmetros.

---

## 7. Troca de colunas e cadeia de Kempe (rodadas 5 e 6)

Implementadas como opções de `ParametrosBusca`, desligadas por padrão:

- **Troca de colunas** (`p_coluna`): os mesmos dois horários trocados em todas as turmas que têm
  aula nos dois.
- **Cadeia de Kempe** (`p_kempe`): dois horários trocados numa turma e, em cadeia, nas turmas
  cujas aulas passariam a disputar professor ou ambiente com as que se moveram (e nas parceiras das
  aulas em conjunto).
- **Kempe de blocos** (`kempe_de_blocos`): quando a aula sorteada está num grupo de aulas seguidas
  de disciplina agrupada, a cadeia troca a janela inteira (k horários) em vez de um só.

Os testes conferem, movimento a movimento, que o custo incremental continua igual ao fitness e que
cada turma continua com as mesmas aulas. Mesmas sementes (101+) e orçamento da rodada 4:

| Variante | média | grande | v3 | v4 (16 s) |
| :--- | ---: | ---: | ---: | ---: |
| padrão | 0,25 | 0,94 | 1,45 | 6/12 |
| colunas 0,02 | 0,31 | 1,16 (7/8) | 1,73 | 7/12 |
| colunas 0,1 | 0,50 | 3,24 (7/8) | 2,44 | 7/12 |
| Kempe 0,02 | 0,26 | **0,78** | 1,73 | 5/12 |
| Kempe 0,1 | 0,31 | 1,05 | 1,70 | 5/12 |
| Kempe 0,3 | 0,38 | 1,35 | 2,35 | 5/12 |
| colunas 0,05 + Kempe 0,1 | 0,40 | 1,57 | 2,33 | 5/12 |
| Kempe de blocos 0,05 | 0,31 | 0,85 | 1,84 | 3/12 |
| Kempe de blocos 0,2 | 0,36 | 1,41 | 2,28 | 7/12 |
| Kempe de blocos 0,4 | 0,45 | 1,95 | 3,13 | 6/12 |

**O poço da v4.** Nas sementes que não chegam a válido, sobram sempre blocos partidos de Língua
Portuguesa e História nas turmas 1º A e 1º B INFO, que dividem a mesma sala (BS2) e a professora
de História. Consertar um bloco pede mover duas aulas seguidas nas duas turmas ao mesmo tempo, o
que motivou o Kempe de blocos. Ele tirou do poço duas de quatro sementes presas no teste isolado,
mas na grade não mudou a taxa de sucesso.

**Conclusões:**

1. **Nenhuma das vizinhanças muda a taxa de sucesso na v4.** Ela continua perto de 50% em 16 s
   numa cadeia, e cada variante falha em sementes diferentes, como na rodada 4.
2. **As vizinhanças entre turmas reduzem os movimentos até válido** na grande (de 5,7 M para
   3,2 a 4,0 M), mas cada movimento custa mais. No tempo, só o Kempe 0,02 ficou à frente do
   padrão (0,78 s contra 0,94 s, sem a cauda de 5,95 s de uma semente). Na média e na v3 todas
   ficam mais lentas.
3. **Troca de colunas não compensa:** cara (varre todas as turmas) e sem ganho em nenhuma
   instância.
4. **Recomendação:** manter as três desligadas. O Kempe 0,02 é o único candidato, por cortar a
   cauda na grande; vale reavaliá-lo junto com o teste de várias cadeias, que continua sendo a
   aposta para a v4.

---

## 8. Várias cadeias em threads (rodadas 7 e 8)

Desde a rodada 7, o padrão já tem Kempe 0,02 e a troca de colunas saiu do código. As cadeias rodam
em paralelo como na página: o pool do rayon tem uma thread por cadeia, e elas sincronizam a cada
20 mil movimentos. O tempo é de relógio, numa VM de 4 núcleos.

**Rodada 7** (sementes 101+, 16 s), tempo até válido (mediana) e sucesso na v4:

| Cadeias e listas | média | grande | v3 | v4 |
| :--- | ---: | ---: | ---: | ---: |
| 1 (5000) | 0,25 | 0,76 | 1,69 | 5/12 |
| 2, fatores de então (5000, 2500) | 0,24 | 0,74 | 1,01 | 8/12 |
| 2, opostas (1000, 20000) | 0,12 | 0,54 | 0,49 | 6/12 |
| 4, fatores de então (5000, 2500, 10000, 5000) | 0,25 | 1,00 | 1,06 | 10/12 |
| 4, espalhadas (5000, 1000, 20000, 2500) | 0,15 | 0,61 | 0,53 | **11/12** |
| 4, iguais (5000) | 0,45 | 1,29 | 2,26 | 10/12 |
| 4, curtas (1000) | 0,12 | 0,50 | 0,48 | 6/12 |

**Rodada 8** — confirmação com sementes novas (201+) dos fatores `[1, 0,5, 0,2, 4]` (a mesma lista
espalhada, em outra ordem: com 2 cadeias entram 5000 e 2500, o melhor par da rodada 7):

| Cadeias | média | grande | v3 | v4 |
| :--- | ---: | ---: | ---: | ---: |
| 4, fatores de então | 0,25 | 1,03 | 1,10 | 10/12 (mediana 3,1 s) |
| 4, novos | **0,10** | **0,84** | **0,46** | 10/12 (mediana **2,1 s**) |
| 2, novos (5000, 2500) | 0,23 | 0,90 | 0,89 | 8/12 |

**Conclusões:**

1. **Mais cadeias resolvem a v4:** de 5/12 com uma para 10–11/12 com quatro, confirmando a teoria
   da seção 5 (as falhas são de sementes diferentes).
2. **A variedade das listas é o que mais rende.** Listas iguais desperdiçam as cadeias extras (mais
   lentas que uma só nas fáceis); listas só curtas falham na v4; o conjunto espalhado ganha nas
   duas frentes. Uma lista longa sozinha (20000) só serve se houver cadeias curtas ao lado: com 2
   cadeias, o par 1000 + 20000 perdeu para 5000 + 2500 na v4.
3. **Nesta VM as threads escalam mal:** com 4 cadeias cada uma faz ~2,75 M movimentos/s, contra
   ~5,3 M/s sozinha (a mesma disputa de memória vista na população do genético). Num computador
   comum o ganho das cadeias deve ser maior que o medido aqui.
4. **Aplicado:** `FATORES_DA_LISTA = [1, 0,5, 0,2, 4]`.

## 9. Aulas fixadas (18/11/2026)

A página permite fixar aulas no horário e continuar a busca a partir dele
(`rust-wasm/src/horario/horario_inicial.rs`). Medido no técnico real v4 (19 turmas, 614 aulas), uma
cadeia, 10 sementes, 20 s por semente (`examples/bench_busca_local.rs` e `examples/bench_fixadas.rs`;
saídas em `~/claude/ferramentas-frontend/bench/`).

| Cenário | Válidos | Mediana até válido |
| :--- | :--- | :--- |
| Motor antigo (commit `3193399`), sem fixadas | 9/10 | 2,35 s |
| Motor com fixadas, sem fixadas | 9/10 | 2,30 s |
| 10% fixadas de um quadro com violações (aquecimento de 2 s), resto ao acaso | 3/10 | 8,2 s |
| 10% fixadas de um quadro com violações, continuando do quadro inteiro | 4/10 | 0,95 s |
| 10% fixadas de um horário válido, resto ao acaso (aula a aula) | 3/9 | 5,3 s |
| 10% fixadas de um horário válido, resto montado em blocos, rígidas | 6/9 | 3,0 s |
| Idem, fixadas por peso 20 | 1/9 | 2,3 s |
| Idem, fixadas por peso 100 | 5/9 | 2,0 s |
| **Final** (peso 100, único modo), sem fixadas | 9/10 | 2,41 s (mesmos movimentos do antigo) |
| **Final**, 10% fixadas de um horário válido, resto em blocos | 5/9 | 2,2 s |

- Sem fixadas, o motor faz exatamente os mesmos movimentos que o antigo (mesmas sementes, mesmo
  número de movimentos): as fixadas não custam nada quando não há nenhuma.
- Fixar aulas de um quadro que ainda tem violações (bloco partido, por exemplo) pode tornar o
  problema impossível: a busca fica presa em 2 a 6 violações.
- O que mais pesava era a partida: completar o quadro aula a aula começava de um custo três vezes
  maior. Agora o resto é montado em blocos, como no quadro sorteado (`completar_com_blocos`).
- Mesmo de um horário válido, 10% fixadas deixam o problema mais difícil que o sem fixadas: o resto
  precisa ser compatível com aquelas posições.

**Decisão:** as fixadas são mais uma regra obrigatória, com peso alto (`PesosFitness::fixa = 100`, o
mesmo do horário indisponível), e não uma proibição. A busca local e o genético funcionam do mesmo
jeito com ou sem fixadas, sem nenhum movimento proibido: as fixadas ficam no lugar porque é onde o
custo é menor, e o late acceptance pode tirá-las do lugar no caminho se isso levar a um horário
melhor. Um horário só é válido com todas no lugar; uma que termina fora aparece como problema na
célula dela, e a página guarda as fixações à parte das alocações, então a próxima geração tenta de
novo. Peso 100 e rígidas ficaram no mesmo nível (5/9 contra 6/9, dentro do ruído com 9 sementes);
peso 20 não devolveu as fixadas. O modo rígido foi removido para não haver dois modos de operação.

## 10. Pesos na mão (18/11/2026)

A busca local e o genético usam o mesmo custo, então a tela Configuração passou a mostrar o peso de
cada regra, obrigatória ou de qualidade, como número (antes: só multiplicadores da qualidade,
"Normal", "Alta"...). O usuário tem controle total: nada impede um peso de qualidade maior que um
obrigatório.

- A escala automática da qualidade (a soma de todas as penalidades de qualidade, no pior caso,
  abaixo da menor obrigatória) saiu. Ela valia de 0,0003 (`grande`, técnico v4) a 0,002
  (`faculdade-anonimizado`) por unidade de peso relativo.
- Os padrões da qualidade são os pesos relativos antigos vezes 0,001 (`PesosQualidade::PADRAO`); os
  obrigatórios não mudaram (`PesosFitness::PADRAO`).
- Técnico v4, sem fixadas, 10 sementes, 20 s: **10/10** válidos, mediana 2,23 s (antes 9/10,
  2,41 s), e a mesma qualidade no fim (25 a 27 aulas sozinhas no intervalo, antes 24 a 26).
