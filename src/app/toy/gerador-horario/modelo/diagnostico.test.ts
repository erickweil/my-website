import assert from "node:assert/strict";
import { test } from "node:test";

import { aulasAEvitar, detalharProblema, diagnosticar, observarHorario } from "./diagnostico.ts";
import { areaDeTrabalhoVazia, type Cadastros, type HorarioGerado, type ProjetoHorario } from "./modelo.ts";
import { criarOferta, criarTurmaAvulsa, gerarFaixas, juntarOfertas, manterDocentes, novoProjeto } from "./operacoes.ts";
import { projetoDaFaculdade } from "./testes/instancia-antiga.ts";

const cadastros = (): Cadastros => ({
    ...areaDeTrabalhoVazia().cadastros,
    professores: [{ id: "ana", nome: "Ana", cor: "#000000" }, { id: "bia", nome: "Bia", cor: "#ffffff" }],
    ambientes: [{ id: "lab", nome: "Lab 1", capacidade: 20 }],
});

/**
 * Projeto que fecha: segunda e terça, 4 aulas (intervalo depois da 2ª). Turma A com Cálculo
 * (4 aulas, duplas, Ana) e Física (4 aulas, Bia).
 */
function projetoQueFecha(): { p: ProjetoHorario; a: string; calculo: string; fisica: string } {
    let p = novoProjeto("teste");
    p.quadro = { dias: ["seg", "ter"], duracaoAulaMin: 50, faixas: gerarFaixas({ turno: "matutino", inicio: "07:30", aulas: 4, intervaloApos: 2, intervaloMin: 20 }) };
    const a = criarTurmaAvulsa(p, { nome: "A", alunos: 30 });
    const o1 = criarOferta(a.projeto, a.turma.id);
    const o2 = criarOferta(o1.projeto, a.turma.id);
    p = manterDocentes({
        ...o2.projeto,
        ofertas: [
            { ...o1.oferta, nome: "Cálculo", aulasSemana: 4, distribuicao: { tipo: "blocos", tamanho: 2, emendar: false }, professorIds: ["ana"] },
            { ...o2.oferta, nome: "Física", aulasSemana: 4, professorIds: ["bia"] },
        ],
    });
    return { p, a: a.turma.id, calculo: o1.oferta.id, fisica: o2.oferta.id };
}

const mensagens = (p: ProjetoHorario, c = cadastros()) => diagnosticar(p, c).map((x) => `${x.gravidade}: ${x.mensagem}`);

test("projeto que fecha não tem pendências; o quadro real também não tem erros", () => {
    assert.deepEqual(mensagens(projetoQueFecha().p), []);
    const { projeto, professores } = projetoDaFaculdade();
    const erros = diagnosticar(projeto, { ...cadastros(), professores }).filter((x) => x.gravidade === "erro");
    assert.deepEqual(erros, []);
});

test("turma: aulas que não fecham com os horários", () => {
    const { p, a, fisica } = projetoQueFecha();
    const menos = { ...p, ofertas: p.ofertas.map((o) => (o.id === fisica ? { ...o, aulasSemana: 2 } : o)) };
    assert.deepEqual(diagnosticar(menos, cadastros()), [{ gravidade: "erro", tela: "aulas", turmaId: a, mensagem: "A turma A tem 8 horários marcados e só 6 aulas: faltam 2." }]);
    const mais = { ...p, ofertas: p.ofertas.map((o) => (o.id === fisica ? { ...o, aulasSemana: 5 } : o)) };
    assert.ok(mensagens(mais).includes("erro: A turma A tem 9 aulas para 8 horários: sobra 1."));
    const semHorario = { ...p, turmas: p.turmas.map((t) => ({ ...t, horarios: {} })) };
    assert.ok(mensagens(semHorario).includes("erro: A turma A não tem nenhum horário marcado."));
});

test("disciplina: blocos que não fecham ou não cabem, e sem professor", () => {
    const { p, calculo, fisica } = projetoQueFecha();
    const impar = { ...p, ofertas: p.ofertas.map((o) => (o.id === calculo ? { ...o, aulasSemana: 3 } : o.id === fisica ? { ...o, aulasSemana: 5 } : o)) };
    assert.ok(mensagens(impar).includes("erro: Cálculo (A) tem 3 aulas, que não fecham em blocos de 2."));

    // A turma só tem a 1ª e a 3ª aula: não há duas seguidas
    const picado = { ...p, turmas: p.turmas.map((t) => ({ ...t, horarios: { seg: [1, 3], ter: [1, 3] } })) };
    assert.ok(mensagens(picado).includes("erro: Cálculo (A) pede blocos de 2 aulas seguidas, e a turma A não tem 2 horários seguidos em nenhum dia."));

    const semProf = manterDocentes({ ...p, ofertas: p.ofertas.map((o) => (o.id === fisica ? { ...o, professorIds: [] } : o)) });
    assert.deepEqual(mensagens(semProf), ["aviso: Física (A) está sem professor."]);
});

