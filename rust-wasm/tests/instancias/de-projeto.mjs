// Converte um projeto exportado pela página do gerador (o JSON da área de trabalho) numa instância
// para os benchmarks nativos, com a mesma função que a página usa para chamar o solver
// (`paraSolver`). É como reproduzir fora do navegador um quadro que a página não resolveu.
//
// Uso: node rust-wasm/tests/instancias/de-projeto.mjs <area-de-trabalho.json> <saida.json> [nome do projeto]
//
// Grava a instância em <saida.json> e, se o projeto tem um horário gerado, o quadro dele em
// <saida>.quadro.json (para `bench_busca_local --de`). Os ids são os do projeto; <saida>.nomes.json
// traz o nome de cada um. Dados reais ficam fora do git: use um nome que comece com `real`.

import fs from "node:fs";
import { paraSolver } from "../../../src/app/toy/gerador-horario/modelo/para-solver.ts";

const [origem, destino, nomeDoProjeto] = process.argv.slice(2);
if (!origem || !destino) {
    console.error("uso: node de-projeto.mjs <area-de-trabalho.json> <saida.json> [nome do projeto]");
    process.exit(2);
}
const area = JSON.parse(fs.readFileSync(origem, "utf8"));
const projeto = nomeDoProjeto ? area.projetos.find((p) => p.nome === nomeDoProjeto) : area.projetos[0];
if (!projeto) {
    console.error(`projeto não encontrado. Projetos no arquivo: ${area.projetos.map((p) => p.nome).join(", ")}`);
    process.exit(1);
}
const base = destino.replace(/\.json$/, "");

const entrada = paraSolver(projeto);
fs.writeFileSync(`${base}.json`, JSON.stringify(entrada, null, 1));

if (projeto.horario) {
    // { turma: { dia: [aula por tempo] } }, o formato das soluções de referência
    const quadro = Object.fromEntries(projeto.turmas.map((t) => [t.id, {}]));
    for (const a of projeto.horario.alocacoes) {
        const oferta = projeto.ofertas.find((o) => o.id === a.ofertaId);
        for (const { turmaId } of oferta?.participacoes ?? []) {
            quadro[turmaId][a.dia] ??= Array(entrada.tempos.length).fill(null);
            quadro[turmaId][a.dia][a.tempo - 1] = a.ofertaId;
        }
    }
    fs.writeFileSync(`${base}.quadro.json`, JSON.stringify(quadro));
}

const nomeDaTurma = (id) => projeto.turmas.find((t) => t.id === id)?.nome ?? id;
const nomes = {};
for (const t of projeto.turmas) nomes[t.id] = t.nome;
for (const o of projeto.ofertas) nomes[o.id] = `${o.nome} [${o.participacoes.map((p) => nomeDaTurma(p.turmaId)).join(" + ")}]`;
for (const p of area.cadastros.professores) nomes[p.id] = p.nome;
for (const a of area.cadastros.ambientes) nomes[a.id] = a.nome;
fs.writeFileSync(`${base}.nomes.json`, JSON.stringify(nomes, null, 1));

const aulas = entrada.aulas.reduce((s, a) => s + a.aulasSemana * a.turmas.length, 0);
console.log(`${projeto.nome}: ${entrada.turmas.length} turmas, ${aulas} aulas por semana, ${entrada.recursos.length} recursos -> ${base}.json${projeto.horario ? ` e ${base}.quadro.json` : ""}`);
