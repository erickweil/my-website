import assert from "node:assert/strict";
import { test } from "node:test";

import { carregar, lerAreaDeTrabalho, salvar } from "./armazenamento.ts";
import { areaDeTrabalhoVazia, type Curso, type ProjetoHorario } from "./modelo.ts";
import {
    alunosDaOferta,
    ambienteDaOferta,
    aulasDaTurma,
    componentesNaoOfertados,
    contarTempos,
    criarOferta,
    criarTurmaAvulsa,
    criarTurmaDePeriodo,
    diferencasDaMatriz,
    duplicarCurso,
    fimDaFaixa,
    gerarFaixas,
    horariosCheios,
    juntarOfertas,
    manterDocentes,
    novoProjeto,
    numeroDeTempos,
    ofertasDaTurma,
    quebraDepoisDe,
    removerTurma,
    separarTurma,
    substituirTurno,
    trocarDias,
    trocarFaixas,
} from "./operacoes.ts";
import { doSolver, paraSolver } from "./para-solver.ts";
import { lerInstanciaAntiga, projetoDaInstanciaAntiga } from "./testes/instancia-antiga.ts";

const curso = (): Curso => ({
    id: "ads",
    nome: "Análise e Desenvolvimento de Sistemas",
    sigla: "ADS",
    nivel: "superior",
    regime: "semestral",
    periodos: [
        {
            id: "ads-1",
            numero: 1,
            componentes: [
                { id: "alg", nome: "Algoritmos", sigla: "ALG", aulasSemana: 4, distribuicao: { tipo: "blocos", tamanho: 2, emendar: false } },
                { id: "mat", nome: "Matemática", sigla: "MAT", aulasSemana: 2, distribuicao: { tipo: "livre" } },
            ],
        },
        { id: "ads-2", numero: 2, componentes: [{ id: "bd", nome: "Banco de Dados", sigla: "BD", aulasSemana: 4, distribuicao: { tipo: "livre" } }] },
    ],
});

/** Projeto com dois turnos: 3 aulas de manhã (intervalo depois da 2ª) e 2 à noite, de 45 min. */
const projetoDoisTurnos = (): ProjetoHorario => {
    const p = novoProjeto("2027/1");
    p.quadro.faixas = [
        ...gerarFaixas({ turno: "matutino", inicio: "07:30", aulas: 3, intervaloApos: 2, intervaloMin: 20 }),
        ...gerarFaixas({ turno: "noturno", inicio: "19:00", aulas: 2, duracaoMin: 45 }),
    ];
    return p;
};

test("quadro: horas, duração por aula e quebras", () => {
    const p = projetoDoisTurnos();
    assert.deepEqual(p.quadro.faixas.map((f) => `${f.tipo} ${f.inicio}-${fimDaFaixa(f)}`), [
        "aula 07:30-08:20",
        "aula 08:20-09:10",
        "intervalo 09:10-09:30",
        "aula 09:30-10:20",
        "aula 19:00-19:45",
        "aula 19:45-20:30",
    ]);
    assert.equal(numeroDeTempos(p.quadro), 5, "intervalo não é tempo");
    assert.equal(quebraDepoisDe(p.quadro, 1), null);
    assert.equal(quebraDepoisDe(p.quadro, 2), "intervalo");
    assert.equal(quebraDepoisDe(p.quadro, 3), "turno");
    assert.equal(quebraDepoisDe(p.quadro, 5), null, "depois do último tempo não há quebra");
    assert.deepEqual(horariosCheios(p.quadro, ["noturno"]).seg, [4, 5]);
});

