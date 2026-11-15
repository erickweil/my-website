/**
 * Verificações do projeto, feitas só olhando os dados (sem rodar o solver).
 *
 * - `diagnosticar`: o que impede ou ameaça um horário completo, antes de gerar. Cada pendência diz
 *   em que tela se corrige.
 * - `observarHorario`: como um horário já gerado se sai nas regras de qualidade (horários a evitar),
 *   que a busca exata ignora e o algoritmo genético tenta atender.
 * - `detalharProblema`: quem está em choque numa célula que o solver marcou com problema.
 */

import type { Cadastros, Dia, HorarioGerado, Id, Oferta, ProjetoHorario, Turma } from "./modelo.ts";
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
        else if (aulas < tempos) erro({ tela: "aulas", turmaId: t.id, mensagem: `A turma ${nome(t)} tem ${tempos} horários marcados e só ${aulas} aulas: ${tempos - aulas === 1 ? "falta 1" : `faltam ${tempos - aulas}`}.` });
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

        if (o.distribuicao.tipo === "blocos") {
            const { tamanho } = o.distribuicao;
            if (o.aulasSemana % tamanho !== 0) {
                erro({ tela: "aulas", turmaId, mensagem: `${rotulo(o)} tem ${o.aulasSemana} aulas, que não fecham em blocos de ${tamanho}.` });
            }
            for (const p of o.participacoes) {
                const t = turma(p.turmaId);
                if (t && maiorSequencia(t, projeto) < tamanho) {
                    erro({ tela: "turmas", turmaId: t.id, mensagem: `${rotulo(o)} pede blocos de ${tamanho} aulas seguidas, e a turma ${nome(t)} não tem ${tamanho} horários seguidos em nenhum dia.` });
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

/** Aulas em horário que algum professor pediu para evitar (uma por professor da aula). */
export function aulasAEvitar(projeto: ProjetoHorario, horario: HorarioGerado): number {
    let n = 0;
    for (const a of horario.alocacoes) {
        const oferta = projeto.ofertas.find((o) => o.id === a.ofertaId);
        for (const d of projeto.docentes) {
            if (oferta?.professorIds.includes(d.professorId) && d.evitar[a.dia]?.includes(a.tempo) && d.disponibilidade[a.dia]?.includes(a.tempo)) n++;
        }
    }
    return n;
}

/** Como o horário se sai nas regras de qualidade: quem ficou com aula em horário a evitar. */
export function observarHorario(projeto: ProjetoHorario, cadastros: Cadastros, horario: HorarioGerado): string[] {
    const lista: string[] = [];
    const oferta = (id: Id) => projeto.ofertas.find((o) => o.id === id);

    // Aulas em horário que o professor pediu para evitar
    for (const d of projeto.docentes) {
        const n = horario.alocacoes.filter(
            (a) => d.evitar[a.dia]?.includes(a.tempo) && d.disponibilidade[a.dia]?.includes(a.tempo) && oferta(a.ofertaId)?.professorIds.includes(d.professorId),
        ).length;
        if (n > 0) lista.push(`${nome(cadastros.professores.find((p) => p.id === d.professorId))} tem ${n === 1 ? "1 aula" : `${n} aulas`} em horários que pediu para evitar.`);
    }

    return lista;
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
