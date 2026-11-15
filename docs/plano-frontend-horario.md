# Plano de execução — Novo front end do gerador de horário

> Executa a modelagem de `modelagem-horario.md`. Substitui as fases de
> `proposta-frontend-horario.md` (§4).
>
> Regras do plano:
> - Cada etapa termina com `tsc`, ESLint e os testes passando, e com a página funcionando.
> - Não há compatibilidade com o formato antigo: a página atual é substituída na Etapa 2.
> - No fim (Etapa 6) existe um só modelo: o Rust passa a ler o modelo novo e o adaptador some.

## Visão geral

| Etapa | Entrega | Mexe no Rust? | Estado |
| :--- | :--- | :--- | :--- |
| 1 | Modelo, operações, armazenamento e adaptador para o solver (sem tela) | Não | **feita** |
| 2 | Página nova com o que a atual faz: projetos, quadro de horários, professores, turmas, ofertas, gerar | Não | **feita** |
| 3 | Cursos e matriz curricular; turma a partir de um período; ambientes | Não | **feita** |
| 4 | Verificações antes de gerar | Não | **feita** |
| 5 | Tela do horário: por turma, professor e ambiente; problemas; imprimir e exportar | Pequeno | **feita** |
| 6 | O Rust lê o modelo novo; o adaptador e o formato antigo são removidos | Sim | |
| 7 | Regras novas no solver: quebras, fixar aulas, preferências | Sim | |

As etapas 2 a 5 são sequenciais. A 6 pode ser feita a qualquer momento depois da 2.

---

## Etapa 1 — Modelo, operações e adaptador

Código puro em `src/app/toy/gerador-horario/modelo/`, sem React, testado com `npm test`.

- `modelo.ts`: esquema `zod` e tipos (`AreaDeTrabalho`, `Cadastros`, `Curso`, `ProjetoHorario`,
  `QuadroHorarios`, `Turma`, `Oferta`, `DocenteNoProjeto`, `HorarioGerado`).
- `operacoes.ts`: gerar faixas do quadro, criar turma a partir de um período, criar turma avulsa,
  remover turma, juntar e separar ofertas, duplicar curso, diferenças em relação à matriz,
  ambiente e alunos de uma oferta, manter os docentes do projeto.
- `para-solver.ts`: `paraSolver(projeto)` gera o `FormularioHorario` atual (ambientes
  compartilhados entram como recurso) e `doSolver(...)` converte o resultado em alocações.
- `armazenamento.ts`: ler e gravar a área de trabalho validada.

**Validação:** testes unitários; e o quadro real de faculdade, reescrito no modelo novo, passa por
`paraSolver` e é resolvido pelo solver nativo (`bench_horario`).

## Etapa 2 — Página nova com paridade

Substitui `page.tsx`. Uma casca com duas áreas: **Cadastros** e **Projeto**.

- Estado: `useAreaDeTrabalho` (carrega, salva automaticamente, exporta e importa JSON).
- Projetos: criar, abrir, renomear, duplicar ("novo a partir de 2026/2"), excluir.
- Quadro de horários: dias; lista de faixas com hora e duração; "gerar faixas" por turno;
  duração padrão do quadro; intervalos.
- Professores (cadastro): nome, sigla, cor.
- Turmas: lista e detalhe; turma avulsa; grade de horários que nasce marcada, com pintar
  arrastando e marcar linha ou coluna.
- Ofertas: tabela por turma (disciplina, professores, aulas, distribuição, junto com), com o
  rodapé "aulas × tempos da turma"; juntar e separar turmas.
- Disponibilidade dos docentes do projeto (pode / evitar / não pode).
- Gerar: um botão; algoritmo em "opções avançadas"; quadro por turma, com o estado correto
  (completo, incompleto, impossível).
- Remove `horario-regras.ts` do formulário antigo no que não for mais usado.

**Validação:** roteiro no navegador (Playwright): importar o quadro real, gerar, zero problemas;
recarregar a página e conferir que nada se perdeu.

**Como ficou:** menu lateral no computador e barra de navegação embaixo no celular; tabelas de
edição que se empilham em telas estreitas; explicações num ícone de ajuda em vez de subtítulos;
junção de turmas numa seção própria ("Aulas em conjunto"), fora da tabela de aulas. A página lê
também o JSON da versão anterior (arquivo ou o que estava salvo no navegador) e o converte num
projeto.

## Etapa 3 — Cursos, matriz e ambientes

- Cursos: lista; períodos; tabela de componentes por período; duplicar curso.
- Turma a partir de curso e período, criando as ofertas; indicador "diferente da matriz",
  "atualizar pela matriz" e lista de componentes não ofertados.
- Ofertas especiais: adicionar componente de outro período ou curso, ou disciplina livre.
- Ambientes (cadastro): nome e capacidade. Turma com número de alunos e ambiente padrão; oferta
  com ambiente próprio opcional.

**Validação:** cadastrar um curso de 2 períodos, criar duas turmas, alterar uma oferta, conferir a
marca de diferença; duas turmas dividindo um laboratório não recebem aula nele ao mesmo tempo.

## Etapa 4 — Verificações antes de gerar

- `diagnostico.ts`: funções puras que devolvem `{ gravidade, mensagem, onde }`.
- Erros: turma com aulas diferentes dos tempos; professor ou ambiente com mais aulas do que
  horários; oferta sem professor ou com zero aulas; carga que não fecha em blocos; bloco que não
  cabe; turmas juntas sem horário comum; capacidade insuficiente; quadro com faixas sobrepostas.
- Avisos: professor sem folga; oferta sem ambiente; componentes da matriz não ofertados.
- Na tela: painel na etapa Gerar e contador em cada item do menu; cada problema leva ao campo.

**Validação:** um teste por verificação; as instâncias `inviavel.json` e a do "professor lotado"
(reescritas no modelo novo) são barradas antes de gerar.

## Etapa 5 — Tela do horário

- Abas por turma, por professor e por ambiente; célula com disciplina, professor e ambiente, e
  hora real da aula.
- Lista de problemas clicável; aulas em horário "evitar" e blocos que atravessam intervalo.
- O horário gerado fica salvo no projeto, com aviso de "desatualizado".
- Imprimir (por turma e por professor) e exportar CSV.
- Rust: mensagens de violação específicas no lugar de "Algo de errado não está certo".

**Validação:** roteiro no navegador com as três visões batendo entre si (mesmas alocações).

## Etapa 6 — Um só modelo

- O Rust recebe o problema por ids: turmas, ofertas (com várias turmas), recursos (professores e
  ambientes) e tempos. Sai `FomularioHorario` e a busca por nome.
- O resultado volta como alocações por oferta.
- `paraSolver` vira uma projeção direta do projeto; some o truque dos nomes internos.
- As instâncias de `rust-wasm/tests/instancias/`, o `gerar.mjs` e os exemplos de benchmark são
  convertidos.

**Validação:** `cargo test` e os benchmarks com os mesmos números de antes nas mesmas instâncias.

## Etapa 7 — Regras novas no solver

Depende da busca local (`plano-solver-local-search.md`) para as regras com peso.

- Bloco não atravessa troca de turno (rígida) e evita intervalo (com peso).
- Fixar aulas e gerar o resto; trocar aulas à mão com validação imediata.
- Preferências "evitar" com peso; máximo de aulas por dia; janelas do professor.
