/**
 * Verificações do projeto, feitas só olhando os dados (sem rodar o solver).
 *
 * - `diagnosticar`: o que impede ou ameaça um horário completo, antes de gerar. Cada pendência diz
 *   em que tela se corrige.
 * - `observarHorario`: como um horário já gerado se sai nas regras de qualidade (horários a evitar,
 *   jornada, descanso, intervalo, horário vago entre aulas, disciplina em mais de um trecho no dia),
 *   que a busca local e o algoritmo genético tentam atender.
 * - `detalharProblema`: quem está em choque numa célula que o solver marcou com problema.
 */

import { DIAS, type Cadastros, type Dia, type HorarioGerado, type Id, type Oferta, type ProjetoHorario, type Turma } from "./modelo.ts";
import {
    alunosDaOferta,
    ambienteDaOferta,
    aulasDaTurma,
    aulasDoProfessor,
    componentesNaoOfertados,
    contarTempos,
    faixaSobreposta,
    limitarAoQuadro,
    nomeNaTurma,
    numeroDeTempos,
} from "./operacoes.ts";
import { divisoesAceitas, regrasDaDivisao } from "./divisao.ts";

/** Os limites das regras de qualidade (os mesmos de rust-wasm/src/horario/horario_qualidade.rs). */
export const JORNADA_MAXIMA_MIN = 10 * 60;
export const DESCANSO_MINIMO_MIN = 11 * 60;

export interface Pendencia {
    /** "erro": com isto não existe horário completo. "aviso": pode atrapalhar, ou merece conferência. */
    gravidade: "erro" | "aviso";
    mensagem: string;
    /** Onde se corrige. */
    tela: "quadro" | "turmas" | "aulas" | "docentes";
    turmaId?: Id;
    professorId?: Id;
}


const nome = (x: { nome: string } | undefined) => x?.nome || "(sem nome)";

/** Maior sequência de tempos seguidos marcados num mesmo dia. */
function maiorSequencia(turma: Turma, projeto: ProjetoHorario): number {
    let maior = 0;
    for (const tempos of Object.values(limitarAoQuadro(turma.horarios, projeto.quadro))) {
        let atual = 0;
        let anterior = -1;
        for (const t of tempos ?? []) {
            atual = t === anterior + 1 ? atual + 1 : 1;
            anterior = t;
            maior = Math.max(maior, atual);
        }
    }
    return maior;
}

/** Horários em que a aula pode acontecer: todas as turmas têm aula e todos os professores estão disponíveis. */
function horariosPossiveis(projeto: ProjetoHorario, oferta: Oferta): number {
    const listas = [
        ...oferta.participacoes.map((p) => projeto.turmas.find((t) => t.id === p.turmaId)?.horarios ?? {}),
        ...oferta.professorIds.map((id) => projeto.docentes.find((d) => d.professorId === id)?.disponibilidade ?? {}),
    ].map((h) => limitarAoQuadro(h, projeto.quadro));
    let n = 0;
    for (const dia of projeto.quadro.dias) {
        for (let t = 1; t <= numeroDeTempos(projeto.quadro); t++) {
            if (listas.every((h) => h[dia]?.includes(t))) n++;
        }
    }
    return n;
}

