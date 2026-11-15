/**
 * Modelo de dados do gerador de horário (v2). Ver docs/modelagem-horario.md.
 *
 * Duas partes: os CADASTROS, permanentes (cursos com a matriz curricular, professores, ambientes),
 * e os PROJETOS de horário, um por período letivo (quadro de horários, turmas, ofertas, docentes e
 * o horário gerado). Tudo se referencia por id; nomes são só rótulos.
 *
 * Os tipos saem do esquema zod, que também valida o que vem do localStorage e de arquivos.
 */

import { z } from "zod";

export const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
export const TURNOS = ["matutino", "vespertino", "noturno"] as const;

/** Duração padrão de uma aula, em minutos. */
export const DURACAO_AULA_PADRAO = 50;

const id = z.string().min(1);
const dia = z.enum(DIAS);
const turno = z.enum(TURNOS);
/** "HH:MM", 24 horas. */
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora no formato HH:MM");
const inteiro = z.number().int();

/**
 * Tempos marcados em cada dia. O tempo é o número da aula no quadro, a partir de 1 (intervalo não
 * conta). É o mesmo formato que o solver recebe.
 */
const horariosPorDia = z.partialRecord(dia, z.array(inteiro.min(1)));

/** Como as aulas da disciplina se dispõem na semana. */
const distribuicao = z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("livre") }),
    z.object({
        tipo: z.literal("blocos"),
        /** Aulas consecutivas por bloco (2 = aulas duplas). */
        tamanho: inteiro.min(2),
        /** true = dois blocos podem ficar encostados no mesmo dia (bloco com múltiplo do tamanho). */
        emendar: z.boolean(),
    }),
]);

// ── Cadastros permanentes ────────────────────────────────────────────────────────────────────

const componente = z.object({
    id,
    nome: z.string(),
    aulasSemana: inteiro.min(0),
    /** Horas totais do PPC; só informativo. */
    cargaHoraria: z.number().min(0).optional(),
    distribuicao,
});

const periodo = z.object({
    id,
    /** 1, 2, 3… ("1º ano" ou "1º semestre", conforme o regime do curso). */
    numero: inteiro.min(1),
    componentes: z.array(componente),
});

/** Um curso é uma matriz curricular: cada PPC novo é um curso novo (ver `duplicarCurso`). */
const curso = z.object({
    id,
    nome: z.string(),
    nivel: z.enum(["integrado", "subsequente", "superior", "outro"]),
    regime: z.enum(["anual", "semestral"]),
    periodos: z.array(periodo),
});

const professor = z.object({
    id,
    nome: z.string(),
    /** Cor das aulas dele no horário, "#rrggbb". */
    cor: z.string(),
});

const ambiente = z.object({
    id,
    nome: z.string(),
    capacidade: inteiro.min(0),
});

const cadastros = z.object({
    cursos: z.array(curso),
    professores: z.array(professor),
    ambientes: z.array(ambiente),
});

// ── Projeto de horário ───────────────────────────────────────────────────────────────────────

const faixa = z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("aula"), id, inicio: hora, duracaoMin: inteiro.min(1), turno }),
    z.object({ tipo: z.literal("intervalo"), id, nome: z.string(), inicio: hora, duracaoMin: inteiro.min(1) }),
]);

const quadroHorarios = z.object({
    dias: z.array(dia),
    /** Duração usada ao criar aulas novas; cada aula guarda a sua e pode diferir. */
    duracaoAulaMin: inteiro.min(1),
    /** A sequência do dia, em ordem. O mesmo quadro vale para todos os dias. */
    faixas: z.array(faixa),
});

const turma = z.object({
    id,
    nome: z.string(),
    /** De qual período de qual curso a turma é; null = turma avulsa, sem matriz. */
    origem: z.object({ cursoId: id, periodoId: id }).nullable(),
    alunos: inteiro.min(0),
    /** Em quais tempos a turma tem aula. */
    horarios: horariosPorDia,
    /** Ambiente padrão das aulas da turma. */
    ambienteId: id.nullable(),
});

