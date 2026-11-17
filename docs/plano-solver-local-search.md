# Plano de implementação — Solver de horários por busca local (Rust/WASM)

> **Situação em 17/11/2026: implementado em parte, e já é o método padrão da página.** O código está
> em `rust-wasm/src/horario/horario_busca_local.rs` e `HorarioBuscaLocalRunner` (`horario_runners.rs`).
> As caixas do §10 estão atualizadas. O que mudou em relação ao plano:
>
> - **Custo:** é o próprio fitness do genético com o sinal trocado (`fitness_rapido`), em `f64`, e
>   inclui as regras de qualidade (evitar, jornada, descanso, intervalo, janela). Não há
>   `custo.rs`/`PesosRestricoes` separados; os testes conferem movimento a movimento que o custo
>   incremental é igual ao fitness do zero.
> - **Avaliação em duas etapas:** primeiro as obrigatórias (recusa cedo a maioria dos movimentos),
>   depois a qualidade.
> - **Vizinhanças:** troca de duas aulas da turma e troca de um grupo de aulas seguidas da mesma
>   disciplina (bloco) com outro trecho; numa aula em conjunto a troca se repete nas turmas
>   parceiras. `SwapColuna` e `KempeChain` ficaram para depois.
> - **Aceitação:** só LAHC, sem trait e sem SA. A lista só baixa (`L[k] ← min(L[k], custo)`); a
>   versão do artigo (`L[k] ← custo`) foi medida e é pior: ver `AtualizacaoDaLista`.
> - **Em vez de ILS:** quando o melhor não melhora por 100 listas, a cadeia volta ao melhor quadro
>   com uma folga crescente (violações obrigatórias ou uma fração do custo de qualidade).
> - **Cadeias:** várias buscas independentes, uma por thread (metade dos núcleos, até 8).
> - **Ponto de partida:** um quadro sorteado com os blocos montados (`genes_com_blocos`), não o
>   Pencilmark.
> - **Sem limite de tempo:** roda até custo 0 ou até o usuário interromper.
>
> O resto deste documento é o plano original (cita arquivos TS e o formato de entrada antigos, que
> já não existem).

> Substituir o algoritmo genético por busca local com **avaliação incremental de custo**,
> mantendo o modelo de restrições existente. Alvo: `rust-wasm/src/horario/`.

---

## 1. Motivação

O solver genético atual tem duas características que limitam a escala:

| Problema | Onde | Efeito |
| :--- | :--- | :--- |
| `population_size = size × 4` | `horario-genetic-wasm.worker.ts:46` | custo por geração é **O(size²)**; dobrar turmas → 4× por geração |
| `fitness()` varre o quadro inteiro | `horario_genetic.rs:100-197` | cada avaliação é O(size × profs), mesmo quando o movimento tocou 2 slots |
| Sem busca local | — | GA puro perde para hill-climbing/SA na literatura de timetabling |

Um movimento (swap de dois slots) altera o custo em **O(profs + turmas + nTempos)** — independente do
tamanho do quadro. É daí que vem o ganho: de ~10³ para ~10⁶ movimentos avaliados por segundo.

### Por que busca local e não outra coisa

- **SA + ILS** venceu a ITC-2011 (solver GOAL, UFOP).
- **LAHC** (Late Acceptance Hill-Climbing), do mesmo grupo, *superou* os métodos vencedores nas
  mesmas instâncias — com **um único parâmetro** (comprimento da lista) em vez de temperatura
  inicial + taxa de resfriamento + reheat.
- Métodos exatos (CP-SAT, IP, MaxSAT) dão resultados melhores em qualidade absoluta, mas são
  *all-or-nothing*: não produzem solução intermediária para renderizar na UI, e o custo de
  integração em WASM é alto. Ver `docs/` histórico da discussão.

**Decisão:** o critério de aceitação é um *trait* plugável. Default **LAHC**; **SA** implementado
lado a lado para comparação empírica. O resto do algoritmo (vizinhanças, avaliador incremental) é
compartilhado — a escolha do critério não deve custar reescrita.

---

## 2. O que se aproveita do código atual

Aproveita, sem alteração:

- `RegrasHorario` (`horario_regras.rs`) — modelo, parsing do formulário, indexação linearizada.
- `QuadroHorario = Vec<i32>` — mesma representação de solução.
- `random.rs` — RNG.
- O worker e a UI (`horario-genetic-wasm.worker.ts`, `page.tsx`) — a interface `run(n)` +
  `get_info()` é mantida, então a troca é quase transparente.
