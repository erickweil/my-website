/// <reference lib="webworker" />

/**
 * Worker do teste de threads: carrega o WASM, cria o pool do rayon, roda as mesmas tarefas em
 * sequência e em paralelo, e mede o motor genético nos dois modos. O pool é criado aqui (e não
 * na thread principal) porque o rayon bloqueia esperando as outras threads, e a thread principal
 * do navegador não pode bloquear.
 *
 * Tudo vai para o console e também é devolvido à página.
 */

import { iniciarWasmComThreads } from "@/lib/wasmThreads";

declare const self: DedicatedWorkerGlobalScope;

type ResultadoTeste = {
    threads_no_pool: number;
    threads_usadas: number;
    thread_por_tarefa: Array<number | null>;
    checksum: string;
};

export type ResultadoGA = {
    problema: string;
    populacao: number;
    geracoes_por_s_sequencial: number;
    geracoes_por_s_paralelo: number;
    ganho: number;
    resultado_identico: boolean;
    automatico_escolheu_paralelo: boolean;
};

export type MensagemTeste =
    | { tipo: "log"; texto: string }
    | { tipo: "fim"; threads: number; sequencialMs: number; paraleloMs: number; sequencial: ResultadoTeste; paralelo: ResultadoTeste; ga: ResultadoGA[] }
    | { tipo: "erro"; texto: string };

const log = (texto: string) => {
    console.log(`[threads-teste] ${texto}`);
    self.postMessage({ tipo: "log", texto } satisfies MensagemTeste);
};

self.onmessage = async (ev: MessageEvent<{ threads: number; tarefas: number; passos: number }>) => {
    const { threads, tarefas, passos } = ev.data;
    try {
        log(`worker: crossOriginIsolated = ${self.crossOriginIsolated}, SharedArrayBuffer = ${typeof SharedArrayBuffer !== "undefined"}`);

        const t0 = performance.now();
        const wasm = await iniciarWasmComThreads(threads);
        log(`WASM carregado e pool do rayon criado com ${threads} threads em ${(performance.now() - t0).toFixed(0)} ms`);

        log(`rodando ${tarefas} tarefas em sequência...`);
        const ts = performance.now();
        const sequencial = wasm.teste_threads(tarefas, passos, false) as ResultadoTeste;
        const sequencialMs = performance.now() - ts;
        log(`sequencial: ${sequencialMs.toFixed(0)} ms`);

        log(`rodando ${tarefas} tarefas em paralelo...`);
        const tp = performance.now();
        const paralelo = wasm.teste_threads(tarefas, passos, true) as ResultadoTeste;
        const paraleloMs = performance.now() - tp;
        log(`paralelo: ${paraleloMs.toFixed(0)} ms, ${paralelo.threads_usadas} threads diferentes usadas`);

        if (sequencial.checksum !== paralelo.checksum) {
            throw new Error(`checksums diferentes: ${sequencial.checksum} x ${paralelo.checksum}`);
        }

        log("medindo o motor genético (sequencial x paralelo, ~1 s por modo e problema)...");
        const ga = wasm.teste_ga_threads(1) as ResultadoGA[];
        for (const r of ga) {
            log(`GA ${r.problema}: ${r.geracoes_por_s_sequencial.toFixed(0)} -> ${r.geracoes_por_s_paralelo.toFixed(0)} ger/s (${r.ganho.toFixed(2)}x), ` +
                `resultado idêntico: ${r.resultado_identico}, automático escolheu ${r.automatico_escolheu_paralelo ? "paralelo" : "sequencial"}`);
        }

        self.postMessage({ tipo: "fim", threads, sequencialMs, paraleloMs, sequencial, paralelo, ga } satisfies MensagemTeste);
    } catch (e) {
        const texto = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.error("[threads-teste]", e);
        self.postMessage({ tipo: "erro", texto } satisfies MensagemTeste);
    }
};
