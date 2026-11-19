# Estudo da unificação e melhoria do algoritmo genético — 19/11/2026

> Mac mini M1 (8 núcleos: 4P + 4E), binário nativo `--release` com `RUSTFLAGS="-C target-cpu=native"`.
> Programa: `rust-wasm/examples/bench_operadores_horario.rs`; scripts, CSVs e análise em
> `rust-wasm/estudos/ga/` (`python3 analise.py <arquivo.csv>`).

**Resumo.** Unificamos tabelas, pesos, primitivas de avaliação e operadores de movimento entre a
busca local e o algoritmo genético (`horario_tabelas.rs`, `horario_movimentos.rs`,
`horario_avaliacao.rs`) e calibramos o GA em cinco rodadas sobre `faculdade-anonimizado` (1M
avaliações), `media` (5M–10M) e `grande` (10M). O GA passou de **4/10 (1,76 s)** para **10/10
(0,45 s)** em `media` e de **0/10 (med `-440`)** para **2/10 (med `-40`)** em `grande`.

---

## 1. Arquitetura unificada (Fases 1 e 2)

Antes da refatoração, a busca local (`horario_busca_local.rs`) e o GA (`horario_genetic.rs`)
duplicavam tabelas estruturais, pesos, regras obrigatórias e operadores de troca. Agora:

- **`horario_tabelas.rs`**: `PesosFitness`, `Unidades`, `TabelasHorario` (leve para copiar por
  thread/ilha, incluindo componentes conexos transitivos de turmas com aula em conjunto) e as
  primitivas atômicas (`delta_recurso`, `unidas_da_celula`, `fixa_fora`, `registrar_pedaco`).
- **`horario_movimentos.rs`**: `ConfigMovimentos`, `RascunhoMovimentos` e `sortear_movimento`
  (troca simples, troca de bloco, propagação em aulas conjuntas e cadeias de Kempe).
- **`horario_avaliacao.rs`**: avaliação completa em lote (`avaliar_quadro` / `fitness_do_quadro`,
  usada pelo GA) e avaliação incremental (`AvaliacaoIncremental`, usada pela busca local) no mesmo
  módulo, construídas sobre as mesmas primitivas e conferidas por um oráculo independente
  (Pencilmark) e casos calculados à mão.

Verificação contra a linha de base (Rodada 0): **0 diferenças** bit a bit em 30/30 execuções de
busca local (1 e 4 cadeias) e 18/18 do GA, com ganho colateral de vazão de **+8% a +36%** na busca
local e **+11% a +20%** no GA.

---

## 2. Rodadas de experimento do GA

| Rodada | Foco | CSVs em `rust-wasm/estudos/ga/` | Decisão |
| :--- | :--- | :--- | :--- |
| 0 | Linha de base (GA e busca local) | `r0-base.csv`, `r0-busca-local.csv` | Referência |
| 3 / 3b | Movimentos compartilhados na mutação (`unidas`, `kempe`, `kbloco`, `ativas`, `retry`) | `r3-varredura.csv`, `r3-portao.csv` | `p_bloco=0.5`, `propagar_unidas=true`, `p_kempe=0.1`, `kempe_de_blocos=false`, `tentativas_mutacao=4`, `taxa_em_ativas=false` |
| 4 | Crossover (por componentes conexos × turma, `p_ipx`, `crossover_rate`) | `r4-crossover.csv` | `crossover_por_componentes=true`, `p_ipx=0.25`, `crossover_rate=0.9` |
| 5a / 5b | População, torneio e estagnação | `r5a-populacao.csv`, `r5b-pop-baixa-sem-stag.csv`, `r5b-grande-10m.csv` | População pequena (`16`/ilha, `64` clássico), `tournament_size=3`, `max_stagnation=None` |
| 5c / 5d | Diversidade, época e migração | `r5c-epoca-div.csv`, `r5d-ilhas-epoca-mig.csv` | `diversity_check=true`, `epoca=200`, `migracao=1` (absoluto, sem migrar elite) |
| 5e | Número de ilhas além dos núcleos (8, 16, 32, 64) | `r5e-num-ilhas.csv` | **1 ilha por núcleo** (mais ilhas aumenta `Mav/s` até +19%, mas corta gerações pela metade a cada dobra e piora a convergência) |

---

## 3. Comparação final (10 sementes, 8 ilhas)

| Instância | Variante | Válidas | Aval.→vál (med) | Tempo→vál (med) | Fit med | ger/s | Mav/s |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `faculdade-anonimizado` (1M) | Antes (`i1+m1`, 8 ilhas) | 10/10 | 1.920 | 0,01 s | 0,0 | — | 0,77 |
| `faculdade-anonimizado` (1M) | **Padrão atual (8 × 16)** | **10/10** | 55.040 | **0,01 s** | **0,0** | 40.980 | 5,25 |
| `media` (5M–10M) | Antes (`i1+m1`, 8 ilhas) | 4/10 | 3.464.000 | 1,76 s | -40,0 | — | 2,09 |
| `media` (5M) | **Padrão atual (8 × 16)** | **10/10** | **1.104.128** | **0,45 s** | **0,0** | 18.926 | 2,42 |
| `grande` (10M) | Antes (`i1+m1`, 8 ilhas) | 0/10 | — | — | -440,0 | — | 0,90 |
| `grande` (10M) | **Padrão atual (8 × 16)** | **2/10** | **8.467.328** | **8,45 s** | **-40,0** | 7.822 | 1,00 |

### Escala de número de ilhas com `pop = 16` (`r5e-num-ilhas.csv`, 10 sementes)

| Ilhas | `media` (5M) | `grande` (10M) | `grande` ger/s | `grande` Mav/s |
| ---: | :--- | :--- | ---: | ---: |
| **8 (1/núcleo)** | **10/10 (0,45 s, med 0,0)** | **2/10 (med -40)** | **7.822** | 1,00 |
| 16 | 9/10 (0,86 s, med 0,0) | 0/10 (med -120) | 4.333 | 1,11 |
| 32 | 5/10 (1,22 s, med -20) | 0/10 (med -280) | 2.266 | 1,16 |
| 64 | 4/10 (1,54 s, med -40) | 0/10 (med -510) | 1.166 | 1,19 |

---

## 4. Decisões refletidas no código e na página

- **Padrões do GA:** 1 ilha por núcleo de processamento (`navigator.hardwareConcurrency`, mínimo 2),
  `16` indivíduos por ilha (`64` sem ilhas), `1` migrante por época de `200` gerações (limitado a
  `population_size - 1`, sem migrar a elite), reinício por estagnação desativado (`0` / `None`).
- **Configuração na interface (`TelaConfiguracao.tsx`):** permite ativar/desativar ilhas e ajustar
  número de ilhas (`0 = 1 por núcleo`), população por ilha, migração entre ilhas e reinício por
  estagnação (`0 = desativado`).
- **Método padrão da página:** continua sendo a busca local (LAHC), que resolve `media` e `grande`
  em 10/10 sementes abaixo de 1 s (`docs/estudo-busca-local.md`).
