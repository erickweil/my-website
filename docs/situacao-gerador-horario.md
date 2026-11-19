# Situação do gerador de horário — 19/11/2026

> Retrato da branch `experimentos-solver-genetico`. Substitui o retrato de 17/11.

**Resumo:** a busca local (late acceptance com avaliação incremental) continua sendo o método padrão
da página. Agora a busca local e o algoritmo genético compartilham a **única fonte da verdade** para
tabelas, pesos, primitivas de avaliação e operadores de movimento (`horario_tabelas.rs`,
`horario_movimentos.rs`, `horario_avaliacao.rs`). O algoritmo genético recebeu os operadores da
busca local, crossover por componentes conexos e um novo padrão calibrado em ilhas (**1 ilha por
núcleo**, **16 indivíduos/ilha**, **1 migrante/época de 200**, **estagnação desativada**), com
todas essas opções configuráveis na tela de Configuração.

---

## 1. Estado do repositório

- `cargo test --release`: **109 testes** passam; `cargo check --examples` limpo. `cargo clippy` sem
  avisos novos nos módulos de horário e GA (aviso conhecido: `getrandom` não usado no build nativo,
  só no WASM).
- `npm test`: **28 testes** passam. `npx tsc --noEmit` limpo (com `src/pkg` compilado).
- ESLint: limpo em todo `src/app/toy/gerador-horario/` (3 erros pré-existentes fora do gerador).
- WASM multithread (`wasm-bindgen-rayon`) compilado via `npm run build:wasm` (`src/pkg/`, ignorado
  no git).

## 2. O que mudou desde o retrato de 17/11

- **Divisão em pedaços, aulas fixadas, pesos editáveis e versões** (commits `5edd949`–`5610ac9`):
  - Regras de divisão estilo XHSTT (`horario_divisao.rs` e `modelo/divisao.ts`).
  - Edição manual do horário (trocar aulas) e aulas fixadas como regra obrigatória
    (`PesosFitness::fixa = 100`, `horario_inicial.rs`).
  - Busca local e genético partem do horário atual (`pontoDePartida`) preservando aulas fixadas.
  - Pesos de todas as regras (obrigatórias e qualidade) editáveis por projeto em `TelaConfiguracao`.
  - Versões salvas do horário e busca local com cadeias de Kempe (`p_kempe = 0.02`) e fatores de
    lista `[1.0, 0.5, 0.2, 4.0]` (`docs/estudo-busca-local.md`).
- **Unificação GA ↔ Busca local (fonte única da verdade):**
  - `horario_tabelas.rs`: `PesosFitness`, `Unidades`, `TabelasHorario` (leve para copiar por
    thread/ilha, incluindo componentes conexos transitivos de aulas em conjunto) e primitivas
    atômicas de regra.
  - `horario_movimentos.rs`: `ConfigMovimentos`, `RascunhoMovimentos`, `sortear_movimento`
    (troca simples, bloco, propagação em aulas conjuntas e cadeias de Kempe) compartilhados pelos
    dois solvers.
  - `horario_avaliacao.rs`: avaliação em lote (`avaliar_quadro` / `fitness_do_quadro`) e
    incremental (`AvaliacaoIncremental`) lado a lado sobre as mesmas primitivas, validadas contra
    um oráculo independente (Pencilmark) e cálculos à mão.
  - `horario_qualidade.rs`: enxugado para ler índices estruturais de `TabelasHorario` sem duplicar
    vetores.
- **Evolução do algoritmo genético** (ver `docs/estudo-ga.md` e `rust-wasm/estudos/ga/`):
  - Mutação passa a usar `sortear_movimento` com `p_bloco = 0.5`, `propagar_unidas = true`,
    `p_kempe = 0.1` e 4 tentativas (`tentativas_mutacao = 4`).
  - Crossover por componentes conexos de turmas com aula em conjunto + `25%` IPX em turmas
    isoladas.
  - `GAConfig::migracao` virou número absoluto de indivíduos (`usize`, limitado a
    `population_size - 1`, padrão `1`) em época de `200`, sem migrar a elite.
  - Padrões: **1 ilha por núcleo** (mínimo 2 quando ilhas está ligado), **16 indivíduos por ilha**
    (`POPULACAO_POR_ILHA = 16`; `64` no modo clássico), `tournament_size = 3`, `diversity_check = true`,
    `max_stagnation = None` (desativado).
  - Tela de Configuração (`TelaConfiguracao.tsx`) expõe: usar ilhas, número de ilhas (`0 = 1 por
    núcleo`), população por ilha, migração entre ilhas e reinício por estagnação (`0 = desativado`),
    repassados via `EntradaConfig::ga`.

## 3. Medições recentes

Evolução do GA (Mac mini M1, 8 núcleos, nativo `--release -C target-cpu=native`, 10 sementes,
8 ilhas, orçamento de 1M em `faculdade`, 5M em `media`, 10M em `grande`; ver `docs/estudo-ga.md`):

| Instância | GA antes (`i1+m1`, 8 ilhas) | GA padrão atual (8 ilhas × 16) |
| :--- | :--- | :--- |
| `faculdade-anonimizado` | 10/10 válidas (0,01 s) | **10/10 válidas (0,01 s)** |
| `media` (10 turmas) | 4/10 válidas (1,76 s, med `-40`) | **10/10 válidas (0,45 s, med `0,0`)** |
| `grande` (25 turmas) | 0/10 válidas (med `-440`) | **2/10 válidas (8,45 s, med `-40`)** |

Busca local continua sendo mais rápida e consistente em quadros grandes (10/10 em `media` e `grande`
abaixo de 1 s; ver `docs/estudo-busca-local.md`), motivo pelo qual segue como método padrão.

## 4. Problemas e pendências conhecidas

1. **Regra do intervalo vale para qualquer disciplina.** Duas ou três aulas seguidas de uma
   disciplina sem agrupamento que atravessam o intervalo também geram observação. Decidir se a
   regra deve valer só para disciplinas agrupadas.
2. **Professores compartilhados entre projetos.** O solver não vê as aulas do mesmo professor em
   outro projeto (choque e descanso entre cursos). Hoje é preciso tirar esses horários da
   disponibilidade à mão.
3. **Propagação em aulas conjuntas:** a troca de uma aula em conjunto repete a troca nas turmas
   parceiras, mas não propaga para outras aulas deslocadas lá (cadeias de Kempe já cobrem parte
   disso).
4. **Pencilmark:** possibilidades globais, não locais por turma; a prova de impossibilidade só
   termina em casos rasos.
5. **A verificar:** COOP `same-origin` em quase todo o site pode quebrar popups de terceiros.
