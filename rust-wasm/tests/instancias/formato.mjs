// Converte uma instância do formato antigo do formulário (disciplinas por turma, professores com a
// lista de disciplinas, grupos de "unidas") para a entrada do solver: turmas, aulas e recursos,
// ligados por id (ver `EntradaHorario` em src/horario/horario_regras.rs).

import { regrasDaDivisao } from "../../../src/app/toy/gerador-horario/modelo/divisao.ts";
//
// O gerador de instâncias (gerar.mjs) ainda monta as instâncias no formato antigo, que é mais
// simples de gerar, e passa por aqui antes de gravar.

/**
 * @returns {{ entrada: object, aulaDaDisciplina: Map<string, string> }} a entrada e, para converter
 * soluções de referência, o id da aula de cada disciplina antiga.
 */
export function paraEntrada(f) {
    const grupoDe = new Map();
    for (const g of f.disciplinas_unidas ?? []) {
        for (const nome of g.disciplinas) grupoDe.set(nome, g);
    }
    const disciplina = (nome) => f.disciplinas.find((d) => d.nome === nome);

    const aulas = [];
    const aulaDaDisciplina = new Map();
    for (const d of f.disciplinas) {
        if (aulaDaDisciplina.has(d.nome)) continue; // já saiu com o grupo dela
        const grupo = grupoDe.get(d.nome);
        const nomes = grupo ? grupo.disciplinas : [d.nome];
        const id = grupo ? grupo.grupo : d.nome;
        for (const nome of nomes) aulaDaDisciplina.set(nome, id);
        const bloco = d.agrupar || 0;
        // Blocos de N (emendando, sem "dividir"), com as mesmas regras que a página manda ao solver
        const { espalhar, ...divisao } = regrasDaDivisao({ pedacos: { tipo: "blocos", tamanho: bloco, emendar: !d.dividir }, espalhar: false }, d.aulas);
        aulas.push({
            id,
            turmas: nomes.map((nome) => disciplina(nome).turma),
            recursos: f.professores.filter((p) => p.disciplinas.some((x) => nomes.includes(x))).map((p) => p.nome),
            aulasSemana: d.aulas,
            ...(bloco >= 2 ? { divisao } : {}),
        });
    }

    return {
        entrada: {
            turmas: f.turmas.map((t) => ({ id: t.nome, horarios: t.horarios })),
            aulas,
            recursos: f.professores.map((p) => ({ id: p.nome, disponibilidade: p.horarios })),
        },
        aulaDaDisciplina,
    };
}
