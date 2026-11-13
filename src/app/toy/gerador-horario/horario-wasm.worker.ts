/// <reference lib="webworker" />

/**
 * Web Worker que roda os solvers de horário em Rust/WASM (Pencilmark ou genético).
 *
 * O worker não interpreta o formulário: só repassa para o Rust, roda em blocos e encaminha o
 * resultado. Erros do formulário chegam aqui como `Error` com a mensagem pronta para o usuário.
 *
 *  - Recebe: { action: "solucionarQuadroHorario", solver, formData, diasAtivos }
 *  - Envia type="message" quando o melhor quadro muda
 *  - Envia type="success" ao terminar
 *  - Envia type="error" em caso de falha
 */

import { WorkerResponseMsg } from "@/lib/workerRace";
import { FormularioHorario, HorarioDia, HorarioWorkerTaskValue, ResultadoHorario, SolverHorario } from "./horario-regras";

declare const self: DedicatedWorkerGlobalScope;

/** Passos por chamada ao WASM: nós da busca no Pencilmark, gerações no GA. */
const PASSOS_POR_BLOCO: Record<SolverHorario, number> = {
    pencilmark: 20_000,
    genetic: 500,
};

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
        const passos = PASSOS_POR_BLOCO[solver];
        if (!passos) {
            throw new Error(`Solver desconhecido: ${solver}`);
        }

        const wasm = await import("@/pkg/rust_wasm.js");
        await wasm.default();

        // Lança Error com a mensagem do Rust se o formulário for inválido
        const runner = solver === "genetic"
            ? new wasm.HorarioGARunner(formData)
            : new wasm.HorarioPencilmarkRunner(formData, undefined);

        try {
            let versao = runner.versao();
            for (;;) {
                const inicio = performance.now();
                const terminou = runner.run(passos);
                const msPorGeracao = solver === "genetic" ? (performance.now() - inicio) / passos : undefined;
                if (terminou) break;

                // Só posta progresso quando o melhor quadro mudou
                if (runner.versao() !== versao) {
                    versao = runner.versao();
                    const resultado = runner.get_resultado() as ResultadoHorario;
                    postMsg({ type: "message", value: { ...filtrarDias(resultado, diasAtivos), msPorGeracao } });
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