test("turma de um período nasce com as ofertas da matriz, que são cópias", () => {
    const c = curso();
    const r = criarTurmaDePeriodo(projetoDoisTurnos(), c, "ads-1", { nome: "ADS 1", alunos: 35, turnos: ["matutino"] });
    assert.deepEqual(r.turma.origem, { cursoId: "ads", periodoId: "ads-1" });
    assert.equal(contarTempos(r.turma.horarios), 15, "3 tempos da manhã em 5 dias");

    const ofertas = ofertasDaTurma(r.projeto, r.turma.id);
    assert.deepEqual(ofertas.map((o) => [o.sigla, o.aulasSemana, o.participacoes[0].componenteId]), [["ALG", 4, "alg"], ["MAT", 2, "mat"]]);
    assert.equal(aulasDaTurma(r.projeto, r.turma.id), 6);

    // Alterar a oferta não toca a matriz, e a diferença aparece
    const alg = c.periodos[0].componentes[0];
    const alterada = { ...ofertas[0], aulasSemana: 6 };
    assert.deepEqual(diferencasDaMatriz(alterada, alg), ["aulasSemana"]);
    assert.deepEqual(diferencasDaMatriz(ofertas[0], alg), []);
    assert.equal(alg.aulasSemana, 4);

    // Tirar uma oferta da turma: o componente aparece como não ofertado
    const semMat = { ...r.projeto, ofertas: r.projeto.ofertas.filter((o) => o.sigla !== "MAT") };
    assert.deepEqual(componentesNaoOfertados(semMat, r.turma, [c]).map((x) => x.id), ["mat"]);

    assert.throws(() => criarTurmaDePeriodo(r.projeto, c, "nao-existe", { nome: "X" }));
});

test("oferta especial: componente de outro período na turma", () => {
    const c = curso();
    const r = criarTurmaDePeriodo(projetoDoisTurnos(), c, "ads-1", { nome: "ADS 1" });
    const bd = c.periodos[1].componentes[0];
    const { projeto, oferta } = criarOferta(r.projeto, r.turma.id, bd);
    assert.equal(oferta.participacoes[0].componenteId, "bd");
    assert.equal(ofertasDaTurma(projeto, r.turma.id).length, 3);
    assert.deepEqual(componentesNaoOfertados(projeto, r.turma, [c]), [], "o que é de fora do período não conta como faltando");
});

test("duplicar curso dá ids novos e mantém o conteúdo", () => {
    const c = curso();
    const copia = duplicarCurso(c, "ADS — matriz 2028");
    assert.equal(copia.nome, "ADS — matriz 2028");
    assert.notEqual(copia.id, c.id);
    assert.notEqual(copia.periodos[0].componentes[0].id, "alg");
    assert.deepEqual(copia.periodos.map((p) => p.componentes.map((x) => x.sigla)), [["ALG", "MAT"], ["BD"]]);
    copia.periodos[0].componentes[0].distribuicao = { tipo: "livre" };
    assert.equal(c.periodos[0].componentes[0].distribuicao.tipo, "blocos", "a cópia não divide objetos com o original");
});

test("juntar, separar e remover turma", () => {
    let p = projetoDoisTurnos();
    const a = criarTurmaAvulsa(p, { nome: "A", alunos: 20, ambienteId: "sala-a" });
    const b = criarTurmaAvulsa(a.projeto, { nome: "B", alunos: 25, ambienteId: "sala-b" });
    const oa = criarOferta(b.projeto, a.turma.id);
    const ob = criarOferta(oa.projeto, b.turma.id);
    p = ob.projeto;
    p.ofertas = p.ofertas.map((o) => ({ ...o, professorIds: [o.id === oa.oferta.id ? "p1" : "p2"] }));

    const junta = juntarOfertas(p, oa.oferta.id, ob.oferta.id);
    assert.ok("projeto" in junta);
    const [conjunta] = junta.projeto.ofertas;
    assert.equal(junta.projeto.ofertas.length, 1);
    assert.deepEqual(conjunta.participacoes.map((x) => x.turmaId), [a.turma.id, b.turma.id]);
    assert.deepEqual(conjunta.professorIds, ["p1", "p2"]);
    assert.equal(alunosDaOferta(junta.projeto, conjunta), 45, "a aula conjunta soma os alunos");
    assert.equal(ambienteDaOferta(junta.projeto, conjunta), "sala-a", "sem ambiente próprio vale o da primeira turma");
    assert.equal(ambienteDaOferta(junta.projeto, { ...conjunta, ambienteId: "auditorio" }), "auditorio");

    // Cargas diferentes ou mesma turma: não junta, e diz por quê
    const outra = criarOferta(p, a.turma.id);
    assert.ok("erro" in juntarOfertas(outra.projeto, oa.oferta.id, outra.oferta.id));
    const maior = { ...p, ofertas: p.ofertas.map((o) => (o.id === ob.oferta.id ? { ...o, aulasSemana: 4 } : o)) };
    assert.ok("erro" in juntarOfertas(maior, oa.oferta.id, ob.oferta.id));

    const separado = separarTurma(junta.projeto, conjunta.id, b.turma.id);
    assert.deepEqual(separado.ofertas.map((o) => o.participacoes.map((x) => x.turmaId)), [[a.turma.id], [b.turma.id]]);

    // Remover a turma A: a oferta conjunta fica só com B; a oferta só de A some, e o docente dela também
    const semA = removerTurma(manterDocentes(junta.projeto), a.turma.id);
    assert.deepEqual(semA.ofertas[0].participacoes.map((x) => x.turmaId), [b.turma.id]);
    const soA = removerTurma(manterDocentes(p), a.turma.id);
    assert.deepEqual(soA.docentes.map((d) => d.professorId), ["p2"]);
});

