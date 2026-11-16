/**
 * Operações sobre o modelo: funções puras, que devolvem cópias alteradas e nunca mexem no que
 * receberam. A página só chama estas funções; não monta turmas e ofertas à mão.
 */

import {
    DIAS,
    DURACAO_AULA_PADRAO,
    type AreaDeTrabalho,
    type Componente,
    type Curso,
    type Periodo,
    type Dia,
    type DocenteNoProjeto,
    type Faixa,
    type FaixaAula,
    type HorariosPorDia,
    type Id,
    type Oferta,
    type ProjetoHorario,
    type QuadroHorarios,
    type Turma,
    type Turno,
} from "./modelo.ts";

export const novoId = (): Id => crypto.randomUUID();

// ── Quadro de horários ───────────────────────────────────────────────────────────────────────

const paraMinutos = (hora: string) => {
    const [h, m] = hora.split(":").map(Number);
    return h * 60 + m;
};

const paraHora = (minutos: number) => {
    const m = ((minutos % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Hora em que a faixa termina. */
export const fimDaFaixa = (f: Faixa) => paraHora(paraMinutos(f.inicio) + f.duracaoMin);

/**
 * Faixas de um turno: `aulas` aulas seguidas a partir de `inicio`, com um intervalo opcional
 * depois da aula de número `intervaloApos`.
 */
export function gerarFaixas(op: {
    turno: Turno;
    inicio: string;
    aulas: number;
    duracaoMin?: number;
    intervaloApos?: number;
    intervaloMin?: number;
    nomeDoIntervalo?: string;
}): Faixa[] {
    const duracao = op.duracaoMin ?? DURACAO_AULA_PADRAO;
    const faixas: Faixa[] = [];
    let agora = paraMinutos(op.inicio);
    for (let n = 1; n <= op.aulas; n++) {
        faixas.push({ tipo: "aula", id: novoId(), inicio: paraHora(agora), duracaoMin: duracao, turno: op.turno });
        agora += duracao;
        if (n === op.intervaloApos && n < op.aulas && op.intervaloMin) {
            faixas.push({
                tipo: "intervalo",
                id: novoId(),
                nome: op.nomeDoIntervalo ?? "Intervalo",
                inicio: paraHora(agora),
                duracaoMin: op.intervaloMin,
            });
            agora += op.intervaloMin;
        }
    }
    return faixas;
}

/** As aulas do quadro, na ordem. O tempo de uma aula é a posição dela nesta lista, mais 1. */
export const aulasDoQuadro = (quadro: QuadroHorarios): FaixaAula[] =>
    quadro.faixas.filter((f): f is FaixaAula => f.tipo === "aula");

export const numeroDeTempos = (quadro: QuadroHorarios) => aulasDoQuadro(quadro).length;

/** Todos os tempos dos turnos dados, em todos os dias do quadro (sem `turnos`: o quadro inteiro). */
export function horariosCheios(quadro: QuadroHorarios, turnos?: Turno[]): HorariosPorDia {
    const tempos = aulasDoQuadro(quadro)
        .map((f, i) => ({ tempo: i + 1, turno: f.turno }))
        .filter((t) => !turnos || turnos.includes(t.turno))
        .map((t) => t.tempo);
    return Object.fromEntries(quadro.dias.map((d) => [d, [...tempos]]));
}

/** Deixa só os dias e tempos que existem no quadro, com os tempos em ordem e sem repetição. */
export function limitarAoQuadro(horarios: HorariosPorDia, quadro: QuadroHorarios): HorariosPorDia {
    const n = numeroDeTempos(quadro);
    const saida: HorariosPorDia = {};
    for (const d of quadro.dias) {
        const tempos = [...new Set(horarios[d] ?? [])].filter((t) => t >= 1 && t <= n).sort((a, b) => a - b);
        if (tempos.length > 0) saida[d] = tempos;
    }
    return saida;
}

export const contarTempos = (horarios: HorariosPorDia) =>
    Object.values(horarios).reduce((soma, tempos) => soma + (tempos?.length ?? 0), 0);

/**
 * Quebra entre o tempo `tempo` e o seguinte: "turno" se mudam de turno (um bloco de aulas nunca
 * deveria atravessar), "intervalo" se há um intervalo entre eles, ou null se são seguidos.
 */
export function quebraDepoisDe(quadro: QuadroHorarios, tempo: number): "turno" | "intervalo" | null {
    const aulas = aulasDoQuadro(quadro);
    const [a, b] = [aulas[tempo - 1], aulas[tempo]];
    if (!a || !b) return null;
    if (a.turno !== b.turno) return "turno";
    const [ia, ib] = [quadro.faixas.indexOf(a), quadro.faixas.indexOf(b)];
    return quadro.faixas.slice(ia + 1, ib).some((f) => f.tipo === "intervalo") ? "intervalo" : null;
}

export const ordenarFaixas = (faixas: Faixa[]): Faixa[] =>
    [...faixas].sort((a, b) => paraMinutos(a.inicio) - paraMinutos(b.inicio));

/** Turno em que uma aula começando nesta hora costuma estar. */
export const turnoDaHora = (hora: string): Turno =>
    paraMinutos(hora) < 12 * 60 ? "matutino" : paraMinutos(hora) < 18 * 60 ? "vespertino" : "noturno";

/** Primeira faixa que começa antes de a anterior terminar (o quadro deve estar em ordem). */
export function faixaSobreposta(quadro: QuadroHorarios): Faixa | null {
    for (let i = 1; i < quadro.faixas.length; i++) {
        const anterior = quadro.faixas[i - 1];
        if (paraMinutos(quadro.faixas[i].inicio) < paraMinutos(anterior.inicio) + anterior.duracaoMin) return quadro.faixas[i];
    }
    return null;
}

/**
 * Troca as faixas do quadro sem perder o que já foi marcado. O tempo é a posição da aula no
 * quadro, então incluir ou tirar uma aula renumera as seguintes: as marcações das turmas e dos
 * docentes acompanham a aula (pelo id). Aulas novas nascem sem turma e com todos os docentes
 * disponíveis. Se a numeração mudou, o horário gerado é descartado.
 */
export function trocarFaixas(projeto: ProjetoHorario, faixas: Faixa[]): ProjetoHorario {
    const antigas = aulasDoQuadro(projeto.quadro);
    const quadro = { ...projeto.quadro, faixas: ordenarFaixas(faixas) };
    const novas = aulasDoQuadro(quadro);

    const novoTempo = new Map<number, number>();
    antigas.forEach((f, i) => {
        const j = novas.findIndex((n) => n.id === f.id);
        if (j >= 0) novoTempo.set(i + 1, j + 1);
    });
    const idsAntigos = new Set(antigas.map((f) => f.id));
    const temposNovos = novas.flatMap((f, i) => (idsAntigos.has(f.id) ? [] : [i + 1]));
    const mesmaNumeracao = antigas.length === novas.length && antigas.every((f, i) => novas[i].id === f.id);
    if (mesmaNumeracao) return { ...projeto, quadro };

    const renumerar = (h: HorariosPorDia, marcarNovos: boolean): HorariosPorDia =>
        Object.fromEntries(
            quadro.dias.map((d) => [
                d,
                [...(h[d] ?? []).flatMap((t) => novoTempo.get(t) ?? []), ...(marcarNovos ? temposNovos : [])].sort((a, b) => a - b),
            ]),
        );
    return {
        ...projeto,
        quadro,
        turmas: projeto.turmas.map((t) => ({ ...t, horarios: renumerar(t.horarios, false) })),
        docentes: projeto.docentes.map((d) => ({
            ...d,
            disponibilidade: renumerar(d.disponibilidade, true),
            evitar: renumerar(d.evitar, false),
        })),
        horario: null,
    };
}

/**
 * Refaz as aulas de um turno (ver `gerarFaixas`). As aulas que já existiam no turno mantêm o id,
 * na ordem, para as marcações continuarem valendo; os intervalos de dentro do turno são refeitos.
 */
export function substituirTurno(projeto: ProjetoHorario, op: Parameters<typeof gerarFaixas>[0]): ProjetoHorario {
    const atuais = projeto.quadro.faixas;
    const doTurno = atuais.filter((f): f is FaixaAula => f.tipo === "aula" && f.turno === op.turno);
    let k = 0;
    const geradas = gerarFaixas(op).map((f) => (f.tipo === "aula" && doTurno[k] ? { ...f, id: doTurno[k++].id } : f));
    // Sai o que era do turno: as aulas dele e os intervalos entre a primeira e a última
    const [ini, fim] = [atuais.indexOf(doTurno[0]), atuais.indexOf(doTurno[doTurno.length - 1])];
    const resto = atuais.filter((f, i) => !(doTurno.length > 0 && i >= ini && i <= fim && (f.tipo === "intervalo" || f.turno === op.turno)));
    return trocarFaixas(projeto, [...resto, ...geradas]);
}

/**
 * Troca os dias do quadro. Num dia novo os docentes nascem disponíveis e as turmas sem aula;
 * o que estava marcado num dia que saiu é descartado, e o horário gerado também.
 */
export function trocarDias(projeto: ProjetoHorario, dias: Dia[]): ProjetoHorario {
    const ordenados = DIAS.filter((d) => dias.includes(d));
    const quadro = { ...projeto.quadro, dias: ordenados };
    const adicionados = ordenados.filter((d) => !projeto.quadro.dias.includes(d));
    const cheios = horariosCheios(quadro);
    const comNovos = (h: HorariosPorDia) => ({ ...h, ...Object.fromEntries(adicionados.map((d) => [d, cheios[d] ?? []])) });
    return {
        ...projeto,
        quadro,
        turmas: projeto.turmas.map((t) => ({ ...t, horarios: limitarAoQuadro(t.horarios, quadro) })),
        docentes: projeto.docentes.map((d) => ({
            ...d,
            disponibilidade: limitarAoQuadro(comNovos(d.disponibilidade), quadro),
            evitar: limitarAoQuadro(d.evitar, quadro),
        })),
        horario: null,
    };
}

export function novoProjeto(nome: string): ProjetoHorario {
    return {
        id: novoId(),
        nome,
        quadro: {
            dias: ["seg", "ter", "qua", "qui", "sex"],
            duracaoAulaMin: DURACAO_AULA_PADRAO,
            faixas: gerarFaixas({ turno: "matutino", inicio: "07:30", aulas: 5, intervaloApos: 3, intervaloMin: 20 }),
        },
        turmas: [],
        ofertas: [],
        docentes: [],
        horario: null,
        revisao: 0,
    };
}

// ── Turmas e ofertas ─────────────────────────────────────────────────────────────────────────

const ofertaDoComponente = (c: Componente, turmaId: Id): Oferta => ({
    id: novoId(),
    participacoes: [{ turmaId, componenteId: c.id }],
    nome: c.nome,
    aulasSemana: c.aulasSemana,
    distribuicao: { ...c.distribuicao },
    ambienteId: null,
    professorIds: [],
});

type DadosDaTurma = { nome: string; alunos?: number; turnos?: Turno[]; ambienteId?: Id | null };

function montarTurma(projeto: ProjetoHorario, dados: DadosDaTurma, origem: Turma["origem"]): Turma {
    return {
        id: novoId(),
        nome: dados.nome,
        origem,
        alunos: dados.alunos ?? 0,
        horarios: horariosCheios(projeto.quadro, dados.turnos),
        ambienteId: dados.ambienteId ?? null,
    };
}

/** Turma sem matriz: as ofertas são criadas à mão. */
export function criarTurmaAvulsa(projeto: ProjetoHorario, dados: DadosDaTurma): { projeto: ProjetoHorario; turma: Turma } {
    const turma = montarTurma(projeto, dados, null);
    return { projeto: { ...projeto, turmas: [...projeto.turmas, turma] }, turma };
}

/**
 * Turma de um período de um curso: já nasce com uma oferta para cada componente do período,
 * copiada da matriz.
 */
export function criarTurmaDePeriodo(
    projeto: ProjetoHorario,
    curso: Curso,
    periodoId: Id,
    dados: DadosDaTurma,
): { projeto: ProjetoHorario; turma: Turma } {
    const periodo = curso.periodos.find((p) => p.id === periodoId);
    if (!periodo) throw new Error(`O curso "${curso.nome}" não tem o período ${periodoId}`);
    const turma = montarTurma(projeto, dados, { cursoId: curso.id, periodoId });
    const ofertas = periodo.componentes.map((c) => ofertaDoComponente(c, turma.id));
    return {
        projeto: { ...projeto, turmas: [...projeto.turmas, turma], ofertas: [...projeto.ofertas, ...ofertas] },
        turma,
    };
}

/** Oferta nova numa turma: de um componente qualquer (oferta especial) ou em branco. */
export function criarOferta(projeto: ProjetoHorario, turmaId: Id, componente?: Componente): { projeto: ProjetoHorario; oferta: Oferta } {
    const oferta: Oferta = componente
        ? ofertaDoComponente(componente, turmaId)
        : {
            id: novoId(),
            participacoes: [{ turmaId, componenteId: null }],
            nome: "",
            aulasSemana: 2,
            distribuicao: { tipo: "livre" },
            ambienteId: null,
            professorIds: [],
        };
    return { projeto: { ...projeto, ofertas: [...projeto.ofertas, oferta] }, oferta };
}

/** Remove a turma e a participação dela nas ofertas; oferta que fica sem turma é removida. */
export function removerTurma(projeto: ProjetoHorario, turmaId: Id): ProjetoHorario {
    const ofertas = projeto.ofertas
        .map((o) => ({ ...o, participacoes: o.participacoes.filter((p) => p.turmaId !== turmaId) }))
        .filter((o) => o.participacoes.length > 0);
    return manterDocentes({ ...projeto, turmas: projeto.turmas.filter((t) => t.id !== turmaId), ofertas });
}

export const ofertasDaTurma = (projeto: ProjetoHorario, turmaId: Id): Oferta[] =>
    projeto.ofertas.filter((o) => o.participacoes.some((p) => p.turmaId === turmaId));

/** Aulas por semana que a turma tem nas suas ofertas; deve ser igual a `contarTempos(turma.horarios)`. */
export const aulasDaTurma = (projeto: ProjetoHorario, turmaId: Id) =>
    ofertasDaTurma(projeto, turmaId).reduce((soma, o) => soma + o.aulasSemana, 0);

const mesmaDistribuicao = (a: Oferta["distribuicao"], b: Oferta["distribuicao"]) =>
    a.tipo === "livre" || b.tipo === "livre"
        ? a.tipo === b.tipo
        : a.tamanho === b.tamanho && a.emendar === b.emendar;

/**
 * Junta duas ofertas numa só, dada às turmas das duas ao mesmo tempo. Vale a oferta `ficaId`
 * (nome, ambiente); os professores das duas são somados. Devolve o motivo, se não puder juntar.
 */
export function juntarOfertas(projeto: ProjetoHorario, ficaId: Id, saiId: Id): { projeto: ProjetoHorario } | { erro: string } {
    const fica = projeto.ofertas.find((o) => o.id === ficaId);
    const sai = projeto.ofertas.find((o) => o.id === saiId);
    if (!fica || !sai || fica === sai) return { erro: "Escolha duas ofertas diferentes." };
    if (fica.participacoes.some((a) => sai.participacoes.some((b) => a.turmaId === b.turmaId))) {
        return { erro: "As duas ofertas são da mesma turma." };
    }
    if (fica.aulasSemana !== sai.aulasSemana || !mesmaDistribuicao(fica.distribuicao, sai.distribuicao)) {
        return { erro: "Para juntar, as duas ofertas precisam ter o mesmo número de aulas e a mesma distribuição." };
    }
    // Cada turma continua chamando a disciplina pelo nome que tinha
    const comNome = (o: Oferta) => o.participacoes.map((p) => ({ ...p, nome: p.nome ?? o.nome }));
    const junta: Oferta = {
        ...fica,
        participacoes: [...comNome(fica), ...comNome(sai)],
        professorIds: [...new Set([...fica.professorIds, ...sai.professorIds])],
    };
    return {
        projeto: {
            ...projeto,
            ofertas: projeto.ofertas.filter((o) => o.id !== saiId).map((o) => (o.id === ficaId ? junta : o)),
        },
    };
}

/** Tira uma turma de uma oferta conjunta: ela ganha uma oferta própria, cópia da original. */
export function separarTurma(projeto: ProjetoHorario, ofertaId: Id, turmaId: Id): ProjetoHorario {
    const oferta = projeto.ofertas.find((o) => o.id === ofertaId);
    const participacao = oferta?.participacoes.find((p) => p.turmaId === turmaId);
    if (!oferta || !participacao || oferta.participacoes.length < 2) return projeto;
    const sozinha = (o: Oferta): Oferta =>
        o.participacoes.length > 1 ? o : { ...o, nome: o.participacoes[0].nome ?? o.nome, participacoes: [{ ...o.participacoes[0], nome: undefined }] };
    const separada = sozinha({ ...oferta, id: novoId(), participacoes: [participacao], professorIds: [...oferta.professorIds] });
    const resto = sozinha({ ...oferta, participacoes: oferta.participacoes.filter((p) => p !== participacao) });
    return { ...projeto, ofertas: projeto.ofertas.flatMap((o) => (o.id === ofertaId ? [resto, separada] : [o])) };
}

/** Nome da disciplina para uma turma (numa aula conjunta cada turma pode ter o seu). */
export const nomeNaTurma = (oferta: Oferta, turmaId: Id) =>
    oferta.participacoes.find((p) => p.turmaId === turmaId)?.nome ?? oferta.nome;

/** Renomeia a disciplina para uma turma: numa aula conjunta, só para ela. */
export const renomearNaTurma = (oferta: Oferta, turmaId: Id, nome: string): Oferta =>
    oferta.participacoes.length > 1
        ? { ...oferta, participacoes: oferta.participacoes.map((p) => (p.turmaId === turmaId ? { ...p, nome } : p)) }
        : { ...oferta, nome };

/** Em quantas turmas diferentes o professor dá aula no projeto. */
export const turmasDoProfessor = (projeto: ProjetoHorario, professorId: Id) =>
    new Set(projeto.ofertas.filter((o) => o.professorIds.includes(professorId)).flatMap((o) => o.participacoes.map((p) => p.turmaId))).size;

/** Ambiente em que a oferta acontece: o dela, ou o padrão da primeira turma. */
export function ambienteDaOferta(projeto: ProjetoHorario, oferta: Oferta): Id | null {
    if (oferta.ambienteId) return oferta.ambienteId;
    const turma = projeto.turmas.find((t) => t.id === oferta.participacoes[0]?.turmaId);
    return turma?.ambienteId ?? null;
}

/** Alunos na aula: a soma das turmas que participam. */
export const alunosDaOferta = (projeto: ProjetoHorario, oferta: Oferta) =>
    oferta.participacoes.reduce((soma, p) => soma + (projeto.turmas.find((t) => t.id === p.turmaId)?.alunos ?? 0), 0);

// ── Matriz curricular ────────────────────────────────────────────────────────────────────────

export function buscarComponente(cursos: Curso[], componenteId: Id): Componente | undefined {
    for (const curso of cursos) {
        for (const periodo of curso.periodos) {
            const c = periodo.componentes.find((x) => x.id === componenteId);
            if (c) return c;
        }
    }
    return undefined;
}

/** Campos em que a oferta difere do componente de onde veio (vazio = igual à matriz). */
export function diferencasDaMatriz(oferta: Oferta, componente: Componente): ("nome" | "aulasSemana" | "distribuicao")[] {
    const dif: ReturnType<typeof diferencasDaMatriz> = [];
    if (oferta.nome !== componente.nome) dif.push("nome");
    if (oferta.aulasSemana !== componente.aulasSemana) dif.push("aulasSemana");
    if (!mesmaDistribuicao(oferta.distribuicao, componente.distribuicao)) dif.push("distribuicao");
    return dif;
}

/** Volta a oferta aos valores da matriz (professores e ambiente ficam). */
export const atualizarPelaMatriz = (oferta: Oferta, componente: Componente): Oferta => ({
    ...oferta,
    nome: componente.nome,
    aulasSemana: componente.aulasSemana,
    distribuicao: { ...componente.distribuicao },
});

/** Componentes do período da turma que não têm oferta nela. */
export function componentesNaoOfertados(projeto: ProjetoHorario, turma: Turma, cursos: Curso[]): Componente[] {
    if (!turma.origem) return [];
    const { cursoId, periodoId } = turma.origem;
    const periodo = cursos.find((c) => c.id === cursoId)?.periodos.find((p) => p.id === periodoId);
    if (!periodo) return [];
    const ofertados = new Set(
        projeto.ofertas.flatMap((o) => o.participacoes.filter((p) => p.turmaId === turma.id).map((p) => p.componenteId)),
    );
    return periodo.componentes.filter((c) => !ofertados.has(c.id));
}

/** Cópia do curso com ids novos, para cadastrar um novo PPC a partir do anterior. */
export function duplicarCurso(curso: Curso, nome = `${curso.nome} (cópia)`): Curso {
    return {
        ...curso,
        id: novoId(),
        nome,
        periodos: curso.periodos.map((p) => ({
            ...p,
            id: novoId(),
            componentes: p.componentes.map((c) => ({ ...c, id: novoId(), distribuicao: { ...c.distribuicao } })),
        })),
    };
}

// ── Docentes do projeto ──────────────────────────────────────────────────────────────────────

/**
 * Deixa `docentes` com exatamente os professores que têm oferta no projeto: quem entrou ganha
 * disponibilidade total; quem não tem mais oferta sai.
 */
export function manterDocentes(projeto: ProjetoHorario): ProjetoHorario {
    const emUso = new Set(projeto.ofertas.flatMap((o) => o.professorIds));
    const docentes: DocenteNoProjeto[] = projeto.docentes.filter((d) => emUso.has(d.professorId));
    const presentes = new Set(docentes.map((d) => d.professorId));
    for (const professorId of emUso) {
        if (!presentes.has(professorId)) {
            docentes.push({ professorId, disponibilidade: horariosCheios(projeto.quadro), evitar: {} });
        }
    }
    return { ...projeto, docentes };
}

/** Aulas por semana do professor no projeto (uma oferta conjunta conta uma vez). */
export const aulasDoProfessor = (projeto: ProjetoHorario, professorId: Id) =>
    projeto.ofertas.filter((o) => o.professorIds.includes(professorId)).reduce((soma, o) => soma + o.aulasSemana, 0);

/** Cópia do projeto (para começar um período letivo a partir de outro), sem o horário gerado. */
export const duplicarProjeto = (projeto: ProjetoHorario, nome: string): ProjetoHorario => ({
    ...structuredClone(projeto),
    id: novoId(),
    nome,
    horario: null,
    revisao: 0,
});

/** Tira o professor do cadastro e de todas as ofertas, em todos os projetos. */
export function removerProfessor(area: AreaDeTrabalho, professorId: Id): AreaDeTrabalho {
    return {
        ...area,
        cadastros: { ...area.cadastros, professores: area.cadastros.professores.filter((p) => p.id !== professorId) },
        projetos: area.projetos.map((projeto) =>
            manterDocentes({
                ...projeto,
                ofertas: projeto.ofertas.map((o) => ({ ...o, professorIds: o.professorIds.filter((x) => x !== professorId) })),
            }),
        ),
    };
}

/** Cores para professores novos, em sequência. */
export const PALETA_CORES = [
    "#649cb1", "#f18841", "#84f8c8", "#9c9b53", "#6c76ad", "#ce74f2",
    "#179fe9", "#ec2d2d", "#2b8a27", "#f79c15", "#3339f3", "#f17cc0",
    "#a75656", "#4e958a", "#a01e6a", "#bec02b", "#589140", "#1f9e78",
];

/** Marca ou desmarca um tempo. */
export function alternarTempo(horarios: HorariosPorDia, dia: Dia, tempo: number): HorariosPorDia {
    const atuais = horarios[dia] ?? [];
    const novos = atuais.includes(tempo) ? atuais.filter((t) => t !== tempo) : [...atuais, tempo].sort((a, b) => a - b);
    return { ...horarios, [dia]: novos };
}

// ── Cadastros ────────────────────────────────────────────────────────────────────────────────

/** "1º ano" ou "1º semestre", conforme o regime do curso. */
export const nomeDoPeriodo = (curso: Curso, periodo: Periodo) => `${periodo.numero}º ${curso.regime === "anual" ? "ano" : "semestre"}`;

export const novoCurso = (nome: string): Curso => ({
    id: novoId(),
    nome,
    nivel: "superior",
    regime: "semestral",
    periodos: [{ id: novoId(), numero: 1, componentes: [] }],
});

export const novoComponente = (): Componente => ({ id: novoId(), nome: "", aulasSemana: 2, distribuicao: { tipo: "livre" } });

/** Acrescenta ao curso o período seguinte ao último. */
export const adicionarPeriodo = (curso: Curso): Curso => ({
    ...curso,
    periodos: [...curso.periodos, { id: novoId(), numero: Math.max(0, ...curso.periodos.map((p) => p.numero)) + 1, componentes: [] }],
});

/** Tira o curso do cadastro. As turmas que vinham dele continuam existindo, como turmas avulsas. */
export function removerCurso(area: AreaDeTrabalho, cursoId: Id): AreaDeTrabalho {
    return {
        ...area,
        cadastros: { ...area.cadastros, cursos: area.cadastros.cursos.filter((c) => c.id !== cursoId) },
        projetos: area.projetos.map((p) => ({
            ...p,
            turmas: p.turmas.map((t) => (t.origem?.cursoId === cursoId ? { ...t, origem: null } : t)),
        })),
    };
}

/** Tira o ambiente do cadastro, das turmas e das ofertas que o usavam. */
export function removerAmbiente(area: AreaDeTrabalho, ambienteId: Id): AreaDeTrabalho {
    return {
        ...area,
        cadastros: { ...area.cadastros, ambientes: area.cadastros.ambientes.filter((a) => a.id !== ambienteId) },
        projetos: area.projetos.map((p) => ({
            ...p,
            turmas: p.turmas.map((t) => (t.ambienteId === ambienteId ? { ...t, ambienteId: null } : t)),
            ofertas: p.ofertas.map((o) => (o.ambienteId === ambienteId ? { ...o, ambienteId: null } : o)),
            revisao: p.revisao + 1,
        })),
    };
}

/** Os turnos que têm aula no quadro, na ordem do dia. */
export const turnosDoQuadro = (quadro: QuadroHorarios): Turno[] => [...new Set(aulasDoQuadro(quadro).map((f) => f.turno))];
