/// <reference lib="webworker" />

/**
 * Worker do teste de threads: carrega o WASM, cria o pool do rayon e roda as mesmas tarefas em
 * sequência e em paralelo. O pool é criado aqui (e não na thread principal) porque o rayon bloqueia
 * esperando as outras threads, e a thread principal do navegador não pode bloquear.
 *
 * Tudo vai para o console e também é devolvido à página.
 */

declare const self: DedicatedWorkerGlobalScope;

type ResultadoTeste = {
    threads_no_pool: number;
    threads_usadas: number;
    thread_por_tarefa: Array<number | null>;
    checksum: string;
};

export type MensagemTeste =
    | { tipo: "log"; texto: string }
    | { tipo: "fim"; sequencialMs: number; paraleloMs: number; sequencial: ResultadoTeste; paralelo: ResultadoTeste }
    | { tipo: "erro"; texto: string };

const log = (texto: string) => {
    console.log(`[threads-teste] ${texto}`);
    self.postMessage({ tipo: "log", texto } satisfies MensagemTeste);
};

self.onmessage = async (ev: MessageEvent<{ threads: number; tarefas: number; passos: number }>) => {
    const { threads, tarefas, passos } = ev.data;
    try {
        log(`worker: crossOriginIsolated = ${self.crossOriginIsolated}, SharedArrayBuffer = ${typeof SharedArrayBuffer !== "undefined"}`);

        const wasm = await import("@/pkg/rust_wasm.js");
        const t0 = performance.now();
        await wasm.default();
        log(`WASM carregado em ${(performance.now() - t0).toFixed(0)} ms`);

        const t1 = performance.now();
        await wasm.initThreadPool(threads);
        log(`pool do rayon criado com ${threads} threads em ${(performance.now() - t1).toFixed(0)} ms`);

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
        self.postMessage({ tipo: "fim", sequencialMs, paraleloMs, sequencial, paralelo } satisfies MensagemTeste);
    } catch (e) {
        const texto = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.error("[threads-teste]", e);
        self.postMessage({ tipo: "erro", texto } satisfies MensagemTeste);
    }
};
