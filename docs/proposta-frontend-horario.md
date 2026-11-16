# Proposta — Reestruturar o front end do gerador de horário

> Objetivo: facilitar o uso e aproximar o cadastro do padrão dos sistemas de horário escolar
> (Urânia, aSc TimeTables, FET, Untis), aproveitando os solvers em Rust que já existem.
>
> Escrito em 15/11/2026 sobre o commit `bcb739b`. Estado geral do projeto em
> `situacao-gerador-horario.md`.

**Resumo da proposta:** trocar o formulário único por um fluxo em etapas (Grade → Turmas →
Professores → Aulas → Gerar → Horário), em que a entidade central passa a ser a **aula** (matéria ×
turma × professor × carga), com referências por id, verificação dos dados antes de gerar e um
resultado que pode ser conferido por turma e por professor. As três primeiras fases não exigem
mudar o Rust.

---

## 1. Diagnóstico do front end atual

Tudo está em `src/app/toy/gerador-horario/page.tsx` (929 linhas, um componente), como um formulário
longo de seis cartões: Configurações da Grade, 1. Turmas, 2. Disciplinas, 3. Unir Disciplinas,
4. Professores, 5. Gerar e Visualizar.

### 1.1 Modelo de dados

| Problema | Onde | Efeito para o usuário |
| :--- | :--- | :--- |
| Disciplina aponta para a turma **pelo nome** | `page.tsx:511` (`d.turma === turma.nome`) | Renomear uma turma faz as disciplinas dela sumirem da tela; ao gerar, o Rust responde "Turma não encontrada" |
| Remover turma não remove as disciplinas dela | `removeTurma` | Ficam disciplinas órfãs, invisíveis, que quebram a geração |
| Professor e "unidas" apontam para disciplinas **pelo nome**, e o nome é global | `horario_regras.rs` (`buscar_disciplina` pega a primeira) | "Matemática" em duas turmas colide: o usuário é obrigado a inventar "Matemática 1A", "Matemática 1B" |
| "Disciplina" funde três coisas: a matéria, a turma e a carga semanal | `FormularioHorario.disciplinas` | A mesma matéria é redigitada em cada turma; não há visão da matéria nem da carga do professor |
| A grade (tempos, dias) fica fora do formulário | `quantidadeTempos`, `diasAtivos` em `useState` | Dois blocos de dados para salvar, exportar e importar |

### 1.2 Usabilidade

- **Os dados só são salvos ao clicar em "Gerar Horário"** (`page.tsx:300`). Recarregar a página
  antes disso perde tudo o que foi digitado.
- **Toda disponibilidade começa vazia.** Turma nova e professor novo nascem sem nenhum horário
  marcado, e cada célula precisa ser clicada uma a uma. O caso comum (disponível sempre, com
  exceções) é o mais trabalhoso.
- **"Preferências de horário" do professor é, na verdade, disponibilidade rígida.** O solver nunca
  coloca aula fora do que foi marcado. O rótulo promete uma coisa mais branda do que faz.
- **"Agrupar" e "Dividir" não têm explicação.** Pelo código: `agrupar = G` exige blocos de aulas
  consecutivas; com `dividir` cada bloco tem exatamente G aulas, sem `dividir` o bloco pode ter
  qualquer múltiplo de G. O nome "dividir" não sugere isso.
- **Não há verificação antes de gerar.** O solver exige que a soma das aulas da turma seja igual ao
  número de horários marcados para ela, e que cada professor tenha horários suficientes. Hoje esses
  erros só aparecem depois, como células "???" ou uma busca que não termina.
- **Mensagens de violação genéricas:** "Algo de errado não está certo", "Marcação não deveria estar
  aqui" (`horario_resultado.rs:17-21`), e só visíveis no `title` do ícone, que não aparece em toque.
- **"✓ Horário gerado com sucesso!" aparece sempre que há um quadro e a busca parou**
  (`page.tsx:852`), inclusive junto com o alerta de erro e quando o usuário interrompe.
- **A escolha do solver expõe jargão** (Pencilmark, Genético, ilhas), e o progresso também
  ("ramos em aberto", "gerações sem melhora").

### 1.3 Resultado

- Só existe a visão por turma. Não há visão por professor, que é a que o professor recebe.
- A cor da célula é a do **primeiro** professor da disciplina; os demais não aparecem.
- Não dá para ajustar à mão, fixar uma aula e gerar de novo, imprimir ou exportar o quadro.
- O quadro gerado não é salvo: some ao recarregar.

---

