/**
 * Exportar e importar um projeto de horário por vez.
 *
 * O arquivo tem o mesmo formato da área de trabalho (versão, cadastros e projetos), com um projeto
 * só e apenas os cadastros que ele usa: os professores das aulas e da disponibilidade, os
 * ambientes das turmas e das aulas e os cursos de onde vêm as turmas e as disciplinas.
 *
 * Ao importar, o projeto entra como novo (com outro nome se já existir um igual). Os cadastros do
 * arquivo que já existem aqui, pelo id ou, nos professores e ambientes, pelo nome, são reaproveitados;
 * os outros são acrescentados.
 */

import { VERSAO, type AreaDeTrabalho, type Id, type ProjetoHorario } from "./modelo.ts";
import { novoId } from "./operacoes.ts";

/** Os ids de cadastro que o projeto usa. */
function referencias(projeto: ProjetoHorario) {
    const professores = new Set<Id>(projeto.docentes.map((d) => d.professorId));
    const ambientes = new Set<Id>();
    const cursos = new Set<Id>();
    const componentes = new Set<Id>();
    for (const o of projeto.ofertas) {
        o.professorIds.forEach((id) => professores.add(id));
        if (o.ambienteId) ambientes.add(o.ambienteId);
        for (const p of o.participacoes) if (p.componenteId) componentes.add(p.componenteId);
    }
    for (const t of projeto.turmas) {
        if (t.ambienteId) ambientes.add(t.ambienteId);
        if (t.origem) cursos.add(t.origem.cursoId);
    }
    return { professores, ambientes, cursos, componentes };
}

/** O arquivo de um projeto: ele e os cadastros que usa. */
export function exportarProjeto(area: AreaDeTrabalho, projetoId: Id): AreaDeTrabalho {
    const projeto = area.projetos.find((p) => p.id === projetoId);
    if (!projeto) throw new Error(`Projeto ${projetoId} não encontrado`);
    const ref = referencias(projeto);
    const usaCurso = (c: AreaDeTrabalho["cadastros"]["cursos"][number]) =>
        ref.cursos.has(c.id) || c.periodos.some((p) => p.componentes.some((x) => ref.componentes.has(x.id)));
    return {
        versao: VERSAO,
        cadastros: {
            cursos: area.cadastros.cursos.filter(usaCurso),
            professores: area.cadastros.professores.filter((p) => ref.professores.has(p.id)),
            ambientes: area.cadastros.ambientes.filter((a) => ref.ambientes.has(a.id)),
        },
        projetos: [projeto],
    };
}

const mesmoNome = (a: string, b: string) => a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");

/** "2027/1", "2027/1 (cópia)", "2027/1 (cópia 2)"… o primeiro que não existe. */
function nomeLivre(nome: string, existentes: string[]): string {
    if (!existentes.some((n) => mesmoNome(n, nome))) return nome;
    for (let i = 1; ; i++) {
        const candidato = i === 1 ? `${nome} (cópia)` : `${nome} (cópia ${i})`;
        if (!existentes.some((n) => mesmoNome(n, candidato))) return candidato;
    }
}

/**
 * Junta à área os projetos de um arquivo (normalmente um só), cada um como projeto novo.
 * Devolve a área nova e os ids dos projetos importados.
 */
export function importarProjetos(area: AreaDeTrabalho, arquivo: AreaDeTrabalho): { area: AreaDeTrabalho; ids: Id[] } {
    let nova = area;
    const ids: Id[] = [];
    for (const projeto of arquivo.projetos) {
        const ref = referencias(projeto);
        /** Id no arquivo → id aqui, para os cadastros que já existiam com outro id. */
        const trocar = new Map<Id, Id>();
        const cadastros = { ...nova.cadastros };

        // Professores e ambientes: pelo id, senão pelo nome, senão entram como novos
        for (const tipo of ["professores", "ambientes"] as const) {
            const lista = [...cadastros[tipo]];
            for (const x of arquivo.cadastros[tipo]) {
                if (!(tipo === "professores" ? ref.professores : ref.ambientes).has(x.id)) continue;
                if (lista.some((y) => y.id === x.id)) continue;
                const igual = lista.find((y) => y.nome.trim() !== "" && mesmoNome(y.nome, x.nome));
                if (igual) trocar.set(x.id, igual.id);
                else lista.push(x as never);
            }
            cadastros[tipo] = lista as never;
        }
        // Cursos: pelo id; os que não existem entram (a matriz de um curso não se compara pelo nome)
        const cursos = [...cadastros.cursos];
        for (const c of arquivo.cadastros.cursos) {
            const usa = ref.cursos.has(c.id) || c.periodos.some((p) => p.componentes.some((x) => ref.componentes.has(x.id)));
            if (usa && !cursos.some((y) => y.id === c.id)) cursos.push(c);
        }
        cadastros.cursos = cursos;

        // O projeto ganha id novo e nome livre; os ids trocados são substituídos no JSON (são UUIDs)
        let json = JSON.stringify({ ...projeto, id: novoId(), nome: nomeLivre(projeto.nome, nova.projetos.map((p) => p.nome)) });
        for (const [de, para] of trocar) json = json.replaceAll(`"${de}"`, `"${para}"`);
        const importado = JSON.parse(json) as ProjetoHorario;

        nova = { ...nova, cadastros, projetos: [...nova.projetos, importado] };
        ids.push(importado.id);
    }
    return { area: nova, ids };
}