- `obterRegrasVioladas` (TS) — **mantido de propósito** como validador independente. Ter uma
  segunda implementação das regras, escrita separadamente, é a melhor defesa contra um avaliador
  incremental com bug.

Não aproveita: `genetic/ga.rs`, `crossover_ipx.rs`, `mutation_operators.rs` — continuam existindo
para o TSP/OneMax e para o GA de horários, que fica no código como *baseline* de comparação.

---

## 3. Modelo de custo

### 3.1 Mudança de convenção

O GA usa **fitness negativo, maximizar** (`0.0` = perfeito). Busca local trabalha melhor com
**custo positivo, minimizar**. A conversão é `custo = -fitness`, e `custo == 0` é solução perfeita.

### 3.2 Separar restrições que hoje estão fundidas

O código atual funde "professor indisponível" e "professor em duas turmas" numa única matriz
decrementada (`prof_matriz`), penalizando ambas com o mesmo peso 50. São restrições diferentes e o
usuário vai querer pesá-las diferente. Separar:

```rust
disp[p][d][t] ∈ {0,1}   // disponibilidade declarada, imutável
uso[p][d][t]  ∈ ℕ       // nº de aulas atribuídas ao professor p em (d,t)  ← estado incremental
```

| Restrição | Custo |
| :--- | :--- |
| Professor indisponível | `uso > 0 && disp == 0` → `W_INDISP × uso` |
| Professor em 2+ turmas | `max(0, uso - 1) × W_CHOQUE` |
| Disciplina unida separada | `W_UNIDA` por parceiro fora do lugar |
| Bloco fora do tamanho | `W_BLOCO × abs(run - ideal)` |
| Slot que devia estar vazio / vazio que devia ter aula | `W_ESTRUTURA` (hard, peso alto) |

Pesos em uma struct `PesosRestricoes` exposta ao JS via `wasm_bindgen`, com os valores atuais
(1000 / 50 / 30 / 20) como default. Isso abre caminho para hard/soft configurável na UI depois.

### 3.3 Invariantes mantidas por construção

Não entram no custo porque nenhuma vizinhança pode quebrá-las:

- número de aulas por disciplina — todo movimento é **permutação dentro da turma**;
- disciplina na turma correta — idem;
- slots inativos (`-1`) — nunca são origem nem destino de movimento.

Isso é uma vantagem herdada do design atual e deve ser preservada deliberadamente.

---

## 4. Avaliador incremental

### 4.1 Estrutura

```rust
pub struct Avaliador<'a> {
    regras: &'a RegrasHorario,
    pesos: PesosRestricoes,

    // estado derivado do quadro, mantido em sincronia
    uso: Vec<u16>,              // [prof][dia][tempo] linearizado
    custo_total: i64,           // custo inteiro — evita drift de f64

    // decomposição do custo, para depuração e para exibir na UI
    custo_prof: i64,
    custo_unidas: i64,
    custo_blocos: i64,
    custo_estrutura: i64,
}
```

**Custo em `i64`, não `f64`.** O GA atual compara `f64` com `+ f64::EPSILON`
(`ga.rs:157`) justamente por causa de drift. Com pesos inteiros o problema desaparece e a
comparação `custo < melhor` fica exata — importante porque o avaliador incremental soma e subtrai
milhões de vezes.

### 4.2 Padrão remove → aplica → soma

Não deduzir fórmula fechada de delta. Para cada movimento:

1. subtrair do `custo_total` a contribuição das **regiões afetadas**;
2. aplicar a mudança no quadro e no `uso`;
3. somar de volta a contribuição das mesmas regiões.

Muito menos propenso a erro, e o custo continua O(região).

### 4.3 Regiões afetadas por um swap de `(turma, d1, t1)` ↔ `(turma, d2, t2)`

| Componente | Região a recomputar | Custo |
| :--- | :--- | :--- |
| Professor | células `(p, d1, t1)` e `(p, d2, t2)` para os profs das 2 disciplinas | O(profs) |
| Unidas | as 2 **colunas** `(d1,t1)` e `(d2,t2)` em todas as turmas | O(T × U) |
| Blocos | as **linhas** `(turma, d1)` e `(turma, d2)`, para as 2 disciplinas | O(nTempos) |
| Estrutura | os 2 slots | O(1) |

Total: **O(profs + T·U + nTempos)** — sem dependência de `size`. Para 10 turmas / 6 tempos isso é
~algumas dezenas de operações, contra ~5 mil da avaliação completa.

### 4.4 Rede de segurança obrigatória

```rust
#[cfg(debug_assertions)]
debug_assert_eq!(self.custo_total, self.recalcular_do_zero(),
    "avaliador incremental divergiu após {:?}", movimento);
```