test("docentes do projeto acompanham as ofertas e nascem disponíveis", () => {
    let p = projetoDoisTurnos();
    const t = criarTurmaAvulsa(p, { nome: "A" });
    const o = criarOferta(t.projeto, t.turma.id);
    p = manterDocentes({ ...o.projeto, ofertas: [{ ...o.oferta, professorIds: ["p1"] }] });
    assert.equal(p.docentes.length, 1);
    assert.equal(contarTempos(p.docentes[0].disponibilidade), 25);

    // Quem já estava mantém o que marcou
    p.docentes[0].disponibilidade = { seg: [1] };
    p = manterDocentes({ ...p, ofertas: [{ ...p.ofertas[0], professorIds: ["p1", "p2"] }] });
    assert.deepEqual(p.docentes.map((d) => contarTempos(d.disponibilidade)), [1, 25]);
});

test("paraSolver: oferta conjunta vira disciplinas unidas, com os recursos só na primeira", () => {
    let p = projetoDoisTurnos();
    const a = criarTurmaAvulsa(p, { nome: "A", ambienteId: "sala-a" });
    const b = criarTurmaAvulsa(a.projeto, { nome: "B", ambienteId: "sala-b" });
    const oa = criarOferta(b.projeto, a.turma.id);
    const ob = criarOferta(oa.projeto, b.turma.id);
    const lab = criarOferta(ob.projeto, b.turma.id);
    p = lab.projeto;
    p.ofertas = p.ofertas.map((o) => ({
        ...o,
        professorIds: ["p1"],
        distribuicao: o.id === lab.oferta.id ? { tipo: "blocos", tamanho: 2, emendar: true } : o.distribuicao,
        // A oferta de laboratório da turma B usa a sala da turma A
        ambienteId: o.id === lab.oferta.id ? "sala-a" : null,
    }));
    const junta = juntarOfertas(p, oa.oferta.id, ob.oferta.id);
    assert.ok("projeto" in junta);
    p = manterDocentes(junta.projeto);
    p.docentes[0].disponibilidade = { seg: [1, 2, 99], dom: [1] };

    const { formulario, diasAtivos } = paraSolver(p);
    const conjunta = oa.oferta.id;
    const [dA, dB, dLab] = [`${conjunta}|${a.turma.id}`, `${conjunta}|${b.turma.id}`, `${lab.oferta.id}|${b.turma.id}`];

    assert.deepEqual(diasAtivos, ["seg", "ter", "qua", "qui", "sex"]);
    assert.deepEqual(formulario.turmas.map((t) => t.nome), [a.turma.id, b.turma.id]);
    assert.deepEqual(formulario.disciplinas, [
        { nome: dA, turma: a.turma.id, aulas: 2, agrupar: 0, dividir: false },
        { nome: dB, turma: b.turma.id, aulas: 2, agrupar: 0, dividir: false },
        { nome: dLab, turma: b.turma.id, aulas: 2, agrupar: 2, dividir: false },
    ]);
    assert.deepEqual(formulario.disciplinas_unidas, [{ grupo: conjunta, disciplinas: [dA, dB] }]);
    assert.deepEqual(formulario.professores, [
        // Disponibilidade limitada ao quadro: sem domingo e sem o tempo 99
        { nome: "p1", disciplinas: [dA, dLab], horarios: { seg: [1, 2] } },
        // "sala-a" é disputada pelas turmas A e B; "sala-b" não é usada por ninguém mais e não entra
        { nome: "ambiente:sala-a", disciplinas: [dA, dLab], horarios: horariosCheios(p.quadro) },
    ]);
});

