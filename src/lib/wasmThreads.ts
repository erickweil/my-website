/**
 * Carrega o WASM e cria o pool de threads do rayon. SÓ para Web Workers.
 *
 * O rayon bloqueia a thread que o chama enquanto as outras trabalham, e a thread principal do
 * navegador não pode bloquear; por isso o código Rust que usa threads roda dentro de um worker,
 * e é o worker que cria o pool (cada thread do pool é outro worker, criado pelo wasm-bindgen-rayon).
 *
 * Na thread principal use `useWasm`: lá não há pool e o Rust roda tudo em sequência
 * (`pool_disponivel()` em rust-wasm/src/paralelo.rs).
 *
 * Exige página "cross-origin isolated" (cabeçalhos em next.config.ts); sem isso `initThreadPool` falha.
 */

type Wasm = typeof import("@/pkg/rust_wasm.js");

let carregando: Promise<Wasm> | null = null;

/** `threads`: tamanho do pool (padrão: todos os núcleos lógicos). Só vale na primeira chamada do worker. */
export function iniciarWasmComThreads(threads: number = navigator.hardwareConcurrency || 1): Promise<Wasm> {
    carregando ??= (async () => {
        const wasm = await import("@/pkg/rust_wasm.js");
        await wasm.default();
        await wasm.initThreadPool(threads);
        // Avisa o Rust que código com rayon já pode ser chamado a partir deste worker
        wasm.marcar_pool_de_threads_pronto();
        return wasm;
    })();
    return carregando;
}
