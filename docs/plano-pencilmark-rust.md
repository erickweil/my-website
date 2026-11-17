# Plano — Migrar o solver Pencilmark de TS para Rust

> **Situação em 17/11/2026: concluído, arquivado.** O Pencilmark roda em Rust
> (`rust-wasm/src/pencilmark/`, `horario_pencilmark.rs`), com busca exaustiva dividida entre as
> threads desde o início, prova de impossibilidade e validação por célula (`validar`). O solver em TS
> e o adaptador do formato antigo foram removidos. As caixas abaixo não foram mantidas; o
> documento fica como registro do plano. Pendente do §2.2: as possibilidades continuam globais
> (`n_possibs = disciplinas.len()`), não locais por turma.

> Objetivo: o gerador de horário passa a rodar **inteiro em Rust/WASM** (Pencilmark + GA + validação),
> com um único worker e uma única implementação das regras do lado do Rust. O TS fica só com
> formulário, renderização e orquestração dos workers.

---

## 1. Situação atual

```
page.tsx
  └─ raceWorkers (nWorkers = 1)
       ├─ horario-solver-task.worker.ts  (TS)
       │     ├─ pencilmark  → lib/pencilmark.ts + horario-pencilmark.ts + lib/bitFlag.ts
       │     └─ genetic v1  → lib/genetic/ga.ts + horario-genetic.ts
       └─ horario-genetic-wasm.worker.ts (Rust GA)
                └─ valida com obterRegrasVioladas()  ← depende do Pencilmark em TS
```

| Peça | Onde | Observação |
| :--- | :--- | :--- |
| Motor genérico (busca célula de menor entropia + backtracking) | `src/lib/pencilmark.ts` (326 l.) | **Também usado pelo Sudoku Minado** |
| Bitset de possibilidades | `src/lib/bitFlag.ts` (150 l.) | `BitFlag32` / `BitFlagArray` |
| Regras de horário para o Pencilmark | `horario-pencilmark.ts` (220 l.) | `verificaQuadro` + `verificaCelula` + `podeDisciplina` |
| Validador por célula | `obterRegrasVioladas` em `horario-solver.ts` | Usado pelos **dois** workers, inclusive o WASM |
| Modelo | `horario-regras.ts` ↔ `horario_regras.rs` | Já equivalentes; **mesmo índice linear** de quadro |

Consequência: mesmo escolhendo o GA em Rust, o worker WASM ainda instancia o Pencilmark em TS só
para validar. Enquanto o Pencilmark e o validador não estiverem em Rust, não dá para remover nada
do lado TS.

### O que já facilita a migração

- `RegrasHorario` (Rust) já tem turmas, disciplinas, professores, `n_tempos`, unidas e agrupar/dividir.
- `to_quadro_index` é **idêntico** ao TS (`turma*7*n + dia*n + tempo`), então um quadro produzido em
  Rust pode ir direto para `construirQuadro()` sem conversão.
- Já existe infraestrutura nativa: `cargo test`, `bench_horario`, instâncias com solução de referência
  e o quadro real (`real.json`, fora do git).

---

## 2. Decisões de desenho

### 2.1 Motor genérico como *trait* — o Sudoku pode vir depois

```rust
pub trait RegrasPencilmark {
    /// Recalcula o estado derivado do quadro (contagem de aulas, ocupação de professores…).
    /// false = o quadro parcial já é inválido (poda).
    fn preparar(&mut self, quadro: &[i32]) -> bool;

    /// Preenche `possib` com os valores permitidos em `index`. false = inválido.
    fn possibilidades(&self, quadro: &[i32], index: usize, possib: &mut Possib) -> bool;
}

pub struct PencilmarkSolver<R: RegrasPencilmark> { /* ... */ }
```

É o mesmo contrato do `regrasFn(quadro, possibs | null)` do TS, só que separado em dois métodos. O
Sudoku Minado **não** entra neste plano: ele continua usando `lib/pencilmark.ts`. Mas o motor fica
pronto para portá-lo depois sem reescrita.

### 2.2 Possibilidades **locais por turma**, não globais

Hoje `nPossibs = disciplinas.length` (todas as turmas), e `verificaCelula` percorre **todas** as
disciplinas para descartar as de outra turma. No quadro real são 20, na instância grande 225.