Um delta com bug produz um solver que "converge" para lixo silenciosamente. Esse assert, rodando em
todos os testes, é o item mais importante do plano inteiro. Custa nada em release.

---

## 5. Vizinhanças

Todas preservam o multiset por turma.

| Nome | Descrição | Ataca |
| :--- | :--- | :--- |
| **SwapSlot** | troca 2 slots ativos da mesma turma | genérico (já existe em `horario_genetic.rs:234`) |
| **SwapBloco** | troca 2 blocos de `G` slots consecutivos, alinhados | `agrupar` — o SwapSlot destrói blocos toda hora |
| **SwapColuna** | troca dois tempos `(d1,t1) ↔ (d2,t2)` **em todas as turmas ao mesmo tempo** | choque de professor em massa |
| **KempeChain** | dado o par de colunas `(d1,t1)`/`(d2,t2)`, monta o grafo de conflito de professores entre turmas e troca só uma componente conexa | choque de professor **sem** criar novos |

`SwapColuna` e `KempeChain` preservam a invariante porque cada turma troca **os seus próprios** dois
slots — o multiset de cada turma é o mesmo, só muda a posição.

`KempeChain` é a vizinhança que a literatura aponta como decisiva: em vez de quebrar uma restrição
para consertar outra (e pagar o custo), ela propaga a troca pela cadeia de conflitos.

**Seleção:** roleta com probabilidades configuráveis. Ponto de partida, adaptado das proporções do
solver GOAL (que usava ES 40% / EM 38% / EBS 20% / KC 2% sem atribuição de recurso):

```
SwapSlot 45% | SwapBloco 25% | SwapColuna 20% | KempeChain 10%
```

Calibrar depois com o harness da Fase 0. `SwapBloco` só entra no sorteio se existir alguma
disciplina com `agrupar > 0`; `KempeChain` só se houver mais de uma turma.

---

## 6. Critério de aceitação

Trait pequeno, para trocar sem tocar no resto:

```rust
pub trait CriterioAceitacao {
    fn aceita(&mut self, custo_atual: i64, custo_candidato: i64, iter: u64) -> bool;
    fn reiniciar(&mut self, custo: i64);
}
```

### 6.1 LAHC (default)

Uma lista circular `L` de tamanho `lh`, inicializada com o custo inicial. Aceita se o candidato for
melhor que o custo de `lh` iterações atrás **ou** melhor que o atual:

```
aceita  ⟺  custo_cand ≤ L[iter mod lh]  ou  custo_cand ≤ custo_atual
L[iter mod lh] ← custo_atual        (após decidir)
```

Parâmetro único: `lh`. Trade-off conhecido — maior `lh` = melhor qualidade, mais tempo. Começar em
`lh = 5_000` e varrer `{1e3, 5e3, 2e4, 1e5}` no harness.

### 6.2 SA (comparação)

Aceita piora com probabilidade `exp(-Δ/T)`, resfriamento geométrico `T ← α·T`. Temperatura inicial
**calibrada automaticamente**, não chutada: amostrar N movimentos aleatórios, medir a piora média
`Δ̄`, e definir `T₀ = -Δ̄ / ln(p₀)` com `p₀ ≈ 0.5`. Reheat ao estagnar. Isso é o que torna o SA
utilizável sem tuning manual por instância — sem isso ele fica pior que o LAHC por motivo errado.

---

## 7. ILS — perturbação

Busca local sozinha estagna. Envolver num laço ILS:

```
s ← solução inicial (Pencilmark, ou aleatória)
melhor ← s
repetir:
    s ← busca_local(s, criterio, orçamento_de_iteracoes)
    se custo(s) < custo(melhor): melhor ← s
    senão se estagnado: s ← perturbar(melhor, forca)
```

**Perturbação (ruin & recreate):** escolher um dia inteiro de 1–3 turmas e re-embaralhar seus slots
ativos aleatoriamente. Preserva o multiset e é bem mais direcionado que reiniciar tudo — que é o que
o GA faz hoje (`ga.rs:187`) e que joga fora todo o progresso.

Força adaptativa: começa em 1 dia, cresce a cada estagnação, volta a 1 quando melhora. É o análogo
do `mutation_multiplier` atual (`ga.rs:169`), que é uma boa ideia mal aproveitada.

---

## 8. Solução inicial

Hoje o GA parte de `random_genes()`. O Pencilmark já produz uma solução **viável ou quase**, e é
muito melhor ponto de partida.

Ordem de preferência:
1. Pencilmark com orçamento curto de iterações (ele já suporta: `maxIter` / `baseIter`);
2. se estourar o orçamento, usar `melhor` parcial e completar aleatoriamente;
3. fallback: `random_genes()` atual.

