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

/**
 * Como as aulas da disciplina se dividem em pedaços (trechos de aulas seguidas num dia). O solver
 * recebe as regras correspondentes: ver modelo/divisao.ts.
 */
const divisao = z.object({
    pedacos: z.discriminatedUnion("tipo", [
        /** Qualquer divisão. */
        z.object({ tipo: z.literal("livre") }),
        z.object({
            tipo: z.literal("blocos"),
            /** Aulas seguidas por bloco (2 = aulas duplas); o que sobra vira um pedaço menor. */
            tamanho: inteiro.min(2),
            /** true = blocos podem se juntar num pedaço maior (2+2 = 4). */
            emendar: z.boolean(),
        }),
        z.object({
            tipo: z.literal("regras"),
            tamanhoMin: inteiro.min(1),
            /** null = sem limite. */
            tamanhoMax: inteiro.min(1).nullable(),
            quantidadeMin: inteiro.min(1),
            quantidadeMax: inteiro.min(1).nullable(),
            /** Quantos pedaços de um tamanho. */
            porTamanho: z.array(z.object({ tamanho: inteiro.min(1), min: inteiro.min(0), max: inteiro.min(0) })),
        }),
    ]),
    /** Preferência (regra de qualidade): no máximo um pedaço por dia. */
    espalhar: z.boolean(),
});

// ── Cadastros permanentes ────────────────────────────────────────────────────────────────────

