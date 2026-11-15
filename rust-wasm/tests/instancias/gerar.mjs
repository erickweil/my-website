#!/usr/bin/env node
// Gera instâncias de horário (formato FormularioHorario, o mesmo do "Exportar JSON" da UI)
// para o benchmark nativo (`cargo run --release --example bench_horario`).
//
// Determinístico: semente fixa por instância, então rodar de novo produz os mesmos arquivos.
//
// Instâncias viáveis são construídas "de trás pra frente": primeiro monta-se um quadro
// completo e sem conflitos, e só então derivam-se professores e disponibilidades a partir dele.
// Assim existe garantidamente uma solução com fitness 0 — o solver é que precisa achá-la.
//
// Para cada instância viável também grava `<nome>.solucao.json` (a solução usada na construção),
// que o benchmark usa para conferir que a instância de fato admite fitness 0.
//
// Uso: node rust-wasm/tests/instancias/gerar.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paraEntrada } from "./formato.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const DIAS = ["seg", "ter", "qua", "qui", "sex"];

// PRNG determinístico (mulberry32)
function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (n) => Math.floor(next() * n);
    const shuffle = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = int(i + 1);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };
    return { next, int, shuffle };
}

// Grade curricular por turma: [nome, aulas, agrupar]. Soma = 25 (5 dias x 5 tempos).
const GRADE = [
    ["Português", 5, 0],
    ["Matemática", 5, 0],
    ["Ciências", 3, 0],
    ["História", 2, 0],
    ["Geografia", 2, 0],
    ["Inglês", 2, 0],
    ["Artes", 2, 2],
    ["Ed. Física", 2, 2],
    ["Redação", 2, 2],
];

/**
 * @param {object} opt
 * @param {number} opt.turmas      número de turmas
 * @param {number} opt.tempos      tempos por dia
 * @param {number} opt.seed
 * @param {number} opt.cargaMax    máximo de aulas por professor
 * @param {number} opt.dispExtra   probabilidade de um slot livre do professor também estar disponível
 * @param {boolean} opt.unidas     cria um grupo de "Ed. Física" unida entre as 2 primeiras turmas
 */
function gerar({ turmas: nTurmas, tempos: nTempos, seed, cargaMax, dispExtra, unidas }) {
    const r = rng(seed);
    const slots = DIAS.length * nTempos;
    const totalAulas = GRADE.reduce((s, [, a]) => s + a, 0);
    if (totalAulas !== slots) throw new Error(`grade tem ${totalAulas} aulas, mas há ${slots} slots`);

    const turmas = [];
    const disciplinas = [];
    // quadro[turma][dia][tempo] = nome da disciplina
    const quadros = [];

    for (let t = 0; t < nTurmas; t++) {
        const nomeTurma = `${Math.floor(t / 4) + 1}º ${"ABCD"[t % 4]}`;
        turmas.push({
            nome: nomeTurma,
            horarios: Object.fromEntries(DIAS.map((d) => [d, Array.from({ length: nTempos }, (_, i) => i + 1)])),
        });

        // Monta o quadro da turma: blocos agrupados primeiro (em pares alinhados de um mesmo dia),
        // depois as aulas avulsas nos slots que sobraram.
        const q = DIAS.map(() => Array(nTempos).fill(null));
        const forcarUnida = unidas && t === 1 ? quadros[0] : null;

        for (const [nome, aulas, agrupar] of GRADE) {
            const nomeDisc = `${nome} ${nomeTurma}`;
            disciplinas.push({ nome: nomeDisc, turma: nomeTurma, aulas, agrupar, dividir: agrupar > 0 });

            if (forcarUnida && nome === "Ed. Física") {
                // Turma unida: copia exatamente os slots da Ed. Física da turma 0
                forcarUnida.forEach((dia, d) => dia.forEach((v, tp) => {
                    if (v?.startsWith("Ed. Física")) q[d][tp] = nomeDisc;
                }));
                continue;
            }
            if (agrupar <= 0) continue;

            let restantes = aulas;
            const pares = r.shuffle(
                DIAS.flatMap((_, d) => Array.from({ length: Math.floor(nTempos / agrupar) }, (_, k) => [d, k * agrupar]))
            );
            const diasUsados = new Set();
            for (const [d, inicio] of pares) {
                if (restantes <= 0) break;
                if (diasUsados.has(d)) continue; // um bloco por dia, como numa escola de verdade
                const livre = Array.from({ length: agrupar }, (_, k) => q[d][inicio + k] === null).every(Boolean);
                if (!livre) continue;
                for (let k = 0; k < agrupar; k++) q[d][inicio + k] = nomeDisc;
                diasUsados.add(d);
                restantes -= agrupar;
            }
            if (restantes > 0) throw new Error(`não coube ${nomeDisc}; troque a semente`);
        }

        const avulsas = GRADE.filter(([, , g]) => g === 0)
            .flatMap(([nome, aulas]) => Array(aulas).fill(`${nome} ${nomeTurma}`));
        r.shuffle(avulsas);
        for (let d = 0; d < DIAS.length; d++)
            for (let tp = 0; tp < nTempos; tp++)
                if (q[d][tp] === null) q[d][tp] = avulsas.pop();

        // Garante que blocos "dividir" não ficaram encostados por acaso com uma avulsa idêntica
        // (não acontece: avulsas e agrupadas são disciplinas diferentes), mas valida a contagem.
        if (avulsas.length !== 0) throw new Error("sobraram aulas avulsas");
        quadros.push(q);
    }

    // Atribui professores guloso: cada disciplina vai para um professor da mesma matéria
    // que esteja livre em TODOS os slots dela e ainda tenha carga; senão, cria um novo.
    const ocupacao = new Map(); // prof -> Set("d,t")
    const professores = [];
    const slotsDe = (nomeDisc) => {
        const turmaIdx = turmas.findIndex((t) => nomeDisc.endsWith(t.nome));
        const s = [];
        quadros[turmaIdx].forEach((dia, d) => dia.forEach((v, tp) => { if (v === nomeDisc) s.push(`${d},${tp}`); }));
        return s;
    };
    for (const disc of r.shuffle([...disciplinas])) {
        const materia = GRADE.find(([nome]) => disc.nome.startsWith(nome))[0];
        const meus = slotsDe(disc.nome);
        let prof = professores.find((p) =>
            p.materia === materia &&
            ocupacao.get(p.nome).size + meus.length <= cargaMax &&
            meus.every((s) => !ocupacao.get(p.nome).has(s))
        );
        if (!prof) {
            prof = { nome: `Prof. ${materia} ${professores.filter((p) => p.materia === materia).length + 1}`, materia, disciplinas: [] };
            professores.push(prof);
            ocupacao.set(prof.nome, new Set());
        }
        prof.disciplinas.push(disc.nome);
        meus.forEach((s) => ocupacao.get(prof.nome).add(s));
    }

    // Disponibilidade: slots onde dá aula na solução + alguns slots extras aleatórios
    const professoresOut = professores.map((p) => {
        const occ = ocupacao.get(p.nome);
        const horarios = Object.fromEntries(DIAS.map((dia, d) => [
            dia,
            Array.from({ length: nTempos }, (_, tp) => tp)
                .filter((tp) => occ.has(`${d},${tp}`) || r.next() < dispExtra)
                .map((tp) => tp + 1),
        ]));
        return { nome: p.nome, disciplinas: p.disciplinas.sort(), horarios };
    });

    const disciplinas_unidas = unidas
        ? [{ grupo: "Ed. Física unida", disciplinas: [`Ed. Física ${turmas[0].nome}`, `Ed. Física ${turmas[1].nome}`] }]
        : [];

    const formulario = { turmas, disciplinas, disciplinas_unidas, professores: professoresOut };
    // Solução de referência: { "<turma>": { "<dia>": ["<disciplina do tempo 1>", ...] } }
    const solucao = Object.fromEntries(turmas.map((t, i) => [
        t.nome, Object.fromEntries(DIAS.map((dia, d) => [dia, quadros[i][d]])),
    ]));
    return { formulario, solucao };
}

