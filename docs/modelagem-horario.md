# Modelagem — Gerador de horário (v2)

> Modelo de dados para a reestruturação descrita em `proposta-frontend-horario.md`. Público-alvo:
> IFRO (ensino médio técnico integrado e superior). Revisado em 15/11/2026 com as decisões do §9.
> O plano de execução está em `plano-frontend-horario.md`; os tipos valem como estão em
> `src/app/toy/gerador-horario/modelo/modelo.ts`.

**Ideia central:** separar o que é **permanente** (cursos e suas matrizes, professores, ambientes)
do que é **de um período letivo** (o projeto de horário: quadro de horários, turmas, ofertas,
disponibilidade e o horário gerado). A matriz do curso é preenchida uma vez; cada projeto cria
turmas a partir dela.

---

## 1. Vocabulário

"Grade" significava duas coisas. Passa a ter dois nomes:

| Termo | Significado |
| :--- | :--- |
| **Matriz curricular** | As disciplinas de um curso, organizadas por período (ano ou semestre) |
| **Componente** | Uma disciplina da matriz (ex.: "Banco de Dados I", 4 aulas/semana, laboratório) |
| **Quadro de horários** | Os dias da semana e a sequência de aulas e intervalos do dia, com hora e duração |
| **Tempo** | Uma aula do quadro de horários (1ª aula, 2ª aula…). Intervalo não é tempo |
| **Ambiente** | Sala, laboratório, quadra. Tem nome e capacidade |
| **Projeto de horário** | O horário de um período letivo (ex.: "2027/1") |
| **Turma** | Um grupo de alunos num projeto, normalmente cursando um período de um curso |
| **Oferta** | Uma disciplina sendo dada num projeto: para qual turma (ou turmas), por quais professores, quantas aulas, em que ambiente. É a "aula" da proposta original |

---

## 2. Visão geral

```
 CADASTROS (permanentes)                    PROJETO DE HORÁRIO (um por período letivo)
 ───────────────────────                    ──────────────────────────────────────────
 Curso                                      QuadroHorarios
  └─ Período (1º, 2º…)                       └─ Faixa (aula | intervalo), com hora e duração
      └─ Componente ───────────┐
                               │ copia      Turma ──── (curso, período, nº de alunos, ambiente padrão)
                               └──────────►  └─ Oferta ◄──── participa ──── outra Turma (junção)
                                                 ├─ professores
 Professor ◄─────────────────────────────────────┤
                                                 └─ ambiente (o da turma, ou outro)
 Ambiente (capacidade) ◄──────────────────  DocenteNoProjeto (disponibilidade e preferências)
                                            Horario gerado (alocações: oferta, dia, tempo)
```

---

## 3. Cadastros permanentes

```ts
type Id = string; // UUID: nomes são só rótulos, livres para repetir e renomear

interface Cadastros {
  cursos: Curso[];
  professores: Professor[];
  ambientes: Ambiente[];
}
```

### 3.1 Curso e matriz curricular

```ts
interface Curso {
  id: Id;
  nome: string;                 // "Tecnologia em Análise e Desenvolvimento de Sistemas"
  sigla: string;                // "ADS"
  nivel: "integrado" | "subsequente" | "superior" | "outro";
  regime: "anual" | "semestral"; // dá o rótulo do período: "1º ano" ou "1º semestre"
  periodos: Periodo[];
}

interface Periodo {
  id: Id;
  numero: number;               // 1, 2, 3…
  componentes: Componente[];
}

interface Componente {
  id: Id;
  nome: string;
  aulasSemana: number;          // o que o solver usa
  cargaHoraria?: number;        // horas totais do PPC; só informativo
  distribuicao: Distribuicao;
}
```

- **`nivel`** só escolhe padrões da tela. Ex.: no integrado, a distribuição padrão tende a "no
  máximo um bloco por dia"; no superior, a blocos longos.
- **A matriz não fala de ambiente.** O ambiente é decidido no projeto: a turma tem um ambiente
  padrão e cada oferta pode trocar (§4.2 e §4.3).