## 2. Como os sistemas do mercado organizam isso

### 2.1 O que foi possível levantar

**Urânia (Geha, Brasil).** O site público só tem material comercial e FAQ; o manual não está
acessível, então telas e ordem de cadastro **não foram confirmadas**. O que o site afirma:

- Indicar como as aulas de cada disciplina se dispõem na semana: "geminadas, separadas, só uma aula
  por dia, etc."; o blog fala em mais de 30 tipos de distribuição.
- "Determinar os horários em que cada professor pode dar suas aulas" e respeitar "disponibilidades
  e preferências" — dois conceitos separados.
- "Limitar o número de aulas diárias de cada professor."
- "Trabalhar com dois ou mais professores em conjunto (divisão de classes)."
- Turmas com horários de início e término diferentes; controle de ambientes (quadra, laboratório).
- "Grau de importância para mais de 40 elementos": as regras têm peso ajustável.
- Janelas (aulas vagas do professor) são minimizadas, com ferramenta própria.
- Duas fases: geração e depois "melhoria do horário", com sugestões ao usuário. Quando não fecha,
  o programa "apresentará sugestões de mudanças".
- "Grande parte de seus cadastros são opcionais."
- Importa planilha, XML e JSON; capta a disponibilidade dos professores por e-mail; publica o
  horário na internet e envia o horário de cada professor.

**aSc TimeTables.** Fluxo: entrar os dados (matérias, turmas, professores, salas), gerar, verificar
e imprimir. A unidade de trabalho é a **aula/cartão** (*lesson/card*): matéria + turma(s) +
professor(es) + quantidade por semana, com a distribuição dos cartões na semana configurável por
matéria. As restrições ficam em dois lugares: *time off* de cada professor/turma e *card
relationships* (ex.: duas turmas com a mesma matéria ao mesmo tempo, máximo de aulas consecutivas
do professor, evitar janelas).

**FET (livre).** A entidade central é a **atividade**: um ou mais professores + uma matéria + um
ou mais conjuntos de alunos (ano > grupo > subgrupo). Todas as regras são restrições de tempo ou de
espaço com **peso em percentual** (100% = obrigatória): indisponibilidade, mínimo de dias entre
atividades, atividades consecutivas ou agrupadas, máximo de dias por semana do professor.

**Untis.** Dados mestres (turmas, professores, salas, matérias) e **aulas** (*lessons*). Os
"pedidos de horário" usam uma escala de **+3 a −2** por célula, para professores, turmas, salas e
aulas individuais; uma tela de **ponderação** define quanto cada critério pesa. Aulas duplas são um
intervalo mín–máx por aula. Por padrão, a matéria aparece só uma vez por dia na turma.

### 2.2 O padrão comum

Apesar das diferenças, os quatro seguem a mesma espinha:

1. **Grade:** dias e tempos da semana.
2. **Cadastros base independentes:** turmas, matérias, professores (e salas).
3. **Aulas (atribuição):** a entidade central, que liga matéria, turma(s), professor(es) e carga
   semanal. É nela que ficam a distribuição na semana e a junção de turmas.
4. **Restrições em dois níveis:** *não pode* (rígida) e *prefere/evite* (flexível, com peso).
5. **Gerar**, com o sistema apontando o que impede o fechamento.
6. **Revisar:** visão por turma e por professor, ajuste manual, nova geração.
7. **Publicar:** imprimir, exportar, enviar.

### 2.3 Onde estamos em relação ao padrão

| Padrão | Hoje | Lacuna |
| :--- | :--- | :--- |
| Grade | "Configurações da Grade" | Separada dos dados; turma marca célula a célula |
| Cadastros base | Turmas e professores | Não existe **matéria**; tudo ligado por nome |
| Aula como entidade central | Diluída entre "Disciplinas", "Professores" e "Unir Disciplinas" | Principal diferença estrutural |
| Distribuição na semana | `agrupar` + `dividir` | Existe no solver, mas com nomes obscuros |
| Junção de turmas | "Unir Disciplinas" | Existe, mas como cadastro à parte |
| Rígida × flexível | Só rígida, chamada de "preferência" | Falta o nível flexível (depende do solver) |
| Verificação dos dados | Nenhuma | Falta |
| Revisão | Só por turma, sem edição | Falta visão por professor, ajuste e fixação |
| Publicação | Nenhuma | Falta imprimir/exportar |

---

## 3. Proposta

### 3.1 Modelo de dados (v2)