/**
 * Uma disciplina sendo dada no projeto. Nasce como CÓPIA de um componente da matriz e pode ser
 * alterada sem tocar a matriz; `componenteId` guarda de onde veio.
 */
const oferta = z.object({
    id,
    /**
     * Mais de uma participação = turmas juntas na mesma aula. Numa aula conjunta cada turma pode
     * chamar a disciplina pelo seu nome (`nome`); sem ele vale o nome da oferta.
     */
    participacoes: z.array(z.object({ turmaId: id, componenteId: id.nullable(), nome: z.string().optional() })).min(1),
    nome: z.string(),
    aulasSemana: inteiro.min(0),
    distribuicao,
    /** null = o ambiente padrão da turma (da primeira, se houver várias). */
    ambienteId: id.nullable(),
    /** Mais de um = professores em conjunto. */
    professorIds: z.array(id),
});

/** O que é do professor NESTE projeto. */
const docenteNoProjeto = z.object({
    professorId: id,
    /** O professor nunca tem aula fora destes tempos. */
    disponibilidade: horariosPorDia,
    /** Preferência: tempos em que ele pode, mas prefere não ter aula. */
    evitar: horariosPorDia,
});

const horarioGerado = z.object({
    /** `revisao` do projeto quando foi gerado; menor que a atual = desatualizado. */
    revisao: inteiro,
    /** true = todas as aulas alocadas e nenhum problema. */
    completo: z.boolean(),
    alocacoes: z.array(z.object({ ofertaId: id, dia, tempo: inteiro.min(1), fixada: z.boolean() })),
    problemas: z.array(z.object({
        mensagem: z.string(),
        ofertaId: id.optional(),
        turmaId: id.optional(),
        dia: dia.optional(),
        tempo: inteiro.optional(),
    })),
});

const projetoHorario = z.object({
    id,
    /** Ex.: "2027/1". */
    nome: z.string(),
    quadro: quadroHorarios,
    turmas: z.array(turma),
    ofertas: z.array(oferta),
    docentes: z.array(docenteNoProjeto),
    horario: horarioGerado.nullable(),
    /** Sobe a cada edição dos dados que afetam o horário. */
    revisao: inteiro,
});

export const esquemaAreaDeTrabalho = z.object({
    versao: z.literal(2),
    cadastros,
    projetos: z.array(projetoHorario),
});

export type Id = string;
export type Dia = (typeof DIAS)[number];
export type Turno = (typeof TURNOS)[number];
export type HorariosPorDia = z.infer<typeof horariosPorDia>;
export type Distribuicao = z.infer<typeof distribuicao>;
export type Componente = z.infer<typeof componente>;
export type Periodo = z.infer<typeof periodo>;
export type Curso = z.infer<typeof curso>;
export type Professor = z.infer<typeof professor>;
export type Ambiente = z.infer<typeof ambiente>;
export type Cadastros = z.infer<typeof cadastros>;
export type Faixa = z.infer<typeof faixa>;
export type FaixaAula = Extract<Faixa, { tipo: "aula" }>;
export type QuadroHorarios = z.infer<typeof quadroHorarios>;
export type Turma = z.infer<typeof turma>;
export type Oferta = z.infer<typeof oferta>;
export type DocenteNoProjeto = z.infer<typeof docenteNoProjeto>;
export type HorarioGerado = z.infer<typeof horarioGerado>;
export type ProjetoHorario = z.infer<typeof projetoHorario>;
export type AreaDeTrabalho = z.infer<typeof esquemaAreaDeTrabalho>;

export const areaDeTrabalhoVazia = (): AreaDeTrabalho => ({
    versao: 2,
    cadastros: { cursos: [], professores: [], ambientes: [] },
    projetos: [],
});
