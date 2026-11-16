# Situação do gerador de horário — 15/11/2026 (revisão da noite)

> Retrato da branch `atualizar-gerador-horario` (commit `d8dbc23`). Números medidos nesta data,
> nativo, 4 núcleos, com uma ou duas execuções curtas por instância: servem de ordem de grandeza,
> não de benchmark. Substitui o retrato anterior (commit `bcb739b`).

**Resumo:** o front end novo (etapas 1 a 7 do `plano-frontend-horario.md`) está pronto e o Rust lê
o modelo novo. O GA melhorou: resolve o quadro real e a instância pequena em todas as sementes
testadas. Mas nenhum solver resolve as instâncias média (10 turmas) e grande (25 turmas), e a busca
local, que atacaria esse limite, continua sem começar.

---

## 1. Estado do repositório

- 16 commits à frente de `main`, já enviados ao `origin`, árvore limpa. Ainda sem PR.
- `cargo test --release`: 68 testes passam. Aviso: dependência `getrandom` não usada no nativo
  (é usada só no WASM). Clippy: 29 avisos.
- `tsc --noEmit` limpo. `npm test`: 19 testes passam.
- ESLint: 3 erros, todos em `sudoku-minado/sudoku-grid.tsx` (fora do gerador); nenhum erro na
  pasta do gerador.
- O container `my-website` (porta 3200) roda uma imagem construída às 12:06, um minuto depois do
  commit `d8dbc23`: está no HEAD. A página responde 200 com COOP/COEP.
- Não houve roteiro no navegador nesta revisão (Playwright não está instalado na VM).

## 2. O que mudou desde o retrato anterior

- **Modelo v2** (cursos, matriz, projetos, ofertas, ambientes) com zod, testes e armazenamento.
- **Página nova:** cadastros, projeto, quadro, turmas, ofertas, aulas em conjunto, ambientes,
  verificações antes de gerar, horário por turma/professor/ambiente, imprimir e CSV.
- **Um só modelo:** o Rust recebe `EntradaHorario` por ids; formulário antigo e adaptador saíram.
- **Validador** diz qual regra a aula quebra.
- **Qualidade só no GA** (`horario_qualidade.rs`): evitar, jornada, descanso e intervalo, como
  penalidades menores que qualquer regra obrigatória.

## 3. Medições

| Instância | Pencilmark (8 s) | GA sem ilhas (10 s, 2 sementes) | Antes (GA) |
| :--- | :--- | :--- | :--- |
| faculdade (real, 3 turmas) | resolve em 28 ms | 2 de 2 (46 ms em média) | 1 de 2 |
| pequena (3 turmas) | não resolve, 71/75 | 2 de 2 (1,5 s em média) | 1 de 2 (7,5 s) |
| média (10 turmas) | não resolve, 203/250 | 0 de 2 (fitness -140 e -100) | 0 de 2 |
| grande (25 turmas) | não resolve, 471/625 | 0 de 2 (média -730) | não medido |
| inviável (3 turmas) | não prova em 8 s, 73/75 | — | — |

Vazão do Pencilmark: ~406 mil nós/s (pequena), ~47 mil (média), ~6,3 mil (grande), igual ao
retrato anterior. Vazão do GA: ~7 mil gerações/s nas de 3 turmas, ~940 na média, ~150 na grande.

## 4. Problemas

1. **Média e grande não resolvem.** É o limite principal e não mudou. O GA estagna (média para
   por estagnação perto de 9 mil gerações); na grande, 150 gerações/s é pouco.
2. **A busca do Pencilmark não escala.** As possibilidades continuam globais
   (`n_possibs = disciplinas.len()`), não locais por turma (`plano-pencilmark-rust.md` §2.2).
3. **A prova de impossibilidade só funciona em casos rasos.** `inviavel.json` não termina em 8 s.
   Na página isso é atenuado pelas verificações antes de gerar, que barram os casos óbvios.
4. **O plano de busca local não saiu do papel.** Só existe a Fase 0 (instâncias e benchmark).
5. **Documentação:** `plano-pencilmark-rust.md` (17 caixas) e `plano-solver-local-search.md`
   (25 caixas) seguem todos desmarcados; o segundo ainda cita arquivos TS removidos e o formato
   antigo de entrada.
6. **Sobras:** `raceWorkers` é sempre chamado com `n: 1` no gerador; `rust-wasm/README.md` começa
   com links soltos; `getrandom` aparece como não usado no build nativo.
7. **A verificar:** COOP `same-origin` em quase todo o site pode quebrar popups de terceiros (login
   com Google). Não testado.

## 5. Próximos passos sugeridos

1. Abrir o PR desta branch para `main`. Antes, um roteiro no navegador (importar o quadro real,
   gerar, recarregar) e o teste do login com Google sob COOP.
2. Implementar a busca local (LAHC com avaliador incremental), com o Pencilmark ou uma construção
   gulosa como ponto de partida. Revisar o plano para o formato `EntradaHorario` e para as regras
   de qualidade antes de começar.
3. Arquivar `plano-pencilmark-rust.md` (feito na prática) e atualizar o plano de busca local.