Detalhado em `modelagem-horario.md`, que incorpora as definições de 15/11/2026: cadastros
permanentes (cursos com matriz curricular por período, professores, ambientes com capacidade)
separados do projeto de horário (quadro de horários com hora e intervalos, turmas criadas a partir
de um período, ofertas, disponibilidade). A "aula" descrita abaixo chama-se **oferta** no modelo.

### 3.2 Fluxo em etapas

Uma navegação fixa de etapas (lateral no desktop, topo no celular), cada uma com um indicador de
pendências. O usuário pode ir e voltar livremente; nada é bloqueado.

```
 Grade  ›  Turmas  ›  Professores  ›  Aulas  ›  Gerar  ›  Horário
                                       ●3                  
```

**1. Grade.** Dias da semana e número de tempos. Como hoje, mas dentro do projeto.

**2. Turmas.** Lista à esquerda, detalhe à direita (em vez de cartões empilhados). Turma nova
nasce com **a grade inteira marcada**; o usuário só desmarca as exceções. Ação "duplicar turma".

**3. Professores.** Mesma estrutura. Disponibilidade nasce **toda marcada**, e o rótulo passa a ser
"Disponibilidade" com a explicação "o professor nunca terá aula fora dos horários marcados". No
detalhe, um resumo: "16 aulas atribuídas · 16 horários disponíveis".

Componente único de grade para turmas e professores, com: clicar e arrastar para pintar, clique no
cabeçalho do dia ou do tempo para marcar a linha ou a coluna inteira, e "copiar de…".

**4. Aulas.** A tela principal do cadastro: uma tabela por turma.

```
 Turma 1                                        22 de 20 tempos  ⚠ sobram 2 aulas
 ┌──────────────┬────────────────┬───────────┬─────────────────────┬────────────┐
 │ Matéria      │ Professor(es)  │ Aulas/sem │ Distribuição        │ Junto com  │
 ├──────────────┼────────────────┼───────────┼─────────────────────┼────────────┤
 │ Cálculo      │ Prof. C        │     4     │ Aulas duplas        │ —          │
 │ Projeto      │ Prof. D, H     │     4     │ Bloco de 4          │ Turma 2    │
 │ + adicionar aula                                                             │
 └──────────────┴────────────────┴───────────┴─────────────────────┴────────────┘
```

- Matéria e professor são campos com busca que **criam o cadastro na hora** se o nome não existir.
  Com isso a etapa "Matérias" não precisa existir como tela separada.
- O rodapé mostra a conta que hoje o usuário faz de cabeça: aulas atribuídas × tempos da turma.
- Alternar "ver por professor" mostra as mesmas aulas agrupadas pelo professor, com a carga dele.

**5. Gerar.** Antes do botão, a **verificação dos dados** (§3.3). Um só botão "Gerar horário"; a
escolha de algoritmo vai para "Opções avançadas". Progresso em termos do usuário: "58 de 60 aulas
alocadas", com o quadro parcial aparecendo como hoje.

**6. Horário.** Ver §3.4.

### 3.3 Verificação antes de gerar

Funções puras em TS (`diagnostico.ts`), recalculadas a cada edição, exibidas na etapa Gerar e como
contador nas etapas. Cada item leva ao campo que o corrige.

Erros (impedem um horário completo):

- turma com soma de aulas diferente do número de tempos marcados;
- professor com mais aulas do que horários disponíveis;
- aula sem professor, sem matéria ou com zero aulas;
- carga que não fecha em blocos (ex.: 3 aulas em blocos de 2) ou bloco maior que o maior trecho
  contínuo de tempos da turma;
- turmas juntas sem nenhum horário em comum;
- turma ou professor sem nome, ou turmas com nomes repetidos.

Avisos (podem tornar o horário impossível):

- professor com carga igual à disponibilidade (sem folga nenhuma — é exatamente o caso que o teste
  `pencilmark_prova_que_o_quadro_e_impossivel` explora);
- professor cujos horários não cruzam o suficiente com os da turma em que leciona.

Isso responde ao ponto em que os solvers são mais fracos: hoje um dado inviável vira uma busca que
não termina; com a verificação, a maior parte desses casos é barrada antes, com a causa nomeada.

### 3.4 Tela do horário

- **Estado honesto:** "Horário completo", "Horário incompleto: N problemas" ou "Não existe horário
  com estas regras" (quando o Pencilmark prova). Sem "sucesso" quando há violação.
- **Abas:** por turma, por professor e geral (todas as turmas lado a lado).
- **Lista de problemas** ao lado do quadro; clicar destaca a célula. Substitui o `title`.
- **Célula** mostra matéria e professor(es); a cor vem do cadastro do professor.
- **Imprimir / exportar** (impressão do navegador e CSV) por turma e por professor.
- **O resultado é salvo** junto com o projeto.