- **Cada PPC é um curso novo** ("ADS — matriz 2024"), criado por "duplicar curso". As turmas
  antigas continuam apontando para a matriz antiga.

### 3.2 Distribuição das aulas na semana

```ts
type Distribuicao =
  | { tipo: "livre" }
  | { tipo: "blocos"; tamanho: number; emendar: boolean };
```

| Na tela | Modelo | Solver hoje (`agrupar`, `dividir`) |
| :--- | :--- | :--- |
| Livre | `livre` | 0, — |
| Aulas duplas (geminadas) | `blocos`, 2, não emenda | 2, sim |
| Em blocos de N | `blocos`, N, não emenda | N, sim |
| Em blocos de N, podendo emendar | `blocos`, N, emenda | N, não |

Para o integrado vão fazer falta, mais adiante, "no máximo N aulas por dia" e "espalhar na semana".
Entram como campos opcionais de `Distribuicao` quando o solver souber tratá-los.

### 3.3 Ambientes

```ts
interface Ambiente {
  id: Id;
  nome: string;                 // "Sala 12", "Lab. Info 2", "Quadra"
  capacidade: number;
}
```

Sem categorias. Sala e laboratório são ambientes iguais; o que muda é quem os usa.

### 3.4 Professor

```ts
interface Professor {
  id: Id;
  nome: string;
  cor: string;
}
```

A disponibilidade e as preferências **não** ficam aqui: são de cada projeto (§4.4).

---

## 4. Projeto de horário

```ts
interface ProjetoHorario {
  id: Id;
  nome: string;                  // "2027/1"
  quadro: QuadroHorarios;
  turmas: Turma[];
  ofertas: Oferta[];
  docentes: DocenteNoProjeto[];
  horario: HorarioGerado | null;
  revisao: number;               // sobe a cada edição; diz se o horário gerado está desatualizado
}
```

### 4.1 Quadro de horários

```ts
interface QuadroHorarios {
  dias: HorarioDia[];            // ["seg", "ter", "qua", "qui", "sex"]
  duracaoAulaMin: number;        // padrão do quadro: 50
  faixas: Faixa[];               // a sequência do dia, em ordem
}

type Faixa =
  | { tipo: "aula"; id: Id; inicio: string; duracaoMin: number; turno: Turno }
  | { tipo: "intervalo"; id: Id; nome: string; inicio: string; duracaoMin: number };

type Turno = "matutino" | "vespertino" | "noturno";
```

- **Duração:** `duracaoAulaMin` é o valor usado ao criar aulas; cada aula guarda a sua e pode ser
  alterada (técnico de dia com 50 min e graduação à noite com outra duração, no mesmo quadro).
- **Um quadro só para o projeto**, cobrindo os três turnos. Cada turma usa a parte que lhe cabe.
  É necessário porque professores e ambientes são compartilhados entre turnos.
- **O número do tempo que o solver usa** é a posição da faixa entre as do tipo `aula`. Intervalo
  não ocupa tempo; ele marca uma **quebra** entre dois tempos vizinhos.
- **Dois tipos de quebra saem do modelo sem campo extra:** entre tempos de turnos diferentes
  (forte: um bloco nunca deveria atravessar) e intervalo dentro do turno (fraca: prefere não
  atravessar).
- A tela oferece "gerar faixas" por turno: início, quantas aulas e onde fica o intervalo.
- O mesmo quadro vale para todos os dias. Sábado letivo não entra no horário semanal.

### 4.2 Turma

```ts
interface Turma {
  id: Id;
  nome: string;                  // "ADS 3º período", "INFO 2A"
  origem: { cursoId: Id; periodoId: Id } | null; // null = turma avulsa
  alunos: number;
  horarios: HorariosPorDia;      // em quais tempos a turma tem aula
  ambienteId: Id | null;         // ambiente padrão das aulas da turma
}
```

**Criar turma a partir de um período** é a operação central:

1. O usuário escolhe curso e período, informa nome, número de alunos, turno(s) e ambiente padrão.
2. `horarios` nasce com todos os tempos dos turnos escolhidos marcados.
3. Para cada componente do período é criada uma **oferta** (§4.3), copiando aulas e distribuição.

**Turma avulsa** (`origem: null`) não tem matriz: as ofertas são criadas à mão. Serve para
dependência, curso FIC, e para quem quer usar o gerador sem cadastrar curso nenhum.

### 4.3 Oferta

```ts
interface Oferta {
  id: Id;
  // mais de uma = turmas juntas; numa aula conjunta cada turma pode ter o seu nome da disciplina
  participacoes: { turmaId: Id; componenteId: Id | null; nome?: string }[];
  nome: string;                  // copiado do componente; editável
  aulasSemana: number;
  distribuicao: Distribuicao;
  ambienteId: Id | null;         // null = o ambiente padrão da turma
  professorIds: Id[];            // mais de um = professores em conjunto
}
```

**Cópia, não referência.** A oferta guarda os valores copiados do componente e o `componenteId`
de onde veio. Consequências:

- Alterar uma oferta ("neste semestre são 6 aulas", "vai ser no laboratório 2") não toca a matriz.
- Corrigir a matriz depois não muda em silêncio um projeto que já tem horário gerado.
- Como a origem fica guardada, a tela consegue mostrar "diferente da matriz" em cada oferta e
  oferecer "atualizar pela matriz", com a lista do que mudaria.

**Ofertas especiais** são ofertas comuns com origem diferente:

| Caso | Como fica |
| :--- | :--- |
| Disciplina da matriz, sem alteração | `componenteId` do período da turma |
| Disciplina da matriz, alterada | idem, com valores diferentes (marcada na tela) |
| Disciplina de outro período ou curso | `componenteId` de fora do período da turma |
| Disciplina que não está em matriz nenhuma | `componenteId: null` |
| Disciplina da matriz não ofertada neste período | a oferta é removida; a tela lista "não ofertadas" |

**Turmas juntas** são uma oferta com mais de uma participação. Cada turma mantém o vínculo com o
componente da própria matriz, então duas turmas de cursos diferentes podem dividir a mesma aula.
É o que hoje se faz em "Unir Disciplinas", sem cadastro à parte. Na tela: "juntar com outra turma"
numa oferta, que funde as duas se as cargas forem iguais. A aula conjunta acontece num ambiente
só (o da oferta, ou o padrão da primeira turma), que precisa comportar a soma dos alunos. Não há
divisão de turma em grupos.

### 4.4 Docente no projeto

```ts
interface DocenteNoProjeto {
  professorId: Id;
  disponibilidade: HorariosPorDia; // nasce toda marcada; o professor nunca tem aula fora dela
  evitar: HorariosPorDia;          // preferência: horários que ele pode, mas prefere não
}
```

Criado automaticamente quando o professor é atribuído a uma oferta do projeto. É específico de
cada projeto. `evitar` é guardado e conferido depois de gerar ("3 aulas em horários a evitar");
vira regra com peso quando o solver tiver custo por regra (`plano-solver-local-search.md` §3).

### 4.5 Horário gerado

```ts
interface HorarioGerado {
  revisao: number;               // a revisão do projeto em que foi gerado
  completo: boolean;
  alocacoes: {
    ofertaId: Id;
    dia: HorarioDia;
    tempo: number;
    fixada: boolean;             // para "fixar e gerar de novo"
  }[];
  problemas: { ofertaId?: Id; turmaId?: Id; dia?: HorarioDia; tempo?: number; mensagem: string }[];
}
```

Guardar por oferta (e não por célula de turma) dá de graça as visões por turma, por professor e
por ambiente: são três agrupamentos da mesma lista. Se `horario.revisao` for menor que a do
projeto, a tela avisa que o horário está desatualizado.

---

## 5. Armazenamento

```ts
interface AreaDeTrabalho {
  versao: 2;
  cadastros: Cadastros;
  projetos: ProjetoHorario[];
}
```