const componente = z.object({
    id,
    nome: z.string(),
    aulasSemana: inteiro.min(0),
    /** Horas totais do PPC; só informativo. */
    cargaHoraria: z.number().min(0).optional(),
    divisao,
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
    divisao,
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

/** Uma aula num dia e tempo do horário. */
const aulaNoHorario = z.object({ ofertaId: id, dia, tempo: inteiro.min(1) });

const horarioGerado = z.object({
    /** `revisao` do projeto quando foi gerado; menor que a atual = desatualizado. */
    revisao: inteiro,
    /** true = todas as aulas alocadas e nenhum problema. */
    completo: z.boolean(),
    alocacoes: z.array(aulaNoHorario),
    /**
     * Aulas fixadas: cada uma deve ficar neste dia e tempo. Para o gerador é mais uma regra
     * obrigatória, de peso alto (rust-wasm/src/horario/horario_inicial.rs): ele pode tirá-la do lugar
     * se não achar coisa melhor, e então ela continua fixada aqui e aparece como problema.
     */
    fixadas: z.array(aulaNoHorario).default([]),
    problemas: z.array(z.object({
        mensagem: z.string(),
        ofertaId: id.optional(),
        turmaId: id.optional(),
        dia: dia.optional(),
        tempo: inteiro.optional(),
    })),
    /**
     * Num horário completo: onde ele deixa a desejar nas regras de qualidade (horários a evitar,
     * jornada e descanso do professor, grupo de aulas partido pelo intervalo, mais de um pedaço da
     * disciplina no dia). A busca local e o algoritmo genético tentam atendê-las; a busca exata as
     * ignora.
     */
    qualidade: z.array(z.object({
        regra: z.enum(["evitar", "jornada", "descanso", "intervalo", "turno", "janela", "espalhar"]),
        professorId: id.optional(),
        turmaId: id.optional(),
        ofertaId: id.optional(),
        /** O dia; no descanso, o primeiro dos dois. */
        dia,
        /** Jornada: minutos acima das 10 horas. Descanso: minutos que faltam para as 11 horas. */
        minutos: inteiro,
    })).default([]),
});

/** O que define o horário de um projeto: quadro, turmas, aulas, docentes e o horário gerado. */
const dadosDoProjeto = z.object({
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

export const SOLVERS = ["local", "pencilmark", "genetic"] as const;

/** As regras de qualidade que os solvers medem (`regra` em `horarioGerado.qualidade`). */
export const REGRAS_DE_QUALIDADE = ["evitar", "jornada", "descanso", "intervalo", "turno", "janela", "espalhar"] as const;

/** As regras obrigatórias que têm peso no custo da busca local e do genético. */
export const REGRAS_OBRIGATORIAS = ["professor", "conflito", "unidas", "agrupar", "fixa"] as const;

/**
 * O peso padrão de cada regra: o que uma violação (obrigatória) ou uma ocorrência (qualidade; na
 * jornada e no descanso, uma hora) soma ao custo. Os mesmos de `PesosFitness::PADRAO` e
 * `PesosQualidade::PADRAO` (rust-wasm/src/horario/horario_genetic.rs e horario_qualidade.rs).
 */
export const PESOS_PADRAO: Record<Regra, number> = {
    professor: 100,
    conflito: 50,
    unidas: 30,
    agrupar: 20,
    fixa: 100,
    evitar: 0.002,
    jornada: 0.004,
    descanso: 0.003,
    intervalo: 0.001,
    turno: 0.002,
    janela: 0.003,
    espalhar: 0.001,
};

/** Como gerar o horário do projeto (tela de configuração). */
const configDoProjeto = z.object({
    /** Método que a tela do horário usa. */
    solver: z.enum(SOLVERS).default("local"),
    /** Algoritmo genético: várias populações em paralelo (modelo de ilhas). */
    ilhas: z.boolean().default(true),
    /** Busca local: buscas em paralelo; 0 = automático (metade dos núcleos, até 8). */
    cadeias: inteiro.min(0).max(16).default(0),
    /**
     * O peso de cada regra no custo da busca local e do genético (0 = desligada). Regra ausente =
     * [`PESOS_PADRAO`].
     */
    pesos: z.partialRecord(z.enum([...REGRAS_OBRIGATORIAS, ...REGRAS_DE_QUALIDADE]), z.number().min(0)).default({}),
});

/**
 * Um horário salvo, com tudo o que é preciso para mostrá-lo e voltar a ele mesmo que o projeto e os
 * cadastros mudem depois: os dados do projeto naquele momento e os cadastros que ele usava.
 */
const versaoDoHorario = z.object({
    id,
    nome: z.string(),
    /** Data e hora (ISO). */
    criadaEm: z.string(),
    projeto: dadosDoProjeto,
    cadastros,
});

const projetoHorario = dadosDoProjeto.extend({
    config: configDoProjeto.prefault({}),
    /** Horários salvos, do mais antigo ao mais novo. */
    versoes: z.array(versaoDoHorario).default([]),
});

/** Versão do formato. A 2 tinha `distribuicao` no lugar de `divisao`; é convertida ao ler (armazenamento.ts). */
export const VERSAO = 3;

export const esquemaAreaDeTrabalho = z.object({
    versao: z.literal(VERSAO),
    cadastros,
    projetos: z.array(projetoHorario),
});

export type Id = string;
export type Dia = (typeof DIAS)[number];
export type Turno = (typeof TURNOS)[number];
export type HorariosPorDia = z.infer<typeof horariosPorDia>;
export type Divisao = z.infer<typeof divisao>;
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
export type AulaNoHorario = z.infer<typeof aulaNoHorario>;
export type ProjetoHorario = z.infer<typeof projetoHorario>;
export type DadosDoProjeto = z.infer<typeof dadosDoProjeto>;
export type ConfigDoProjeto = z.infer<typeof configDoProjeto>;
export type VersaoDoHorario = z.infer<typeof versaoDoHorario>;
export type RegraDeQualidade = (typeof REGRAS_DE_QUALIDADE)[number];
export type RegraObrigatoria = (typeof REGRAS_OBRIGATORIAS)[number];
export type Regra = RegraObrigatoria | RegraDeQualidade;

/** O peso de uma regra no projeto (o padrão, se não foi mexido). */
export const pesoDaRegra = (config: ConfigDoProjeto, regra: Regra) => config.pesos[regra] ?? PESOS_PADRAO[regra];
export type Solver = (typeof SOLVERS)[number];

export const configPadrao = (): ConfigDoProjeto => configDoProjeto.parse({});
export type AreaDeTrabalho = z.infer<typeof esquemaAreaDeTrabalho>;

export const areaDeTrabalhoVazia = (): AreaDeTrabalho => ({
    versao: VERSAO,
    cadastros: { cursos: [], professores: [], ambientes: [] },
    projetos: [],
});
