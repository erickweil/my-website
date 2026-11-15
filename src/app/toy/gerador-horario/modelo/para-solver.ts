/**
 * Ponte entre o modelo e o solver em Rust/WASM.
 *
 * O Rust ainda lê o formulário antigo (`FormularioHorario`: disciplinas por turma, ligadas por
 * nome). Este módulo gera esse formulário a partir do projeto e traduz o resultado de volta em
 * alocações por oferta. Quando o Rust ler o modelo novo (Etapa 6 de docs/plano-frontend-horario.md)
 * os nomes internos somem e isto vira uma projeção direta.
 */

import type { FormularioHorario, ResultadoHorario } from "../horario-regras.ts";
import type { Dia, HorarioGerado, Id, Oferta, ProjetoHorario } from "./modelo.ts";
import { ambienteDaOferta, horariosCheios, limitarAoQuadro } from "./operacoes.ts";

/** Nome interno da "disciplina" do solver: uma por (oferta, turma). */
const nomeDaDisciplina = (ofertaId: Id, turmaId: Id) => `${ofertaId}|${turmaId}`;
const ofertaDoNome = (nome: string) => nome.split("|")[0];
const PREFIXO_AMBIENTE = "ambiente:";

export interface EntradaDoSolver {
    formulario: FormularioHorario;
    /** Os dias do quadro, para o worker filtrar o resultado. */
    diasAtivos: Dia[];
}

/** Só as ofertas que geram aula: com alguma aula por semana. */
const ofertasComAula = (projeto: ProjetoHorario) => projeto.ofertas.filter((o) => o.aulasSemana > 0);

/**
 * Formulário do solver para o projeto.
 *
 * - Cada turma vira uma turma do solver, com o id como nome.
 * - Cada participação de cada oferta vira uma disciplina; as de uma oferta conjunta são "unidas".
 * - Professores e ambientes viram recursos de ocupação única (os "professores" do solver). Numa
 *   oferta conjunta eles ficam ligados só à primeira participação: as participações são forçadas
 *   ao mesmo horário, e ligar o recurso a todas faria o solver ver um choque dele consigo mesmo.
 * - Só entram os ambientes disputados por mais de uma turma; os outros não restringem nada.
 */
export function paraSolver(projeto: ProjetoHorario): EntradaDoSolver {
    const ofertas = ofertasComAula(projeto);
    const primeira = (o: Oferta) => nomeDaDisciplina(o.id, o.participacoes[0].turmaId);

    const disciplinas: FormularioHorario["disciplinas"] = ofertas.flatMap((o) =>
        o.participacoes.map((p) => ({
            nome: nomeDaDisciplina(o.id, p.turmaId),
            turma: p.turmaId,
            aulas: o.aulasSemana,
            agrupar: o.distribuicao.tipo === "blocos" ? o.distribuicao.tamanho : 0,
            dividir: o.distribuicao.tipo === "blocos" && !o.distribuicao.emendar,
        })),
    );

    const disciplinas_unidas: FormularioHorario["disciplinas_unidas"] = ofertas
        .filter((o) => o.participacoes.length > 1)
        .map((o) => ({ grupo: o.id, disciplinas: o.participacoes.map((p) => nomeDaDisciplina(o.id, p.turmaId)) }));

    const professores: FormularioHorario["professores"] = projeto.docentes
        .map((d) => ({
            nome: d.professorId,
            disciplinas: ofertas.filter((o) => o.professorIds.includes(d.professorId)).map(primeira),
            horarios: limitarAoQuadro(d.disponibilidade, projeto.quadro),
        }))
        .filter((p) => p.disciplinas.length > 0);

    // Ambientes: agrupa as ofertas por ambiente e fica com os usados por mais de uma turma
    const porAmbiente = new Map<Id, Oferta[]>();
    for (const o of ofertas) {
        const ambienteId = ambienteDaOferta(projeto, o);
        if (ambienteId) porAmbiente.set(ambienteId, [...(porAmbiente.get(ambienteId) ?? []), o]);
    }
    for (const [ambienteId, usadoPor] of porAmbiente) {
        const turmas = new Set(usadoPor.flatMap((o) => o.participacoes.map((p) => p.turmaId)));
        if (turmas.size > 1) {
            professores.push({
                nome: PREFIXO_AMBIENTE + ambienteId,
                disciplinas: usadoPor.map(primeira),
                horarios: horariosCheios(projeto.quadro),
            });
        }
    }

    return {
        formulario: {
            turmas: projeto.turmas.map((t) => ({ nome: t.id, horarios: limitarAoQuadro(t.horarios, projeto.quadro) })),
            disciplinas,
            disciplinas_unidas,
            professores,
        },
        diasAtivos: [...projeto.quadro.dias],
    };
}

/**
 * Resultado do solver como horário do projeto. As aulas ficam por oferta (uma oferta conjunta
 * aparece uma vez por horário, não uma por turma); células vazias ou com violação viram problemas.
 */
export function doSolver(projeto: ProjetoHorario, resultado: ResultadoHorario): HorarioGerado {
    const alocacoes: HorarioGerado["alocacoes"] = [];
    const problemas: HorarioGerado["problemas"] = [];
    const vistas = new Set<string>();

    for (const quadroDaTurma of resultado.solucao ?? []) {
        const turmaId = quadroDaTurma.turma;
        for (const { dia, tempos } of quadroDaTurma.horario) {
            tempos.forEach(({ descricao, violacao }, i) => {
                const tempo = i + 1;
                // "???" é célula que o solver não conseguiu preencher
                const ofertaId = descricao && descricao !== "???" ? ofertaDoNome(descricao) : undefined;
                if (ofertaId) {
                    const chave = `${ofertaId}|${dia}|${tempo}`;
                    if (!vistas.has(chave)) {
                        vistas.add(chave);
                        alocacoes.push({ ofertaId, dia, tempo, fixada: false });
                    }
                }
                if (violacao) problemas.push({ mensagem: violacao, ofertaId, turmaId, dia, tempo });
            });
        }
    }
    if (resultado.mensagem && (resultado.alguma_violacao || !resultado.solucao)) {
        problemas.unshift({ mensagem: resultado.mensagem });
    }

    return {
        revisao: projeto.revisao,
        completo: resultado.solucao !== null && !resultado.alguma_violacao,
        alocacoes,
        problemas,
    };
}
