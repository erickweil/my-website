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
    nomeNaTurma,
    renomearNaTurma,
    turmasDoProfessor,
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
import { lerInstanciaDoSolver, projetoDaFaculdade } from "./testes/instancia-antiga.ts";

const curso = (): Curso => ({
    id: "ads",
    nome: "Análise e Desenvolvimento de Sistemas",
    nivel: "superior",
    regime: "semestral",
    periodos: [
        {
            id: "ads-1",
            numero: 1,
            componentes: [
                { id: "alg", nome: "Algoritmos", aulasSemana: 4, distribuicao: { tipo: "blocos", tamanho: 2, emendar: false } },
                { id: "mat", nome: "Matemática", aulasSemana: 2, distribuicao: { tipo: "livre" } },
            ],
        },
        { id: "ads-2", numero: 2, componentes: [{ id: "bd", nome: "Banco de Dados", aulasSemana: 4, distribuicao: { tipo: "livre" } }] },
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
    assert.deepEqual(ofertas.map((o) => [o.nome, o.aulasSemana, o.participacoes[0].componenteId]), [["Algoritmos", 4, "alg"], ["Matemática", 2, "mat"]]);
    assert.equal(aulasDaTurma(r.projeto, r.turma.id), 6);

    // Alterar a oferta não toca a matriz, e a diferença aparece
    const alg = c.periodos[0].componentes[0];
    const alterada = { ...ofertas[0], aulasSemana: 6 };
    assert.deepEqual(diferencasDaMatriz(alterada, alg), ["aulasSemana"]);
    assert.deepEqual(diferencasDaMatriz(ofertas[0], alg), []);
    assert.equal(alg.aulasSemana, 4);

    // Tirar uma oferta da turma: o componente aparece como não ofertado
    const semMat = { ...r.projeto, ofertas: r.projeto.ofertas.filter((o) => o.nome !== "Matemática") };
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
    assert.deepEqual(copia.periodos.map((p) => p.componentes.map((x) => x.nome)), [["Algoritmos", "Matemática"], ["Banco de Dados"]]);
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
    p.ofertas = p.ofertas.map((o) => (o.id === oa.oferta.id ? { ...o, nome: "Projeto A", professorIds: ["p1"] } : { ...o, nome: "Projeto B", professorIds: ["p2"] }));

    const junta = juntarOfertas(p, oa.oferta.id, ob.oferta.id);
    assert.ok("projeto" in junta);
    const [conjunta] = junta.projeto.ofertas;
    // Cada turma continua com o nome que dava à disciplina, e pode mudar o seu sem mexer no da outra
    assert.deepEqual([a, b].map((t) => nomeNaTurma(conjunta, t.turma.id)), ["Projeto A", "Projeto B"]);
    const renomeada = renomearNaTurma(conjunta, b.turma.id, "Projeto Integrador");
    assert.deepEqual([a, b].map((t) => nomeNaTurma(renomeada, t.turma.id)), ["Projeto A", "Projeto Integrador"]);
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
    assert.deepEqual(separado.ofertas.map((o) => [o.nome, o.participacoes[0].nome]), [["Projeto A", undefined], ["Projeto B", undefined]], "separadas, cada uma volta a ter o seu nome");
    assert.equal(turmasDoProfessor(junta.projeto, "p1"), 2, "na aula conjunta o professor atende as duas turmas");
    assert.equal(turmasDoProfessor(p, "p1"), 1);

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

test("paraSolver: aulas por id, com as turmas, os professores e o ambiente disputado", () => {
    let p = projetoDoisTurnos();
    const a = criarTurmaAvulsa(p, { nome: "A", ambienteId: "sala-a" });
    const b = criarTurmaAvulsa(a.projeto, { nome: "B", ambienteId: "sala-b" });
    const oa = criarOferta(b.projeto, a.turma.id);
    const ob = criarOferta(oa.projeto, b.turma.id);
    const lab = criarOferta(ob.projeto, b.turma.id);
    const semAula = criarOferta(lab.projeto, b.turma.id);
    p = semAula.projeto;
    p.ofertas = p.ofertas.map((o) => ({
        ...o,
        professorIds: ["p1"],
        aulasSemana: o.id === semAula.oferta.id ? 0 : o.aulasSemana,
        distribuicao: o.id === lab.oferta.id ? { tipo: "blocos", tamanho: 2, emendar: true } : o.distribuicao,
        // A oferta de laboratório da turma B usa a sala da turma A
        ambienteId: o.id === lab.oferta.id ? "sala-a" : null,
    }));
    const junta = juntarOfertas(p, oa.oferta.id, ob.oferta.id);
    assert.ok("projeto" in junta);
    p = manterDocentes(junta.projeto);
    p.docentes[0].disponibilidade = { seg: [1, 2, 99], dom: [1] };
    p.docentes[0].evitar = { seg: [2], sab: [1] };

    assert.deepEqual(paraSolver(p), {
        turmas: [
            { id: a.turma.id, horarios: horariosCheios(p.quadro) },
            { id: b.turma.id, horarios: horariosCheios(p.quadro) },
        ],
        aulas: [
            // A aula em conjunto é uma só, com as duas turmas; a de zero aulas não entra
            { id: oa.oferta.id, turmas: [a.turma.id, b.turma.id], recursos: ["p1", "sala-a"], aulasSemana: 2, bloco: 0, emendar: false },
            { id: lab.oferta.id, turmas: [b.turma.id], recursos: ["p1", "sala-a"], aulasSemana: 2, bloco: 2, emendar: true },
        ],
        recursos: [
            // Limitados ao quadro: sem domingo, sem sábado e sem o tempo 99
            { id: "p1", ambiente: false, disponibilidade: { seg: [1, 2] }, evitar: { seg: [2] } },
            // "sala-a" é disputada pelas turmas A e B; "sala-b" não é usada por mais ninguém e não entra
            { id: "sala-a", ambiente: true, disponibilidade: horariosCheios(p.quadro), evitar: {} },
        ],
        // As horas do quadro: manhã 07:30, intervalo depois da 2ª, e a noite com aulas de 45 minutos
        tempos: [
            { inicio: 450, fim: 500, turno: "matutino" },
            { inicio: 500, fim: 550, turno: "matutino" },
            { inicio: 570, fim: 620, turno: "matutino" },
            { inicio: 1140, fim: 1185, turno: "noturno" },
            { inicio: 1185, fim: 1230, turno: "noturno" },
        ],
    });
});

test("paraSolver: o quadro real, importado do formato antigo, dá a instância que o Rust testa", () => {
    const { projeto, professores } = projetoDaFaculdade();
    const entrada = paraSolver(projeto);
    const doRust = lerInstanciaDoSolver("faculdade-anonimizado");

    // Os ids mudam (aqui são sorteados; lá são os nomes): compara pelo nome e pela posição
    const turma = (id: string) => projeto.turmas.find((t) => t.id === id)!.nome;
    const recurso = (id: string) => professores.find((x) => x.id === id)!.nome;
    assert.deepEqual(entrada.turmas.map((t) => ({ id: turma(t.id), horarios: t.horarios })), doRust.turmas);
    // No formato antigo a aula em conjunto ficava na posição da última disciplina do grupo; aqui, na da primeira
    const forma = (aulas: typeof doRust.aulas, nome: (id: string) => string, deTurma: (id: string) => string) =>
        aulas.map((x) => JSON.stringify([x.turmas.map(deTurma), x.recursos.map(nome).sort(), x.aulasSemana, x.bloco ?? 0, x.emendar ?? false])).sort();
    assert.deepEqual(forma(entrada.aulas, recurso, turma), forma(doRust.aulas, (x) => x, (x) => x));
    assert.equal(entrada.aulas.length, 19, "20 disciplinas antigas, duas delas numa aula em conjunto");
    // Os docentes saem na ordem em que aparecem nas aulas, e dia sem horário não é listado
    const recursos = (lista: { id: string; disponibilidade: object }[], nome: (id: string) => string) =>
        lista
            .map((x) => [nome(x.id), Object.entries(x.disponibilidade).filter(([, t]) => (t as number[]).length > 0).sort()] as const)
            .sort((x, y) => x[0].localeCompare(y[0]));
    assert.deepEqual(recursos(entrada.recursos, recurso), recursos(doRust.recursos, (x) => x));
});

test("doSolver: alocações e problemas voltam com os ids do projeto", () => {
    const p = { ...projetoDoisTurnos(), revisao: 7 };
    const horario = doSolver(p, {
        alocacoes: [{ aula: "oferta-1", dia: "seg", tempo: 1 }],
        problemas: [
            { turma: "turma-a", dia: "seg", tempo: 2, aula: null, mensagem: "Este espaço não deveria estar vazio" },
            { turma: "turma-a", dia: "ter", tempo: 1, aula: "oferta-1", mensagem: "Professor ocupado" },
        ],
        alguma_violacao: true,
        mensagem: "Não foi possível completar",
        qualidade: [],
        iter: 1,
        depth: 0,
        terminou: true,
    });
    assert.deepEqual(horario, {
        revisao: 7,
        completo: false,
        alocacoes: [{ ofertaId: "oferta-1", dia: "seg", tempo: 1, fixada: false }],
        problemas: [
            { mensagem: "Não foi possível completar" },
            { mensagem: "Este espaço não deveria estar vazio", ofertaId: undefined, turmaId: "turma-a", dia: "seg", tempo: 2 },
            { mensagem: "Professor ocupado", ofertaId: "oferta-1", turmaId: "turma-a", dia: "ter", tempo: 1 },
        ],
        qualidade: [],
    });

    const base = { problemas: [], qualidade: [], mensagem: null, iter: 1, depth: 0, terminou: true };
    // Horário válido com ocorrências de qualidade: completo, e os ids voltam nos campos do projeto
    const valido = doSolver(p, {
        ...base,
        alocacoes: [],
        alguma_violacao: false,
        qualidade: [
            { regra: "jornada", recurso: "prof-1", turma: null, aula: null, dia: "seg", minutos: 30 },
            { regra: "turno", recurso: null, turma: "turma-a", aula: "oferta-1", dia: "ter", minutos: 0 },
        ],
    });
    assert.equal(valido.completo, true);
    assert.deepEqual(valido.qualidade, [
        { regra: "jornada", professorId: "prof-1", turmaId: undefined, ofertaId: undefined, dia: "seg", minutos: 30 },
        { regra: "turno", professorId: undefined, turmaId: "turma-a", ofertaId: "oferta-1", dia: "ter", minutos: 0 },
    ]);
    // Sem quadro nenhum: incompleto, com a mensagem do solver
    const semQuadro = doSolver(p, { ...base, alocacoes: null, alguma_violacao: true, mensagem: "Sem solução" });
    assert.deepEqual([semQuadro.completo, semQuadro.alocacoes, semQuadro.problemas], [false, [], [{ mensagem: "Sem solução" }]]);
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
    p.horario = { revisao: 0, completo: true, alocacoes: [], problemas: [], qualidade: [] };

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

test("disciplinas com o mesmo nome, em turmas diferentes ou na mesma, não se confundem", () => {
    let p = projetoDoisTurnos();
    const a = criarTurmaAvulsa(p, { nome: "1A" });
    const b = criarTurmaAvulsa(a.projeto, { nome: "1B" });
    p = b.projeto;
    const ids: string[] = [];
    // "Matemática" na 1A (prof. p1), "Matemática" na 1B (prof. p2) e uma segunda "Matemática" na 1B (prof. p3)
    for (const [turmaId, professorId] of [[a.turma.id, "p1"], [b.turma.id, "p2"], [b.turma.id, "p3"]]) {
        const r = criarOferta(p, turmaId);
        ids.push(r.oferta.id);
        p = { ...r.projeto, ofertas: r.projeto.ofertas.map((o) => (o.id === r.oferta.id ? { ...o, nome: "Matemática", professorIds: [professorId] } : o)) };
    }
    p = manterDocentes(p);

    const entrada = paraSolver(p);
    // Três aulas distintas, cada uma com a sua turma e o seu professor
    assert.deepEqual(entrada.aulas.map((x) => [x.id, x.turmas, x.recursos]), [
        [ids[0], [a.turma.id], ["p1"]],
        [ids[1], [b.turma.id], ["p2"]],
        [ids[2], [b.turma.id], ["p3"]],
    ]);
});