export function diagnosticar(projeto: ProjetoHorario, cadastros: Cadastros): Pendencia[] {
    const lista: Pendencia[] = [];
    const erro = (p: Omit<Pendencia, "gravidade">) => lista.push({ gravidade: "erro", ...p });
    const aviso = (p: Omit<Pendencia, "gravidade">) => lista.push({ gravidade: "aviso", ...p });
    const turma = (id: Id) => projeto.turmas.find((t) => t.id === id);
    const professor = (id: Id) => cadastros.professores.find((p) => p.id === id);
    /** "Cálculo (ADS 1)" */
    const rotulo = (o: Oferta) => {
        const t = o.participacoes[0].turmaId;
        return `${nomeNaTurma(o, t) || "(sem nome)"} (${o.participacoes.map((p) => nome(turma(p.turmaId))).join(" + ")})`;
    };

    // Quadro
    if (numeroDeTempos(projeto.quadro) === 0) erro({ tela: "quadro", mensagem: "O quadro de horários não tem nenhuma aula." });
    if (projeto.quadro.dias.length === 0) erro({ tela: "quadro", mensagem: "O quadro de horários não tem nenhum dia." });
    const sobreposta = faixaSobreposta(projeto.quadro);
    if (sobreposta) aviso({ tela: "quadro", mensagem: `No quadro de horários, a faixa das ${sobreposta.inicio} começa antes de a anterior terminar.` });

    // Turmas
    if (projeto.turmas.length === 0) erro({ tela: "turmas", mensagem: "O projeto não tem turmas." });
    for (const t of projeto.turmas) {
        const [aulas, tempos] = [aulasDaTurma(projeto, t.id), contarTempos(limitarAoQuadro(t.horarios, projeto.quadro))];
        if (tempos === 0) erro({ tela: "turmas", turmaId: t.id, mensagem: `A turma ${nome(t)} não tem nenhum horário marcado.` });
        // Menos aulas que horários é permitido: os que sobram ficam vagos, de preferência nas pontas do turno
        else if (aulas > tempos) erro({ tela: "aulas", turmaId: t.id, mensagem: `A turma ${nome(t)} tem ${aulas} aulas para ${tempos} horários: ${aulas - tempos === 1 ? "sobra 1" : `sobram ${aulas - tempos}`}.` });

        const faltando = componentesNaoOfertados(projeto, t, cadastros.cursos);
        if (faltando.length > 0) {
            aviso({ tela: "aulas", turmaId: t.id, mensagem: `A turma ${nome(t)} não oferta ${faltando.length === 1 ? "uma disciplina" : `${faltando.length} disciplinas`} da matriz: ${faltando.map(nome).join(", ")}.` });
        }
    }
    const nomes = projeto.turmas.map((t) => t.nome.trim());
    const repetido = nomes.find((n, i) => n !== "" && nomes.indexOf(n) !== i);
    if (repetido) aviso({ tela: "turmas", mensagem: `Há mais de uma turma chamada ${repetido}.` });

    // Disciplinas
    for (const o of projeto.ofertas) {
        if (o.aulasSemana === 0) continue;
        const turmaId = o.participacoes[0].turmaId;
        if (o.professorIds.length === 0) aviso({ tela: "aulas", turmaId, mensagem: `${rotulo(o)} está sem professor.` });

        // Divisão em pedaços: alguma divisão atende às regras, e o menor dos maiores pedaços cabe
        const divisoes = divisoesAceitas(regrasDaDivisao(o.divisao, o.aulasSemana), o.aulasSemana);
        if (divisoes.length === 0) {
            erro({ tela: "aulas", turmaId, mensagem: `${rotulo(o)} tem ${o.aulasSemana} aulas, e nenhuma divisão em pedaços atende às regras escolhidas.` });
        } else {
            const maiorPedaco = Math.min(...divisoes.map((d) => d[0]));
            for (const p of o.participacoes) {
                const t = turma(p.turmaId);
                if (t && maiorSequencia(t, projeto) < maiorPedaco) {
                    erro({ tela: "turmas", turmaId: t.id, mensagem: `${rotulo(o)} pede ${maiorPedaco} aulas seguidas, e a turma ${nome(t)} não tem ${maiorPedaco} horários seguidos em nenhum dia.` });
                }
            }
        }

        const possiveis = horariosPossiveis(projeto, o);
        if (possiveis < o.aulasSemana) {
            const quem = [o.participacoes.length > 1 ? "as turmas" : "a turma", ...(o.professorIds.length > 0 ? [o.professorIds.length > 1 ? "os professores" : nome(professor(o.professorIds[0]))] : [])].join(" e ");
            erro({ tela: o.professorIds.length > 0 ? "docentes" : "turmas", turmaId, professorId: o.professorIds[0], mensagem: `${rotulo(o)} tem ${o.aulasSemana} aulas, mas só há ${possiveis} horários em que ${quem} podem ao mesmo tempo.` });
        }
    }

    // Docentes
    for (const d of projeto.docentes) {
        const [aulas, tempos] = [aulasDoProfessor(projeto, d.professorId), contarTempos(limitarAoQuadro(d.disponibilidade, projeto.quadro))];
        const quem = nome(professor(d.professorId));
        if (aulas > tempos) erro({ tela: "docentes", professorId: d.professorId, mensagem: `${quem} tem ${aulas} aulas e só ${tempos} horários disponíveis.` });
        else if (aulas === tempos && aulas > 0) aviso({ tela: "docentes", professorId: d.professorId, mensagem: `${quem} tem ${aulas} aulas e exatamente ${tempos} horários disponíveis: sem nenhuma folga.` });
    }

    // Ambientes
    const usoDoAmbiente = new Map<Id, number>();
    for (const o of projeto.ofertas) {
        const ambiente = cadastros.ambientes.find((a) => a.id === ambienteDaOferta(projeto, o));
        if (!ambiente || o.aulasSemana === 0) continue;
        usoDoAmbiente.set(ambiente.id, (usoDoAmbiente.get(ambiente.id) ?? 0) + o.aulasSemana);
        const alunos = alunosDaOferta(projeto, o);
        if (alunos > ambiente.capacidade) {
            aviso({ tela: "aulas", turmaId: o.participacoes[0].turmaId, mensagem: `${rotulo(o)} tem ${alunos} alunos e ${nome(ambiente)} comporta ${ambiente.capacidade}.` });
        }
    }
    const temposDaSemana = projeto.quadro.dias.length * numeroDeTempos(projeto.quadro);
    for (const [id, aulas] of usoDoAmbiente) {
        if (aulas > temposDaSemana) {
            erro({ tela: "aulas", mensagem: `${nome(cadastros.ambientes.find((a) => a.id === id))} recebe ${aulas} aulas por semana, mas a semana só tem ${temposDaSemana} horários.` });
        }
    }

    return lista.sort((a, b) => Number(b.gravidade === "erro") - Number(a.gravidade === "erro"));
}

