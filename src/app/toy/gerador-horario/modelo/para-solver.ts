/**
 * Ponte entre o modelo e o solver em Rust/WASM: monta a entrada do solver a partir do projeto e
 * traz o resultado de volta como horário do projeto. Os ids do projeto vão e voltam como estão.
 */

import type { EntradaDoSolver, ResultadoDoSolver } from "../horario-regras.ts";
import { REGRAS_DE_QUALIDADE, REGRAS_OBRIGATORIAS, pesoDaRegra, type AulaNoHorario, type Regra, type HorarioGerado, type Id, type Oferta, type ProjetoHorario } from "./modelo.ts";
import { regrasDaDivisao } from "./divisao.ts";
import { ambienteDaOferta, aulasDoQuadro, horariosCheios, limitarAoQuadro } from "./operacoes.ts";

/**
 * A entrada do solver para o projeto.
 *
 * - Cada oferta com aulas vira uma aula, com as turmas que participam e as regras da divisão dela.
 * - Os recursos de uma aula são os professores dela e, se disputado, o ambiente. Só entram os
 *   ambientes usados por mais de uma turma: os outros não restringem nada.
 * - Disponibilidades e horários limitados aos dias e tempos do quadro.
 * - As horas das aulas do quadro, para as regras de qualidade (jornada, descanso, intervalo).
 * - O horário de onde a busca parte (`inicial`, ver [`pontoDePartida`]) e o peso de cada regra,
 *   obrigatória ou de qualidade, da configuração do projeto.
 */
export function paraSolver(projeto: ProjetoHorario, inicial: AulaDePartida[] = []): EntradaDoSolver {
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
            divisao: regrasDaDivisao(o.divisao, o.aulasSemana),
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
        inicial: inicial.map((a) => ({ aula: a.ofertaId, dia: a.dia, tempo: a.tempo, fixa: a.fixada })),
        config: {
            pesos: Object.fromEntries([...REGRAS_OBRIGATORIAS, ...REGRAS_DE_QUALIDADE].map((r) => [r, pesoDaRegra(projeto.config, r)])) as Record<Regra, number>,
            ga: {
                ...(projeto.config.ilhas
                    ? { populacao: projeto.config.populacaoIlha, migracao: projeto.config.migracaoIlhas }
                    : {}),
                estagnacao: projeto.config.estagnacao,
            },
        },
    };
}

/** Uma aula do horário de onde a geração parte; `fixada`: deve ficar ali (regra obrigatória). */
export type AulaDePartida = AulaNoHorario & { fixada: boolean };

/**
 * De onde a próxima geração parte: as aulas fixadas e, se o horário está em dia com os dados do
 * projeto, as outras aulas dele (se as regras mudaram depois dele, o resto é sorteado de novo); sem
 * horário, nada (quadro sorteado). As fixadas vêm primeiro: numa célula que tem outra aula (a fixada
 * foi tirada do lugar), fica a fixada. O solver encaixa o que ainda cabe
 * (rust-wasm/src/horario/horario_inicial.rs).
 */
export function pontoDePartida(projeto: ProjetoHorario): AulaDePartida[] {
    const h = projeto.horario;
    if (!h) return [];
    const fixadas = new Set(h.fixadas.map(chaveDaAlocacao));
    const resto = h.revisao === projeto.revisao ? h.alocacoes.filter((a) => !fixadas.has(chaveDaAlocacao(a))) : [];
    return [...h.fixadas.map((a) => ({ ...a, fixada: true })), ...resto.map((a) => ({ ...a, fixada: false }))];
}

/** Chave de uma aula no horário: oferta, dia e tempo. */
export const chaveDaAlocacao = (a: { ofertaId: Id; dia: string; tempo: number }) => `${a.ofertaId}|${a.dia}|${a.tempo}`;

/**
 * Resultado do solver como horário do projeto. As fixações do horário atual continuam (das aulas
 * que ainda existem), estejam as aulas no lugar ou não.
 */
export function doSolver(projeto: ProjetoHorario, resultado: ResultadoDoSolver): HorarioGerado {
    const ofertas = new Set(projeto.ofertas.map((o) => o.id));
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
        alocacoes: (resultado.alocacoes ?? []).map((a) => ({ ofertaId: a.aula, dia: a.dia, tempo: a.tempo })),
        fixadas: (projeto.horario?.fixadas ?? []).filter((a) => ofertas.has(a.ofertaId)),
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
