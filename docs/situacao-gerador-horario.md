# Situação do gerador de horário — 15/11/2026

> Retrato da branch `atualizar-gerador-horario` (commit `bcb739b`). Números medidos nesta data,
> nativo, 4 núcleos, com uma ou duas execuções curtas por instância: servem de ordem de grandeza,
> não de benchmark.

**Resumo:** o gerador funciona e é estável para o quadro real de faculdade, mas nenhum dos dois
solvers resolve de forma confiável as instâncias sintéticas, nem a de 3 turmas. A migração para
Rust/WASM está concluída; o plano de busca local, que atacaria esse limite, não foi começado.

---

## 1. Estado do repositório

- 9 commits à frente de `main`, já enviados ao `origin`, árvore limpa.
- `cargo test --release`: 59 testes passam. `tsc --noEmit` limpo. ESLint sem erros (9 avisos, quase
  todos em `src/lib/genetic/`).
- O container `my-website` (porta 3200) roda uma imagem de 14/11 21:23, anterior ao último commit
  (22:43). Ela já contém o runner exaustivo com threads, então foi construída com esse trabalho
  ainda não commitado. Não foi confirmado que é idêntica ao HEAD.

## 2. O que esta branch entregou

- **Tudo em Rust:** Pencilmark, GA, leitura do formulário e validação. No TS sobraram os tipos
  (`horario-regras.ts`), um worker único (`horario-wasm.worker.ts`) e a página.
- **Threads no WASM:** rayon via `wasm-bindgen-rayon`, build nightly, cabeçalhos COOP/COEP em
  todas as rotas menos o Sudoku Minado.
- **Pencilmark exaustivo paralelo:** reparte a árvore de busca entre as threads e consegue provar
  que um quadro é impossível. Começa em sequência e só cria o pool depois de 300 ms.
- **GA:** motor paralelo, modelo de ilhas opcional, fitness refeito e medido em "aulas a mover".

## 3. Medições

| Instância | Pencilmark (8 s) | GA sem ilhas (10 s, 2 sementes) |
| :--- | :--- | :--- |
| faculdade (real, 3 turmas) | resolve em 15 ms | 1 de 2 (27 ms; a outra parou em -40) |
| pequena (3 turmas) | não resolve, 74/75 células | 1 de 2 (7,5 s) |
| média (10 turmas) | não resolve, 223/250 | 0 de 2 |
| grande (25 turmas) | não resolve, 440/625 | não medido |
| inviável (3 turmas) | não prova em 8 s, 72/75 | — |

A página usa ilhas por padrão no GA; o benchmark não.

## 4. Problemas

1. **A busca do Pencilmark não escala.** A vazão cai de ~396 mil nós/s (pequena) para ~6,5 mil
   nós/s (grande). As possibilidades continuam globais (`n_possibs = disciplinas.len()`), e não
   locais por turma como previa o `plano-pencilmark-rust.md` §2.2.
2. **A prova de impossibilidade só funciona em casos rasos.** O teste do professor lotado termina,
   mas a `inviavel.json` não termina em 8 s. Na página, a busca fica rodando sem fim.
3. **O GA é irregular.** No mesmo quadro real, uma semente resolve em 27 ms e outra fica presa.
4. **O plano de busca local não saiu do papel.** De `plano-solver-local-search.md` só existe a
   Fase 0 (instâncias e benchmark). Não há `custo.rs`, `avaliador.rs` nem vizinhanças.
5. **A documentação está defasada.** `plano-pencilmark-rust.md` tem todas as caixas desmarcadas,
   embora quase tudo esteja feito. As Fases 0 e 3 (vetores de equivalência com o TS) foram puladas
   e o TS já foi apagado; a garantia que restou é o teste cruzado "solução do Pencilmark tem
   fitness 0 no GA". O plano de busca local ainda cita arquivos TS removidos.
6. **Sobras:** `raceWorkers` é sempre chamado com `n: 1`; o `rust-wasm/README.md` começa com links
   soltos.
7. **A verificar:** o COOP `same-origin` em quase todo o site pode quebrar fluxos de popup de
   terceiros, como o login com Google citado em "Sobre". Não foi testado.

## 5. Próximos passos sugeridos

1. Abrir o PR desta branch para `main`: está verde e é uma base coerente.
2. Implementar a busca local (LAHC com avaliador incremental), usando o Pencilmark como fase
   construtiva. Ataca os problemas 1 a 3, e o benchmark e as instâncias já existem para comparar.
3. Reestruturar o front end: ver `proposta-frontend-horario.md`.
4. Atualizar ou arquivar os dois planos antigos.