const NOME_DO_DIA: Record<Dia, string> = { dom: "domingo", seg: "segunda", ter: "terça", qua: "quarta", qui: "quinta", sex: "sexta", sab: "sábado" };

/** "8h25", "10h" */
const horas = (minutos: number) => `${Math.floor(minutos / 60)}h${minutos % 60 ? String(minutos % 60).padStart(2, "0") : ""}`;

/**
 * As regras de qualidade que o horário não atende, em frases. A medição vem do solver
 * (`horario.qualidade`); aqui só entram os nomes.
 */
export function observarHorario(projeto: ProjetoHorario, cadastros: Cadastros, horario: HorarioGerado): string[] {
    const professor = (id?: Id) => nome(cadastros.professores.find((p) => p.id === id));
    const lista: string[] = [];

    // Horários a evitar: uma frase por professor
    const aEvitar = new Map<Id, number>();
    for (const o of horario.qualidade) {
        if (o.regra === "evitar" && o.professorId) aEvitar.set(o.professorId, (aEvitar.get(o.professorId) ?? 0) + 1);
    }
    for (const [id, n] of aEvitar) lista.push(`${professor(id)} tem ${n === 1 ? "1 aula" : `${n} aulas`} em horários que pediu para evitar.`);

    for (const o of horario.qualidade) {
        const dia = NOME_DO_DIA[o.dia];
        if (o.regra === "jornada") {
            lista.push(`${professor(o.professorId)}, ${dia}: ${horas(JORNADA_MAXIMA_MIN + o.minutos)} entre o início da primeira aula e o fim da última (o limite é ${horas(JORNADA_MAXIMA_MIN)}).`);
        } else if (o.regra === "descanso") {
            const seguinte = NOME_DO_DIA[DIAS[DIAS.indexOf(o.dia) + 1] ?? o.dia];
            lista.push(`${professor(o.professorId)}: ${horas(DESCANSO_MINIMO_MIN - o.minutos)} de descanso entre a última aula de ${dia} e a primeira de ${seguinte} (o mínimo é ${horas(DESCANSO_MINIMO_MIN)}).`);
        } else if (o.regra === "intervalo" || o.regra === "turno") {
            const oferta = projeto.ofertas.find((x) => x.id === o.ofertaId);
            const turma = projeto.turmas.find((t) => t.id === o.turmaId);
            const disciplina = (oferta && turma && nomeNaTurma(oferta, turma.id)) || "(sem nome)";
            lista.push(`${disciplina} (${nome(turma)}), ${dia}: uma aula fica sozinha de um lado ${o.regra === "turno" ? "da troca de turno" : "do intervalo"}.`);
        }
    }

    // Mais de um pedaço da disciplina no dia: uma frase por disciplina, turma e dia
    const espalhar = new Map<string, { ofertaId?: Id; turmaId?: Id; dia: Dia; n: number }>();
    for (const o of horario.qualidade) {
        if (o.regra !== "espalhar") continue;
        const chave = `${o.ofertaId}|${o.turmaId}|${o.dia}`;
        const atual = espalhar.get(chave) ?? { ofertaId: o.ofertaId, turmaId: o.turmaId, dia: o.dia, n: 0 };
        espalhar.set(chave, { ...atual, n: atual.n + 1 });
    }
    for (const { ofertaId, turmaId, dia, n } of espalhar.values()) {
        const oferta = projeto.ofertas.find((x) => x.id === ofertaId);
        const turma = projeto.turmas.find((t) => t.id === turmaId);
        const disciplina = (oferta && turma && nomeNaTurma(oferta, turma.id)) || "(sem nome)";
        lista.push(`${disciplina} (${nome(turma)}), ${NOME_DO_DIA[dia]}: aulas em ${n + 1} trechos separados no mesmo dia.`);
    }

    // Horários vagos entre aulas: uma frase por turma e dia
    const janelas = new Map<string, { turmaId?: Id; dia: Dia; n: number }>();
    for (const o of horario.qualidade) {
        if (o.regra !== "janela") continue;
        const chave = `${o.turmaId}|${o.dia}`;
        const atual = janelas.get(chave) ?? { turmaId: o.turmaId, dia: o.dia, n: 0 };
        janelas.set(chave, { ...atual, n: atual.n + 1 });
    }
    for (const { turmaId, dia, n } of janelas.values()) {
        const turma = projeto.turmas.find((t) => t.id === turmaId);
        lista.push(`Turma ${nome(turma)}, ${NOME_DO_DIA[dia]}: ${n === 1 ? "1 horário vago" : `${n} horários vagos`} entre aulas do mesmo turno.`);
    }
    return [...new Set(lista)];
}

