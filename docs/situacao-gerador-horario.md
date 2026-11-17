# Situação do gerador de horário — 17/11/2026

> Retrato da branch `experimentos-solver-genetico`. Os números são de execuções nativas nesta VM
> (4 núcleos), 10 sementes por instância: servem de ordem de grandeza, não de benchmark. Substitui
> o retrato de 15/11 (branch `atualizar-gerador-horario`, já em `main`).

**Resumo:** a busca local (late acceptance com avaliação incremental) resolve todas as instâncias
de teste, inclusive as de 10 e 25 turmas e o técnico real de 19 turmas, e virou o método padrão
da página. Os três métodos usam o pool de threads desde o início e nenhum tem limite de tempo:
a busca local e o genético rodam até atender a todas as regras ou até o usuário interromper.

---

## 1. Estado do repositório

- Dois commits à frente de `main` já enviados (`6738ec9` busca local, `e9b958c` padrão, sem limite,
  progresso). Há mudanças locais ainda sem commit (§2, a partir de "Painel"), já publicadas no
  container.
- `cargo test --release`: 87 testes passam. Clippy: 30 avisos. Aviso conhecido: `getrandom` não
  usado no build nativo (só no WASM).
- `npm test`: 19 testes passam. `tsc` limpo (com o `src/pkg` gerado).
- ESLint: 3 erros, todos em `sudoku-minado/sudoku-grid.tsx` (fora do gerador).
- O container `my-website` (porta 3200, `erick.fslab.dev`) roda o estado atual da árvore de trabalho.
- Sem roteiro no navegador: a VM não tem Chromium nem Playwright.

## 2. O que mudou desde o retrato anterior

- **Busca local** (`horario_busca_local.rs`): custo igual ao fitness do genético (obrigatórias e
  qualidade num número só), avaliação incremental testada movimento a movimento, trocas de aulas e
  de blocos dentro da turma (repetidas nas turmas de uma aula em conjunto), cadeias em paralelo.
  Ver `plano-solver-local-search.md` (situação no topo).
- **Padrão e limites:** busca local é o método padrão; busca local e genético não param por tempo
  nem por falta de melhora, só com custo 0 ou interrompidos.
- **Threads desde o início** em todos os métodos. O genético sorteia a população inicial em
  paralelo e os filhos começam como cópia (antes, dezenas de milhares de quadros eram sorteados
  numa thread só antes do primeiro progresso). A busca exata não começa mais numa thread só.
- **Progresso** a cada 250 ms: tempo, iterações por segundo, violações obrigatórias, observações
  de qualidade (o custo exato fica no title), tempo sem melhora, atualizações do quadro. As aulas
  que mudaram de lugar na última atualização ficam com contorno azul.
- **Painel** (sem commit): o resultado sempre traz as observações de qualidade, também com
  violação; listas longas de avisos com "ver mais"; horário, quadro e grades de disponibilidade
  divididos por turno, com as aulas numeradas dentro do turno; title nas células do horário com
  disciplina, turmas, professores e ambiente; horas disponíveis por semana de cada docente; aula a
  menos que horários na turma deixou de ser destacada em vermelho; "emendar blocos" vem marcado e
  fica desativado quando há um bloco só.

## 3. Medições

Tempo até um horário que atende às regras obrigatórias, uma cadeia (a página usa até 8):

| Instância | Busca local (mediana) | Antes (GA, 10 s) |
| :--- | :--- | :--- |
| média (10 turmas) | 0,27 s, 10 de 10 | 0 de 2 |
| grande (25 turmas) | 0,75 s, 10 de 10 | 0 de 2 |
| técnico real v3 (19 turmas, 614 aulas) | 1,59 s, 10 de 10 | — |
| técnico real v4 (19 turmas) | 3,63 s, 5 de 10 em 20 s | — |

Vazão: 2 a 6 milhões de movimentos por segundo por cadeia. No técnico v3, todas as sementes param
em custo 0,0078 = 21 ocorrências de "aula sozinha de um lado do intervalo".

Comparação da lista do late acceptance (só baixa × como no artigo): ver `AtualizacaoDaLista` em
`horario_busca_local.rs`; a atual ganha ou empata em todas as instâncias.

## 4. Problemas e pendências

1. **Regra do intervalo vale para qualquer disciplina.** Duas ou três aulas seguidas de uma
   disciplina sem agrupamento que atravessam o intervalo também geram observação. Decidir se a
   regra deve valer só para disciplinas agrupadas.
2. **Professores compartilhados entre projetos.** O solver não vê as aulas do mesmo professor em
   outro projeto (choque e descanso entre cursos). Hoje é preciso tirar esses horários da
   disponibilidade à mão.
3. **Sem edição manual do horário gerado** (trocar ou fixar aulas). O campo `fixada` existe no
   modelo, mas nada o usa.
4. **Gerar de novo a partir do horário atual:** a busca local sempre parte de um quadro sorteado.
5. **Vizinhanças que faltam:** `SwapColuna` e `KempeChain`; a troca de uma aula em conjunto não
   propaga para as aulas deslocadas nas turmas parceiras.
6. **Pencilmark:** possibilidades globais, não locais por turma; a prova de impossibilidade só
   termina em casos rasos.
7. **Escala das threads nesta VM:** o sorteio paralelo da população não acelera aqui (acesso a
   memória compartilhada entre núcleos); com uma cópia das regras por thread acelera 3,7×. Não
   otimizado, por parecer próprio da VM.
8. **A verificar:** COOP `same-origin` em quase todo o site pode quebrar popups de terceiros.

## 5. Próximos passos sugeridos

1. Fazer commit das mudanças locais e abrir o PR desta branch.
2. Itens 1, 4 e a versão mínima do 3 (trocar duas aulas de lugar no horário gerado).
3. Item 2, se os professores dividem cursos.
