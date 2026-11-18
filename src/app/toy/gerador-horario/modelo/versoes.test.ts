import assert from "node:assert/strict";
import { test } from "node:test";

import { areaDeTrabalhoVazia, type AreaDeTrabalho } from "./modelo.ts";
import { criarOferta, criarTurmaAvulsa, manterDocentes, novoProjeto, removerProfessor } from "./operacoes.ts";
import { removerVersao, restaurarVersao, salvarVersao } from "./versoes.ts";

/** Um projeto com uma turma, uma aula da Ana e um horário gerado. */
function area(): AreaDeTrabalho {
    const t = criarTurmaAvulsa(novoProjeto("2027/1"), { nome: "1A" });
    const o = criarOferta(t.projeto, t.turma.id);
    const projeto = manterDocentes({ ...o.projeto, ofertas: o.projeto.ofertas.map((x) => ({ ...x, professorIds: ["ana"] })) });
    return {
        ...areaDeTrabalhoVazia(),
        cadastros: { cursos: [], professores: [{ id: "ana", nome: "Ana", cor: "#ff0000" }, { id: "bia", nome: "Bia", cor: "#00ff00" }], ambientes: [] },
        projetos: [{
            ...projeto,
            revisao: 3,
            horario: { revisao: 3, completo: true, alocacoes: [{ ofertaId: o.oferta.id, dia: "seg", tempo: 1 }], fixadas: [{ ofertaId: o.oferta.id, dia: "seg", tempo: 1 }], problemas: [], qualidade: [] },
        }],
    };
}

test("a versão guarda os dados do projeto e só os cadastros que ele usa", () => {
    const inicial = area();
    const a = salvarVersao(inicial, inicial.projetos[0].id, "Primeira", new Date("2027-01-10T12:00:00Z"));
    const [v] = a.projetos[0].versoes;
    assert.equal(v.nome, "Primeira");
    assert.equal(v.criadaEm, "2027-01-10T12:00:00.000Z");
    assert.equal(v.projeto.horario?.alocacoes.length, 1);
    assert.deepEqual(v.cadastros.professores.map((p) => p.id), ["ana"]);
    assert.equal("versoes" in v.projeto, false);
});

test("restaurar volta os dados e o professor apagado, com o horário em dia", () => {
    const inicial = area();
    const id = inicial.projetos[0].id;
    let a = salvarVersao(inicial, id, "Boa");
    const versaoId = a.projetos[0].versoes[0].id;
    // Depois de salvar: a turma some, a Ana é apagada e o projeto muda de nome
    a = removerProfessor(a, "ana");
    a = { ...a, projetos: a.projetos.map((p) => ({ ...p, nome: "Renomeado", turmas: [], ofertas: [], horario: null, revisao: 7 })) };

    const r = restaurarVersao(a, id, versaoId);
    const p = r.projetos[0];
    assert.equal(p.nome, "Renomeado");
    assert.equal(p.turmas.length, 1);
    assert.deepEqual(p.ofertas[0].professorIds, ["ana"]);
    assert.ok(r.cadastros.professores.some((x) => x.id === "ana"));
    assert.equal(p.revisao, 8);
    assert.equal(p.horario?.revisao, 8);
    assert.equal(p.horario?.fixadas.length, 1);
    assert.equal(p.versoes.length, 1);

    assert.equal(removerVersao(r, id, versaoId).projetos[0].versoes.length, 0);
});
