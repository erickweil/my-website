import assert from "node:assert/strict";
import { test } from "node:test";

import { exportarProjeto, importarProjetos } from "./exportacao.ts";
import { areaDeTrabalhoVazia, type AreaDeTrabalho } from "./modelo.ts";
import { criarOferta, criarTurmaAvulsa, manterDocentes, novoProjeto } from "./operacoes.ts";

/** Área com dois professores e um ambiente, e um projeto em que só a Ana e a Sala 1 são usadas. */
function area(): AreaDeTrabalho {
    let projeto = novoProjeto("2027/1");
    const t = criarTurmaAvulsa(projeto, { nome: "1A", ambienteId: "sala1" });
    const o = criarOferta(t.projeto, t.turma.id);
    projeto = manterDocentes({ ...o.projeto, ofertas: o.projeto.ofertas.map((x) => ({ ...x, professorIds: ["ana"] })) });
    return {
        ...areaDeTrabalhoVazia(),
        cadastros: {
            cursos: [],
            professores: [
                { id: "ana", nome: "Ana", cor: "#ff0000" },
                { id: "bia", nome: "Bia", cor: "#00ff00" },
            ],
            ambientes: [{ id: "sala1", nome: "Sala 1", capacidade: 40 }, { id: "sala2", nome: "Sala 2", capacidade: 40 }],
        },
        projetos: [projeto],
    };
}

test("exportar leva o projeto e só os cadastros que ele usa", () => {
    const a = area();
    const arquivo = exportarProjeto(a, a.projetos[0].id);
    assert.equal(arquivo.projetos.length, 1);
    assert.deepEqual(arquivo.cadastros.professores.map((p) => p.id), ["ana"]);
    assert.deepEqual(arquivo.cadastros.ambientes.map((x) => x.id), ["sala1"]);
});

test("importar na mesma área cria uma cópia sem duplicar cadastros", () => {
    const a = area();
    const r = importarProjetos(a, exportarProjeto(a, a.projetos[0].id));
    assert.equal(r.area.projetos.length, 2);
    assert.equal(r.area.projetos[1].nome, "2027/1 (cópia)");
    assert.notEqual(r.area.projetos[1].id, a.projetos[0].id);
    assert.equal(r.area.cadastros.professores.length, 2);
    assert.equal(r.area.cadastros.ambientes.length, 2);
});

test("importar em outra área reaproveita professor de mesmo nome e acrescenta o que falta", () => {
    const origem = area();
    const destino: AreaDeTrabalho = {
        ...areaDeTrabalhoVazia(),
        cadastros: { cursos: [], professores: [{ id: "outra-ana", nome: " ana ", cor: "#000000" }], ambientes: [] },
    };
    const r = importarProjetos(destino, exportarProjeto(origem, origem.projetos[0].id));
    const projeto = r.area.projetos[0];
    assert.equal(projeto.nome, "2027/1");
    assert.deepEqual(r.area.cadastros.professores.map((p) => p.id), ["outra-ana"]);
    assert.deepEqual(projeto.ofertas[0].professorIds, ["outra-ana"]);
    assert.deepEqual(projeto.docentes.map((d) => d.professorId), ["outra-ana"]);
    assert.deepEqual(r.area.cadastros.ambientes.map((x) => x.id), ["sala1"]);
});