Em Rust, cada célula só considera as disciplinas **da própria turma**:

```rust
disciplinas_por_turma: Vec<Vec<usize>>   // pré-calculado
type Possib = u64;                        // bit i = i-ésima disciplina da turma
```

- O bitset cabe num `u64`: hoje são ~7–9 disciplinas por turma. Um `assert!` na construção recusa
  turmas com mais de 64 disciplinas, o que fica bem longe de um caso real.
- O custo por célula cai de O(disciplinas totais) para O(disciplinas da turma). Na instância grande
  isso é ~25× menos trabalho, sem mudar nenhuma regra.
- Não é preciso portar o `bitFlag.ts`: `count_ones()`, `&`, `|` e `trailing_zeros()` substituem a
  classe inteira.

### 2.3 Busca **iterativa e retomável**, com a mesma API do GA

O `_solucionarQuadro` em TS é recursivo e chama `progressCallback` lá de dentro. Uma chamada WASM é
síncrona, então em Rust a recursão vira uma **pilha explícita** de decisões:

```rust
struct Decisao { index: usize, possib: Possib, offset: u32, proximo: u32 }

pub enum Status { EmAndamento, Resolvido, Impossivel }

impl PencilmarkSolver<_> {
    pub fn run(&mut self, max_iter: usize) -> Status;   // avança até max_iter nós e devolve
}
```

Vantagens:
- **Mesma interface do `HorarioGAProblemRunner`** (`run(n)` + `get_info()`). O worker roda
  `run(5000)`, posta o progresso e repete, sem precisar de callback JS → Rust.
- Sem risco de estouro de pilha no WASM em quadros grandes. A profundidade é o número de células
  livres: 60 no real e 625 na grande.
- Fica fácil de testar e medir no `bench_horario`.

### 2.4 Reinícios e aleatoriedade

- Manter o esquema atual de **reinício com orçamento dobrando** (`baseIter`: 2^10, 2^11…) e o modo
  sem reinício (`baseIter = null`).
- `Math.random()` vira `fastrand` **com semente**. Isso dá benchmarks reprodutíveis e permite reativar
  o `raceWorkers` com N workers e sementes diferentes. Hoje `nWorkers = 1`, então os reinícios nunca
  são usados na prática.
- Manter o `melhor` (quadro parcial mais preenchido) para a UI mostrar algo mesmo quando o quadro é
  impossível.

### 2.5 Validador em Rust, com código de violação

`obterRegrasVioladas` é portado como função Rust que devolve, por célula, um **código** de violação
(enum), não uma string:

```rust
#[repr(u8)] pub enum Violacao { Nenhuma, Vazio, ProfessorIndisponivel, ChoqueProfessor,
                                 UnidaSeparada, BlocoInvalido, ... }
```

O TS mapeia o código para texto. Hoje ele diz só "Marcação não deveria estar aqui" ou "Algo de
errado não está certo"; com o código, a UI pode dizer **qual** regra foi violada. Esse é um ganho de
experiência de uso que vem de graça com a migração.

---

## 3. Fases

Cada fase termina com `cargo test` passando e o site funcionando.

### Fase 0 — Linha de base do Pencilmark em TS
- [ ] Script `npx tsx` que roda o `PencilmarkSolver` TS nas instâncias de `rust-wasm/tests/instancias/`
      (pequena, média, grande, inviável, real) e grava tempo, iterações e se resolveu.
- [ ] Mesmo script exporta **vetores de teste**: quadros parciais aleatórios + as possibilidades que o
      TS calcula para cada célula + as violações de `obterRegrasVioladas`. Isso vira o oráculo da
      Fase 3.

### Fase 1 — Motor genérico
- [ ] `rust-wasm/src/pencilmark/mod.rs`: trait `RegrasPencilmark`, `Possib = u64`, solver iterativo
      com pilha, `run(max_iter) -> Status`, `melhor`, reinícios e semente.
- [ ] Testes com uma regra de brinquedo (ex.: N-rainhas ou latin square 4×4): acha solução, detecta
      impossível e o resultado é o mesmo com e sem reinícios.

### Fase 2 — Regras de horário
- [ ] `rust-wasm/src/horario/horario_pencilmark.rs`: `impl RegrasPencilmark` com o port de
      `verificaQuadro` (contagem de aulas, ocupação de professor, consistência de blocos fechados) e de
      `podeDisciplina` (turma, contagem, professor livre, agrupar/dividir, unidas direta e reversa).
