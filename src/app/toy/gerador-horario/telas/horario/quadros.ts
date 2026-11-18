/**
 * O horário gerado como quadros dias × aulas: um por turma, por professor ou por ambiente, com o
 * que cada célula mostra (disciplina, professor, problemas, avisos de qualidade). Lógica pura, sem
 * React: a tela só desenha o que sai daqui.
 */

import { DIAS_SEMANA_MAP } from "../../horario-regras";
import type { Dia, HorarioGerado, Id, Oferta, Professor, ProjetoHorario } from "../../modelo/modelo";
import { NOME_DO_TURNO, ambienteDaOferta, aulasPorTurno, fimDaFaixa, nomeNaTurma } from "../../modelo/operacoes";

export type Visao = "turmas" | "professores" | "ambientes";

export interface Celula {
    /** Linhas da célula: a primeira em destaque. */
    linhas: string[];
    cor?: string;
    problema?: string;
    /** Para o title: disciplina, turmas, professores e ambiente de cada aula da célula. */
    detalhes?: string[];
    /** A aula chegou nesta célula na última atualização do quadro (durante a busca). */
    mudou?: boolean;
    /** A aula não tem professor (fica sem cor). */
    semProfessor?: boolean;
    /** Regras de qualidade que a aula não atende (preferências, não impedem o horário). */
    avisos?: string[];
}

/** Um quadro dias × aulas: de uma turma, de um professor ou de um ambiente. */
export interface Quadro {
    id: Id;
    titulo: string;
    /** Horários em que este quadro pode ter aula (os outros ficam apagados). */
    ativo: (dia: Dia, tempo: number) => boolean;
    celulas: Map<string, Celula>;
    /** Horário ativo sem aula conta como falha (turma) ou é só um horário livre (professor, ambiente)? */
    vazioEhFalha: boolean;
}

export const chave = (dia: Dia, tempo: number) => `${dia}|${tempo}`;
const chaveDaAlocacao = (a: { ofertaId: Id; dia: Dia; tempo: number }) => `${a.ofertaId}|${a.dia}|${a.tempo}`;

/** As alocações de `novo` que não estavam em `antes` (o que a última atualização do quadro mudou). */
export function alocacoesNovas(antes: HorarioGerado | null, novo: HorarioGerado): Set<string> {
    if (!antes) return new Set();
    const tinha = new Set(antes.alocacoes.map(chaveDaAlocacao));
    return new Set(novo.alocacoes.map(chaveDaAlocacao).filter((k) => !tinha.has(k)));
}