### 3.5 Persistência

- Salvamento automático no `localStorage` a cada alteração (com atraso curto), indicador "salvo".
- Um único JSON versionado (`ProjetoHorario`), que já inclui a grade; importação validada com
  mensagem de erro por campo.
- "Limpar tudo" passa a pedir confirmação.

### 3.6 Organização do código

```
src/app/toy/gerador-horario/
├── page.tsx                  casca: etapas e estado do projeto
├── modelo.ts                 tipos v2, esquema zod, migrarV1
├── para-solver.ts            ProjetoHorario → FormularioHorario, e o mapa de volta
├── diagnostico.ts            verificações (funções puras, testáveis)
├── useProjeto.ts             estado, salvamento automático, importar/exportar
├── etapas/                   Grade, Turmas, Professores, Aulas, Gerar, Horario
├── componentes/              GradeDisponibilidade, QuadroHorario, ListaProblemas
├── horario-regras.ts         (fica: formato trocado com o Rust)
└── horario-wasm.worker.ts    (fica)
```

---

## 4. Fases

Cada fase termina com o site funcionando e os JSON antigos ainda abrindo.

| Fase | Entrega | Mexe no Rust? |
| :--- | :--- | :--- |
| 1 | Modelo v2, `paraSolver`, `migrarV1`, salvamento automático. A tela muda pouco, mas renomear e remover turma deixam de quebrar | Não |
| 2 | Fluxo em etapas, tela de Aulas, grade de disponibilidade nova (padrão marcado, pintar, copiar) | Não |
| 3 | Verificação antes de gerar | Não |
| 4 | Tela do horário: estado honesto, visão por professor, lista de problemas, imprimir/exportar | Pequeno: mensagens de violação específicas (o `enum Violacao` previsto em `plano-pencilmark-rust.md` §2.5) |
| 5 | Fixar aulas e gerar de novo; trocar duas aulas à mão com validação imediata | Sim: quadro inicial com células preenchidas (o motor do Pencilmark já aceita; falta expor no runner) e `validar` exposto ao JS |
| 6 | Preferências flexíveis (disponível / evitar / indisponível), limite de aulas por dia, janelas do professor, com pesos | Sim: depende do custo por regra de `plano-solver-local-search.md` §3 |

As fases 1 a 3 trazem a maior parte do ganho de uso e não dependem de nada no solver. A fase 6 é a
que nos aproxima de fato do Urânia e do Untis, e só faz sentido depois da busca local.

---

## 5. Decisões

Respondidas em 15/11/2026:

1. **Público-alvo:** IFRO, ensino médio técnico integrado e superior. Hoje resolve o superior.
2. **Ambientes:** entram no modelo já (salas com capacidade, turma com número de alunos,
   disciplina escolhe o ambiente), mesmo com o solver ignorando.
3. **Vários projetos:** sim. A matriz do curso é cadastrada uma vez e cada projeto cria turmas a
   partir dela.
4. **Quadro de horários:** com hora, duração e intervalos.

As demais decisões estão em `modelagem-horario.md` (§9). O plano de execução é
`plano-frontend-horario.md`, que prevalece sobre o §4 deste documento.

---

## Fontes

- Urânia: [O Programa](https://horario.com.br/o-programa), [FAQ](https://horario.com.br/faq),
  [página inicial](https://horario.com.br/),
  [blog: como distribuir as aulas](https://horario.com.br/blog/horario-escolar-como-distribuir-as-aulas-e-melhorar-o-aprendizado-dos-alunos/)
- aSc TimeTables: [ajuda online](https://help.asctimetables.com/index.php?lang_id=18),
  [tópicos frequentes](https://help.asctimetables.com/frequenttopics.php?lang_id=5),
  [ajuda EduPage](https://help.edupage.org/?p=u1%2Fu3)
- FET: [recursos](https://lalescu.ro/liviu/fet/features.html),
  [FAQ](https://sources.debian.org/src/fet/3.12.30-1/doc/FAQ.html)
- Untis: [pedidos de horário](https://www.untis.at/HTML/WebHelp/uk/untis/wus_zeitwuensche.htm),
  [ponderação](https://webhelp.untis.at/HTML/WebHelp/uk/untis/opgewichtung.htm),
  [aulas duplas](https://www.untis.at/HTML/WebHelp/uk/untis/doppelstundeke.htm)