test("paraSolver: o quadro real de faculdade dá o mesmo problema do formato antigo", () => {
    const antigo = lerInstanciaAntiga("faculdade-anonimizado");
    const { projeto } = projetoDaInstanciaAntiga(antigo);
    const { formulario } = paraSolver(projeto);

    assert.equal(formulario.turmas.length, antigo.turmas.length);
    assert.equal(formulario.disciplinas.length, antigo.disciplinas.length);
    assert.equal(formulario.disciplinas_unidas.length, 1);
    assert.equal(formulario.professores.length, antigo.professores.length, "sem ambientes, só os professores");
    const soma = (ds: { aulas: number }[]) => ds.reduce((s, d) => s + d.aulas, 0);
    assert.equal(soma(formulario.disciplinas), soma(antigo.disciplinas));
    // Toda referência por nome existe (o Rust recusa o formulário se não existir)
    const nomes = new Set(formulario.disciplinas.map((d) => d.nome));
    const turmas = new Set(formulario.turmas.map((t) => t.nome));
    assert.ok(formulario.disciplinas.every((d) => turmas.has(d.turma)));
    assert.ok(formulario.professores.every((p) => p.disciplinas.every((d) => nomes.has(d))));
    assert.ok(formulario.disciplinas_unidas.every((g) => g.disciplinas.every((d) => nomes.has(d))));
});

test("doSolver: alocações por oferta, sem repetir a conjunta, e problemas", () => {
    let p = projetoDoisTurnos();
    const a = criarTurmaAvulsa(p, { nome: "A" });
    const b = criarTurmaAvulsa(a.projeto, { nome: "B" });
    const oa = criarOferta(b.projeto, a.turma.id);
    const ob = criarOferta(oa.projeto, b.turma.id);
    const junta = juntarOfertas(ob.projeto, oa.oferta.id, ob.oferta.id);
    assert.ok("projeto" in junta);
    p = { ...junta.projeto, revisao: 7 };
    const id = oa.oferta.id;

    const celula = (descricao: string | null, violacao: string | null = null) => ({ descricao, violacao });
    const horario = doSolver(p, {
        solucao: [
            { turma: a.turma.id, horario: [{ dia: "seg", tempos: [celula(`${id}|${a.turma.id}`), celula("???", "Incompleto"), celula(null)] }] },
            { turma: b.turma.id, horario: [{ dia: "seg", tempos: [celula(`${id}|${b.turma.id}`), celula(null), celula(null)] }] },
        ],
        alguma_violacao: true,
        mensagem: "Não foi possível completar",
        iter: 1,
        depth: 0,
        terminou: true,
    });
    assert.equal(horario.revisao, 7);
    assert.equal(horario.completo, false);
    assert.deepEqual(horario.alocacoes, [{ ofertaId: id, dia: "seg", tempo: 1, fixada: false }]);
    assert.deepEqual(horario.problemas, [
        { mensagem: "Não foi possível completar" },
        { mensagem: "Incompleto", ofertaId: undefined, turmaId: a.turma.id, dia: "seg", tempo: 2 },
    ]);
});

test("armazenamento: grava, lê e recusa conteúdo inválido sem apagar", () => {
    const dados = new Map<string, string>();
    const armazem = { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => void dados.set(k, v) };

    assert.deepEqual(carregar(armazem), { ok: true, area: areaDeTrabalhoVazia() });

    const area = areaDeTrabalhoVazia();
    area.cadastros.cursos.push(curso());
    area.cadastros.ambientes.push({ id: "lab", nome: "Lab. Info 1", capacidade: 20 });
    area.projetos.push(criarTurmaDePeriodo(projetoDoisTurnos(), curso(), "ads-1", { nome: "ADS 1", alunos: 30 }).projeto);
    salvar(armazem, area);
    assert.deepEqual(carregar(armazem), { ok: true, area });

    const ruim = lerAreaDeTrabalho(JSON.stringify({ ...area, cadastros: { ...area.cadastros, ambientes: [{ id: "x", nome: "Sala", capacidade: "muita" }] } }));
    assert.equal(ruim.ok, false);
    assert.match(ruim.ok ? "" : ruim.erro, /capacidade/);
    assert.equal(lerAreaDeTrabalho("{").ok, false);
    assert.equal(lerAreaDeTrabalho(JSON.stringify({ versao: 1 })).ok, false);
});