- Salvamento automático no `localStorage` a cada alteração. Só no navegador, por enquanto.
- Exportar e importar a área de trabalho inteira num JSON, validado com `zod`.
- Sem compatibilidade com o formato antigo: a página e os dados antigos são substituídos.

---

## 6. Do modelo para o solver

`paraSolver(projeto)` monta a entrada que o Rust lê (`EntradaHorario`), com os ids do projeto:

| Entrada do solver | Vem de |
| :--- | :--- |
| `turmas[]` | as turmas, com os horários limitados ao quadro |
| `aulas[]` | uma por oferta com aulas: turmas que participam, aulas por semana, bloco e emendar |
| `aulas[].recursos` | os professores da oferta e, se disputado, o ambiente |
| `recursos[]` | um por docente (disponibilidade e horários a evitar) e um por ambiente disputado |

- **Ambiente é um recurso de ocupação única**, igual a um professor: duas aulas não caem nele ao
  mesmo tempo. Só entram os ambientes usados por mais de uma turma (os outros não restringem).
- **`tempos[]`:** a hora de início e de fim e o turno de cada aula do quadro.
- **Regras obrigatórias e de qualidade.** A busca exata só conhece as obrigatórias. As de
  qualidade só o algoritmo genético considera, com peso menor que qualquer obrigatória: horários
  a evitar, jornada de até 10 horas no dia, 11 horas de descanso até o dia seguinte, e grupo de
  aulas partido pelo intervalo ou pela troca de turno com uma aula sozinha. As três últimas usam
  as horas do quadro. O resultado dos dois métodos traz o que não foi atendido.

**O que o solver ignora:** capacidade e número de alunos (conferidos na tela).

---

## 7. O que o modelo permite verificar na tela

Além das verificações da proposta (§3.3 de `proposta-frontend-horario.md`):

- **Capacidade:** o ambiente da oferta não comporta a turma, ou a soma das turmas juntas.
- **Ocupação do ambiente:** as aulas que usam um ambiente somam mais tempos do que ele tem na semana.
- **Sem ambiente:** oferta sem ambiente próprio numa turma sem ambiente padrão (aviso).
- **Bloco que não cabe:** bloco de N aulas maior que o maior trecho sem quebra forte nos tempos da turma.
- **Matriz:** componentes do período sem oferta na turma, e ofertas diferentes da matriz.
- **Quadro:** faixas fora de ordem ou sobrepostas.
- **Depois de gerar:** as regras de qualidade que o horário não atende (medidas pelo solver).

---

## 8. Regras futuras do solver que o modelo já sustenta

| Regra | Dado que usa |
| :--- | :--- |
| Janelas do professor medidas em minutos reais | `inicio` e `duracaoMin` das faixas |
| Máximo de aulas por dia, espalhar a disciplina na semana | campos novos em `Distribuicao` |
| Fixar aulas e gerar o resto | `alocacoes[].fixada` |

---

## 9. Decisões (15/11/2026)

| Tema | Decisão |
| :--- | :--- |
| Ambiente na matriz | Não. O curso não exige ambiente |
| Categorias de ambiente | Não. Ambiente tem só nome e capacidade |
| Ambiente da aula | A turma tem um ambiente padrão; cada oferta pode trocar |
| Duração da aula | Padrão por quadro (50 min), alterável em cada aula |
| Novo PPC | Um curso novo, com "duplicar curso" |
| Divisão de turma em grupos | Não. Juntar turmas num ambiente é possível se a capacidade comportar |
| Disponibilidade e preferências do professor | Por projeto |
| Sábado letivo | Fora do horário semanal; mesmo quadro para todos os dias |
| Armazenamento | `localStorage`, só no front end |
| Endereço | A mesma página (`/toy/gerador-horario`), substituindo a atual |
| Compatibilidade com o formato antigo | Não é necessária |
| Sigla de disciplina e de professor | Não existe: o horário mostra o nome, quebrando a linha |
| Disciplinas com o mesmo nome | Permitido, em turmas diferentes ou na mesma: a identidade é o id |