Isso muda o papel do Pencilmark de **concorrente** (hoje disputa no `raceWorkers`) para
**fase construtiva** — a arquitetura de duas fases padrão na literatura.

> Nota: o Pencilmark é TS e o solver novo é Rust. Na primeira versão, passar o quadro inicial do JS
> para o WASM como `Vec<i32>` no construtor. Portar o Pencilmark para Rust é trabalho separado e
> não bloqueia nada.

---

## 9. Arquivos

```
rust-wasm/src/horario/
├── mod.rs                    (+ exports)
├── horario_regras.rs         (inalterado)
├── horario_genetic.rs        (inalterado — baseline de comparação)
├── custo.rs                  NOVO  PesosRestricoes, custo_total_do_zero()
├── avaliador.rs              NOVO  Avaliador incremental (uso[], delta)
├── vizinhancas.rs            NOVO  Movimento + 4 vizinhanças + sorteio
├── aceitacao.rs              NOVO  trait + LAHC + SA
└── local_search.rs           NOVO  laço principal + ILS + runner WASM
```

Runner exposto espelhando a API atual, para o worker quase não mudar:

```rust
#[wasm_bindgen]
pub struct HorarioLocalSearchRunner { /* ... */ }

#[wasm_bindgen]
impl HorarioLocalSearchRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(formulario: JsValue, config: LSConfig, quadro_inicial: Option<Vec<i32>>) -> Self;
    pub fn run(&mut self, iteracoes: usize);   // igual ao GA
    pub fn get_info(&self) -> JsValue;         // { iter, custo, melhor_custo, melhor_quadro, custo_por_regra, estagnado_por }
    pub fn free(self);
}
```

---

## 10. Fases de implementação

Cada fase deve terminar com o projeto compilando e os testes passando.

### Fase 0 — Harness de benchmark *(fazer primeiro)*

Sem isso não há como afirmar que melhorou.

- [x] 3–4 instâncias fixas em JSON (`rust-wasm/tests/instancias/`): pequena (3 turmas),
      média (10 turmas), grande (25 turmas), e uma **comprovadamente inviável**.
- [x] Binário/teste que roda um solver por N segundos com semente fixa e emite
      `(tempo, custo, iterações)` em CSV.
- [x] Rodar com o GA atual → é a linha de base contra a qual tudo será comparado.

### Fase 1 — Custo unificado

- [ ] ~~`custo.rs`: `PesosRestricoes`~~ (não feito: o custo é o fitness do GA) + `custo_total_do_zero(regras, quadro) -> DecomposicaoCusto`.
- [x] Teste: `custo_total_do_zero == -fitness_do_GA` (com os pesos default e as duas restrições de
      professor somadas) — garante que o modelo novo é o mesmo modelo.

### Fase 2 — Avaliador incremental

- [x] `avaliador.rs` com `uso[]` e o padrão remove→aplica→soma.
- [x] `aplicar(movimento)` / `desfazer(movimento)`.
- [x] **Teste de propriedade** (`wasm-bindgen-test`): 10 mil movimentos aleatórios, comparando
      `custo_total` incremental com `custo_total_do_zero()` a cada passo.
- [ ] `debug_assert` permanente conforme §4.4. (no lugar: os testes conferem o custo a cada movimento)

### Fase 3 — Vizinhanças

- [ ] `SwapSlot`, `SwapBloco` ✔; `SwapColuna`, `KempeChain` pendentes.
- [ ] **Teste de invariante** para cada uma: após qualquer sequência de movimentos, o multiset de
      cada turma é idêntico ao inicial e nenhum slot `-1` foi tocado.
- [ ] Sorteio por roleta com pesos configuráveis. (hoje: bloco com probabilidade 0,5 quando a aula é agrupada)

### Fase 4 — Busca local

- [ ] `aceitacao.rs`: trait + LAHC + SA (só LAHC, sem trait) com calibração automática de `T₀`.
- [x] `local_search.rs`: laço principal, rastreio de melhor solução, contagem de estagnação.
- [ ] Comparar LAHC vs SA vs GA no harness. (LAHC × GA feito: a busca local resolve média, grande e o técnico real; SA não implementado) **Decidir com dado, não com preferência.**

### Fase 5 — ILS

- [ ] Perturbação ruin & recreate com força adaptativa.
- [x] Critério de estagnação e reinício a partir da melhor solução (volta ao melhor com folga).

### Fase 6 — Integração