- [ ] Estado derivado (`cont_aulas`, `prof_livre`) separado de `RegrasHorario`, como já é feito com
      `HorarioGAState`.

### Fase 3 — Equivalência com o TS
- [ ] Teste que lê os vetores da Fase 0 e compara, célula por célula, as possibilidades Rust × TS.
      **Divergência zero** é critério de aceite.
- [ ] Teste cruzado entre as duas implementações Rust: toda solução completa do Pencilmark precisa ter
      **fitness 0 no GA**. Se não tiver, uma das duas regras está errada.
- [ ] Toda instância viável (`*.solucao.json`) é resolvida. A `inviavel.json` termina em `Impossivel`.

### Fase 4 — Validador
- [ ] `horario/validacao.rs`: violações por célula com `enum Violacao`.
- [ ] Teste de equivalência com `obterRegrasVioladas` usando os vetores da Fase 0.

### Fase 5 — Benchmark
- [ ] `bench_horario --solver pencilmark|ga`, reutilizando instâncias, CSV e resumo.
- [ ] Comparar com a linha de base TS da Fase 0. O alvo é ser mais rápido em todas as instâncias e
      resolver o `real.json`.

### Fase 6 — Integração WASM e worker único
- [ ] `HorarioPencilmarkRunner` (`#[wasm_bindgen]`): `new(formulario, base_iter, seed)`, `run(n)`,
      `get_info() → { iter, depth, status, melhor, solucao }` e `validar(quadro) → Uint8Array`.
- [ ] Um único `horario-wasm.worker.ts` com `solverType: "pencilmark" | "genetic"`, que substitui os
      dois workers atuais.
- [ ] `raceWorkers` com `n = navigator.hardwareConcurrency` e sementes diferentes para o Pencilmark
      com reinícios (o worker 0 continua sem reinício, como hoje).
- [ ] UI: texto da violação a partir do código.

### Fase 7 — Limpeza do TS
Remover, depois que a Fase 6 estiver em produção:
- `horario-pencilmark.ts`, `horario-solver.ts`, `horario-solver-task.worker.ts`,
  `horario-genetic-wasm.worker.ts`
- `horario-genetic.ts` e a opção "Genético v1 (TS)" da UI (ver §5)
- De `horario-regras.ts`, as classes `RegrasHorario`/`Turma`/`Professor`/`Disciplina`. Ficam só os
  **tipos** do formulário, `TODOS_OS_DIAS` e `construirQuadro`.
- Ficam: `lib/pencilmark.ts` e `lib/bitFlag.ts` (Sudoku Minado) e `lib/genetic/` (página `/toy/genetic`).

---

## 4. Riscos

| Risco | Mitigação |
| :--- | :--- |
| Port com diferença sutil de regra (ex.: borda de bloco, unida reversa) | Vetores de teste TS → Rust (Fase 3), com divergência zero |
| Bug na conversão de recursão para pilha (backtrack restaura célula errada) | Teste de invariante: depois de `Impossivel`, o quadro volta exatamente ao inicial |
| Pencilmark e GA em Rust divergirem entre si | Teste cruzado: solução do Pencilmark ⇒ fitness 0 no GA |
| `obterMelhorPossib` varre o quadro inteiro a cada nó (O(células × disciplinas)) | Já melhora com as possibilidades locais (§2.2). Cache incremental só se o benchmark mostrar necessidade |
| Copiar `melhor` para o JS a cada progresso | Enviar só quando melhorar, como o worker do GA já faz |
| Quadro impossível travar a UI | `run(n)` em blocos + `abort()` do `raceWorkers`, que já existe |

---

## 5. Perguntas em aberto

1. **Remover o "Genético v1 (TS)" da UI?** Ele é a mesma lógica do v2, só que mais lenta. Remover
   simplifica a Fase 7.
2. **Portar o Sudoku Minado** para o mesmo motor Rust, num trabalho separado depois?
3. **Pencilmark como fase construtiva do GA/busca local** (plano em `plano-solver-local-search.md`,
   §8)? Com os dois em Rust isso vira passar um `Vec<i32>` internamente, sem atravessar a fronteira
   JS. Fica fora deste plano, mas a arquitetura deixa pronto.
