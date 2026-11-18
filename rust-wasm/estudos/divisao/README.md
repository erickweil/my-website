# Estudo: agrupamento antigo x regras de divisão diretas — 17/11/2026

Comparação que levou a trocar o agrupamento antigo (`agrupar` + `dividir`, medido em aulas a
mover) pelas regras de divisão em pedaços no estilo do XHSTT (`src/horario/horario_divisao.rs`).
As duas medidas aceitam exatamente os mesmos quadros; só o "relevo" do custo muda.

Rodado com um modo experimental que já saiu do código (as opções `--agrupar-direto`, `--espalhar`
e `--peso-agrupar` dos exemplos não existem mais). Ficam os CSVs, no formato do
`grade_busca_local`, e o resumo: `python3 analise.py r1.csv`.

| Arquivo | O quê |
| :--- | :--- |
| `r1.csv` | busca local, uma cadeia, sementes 101–108: atual, direto, direto + um pedaço por dia obrigatório |
| `r3.csv` | técnico v4, sementes 201–212: atual x direto |
| `r4.csv` | técnico v4, sementes 101–108 e 201–212: atual com peso 40 x direto com peso 10 |

## Resultados

- **Velocidade igual ou melhor:** 5,1 contra 5,05 M mov/s na média; 2,37 contra 2,16 no técnico v4.
  O genético fez 10 M de avaliações no técnico v4 no mesmo tempo nos dois modos.
- **Convergência da busca local**, tempo até um horário válido (mediana):

| Instância | Atual | Direto |
| :--- | ---: | ---: |
| média | 0,26 s, 8/8 | 0,27 s, 8/8 |
| grande | 0,77 s, 8/8 | 0,74 s, 8/8 |
| técnico v3 | 1,74 s, 8/8 | 1,16 s, 8/8 |
| técnico v4 (16 s) | 5/20 | 18/20 |

- **A causa do ganho no v4 é o peso:** no direto, um bloco de 2 partido vale 2 unidades (dois pedaços
  abaixo do mínimo); no antigo, 1 (uma aula a mover). O antigo com o dobro do peso chegou a 17/20;
  o direto com metade do peso, a 11/20.
- **"Um pedaço por dia" como regra obrigatória** deixou o técnico v4 sem horário válido (0/8) e a
  instância grande mais lenta: por isso virou regra de qualidade (`espalhar`).
- **Genético** (mesmo orçamento de avaliações): média 2/4 resolvidas no direto contra 0/4; no técnico
  v4, nenhum dos dois resolve em 10 M de avaliações.