test("editar o quadro renumera os tempos sem perder as marcações", () => {
    let p = projetoDoisTurnos(); // tempos: 1 2 3 de manhã, 4 5 à noite
    const t = criarTurmaAvulsa(p, { nome: "Noite", turnos: ["noturno"] });
    const o = criarOferta(t.projeto, t.turma.id);
    p = manterDocentes({ ...o.projeto, ofertas: [{ ...o.oferta, professorIds: ["p1"] }] });
    p.docentes[0].disponibilidade = { seg: [1, 4, 5] };
    p.docentes[0].evitar = { seg: [5] };
    p.horario = { revisao: 0, completo: true, alocacoes: [], problemas: [] };

    // Só mudar a hora de uma aula não renumera nada e mantém o horário gerado
    const soHora = trocarFaixas(p, p.quadro.faixas.map((f, i) => (i === 0 ? { ...f, inicio: "07:00" } : f)));
    assert.ok(soHora.horario);
    assert.deepEqual(soHora.turmas[0].horarios.seg, [4, 5]);

    // Uma 4ª aula de manhã: as da noite passam a ser os tempos 5 e 6
    const mais = trocarFaixas(p, [...p.quadro.faixas, { tipo: "aula", id: "nova", inicio: "10:20", duracaoMin: 50, turno: "matutino" }]);
    assert.equal(numeroDeTempos(mais.quadro), 6);
    assert.deepEqual(mais.turmas[0].horarios.seg, [5, 6], "a turma acompanha as aulas dela e não ganha a nova");
    assert.deepEqual(mais.docentes[0].disponibilidade.seg, [1, 4, 5, 6], "o docente fica disponível na aula nova (4)");
    assert.deepEqual(mais.docentes[0].evitar.seg, [6]);
    assert.equal(mais.horario, null);

    // Tirar a 1ª aula da manhã: tudo desce um
    const menos = trocarFaixas(p, p.quadro.faixas.slice(1));
    assert.deepEqual(menos.turmas[0].horarios.seg, [3, 4]);
    assert.deepEqual(menos.docentes[0].disponibilidade.seg, [3, 4]);

    // Refazer a noite com 3 aulas: as duas que existiam mantêm as marcações
    const noite = substituirTurno(p, { turno: "noturno", inicio: "18:30", aulas: 3, intervaloApos: 2, intervaloMin: 10 });
    assert.deepEqual(noite.quadro.faixas.slice(4).map((f) => `${f.tipo} ${f.inicio}`), ["aula 18:30", "aula 19:20", "intervalo 20:10", "aula 20:20"]);
    assert.deepEqual(noite.turmas[0].horarios.seg, [4, 5]);
    assert.deepEqual(noite.docentes[0].disponibilidade.seg, [1, 4, 5, 6]);
});

test("trocar os dias do quadro", () => {
    let p = projetoDoisTurnos();
    const t = criarTurmaAvulsa(p, { nome: "A" });
    const o = criarOferta(t.projeto, t.turma.id);
    p = manterDocentes({ ...o.projeto, ofertas: [{ ...o.oferta, professorIds: ["p1"] }] });
    const novo = trocarDias(p, ["sab", "seg", "ter"]);
    assert.deepEqual(novo.quadro.dias, ["seg", "ter", "sab"], "na ordem da semana");
    assert.deepEqual(Object.keys(novo.turmas[0].horarios), ["seg", "ter"], "a turma não ganha o sábado e perde qua-sex");
    assert.equal(contarTempos(novo.docentes[0].disponibilidade), 15, "o docente fica disponível no sábado");
});
