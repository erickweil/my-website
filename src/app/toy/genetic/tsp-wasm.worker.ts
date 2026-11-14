/// <reference lib="webworker" />

/**
 * Worker que roda o GA do TSP em Rust/WASM. Fica num worker (e não na thread principal) para o
 * motor genético poder usar o pool de threads do rayon, que bloqueia a thread que o chama.
 *
 *  - Recebe { tipo: "iniciar", id, cities }: (re)começa a evolução com essas cidades.
 *  - Recebe { tipo: "parar" }: para a evolução atual.
 *  - Envia { tipo: "progresso", id, ... } a cada ~20 ms, com o melhor caminho até agora.
 *  - Envia { tipo: "erro", texto } se algo falhar.
 */

import { iniciarWasmComThreads } from "@/lib/wasmThreads";

declare const self: DedicatedWorkerGlobalScope;

export type TSPWorkerEntrada =
    | { tipo: "iniciar"; id: number; cities: { x: number; y: number }[] }
    | { tipo: "parar" };

export type TSPWorkerSaida =
    | {
        tipo: "progresso";
        /** O `id` do "iniciar" a que este progresso pertence. */
        id: number;
        generation: number;
        fitness: number;
        stagnatedFor: number;
        genes: number[];
        msPerGeneration: number;
        /** Threads no pool do rayon. */
        threads: number;
        /** O motor está rodando as gerações em paralelo? (o modo automático decide) */
        usandoThreads: boolean;
    }
    | { tipo: "erro"; texto: string };

/** Tempo de cada bloco de gerações entre um progresso e outro. */
const MS_POR_BLOCO = 20;

/** Muda a cada "iniciar"/"parar": a evolução em andamento percebe e termina. */
let execucao = 0;

// Devolve o controle ao worker para ele receber mensagens, sem o atraso mínimo do setTimeout
const canal = new MessageChannel();
const ceder = () => new Promise<void>((resolve) => {
    canal.port1.onmessage = () => resolve();
    canal.port2.postMessage(null);
});

async function evoluir(id: number, cities: { x: number; y: number }[]) {
    const minha = ++execucao;
    const threads = navigator.hardwareConcurrency || 1;
    const wasm = await iniciarWasmComThreads(threads);
    if (minha !== execucao) return;

    const size = cities.length;
    const cfg = new wasm.GAConfig();
    cfg.population_size = size * 2;
    cfg.crossover_rate = 0.9;
    cfg.mutation_rate = 0.9;
    cfg.mutation_gene_rate = 1 / size;
    cfg.tournament_size = 8;
    cfg.max_stagnation = 50000;
    cfg.diversity_check = false;
    cfg.threads = 0; // automático: usa as threads só se a geração ficar mais rápida com elas
    const runner = new wasm.TSPGAProblemRunner(cities, cfg);

    try {
        while (minha === execucao) {
            let geracoes = 0;
            const inicio = performance.now();
            do {
                runner.run(50);
                geracoes += 50;
            } while (performance.now() - inicio < MS_POR_BLOCO);
            const ms = performance.now() - inicio;

            const info = runner.get_info() as { generation: number; best_fitness: number; stagnated_for: number; best_genes: number[] };
            self.postMessage({
                tipo: "progresso",
                id,
                generation: info.generation,
                fitness: info.best_fitness,
                stagnatedFor: info.stagnated_for,
                genes: info.best_genes,
                msPerGeneration: ms / geracoes,
                threads,
                usandoThreads: runner.usando_threads(),
            } satisfies TSPWorkerSaida);

            await ceder();
        }
    } finally {
        runner.free();
    }
}

self.onmessage = (ev: MessageEvent<TSPWorkerEntrada>) => {
    const msg = ev.data;
    if (msg.tipo === "parar") {
        execucao++;
        return;
    }
    evoluir(msg.id, msg.cities).catch((e) => {
        console.error("[tsp-wasm]", e);
        self.postMessage({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) } satisfies TSPWorkerSaida);
    });
};
