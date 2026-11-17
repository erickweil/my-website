/// <reference lib="webworker" />

/**
 * Web Worker que roda os solvers de horário em Rust/WASM (Pencilmark, busca local ou genético).
 *
 * O worker não interpreta a entrada: só repassa para o Rust, roda em blocos e encaminha o
 * resultado. Erros da entrada chegam aqui como `Error` com a mensagem pronta para o usuário.
 *
 *  - Recebe: { action: "solucionarQuadroHorario", solver, entrada, ilhas }
 *  - Envia type="message" a cada bloco de trabalho, com o progresso, e o quadro quando ele mudou
 *  - Envia type="success" ao terminar (custo 0, ou, na busca exata, horário achado ou impossível)
 *  - Envia type="error" em caso de falha
 */

import { iniciarWasmComThreads } from "@/lib/wasmThreads";
import { WorkerResponseMsg } from "@/lib/workerRace";
import { EntradaDoSolver, HorarioWorkerTaskValue, ProgressoDoSolver, ResultadoDoSolver, SolverHorario } from "./horario-regras";

declare const self: DedicatedWorkerGlobalScope;

/** Passos por chamada ao WASM: nós da busca no Pencilmark, movimentos (por cadeia) na busca local, gerações no GA. */
const PASSOS_POR_CHAMADA: Record<SolverHorario, number> = {
    pencilmark: 20_000,
    local: 20_000,
    genetic: 50,
};

/**
 * Tempo mínimo de trabalho entre uma checagem de progresso e outra. O custo de uma geração do GA
 * varia muito (tamanho do quadro, número de ilhas), então o bloco é medido em tempo, não em gerações.
 */
const MS_POR_BLOCO = 100;

/** Tempo de busca do Pencilmark em sequência antes de criar o pool de threads. */
const MS_ATE_USAR_THREADS = 300;

/**
 * Número de ilhas do GA quando a opção está ligada: uma por thread, entre 2 e 16.
 * Medido (rust-wasm/examples/bench_ga_qualidade): no quadro pequeno, 16 ilhas resolveram 18 de 20
 * execuções, 8 ilhas 16 de 20, e o modelo sem ilhas 10 de 20, com o mesmo número de avaliações.
 */
const numeroDeIlhas = () => Math.min(Math.max(navigator.hardwareConcurrency || 1, 2), 16);

/**
 * Número de cadeias da busca local: metade das threads, entre 1 e 8. Todas as cadeias fazem o mesmo
 * número de movimentos por chamada, então as rápidas esperam a mais lenta: com uma cadeia por
 * núcleo lógico, núcleos de eficiência (ou hyper-threads) seguram as outras. Medido num M1 (4 + 4
 * núcleos), no técnico real: 4 cadeias chegam a um horário válido em 0,95 s (mediana), 8 em 1,55 s
 * e uma só em 1,57 s (rust-wasm/examples/bench_busca_local).
 */
const numeroDeCadeias = () => Math.min(Math.max(Math.floor((navigator.hardwareConcurrency || 1) / 2), 1), 8);

const postMsg = (msg: WorkerResponseMsg<HorarioWorkerTaskValue>) => {
    self.postMessage(msg);
};

self.onmessage = async (message) => {
    const data = message.data;

    try {
        if (data.action !== "solucionarQuadroHorario") {
            throw new Error(`Ação desconhecida: ${data.action}`);
        }

        const solver: SolverHorario = data.solver;
        const entrada: EntradaDoSolver = data.entrada;
        const usarIlhas: boolean = data.ilhas ?? true;
        const passos = PASSOS_POR_CHAMADA[solver];
        if (!passos) {
            throw new Error(`Solver desconhecido: ${solver}`);
        }

        // O GA roda em paralelo desde o início e precisa do pool de threads; a busca local, de uma
        // thread por cadeia. O Pencilmark resolve a maioria dos quadros em milissegundos, menos que
        // o tempo de criar o pool: ele começa em sequência e só passa a dividir a busca entre as
        // threads se demorar (ver abaixo).
        const cadeias = solver === "local" ? numeroDeCadeias() : 0;
        let wasm;
        if (solver === "genetic") {
            wasm = await iniciarWasmComThreads();
        } else if (cadeias > 1) {
            wasm = await iniciarWasmComThreads(cadeias);
        } else {
            wasm = await import("@/pkg/rust_wasm.js");
            await wasm.default();
        }

        // Lança Error com a mensagem do Rust se a entrada for inválida
        const ilhas = solver === "genetic" && usarIlhas ? numeroDeIlhas() : 0;
        const runner = solver === "genetic"
            ? new wasm.HorarioGARunner(entrada, ilhas)
            : solver === "local"
              ? new wasm.HorarioBuscaLocalRunner(entrada, cadeias)
              : new wasm.HorarioPencilmarkRunner(entrada, undefined);

        try {
            const inicioDaBusca = performance.now();
            let versaoPostada = -1;
            let poolPedido = false;
            let msPorGeracao: number | undefined;
            const progresso = (resultado: ResultadoDoSolver): ProgressoDoSolver => ({
                ms: performance.now() - inicioDaBusca,
                iter: resultado.iter,
                depth: resultado.depth,
                custo: runner instanceof wasm.HorarioPencilmarkRunner ? undefined : (runner.custo() ?? undefined),
                versao: runner.versao(),
                msPorGeracao,
                ilhas,
                threads: runner instanceof wasm.HorarioPencilmarkRunner && runner.usando_threads() ? navigator.hardwareConcurrency : undefined,
                cadeias: cadeias || undefined,
            });
            for (;;) {
                let terminou = false;
                let feitos = 0;
                const inicio = performance.now();
                do {
                    terminou = runner.run(passos);
                    feitos += passos;
                } while (!terminou && performance.now() - inicio < MS_POR_BLOCO);
                if (solver === "genetic") msPorGeracao = (performance.now() - inicio) / feitos;
                if (terminou) break;

                // Pencilmark demorando: cria o pool. A busca exaustiva é a mesma; a partir daqui
                // o Rust reparte a árvore de busca entre as threads.
                if (solver === "pencilmark" && !poolPedido && performance.now() - inicioDaBusca > MS_ATE_USAR_THREADS) {
                    poolPedido = true;
                    await iniciarWasmComThreads();
                }

                // O progresso vai sempre; o quadro, só quando mudou
                const resultado = runner.get_resultado() as ResultadoDoSolver;
                const mudou = runner.versao() !== versaoPostada;
                versaoPostada = runner.versao();
                postMsg({ type: "message", value: { progresso: progresso(resultado), resultado: mudou ? resultado : undefined } });
            }

            const resultado = runner.get_resultado() as ResultadoDoSolver;
            postMsg({ type: "success", value: { progresso: progresso(resultado), resultado } });
        } finally {
            runner.free();
        }
    } catch (error) {
        postMsg({
            type: "error",
            message: error instanceof Error ? error.message : "Erro desconhecido no worker.",
        });
    }
};