export function montarQuadros(
    projeto: ProjetoHorario,
    horario: HorarioGerado,
    visao: Visao,
    professor: (id: Id) => Professor | undefined,
    ambientes: { id: Id; nome: string }[],
    novas: Set<string> = new Set(),
): Quadro[] {
    const oferta = (id: Id) => projeto.ofertas.find((o) => o.id === id);
    const nomeDaTurma = (id: Id) => projeto.turmas.find((t) => t.id === id)?.nome || "(sem nome)";
    const turmasDa = (o: Oferta) => o.participacoes.map((p) => nomeDaTurma(p.turmaId)).join(" + ");
    const cor = (o: Oferta) => professor(o.professorIds[0])?.cor;
    const nomesDosProfessores = (o: Oferta) => o.professorIds.map((id) => professor(id)?.nome || "(sem nome)").join(", ");

    /**
     * As regras de qualidade que uma aula não atende. Só as que se ligam a uma aula: horário a
     * evitar do professor, aula sozinha num lado do intervalo, mais de um trecho no dia e, no
     * quadro do professor, jornada e descanso do dia.
     */
    const avisosDaAula = (o: Oferta, dia: Dia, tempo: number, turmaId?: Id, professorId?: Id): string[] => {
        const avisos: string[] = [];
        for (const id of o.professorIds) {
            if (professorId && id !== professorId) continue;
            if (projeto.docentes.find((d) => d.professorId === id)?.evitar[dia]?.includes(tempo)) {
                avisos.push(`${professor(id)?.nome || "O professor"} pediu para evitar este horário.`);
            }
        }
        for (const q of horario.qualidade) {
            if (q.dia !== dia) continue;
            const daAula = q.ofertaId === o.id && (!turmaId || !q.turmaId || q.turmaId === turmaId);
            if (daAula && (q.regra === "intervalo" || q.regra === "turno")) avisos.push(`Aula sozinha de um lado ${q.regra === "turno" ? "da troca de turno" : "do intervalo"}.`);
            if (daAula && q.regra === "espalhar") avisos.push("A disciplina está em mais de um trecho neste dia.");
            if (professorId && q.professorId === professorId && q.regra === "jornada") avisos.push("Jornada do professor acima de 10 horas neste dia.");
            if (professorId && q.professorId === professorId && q.regra === "descanso") avisos.push("Menos de 11 horas de descanso até o dia seguinte.");
        }
        return [...new Set(avisos)];
    };

    /** O que aparece ao passar o mouse numa aula: disciplina, turmas, professores, ambiente. */
    const detalhar = (o: Oferta, turmaId: Id): string => {
        const professores = o.professorIds.map((id) => professor(id)?.nome || "(sem nome)");
        const ambienteId = ambienteDaOferta(projeto, o);
        const ambiente = ambienteId ? ambientes.find((x) => x.id === ambienteId)?.nome || "(sem nome)" : null;
        return [
            nomeNaTurma(o, turmaId) || "(sem nome)",
            `${o.participacoes.length > 1 ? "Turmas" : "Turma"}: ${turmasDa(o)}`,
            `${professores.length > 1 ? "Professores" : "Professor"}: ${professores.join(", ") || "nenhum"}`,
            `Ambiente: ${ambiente ?? "nenhum"}`,
        ].join("\n");
    };

    /** Quadro de um recurso (professor ou ambiente): as aulas das ofertas que o usam. */
    const doRecurso = (id: Id, titulo: string, usa: (o: Oferta) => boolean, ativo: Quadro["ativo"], quem: string, professorId?: Id): Quadro => {
        const celulas = new Map<string, Celula>();
        for (const a of horario.alocacoes) {
            const o = oferta(a.ofertaId);
            if (!o || !usa(o)) continue;
            const k = chave(a.dia, a.tempo);
            const linhas = [nomeNaTurma(o, o.participacoes[0].turmaId) || "(sem nome)", turmasDa(o)];
            const anterior = celulas.get(k);
            const mudou = novas.has(chaveDaAlocacao(a)) || anterior?.mudou;
            const detalhes = [...(anterior?.detalhes ?? []), detalhar(o, o.participacoes[0].turmaId)];
            const avisos = [...(anterior?.avisos ?? []), ...avisosDaAula(o, a.dia, a.tempo, undefined, professorId)];
            celulas.set(k, anterior ? { ...anterior, linhas: [...anterior.linhas, ...linhas], problema: `${quem} está em duas aulas ao mesmo tempo.`, mudou, detalhes, avisos } : { linhas, cor: cor(o), mudou, detalhes, semProfessor: o.professorIds.length === 0, avisos });
        }
        return { id, titulo, ativo, celulas, vazioEhFalha: false };
    };

    if (visao === "professores") {
        return projeto.docentes
            .map((d) => {
                const nome = professor(d.professorId)?.nome || "(sem nome)";
                return doRecurso(d.professorId, nome, (o) => o.professorIds.includes(d.professorId), (dia, t) => !!d.disponibilidade[dia]?.includes(t), nome, d.professorId);
            })
            .sort((a, b) => a.titulo.localeCompare(b.titulo));
    }
    if (visao === "ambientes") {
        return ambientes
            .filter((amb) => projeto.ofertas.some((o) => ambienteDaOferta(projeto, o) === amb.id))
            .map((amb) => doRecurso(amb.id, amb.nome || "(sem nome)", (o) => ambienteDaOferta(projeto, o) === amb.id, () => true, amb.nome));
    }
    return projeto.turmas.map((turma) => {
        const celulas = new Map<string, Celula>();
        for (const a of horario.alocacoes) {
            const o = oferta(a.ofertaId);
            if (o?.participacoes.some((p) => p.turmaId === turma.id)) {
                celulas.set(chave(a.dia, a.tempo), {
                    // O professor vai na célula: dispensa a legenda de cores
                    linhas: [nomeNaTurma(o, turma.id) || "(sem nome)", nomesDosProfessores(o) || "sem professor"],
                    cor: cor(o),
                    semProfessor: o.professorIds.length === 0,
                    avisos: avisosDaAula(o, a.dia, a.tempo, turma.id),
                    mudou: novas.has(chaveDaAlocacao(a)),
                    detalhes: [detalhar(o, turma.id)],
                });
            }
        }
        for (const p of horario.problemas) {
            if (p.turmaId !== turma.id || !p.dia || !p.tempo) continue;
            const k = chave(p.dia, p.tempo);
            celulas.set(k, { ...(celulas.get(k) ?? { linhas: [] }), problema: p.mensagem });
        }
        return { id: turma.id, titulo: turma.nome || "(sem nome)", ativo: (dia, t) => !!turma.horarios[dia]?.includes(t), celulas, vazioEhFalha: true };
    });
}

/** Os quadros como CSV (separado por ponto e vírgula, que é o que as planilhas em português abrem). */
export function paraCsv(projeto: ProjetoHorario, quadros: Quadro[]): string {
    const campo = (s: string) => `"${s.replaceAll('"', '""')}"`;
    const linhas: string[] = [];
    for (const q of quadros) {
        linhas.push(campo(q.titulo));
        linhas.push(["Aula", "Início", "Fim", ...projeto.quadro.dias.map((d) => DIAS_SEMANA_MAP[d])].map(campo).join(";"));
        for (const t of aulasPorTurno(projeto.quadro)) {
            linhas.push(campo(NOME_DO_TURNO[t.turno]));
            for (const l of t.linhas) {
                if (l.tipo !== "aula") continue;
                const f = l.faixa;
                linhas.push([`${l.numero}ª`, f.inicio, fimDaFaixa(f), ...projeto.quadro.dias.map((d) => q.celulas.get(chave(d, l.tempo))?.linhas.join(" - ") ?? "")].map(campo).join(";"));
            }
        }
        linhas.push("");
    }
    return "﻿" + linhas.join("\r\n");
}