/** Torna a instância inviável: um professor passa a ter menos horários disponíveis que aulas. */
function tornarInviavel({ formulario: inst }) {
    const prof = inst.professores[0];
    const aulas = inst.disciplinas
        .filter((d) => prof.disciplinas.includes(d.nome))
        .reduce((s, d) => s + d.aulas, 0);
    let manter = aulas - 1;
    for (const dia of DIAS) {
        prof.horarios[dia] = prof.horarios[dia].filter(() => manter-- > 0);
    }
    return { formulario: inst, solucao: null };
}

const instancias = {
    pequena: gerar({ turmas: 3, tempos: 5, seed: 1, cargaMax: 20, dispExtra: 0.3, unidas: true }),
    media: gerar({ turmas: 10, tempos: 5, seed: 2, cargaMax: 20, dispExtra: 0.3, unidas: true }),
    grande: gerar({ turmas: 25, tempos: 5, seed: 3, cargaMax: 20, dispExtra: 0.3, unidas: true }),
    inviavel: tornarInviavel(gerar({ turmas: 3, tempos: 5, seed: 1, cargaMax: 20, dispExtra: 0.3, unidas: true })),
};

for (const [nome, { formulario, solucao }] of Object.entries(instancias)) {
    const arquivo = join(DIR, `${nome}.json`);
    const { entrada, aulaDaDisciplina } = paraEntrada(formulario);
    writeFileSync(arquivo, JSON.stringify(entrada, null, 2) + "\n");
    // Inviável não tem solução de referência (por construção, não existe nenhuma)
    if (solucao) {
        // { "<turma>": { "<dia>": ["<aula do tempo 1>", ...] } }
        const comAulas = Object.fromEntries(Object.entries(solucao).map(([turma, dias]) => [
            turma, Object.fromEntries(Object.entries(dias).map(([dia, tempos]) => [dia, tempos.map((d) => (d === null ? null : aulaDaDisciplina.get(d)))])),
        ]));
        writeFileSync(join(DIR, `${nome}.solucao.json`), JSON.stringify(comAulas, null, 2) + "\n");
    }
    const aulas = entrada.aulas.reduce((s, a) => s + a.aulasSemana * a.turmas.length, 0);
    console.log(`${nome.padEnd(9)} turmas=${entrada.turmas.length} aulas=${entrada.aulas.length} recursos=${entrada.recursos.length} aulas/semana=${aulas} -> ${arquivo}`);
}
