/// <reference lib="webworker" />

/**
 * Web Worker que roda os solvers de horário em Rust/WASM (Pencilmark ou genético).
 *
 * O worker não interpreta o formulário: só repassa para o Rust, roda em blocos e encaminha o
 * resultado. Erros do formulário chegam aqui como `Error` com a mensagem pronta para o usuário.
 *
 *  - Recebe: { action: "solucionarQuadroHorario", solver, formData, diasAtivos, ilhas }
 *  - Envia type="message" quando o melhor quadro muda
 *  - Envia type="success" ao terminar
 *  - Envia type="error" em caso de falha
 */

import { iniciarWasmComThreads } from "@/lib/wasmThreads";
import { WorkerResponseMsg } from "@/lib/workerRace";
import { FormularioHorario, HorarioDia, HorarioWorkerTaskValue, ResultadoHorario, SolverHorario } from "./horario-regras";

declare const self: DedicatedWorkerGlobalScope;

/** Passos por chamada ao WASM: nós da busca no Pencilmark, gerações no GA. */
const PASSOS_POR_CHAMADA: Record<SolverHorario, number> = {
    pencilmark: 20_000,
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

const postMsg = (msg: WorkerResponseMsg<HorarioWorkerTaskValue>) => {
    self.postMessage(msg);
};

/** O Rust devolve os 7 dias; a página mostra só os ativos. */
const filtrarDias = (resultado: ResultadoHorario, diasAtivos: HorarioDia[]): ResultadoHorario => ({
    ...resultado,
    solucao: resultado.solucao?.map((turma) => ({
        ...turma,
        horario: turma.horario.filter((d) => diasAtivos.includes(d.dia)),
    })) ?? null,
});

self.onmessage = async (message) => {
    const data = message.data;

    try {
        if (data.action !== "solucionarQuadroHorario") {
            throw new Error(`Ação desconhecida: ${data.action}`);
        }

        const solver: SolverHorario = data.solver;
        const formData: FormularioHorario = data.formData;
        const diasAtivos: HorarioDia[] = data.diasAtivos;
        const usarIlhas: boolean = data.ilhas ?? true;
        const passos = PASSOS_POR_CHAMADA[solver];
        if (!passos) {
            throw new Error(`Solver desconhecido: ${solver}`);
        }

        // O GA roda em paralelo desde o início e precisa do pool de threads. O Pencilmark resolve a
        // maioria dos quadros em milissegundos, menos que o tempo de criar o pool: ele começa em
        // sequência e só passa a dividir a busca entre as threads se demorar (ver abaixo).
        let wasm;
        if (solver === "genetic") {
            wasm = await iniciarWasmComThreads();
        } else {
            wasm = await import("@/pkg/rust_wasm.js");
            await wasm.default();
        }

        // Lança Error com a mensagem do Rust se o formulário for inválido
        const ilhas = solver === "genetic" && usarIlhas ? numeroDeIlhas() : 0;
        const runner = solver === "genetic"
            ? new wasm.HorarioGARunner(formData, ilhas)
            : new wasm.HorarioPencilmarkRunner(formData, undefined);

        try {
            let versao = runner.versao();
            const inicioDaBusca = performance.now();
            let poolPedido = false;
            for (;;) {
                let terminou = false;
                let feitos = 0;
                const inicio = performance.now();
                do {
                    terminou = runner.run(passos);
                    feitos += passos;
                } while (!terminou && performance.now() - inicio < MS_POR_BLOCO);
                const msPorGeracao = solver === "genetic" ? (performance.now() - inicio) / feitos : undefined;
                if (terminou) break;

                // Pencilmark demorando: cria o pool. A busca exaustiva é a mesma; a partir daqui
                // o Rust reparte a árvore de busca entre as threads.
                if (solver === "pencilmark" && !poolPedido && performance.now() - inicioDaBusca > MS_ATE_USAR_THREADS) {
                    poolPedido = true;
                    await iniciarWasmComThreads();
                }

                // Só posta progresso quando o melhor quadro mudou
                if (runner.versao() !== versao) {
                    versao = runner.versao();
                    const resultado = runner.get_resultado() as ResultadoHorario;
                    const threads = runner instanceof wasm.HorarioPencilmarkRunner && runner.usando_threads()
                        ? navigator.hardwareConcurrency
                        : undefined;
                    postMsg({ type: "message", value: { ...filtrarDias(resultado, diasAtivos), msPorGeracao, ilhas, threads } });
                }
            }

            postMsg({ type: "success", value: filtrarDias(runner.get_resultado() as ResultadoHorario, diasAtivos) });
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