/**
 * Para uma aula num horário: quem mais está ocupado ali. Ajuda a entender uma célula que o solver
 * marcou com problema ("Prof. Ana também está em ADS 2").
 */
export function detalharProblema(projeto: ProjetoHorario, cadastros: Cadastros, horario: HorarioGerado, ofertaId: Id, dia: Dia, tempo: number): string[] {
    const oferta = projeto.ofertas.find((o) => o.id === ofertaId);
    if (!oferta) return [];
    const detalhes: string[] = [];
    const turmas = (o: Oferta) => o.participacoes.map((p) => nome(projeto.turmas.find((t) => t.id === p.turmaId))).join(" + ");
    const noMesmoHorario = horario.alocacoes
        .filter((a) => a.dia === dia && a.tempo === tempo && a.ofertaId !== ofertaId)
        .flatMap((a) => projeto.ofertas.find((o) => o.id === a.ofertaId) ?? []);

    for (const professorId of oferta.professorIds) {
        const quem = nome(cadastros.professores.find((p) => p.id === professorId));
        const docente = projeto.docentes.find((d) => d.professorId === professorId);
        if (docente && !docente.disponibilidade[dia]?.includes(tempo)) detalhes.push(`${quem} não está disponível neste horário.`);
        for (const outra of noMesmoHorario.filter((o) => o.professorIds.includes(professorId))) detalhes.push(`${quem} também está em ${turmas(outra)}.`);
    }
    const ambienteId = ambienteDaOferta(projeto, oferta);
    if (ambienteId) {
        for (const outra of noMesmoHorario.filter((o) => ambienteDaOferta(projeto, o) === ambienteId)) {
            detalhes.push(`${nome(cadastros.ambientes.find((a) => a.id === ambienteId))} também está com ${turmas(outra)}.`);
        }
    }
    return detalhes;
}
