/// <reference lib="webworker" />

/**
 * Web Worker que executa o solver Pencilmark de horários via WASM (Rust).
 *
 * Mesmo protocolo do worker TS (horario-solver-task.worker.ts):
 *  - Recebe: { action: "solucionarQuadroHorario", formData, diasAtivos, baseIter }
 *  - Envia type="message" com progresso parcial (melhor quadro até agora)
 *  - Envia type="success" ao terminar
 *  - Envia type="error" em caso de falha
 */

import { WorkerResponseMsg } from "@/lib/workerRace";
import { construirQuadro, HorarioWorkerTaskValue, obterRegrasVioladas } from "./horario-solver";
import { FormularioHorario, HorarioDia } from "./horario-regras";
import { HorarioSolverPencilmark } from "./horario-pencilmark";

declare const self: DedicatedWorkerGlobalScope;

const postMsg = (msg: WorkerResponseMsg<HorarioWorkerTaskValue>) => {
    self.postMessage(msg);
};

/** Nós da busca processados por chamada ao WASM, entre um envio de progresso e outro. */
const ITER_POR_BLOCO = 20_000;

type PencilmarkInfo = {
    iter: number;
    depth: number;
    terminou: boolean;
    solucoes: number[][];
    melhor: number[];
};

self.onmessage = async (message) => {
    const data = message.data;

    try {
        if (data.action !== "solucionarQuadroHorario") {
            throw new Error(`Ação desconhecida: ${data.action}`);
        }

        const formData: FormularioHorario = data.formData;
        const diasAtivos: HorarioDia[] = data.diasAtivos;
        const baseIter: number | null = data.baseIter ?? null;
        // Instancia as regras em TS apenas para montar o resultado e validar violações
        const regrasTs = new HorarioSolverPencilmark(formData);

        // ── Inicializar WASM ──────────────────────────────────────────────────
        const wasmModule = await import("@/pkg/rust_wasm.js");
        await wasmModule.default();

        const runner = new wasmModule.HorarioPencilmarkRunner(formData, baseIter ?? undefined, 1);

        // ── Busca em blocos ───────────────────────────────────────────────────
        let info: PencilmarkInfo;
        let melhorAnterior = -1;
        for (;;) {
            const terminou = runner.run(ITER_POR_BLOCO);
            info = runner.get_info() as PencilmarkInfo;
            if (terminou) break;

            // Só posta progresso quando o quadro parcial melhora
            const preenchidos = info.melhor.filter((v) => v !== 0).length;
            if (info.melhor.length > 0 && preenchidos > melhorAnterior) {
                melhorAnterior = preenchidos;
                postMsg({
                    type: "message",
                    value: {
                        solucao: construirQuadro(info.melhor, info.melhor.map((v) => (v === 0 ? "Incompleto" : undefined)), regrasTs, diasAtivos),
                        iter: info.iter,
                        depth: info.depth,
                    },
                });
            }
        }

        runner.free();

        // ── Resultado final (mesma lógica de solucionarQuadroHorario) ─────────
        let quadro: number[] | undefined = info.solucoes[0];
        if (!quadro && info.melhor.length > 0) {
            // Sem solução completa: usa o melhor quadro parcial
            quadro = info.melhor;
        }
        if (!quadro || quadro.length === 0) {
            postMsg({
                type: "success",
                value: {
                    solucao: undefined,
                    violacoes: [
                        ...Array.from({ length: regrasTs.quadro.length }, () => undefined as string | undefined),
                        "Não foi possível encontrar uma solução viável para este horário com as restrições dadas.",
                    ],
                    iter: info.iter,
                    depth: 0,
                },
            });
            return;
        }

        const { violacoes } = obterRegrasVioladas(quadro, regrasTs);
        postMsg({
            type: "success",
            value: {
                solucao: construirQuadro(quadro, violacoes, regrasTs, diasAtivos),
                violacoes,
                iter: info.iter,
                depth: 0,
            },
        });
    } catch (error) {
        postMsg({
            type: "error",
            message: error instanceof Error ? error.message : "Erro desconhecido no worker WASM.",
        });
    }
};