- [x] `HorarioLocalSearchRunner` + `wasm_bindgen` (`HorarioBuscaLocalRunner`).
- [x] Worker: novo `solverType: "local-search"` em `horario-solver.ts` e no seletor da UI
      (`page.tsx:803`), mantendo GA e Pencilmark como opções.
- [x] Progresso *anytime*: reportar a melhor solução a cada bloco de iterações — a UI já sabe
      renderizar isso (`postMessage` com `solucao`/`violacoes`).
- [ ] Solução inicial vinda do Pencilmark. (parte de `genes_com_blocos`)
- [x] Validar com `obterRegrasVioladas` (TS) (hoje: o validador do Pencilmark em Rust, `validar`): custo 0 no Rust **tem** que dar zero violações no TS.

### Fase 7 — Ajuste fino

- [ ] Calibrar `lh` (lista 5000 medida; probabilidades e perturbação não), probabilidades das vizinhanças e força da perturbação no harness.
- [ ] Iterar só os dias ativos em vez de `QUANTOS_DIAS = 7` (~29% de trabalho desperdiçado numa
      escola de 5 dias).
- [x] Reativar `raceWorkers` (feito como cadeias em threads, dentro do mesmo worker) com `nWorkers > 1` (`page.tsx:54`) e sementes distintas — execuções
      independentes de LAHC são paralelizáveis de graça, sem `SharedArrayBuffer`.

---

## 11. Critérios de aceite

| Métrica | Alvo |
| :--- | :--- |
| Movimentos avaliados/s (instância média) | ≥ 100× a taxa de avaliações do GA |
| Custo após 10 s (instância média) | estritamente melhor que o GA no mesmo tempo |
| Instância grande (25 turmas) | encontra solução viável; hoje o GA não converge |
| Instância inviável | reporta a melhor solução parcial sem travar a UI |
| Divergência do avaliador incremental | **zero** nos testes de propriedade |
| Discordância Rust ↔ validador TS | **zero** |

---

## 12. Riscos

| Risco | Mitigação |
| :--- | :--- |
| Delta incremental com bug silencioso | `debug_assert` + teste de propriedade da Fase 2 — inegociável |
| Vizinhança quebrando o multiset | teste de invariante da Fase 3 |
| Pesos mal calibrados fazendo o solver otimizar a coisa errada | decomposição do custo por regra exposta no `get_info()` e visível na UI |
| `KempeChain` com componente conexa gigante (vira "trocar tudo") | limitar tamanho da componente; se exceder, descartar o movimento |
| LAHC estagnar com `lh` alto demais em instância pequena | `lh` proporcional ao `size`, com piso e teto |
| Escopo crescer para "portar o Pencilmark para Rust" | fora do escopo; o quadro inicial atravessa a fronteira JS→WASM como `Vec<i32>` |

---

## 13. O que este plano *não* faz

- Não remove a triplicação das regras (`horario-pencilmark.ts`, `horario-genetic.ts`,
  `horario_genetic.rs`). A Fase 1 concentra o custo em Rust num só lugar, o que é o primeiro passo,
  mas o Pencilmark em TS continua com a sua própria cópia. Trabalho separado.
- Não adiciona restrições novas (**Spread Events**, janelas de professor). O `custo.rs` é desenhado
  para receber isso depois sem reescrita, mas incluir agora misturaria duas mudanças.
- Não toca em CP-SAT/MaxSAT. Decisão anterior: errado para o caminho crítico da UI.

---

## Referências

- [GOAL solver: a hybrid local search based solver for high school timetabling](https://link.springer.com/article/10.1007/s10479-014-1685-4) — vencedor da ITC-2011, SA+ILS, proporções das vizinhanças
- [Late acceptance hill-climbing for high school timetabling](https://link.springer.com/article/10.1007/s10951-015-0458-5) — LAHC superando os vencedores da ITC-2011
- [A Late Acceptance Strategy in Hill-Climbing for Exam Timetabling (Burke & Bykov)](https://patatconference.org/patat2008/proceedings/Bykov-HC2a.pdf) — formulação original do LAHC
- [Modeling high school timetabling with bitvectors](https://pmc.ncbi.nlm.nih.gov/articles/PMC5411413/) — avaliação incremental e ganho de iterações/s sobre a KHE
- [Educational Timetabling: Problems, Benchmarks, and State-of-the-Art Results](https://arxiv.org/pdf/2201.07525) — panorama e estado da arte
- [A simulated annealing with a new neighborhood structure for high school timetabling](https://www.sciencedirect.com/science/article/abs/pii/S0377221709006055)
- [The Third International Timetabling Competition](https://link.springer.com/article/10.1007/s10479-013-1340-5)
