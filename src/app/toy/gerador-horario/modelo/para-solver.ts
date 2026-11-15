/**
 * Ponte entre o modelo e o solver em Rust/WASM: monta a entrada do solver a partir do projeto e
 * traz o resultado de volta como horário do projeto. Os ids do projeto vão e voltam como estão.
 */

import type { EntradaDoSolver, ResultadoDoSolver } from "../horario-regras.ts";
import type { HorarioGerado, Id, Oferta, ProjetoHorario } from "./modelo.ts";
import { ambienteDaOferta, aulasDoQuadro, horariosCheios, limitarAoQuadro } from "./operacoes.ts";

/**
 * A entrada do solver para o projeto.
 *
 * - Cada oferta com aulas vira uma aula, com as turmas que participam.
 * - Os recursos de uma aula são os professores dela e, se disputado, o ambiente. Só entram os
 *   ambientes usados por mais de uma turma: os outros não restringem nada.
 * - Disponibilidades e horários limitados aos dias e tempos do quadro.
 * - As horas das aulas do quadro, para as regras de qualidade (jornada, descanso, intervalo).
 */
export function paraSolver(projeto: ProjetoHorario): EntradaDoSolver {
    const ofertas = projeto.ofertas.filter((o) => o.aulasSemana > 0);

    // Ambientes: agrupa as ofertas por ambiente e fica com os usados por mais de uma turma
    const porAmbiente = new Map<Id, Oferta[]>();
    for (const o of ofertas) {
        const ambienteId = ambienteDaOferta(projeto, o);
        if (ambienteId) porAmbiente.set(ambienteId, [...(porAmbiente.get(ambienteId) ?? []), o]);
    }
    const disputados = new Set(
        [...porAmbiente].filter(([, usadoPor]) => new Set(usadoPor.flatMap((o) => o.participacoes.map((p) => p.turmaId))).size > 1).map(([id]) => id),
    );
    const ambienteDisputado = (o: Oferta) => {
        const id = ambienteDaOferta(projeto, o);
        return id && disputados.has(id) ? [id] : [];
    };

    const comAula = new Set(ofertas.flatMap((o) => o.professorIds));
    return {
        turmas: projeto.turmas.map((t) => ({ id: t.id, horarios: limitarAoQuadro(t.horarios, projeto.quadro) })),
        aulas: ofertas.map((o) => ({
            id: o.id,
            turmas: o.participacoes.map((p) => p.turmaId),
            recursos: [...o.professorIds, ...ambienteDisputado(o)],
            aulasSemana: o.aulasSemana,
            bloco: o.distribuicao.tipo === "blocos" ? o.distribuicao.tamanho : 0,
            emendar: o.distribuicao.tipo === "blocos" && o.distribuicao.emendar,
        })),
        recursos: [
            ...projeto.docentes
                .filter((d) => comAula.has(d.professorId))
                .map((d) => ({
                    id: d.professorId,
                    ambiente: false,
                    disponibilidade: limitarAoQuadro(d.disponibilidade, projeto.quadro),
                    evitar: limitarAoQuadro(d.evitar, projeto.quadro),
                })),
            ...[...disputados].map((id) => ({ id, ambiente: true, disponibilidade: horariosCheios(projeto.quadro), evitar: {} })),
        ],
        tempos: aulasDoQuadro(projeto.quadro).map((f) => {
            const [h, m] = f.inicio.split(":").map(Number);
            return { inicio: h * 60 + m, fim: h * 60 + m + f.duracaoMin, turno: f.turno };
        }),
    };
}

/** Resultado do solver como horário do projeto. */
export function doSolver(projeto: ProjetoHorario, resultado: ResultadoDoSolver): HorarioGerado {
    const problemas: HorarioGerado["problemas"] = resultado.problemas.map((p) => ({
        mensagem: p.mensagem,
        ofertaId: p.aula ?? undefined,
        turmaId: p.turma,
        dia: p.dia,
        tempo: p.tempo,
    }));
    if (resultado.mensagem && (resultado.alguma_violacao || !resultado.alocacoes)) {
        problemas.unshift({ mensagem: resultado.mensagem });
    }
    return {
        revisao: projeto.revisao,
        completo: resultado.alocacoes !== null && !resultado.alguma_violacao,
        alocacoes: (resultado.alocacoes ?? []).map((a) => ({ ofertaId: a.aula, dia: a.dia, tempo: a.tempo, fixada: false })),
        problemas,
        qualidade: resultado.qualidade.map((o) => ({
            regra: o.regra,
            professorId: o.recurso ?? undefined,
            turmaId: o.turma ?? undefined,
            ofertaId: o.aula ?? undefined,
            dia: o.dia,
            minutos: o.minutos,
        })),
    };
}