test("docente: sem horários suficientes, sem folga, e sem horário em comum com a turma", () => {
    const { p } = projetoQueFecha();
    const comAna = (disponibilidade: ProjetoHorario["docentes"][0]["disponibilidade"]) => ({
        ...p,
        docentes: p.docentes.map((d) => (d.professorId === "ana" ? { ...d, disponibilidade } : d)),
    });
    assert.ok(mensagens(comAna({ seg: [1, 2, 3] })).includes("erro: Ana tem 4 aulas e só 3 horários disponíveis."));
    assert.deepEqual(mensagens(comAna({ seg: [1, 2, 3, 4] })), ["aviso: Ana tem 4 aulas e exatamente 4 horários disponíveis: sem nenhuma folga."]);

    // Ana tem horários de sobra, mas a turma só tem aula na terça
    const soTerca = { ...comAna({ seg: [1, 2, 3, 4], ter: [1, 2] }), turmas: p.turmas.map((t) => ({ ...t, horarios: { ter: [1, 2, 3, 4] } })) };
    assert.ok(mensagens(soTerca).includes("erro: Cálculo (A) tem 4 aulas, mas só há 2 horários em que a turma e Ana podem ao mesmo tempo."));
});

test("ambiente: capacidade (somando as turmas juntas) e ocupação", () => {
    const { p, a, calculo } = projetoQueFecha();
    const noLab = { ...p, ofertas: p.ofertas.map((o) => (o.id === calculo ? { ...o, ambienteId: "lab" } : o)) };
    assert.deepEqual(mensagens(noLab), ["aviso: Cálculo (A) tem 30 alunos e Lab 1 comporta 20."]);
    const cabe = { ...noLab, turmas: noLab.turmas.map((t) => ({ ...t, alunos: 20 })) };
    assert.deepEqual(mensagens(cabe), []);

    // Com outra turma junto, a soma passa da capacidade
    const b = criarTurmaAvulsa(cabe, { nome: "B", alunos: 15 });
    const ob = criarOferta(b.projeto, b.turma.id);
    const comB = { ...ob.projeto, ofertas: ob.projeto.ofertas.map((o) => (o.id === ob.oferta.id ? { ...o, nome: "Cálculo", aulasSemana: 4, distribuicao: { tipo: "blocos" as const, tamanho: 2, emendar: false } } : o)) };
    const junta = juntarOfertas(comB, calculo, ob.oferta.id);
    assert.ok("projeto" in junta);
    assert.ok(mensagens(junta.projeto).includes("aviso: Cálculo (A + B) tem 35 alunos e Lab 1 comporta 20."));

    // Sala padrão da turma com mais aulas do que a semana tem
    const lotado = { ...p, turmas: p.turmas.map((t) => (t.id === a ? { ...t, ambienteId: "lab", alunos: 10 } : t)), ofertas: p.ofertas.map((o) => ({ ...o, aulasSemana: 8 })) };
    assert.ok(mensagens(lotado).includes("erro: Lab 1 recebe 16 aulas por semana, mas a semana só tem 8 horários."));
});

test("horário gerado: horários a evitar e quem está em choque", () => {
    const { p, calculo, fisica } = projetoQueFecha();
    const projeto = { ...p, docentes: p.docentes.map((d) => (d.professorId === "ana" ? { ...d, evitar: { seg: [1] }, disponibilidade: { seg: [1, 2, 3], ter: [1, 2, 3, 4] } } : d)) };
    const aula = (ofertaId: string, dia: "seg" | "ter", tempo: number) => ({ ofertaId, dia, tempo, fixada: false });
    const horario: HorarioGerado = {
        revisao: 0,
        completo: true,
        // Cálculo: bloco 1-2 na segunda (ok) e bloco 2-3 na terça (atravessa o intervalo)
        alocacoes: [aula(calculo, "seg", 1), aula(calculo, "seg", 2), aula(calculo, "ter", 2), aula(calculo, "ter", 3), aula(fisica, "seg", 4)],
        problemas: [],
    };
    assert.deepEqual(observarHorario(projeto, cadastros(), horario), ["Ana tem 1 aula em horários que pediu para evitar."]);
    assert.equal(aulasAEvitar(projeto, horario), 1);

    // Ana em Física no mesmo horário de uma aula dela de Cálculo, num horário em que não está disponível
    const comChoque = { ...projeto, ofertas: projeto.ofertas.map((o) => (o.id === fisica ? { ...o, professorIds: ["ana"], ambienteId: "lab" } : { ...o, ambienteId: "lab" })) };
    const h2 = { ...horario, alocacoes: [aula(calculo, "seg", 4), aula(fisica, "seg", 4)] };
    assert.deepEqual(detalharProblema(comChoque, cadastros(), h2, fisica, "seg", 4), [
        "Ana não está disponível neste horário.",
        "Ana também está em A.",
        "Lab 1 também está com A.",
    ]);
});
