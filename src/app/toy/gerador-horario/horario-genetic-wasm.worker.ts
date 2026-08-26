/// <reference lib="webworker" />

/**
 * Web Worker que executa o solver genético de horários via WASM (Rust).
 *
 * Protocolo de mensagens:
 *  - Recebe: { action: "solucionarQuadroHorario", formData, diasAtivos }
 *  - Envia type="message" com progresso parcial
 *  - Envia type="success" ao terminar
 *  - Envia type="error" em caso de falha
 */

import { WorkerResponseMsg } from "@/lib/workerRace";
import { construirQuadro, HorarioWorkerTaskValue } from "./horario-solver";
import { FormularioHorario, HorarioDia } from "./horario-regras";
import { HorarioSolverPencilmark } from "./horario-pencilmark";
import { obterRegrasVioladas } from "./horario-solver";

declare const self: DedicatedWorkerGlobalScope;

const postMsg = (msg: WorkerResponseMsg<HorarioWorkerTaskValue>) => {
    self.postMessage(msg);
};

self.onmessage = async (message) => {
    const data = message.data;

    try {
        if (data.action !== "solucionarQuadroHorario") {
            throw new Error(`Ação desconhecida: ${data.action}`);
        }

        const formData: FormularioHorario = data.formData;
        const diasAtivos: HorarioDia[] = data.diasAtivos;
        // Instancia o pencilmark solver apenas para validação de violações
        const regrasPencilmark = new HorarioSolverPencilmark(formData);

        // ── Inicializar WASM ──────────────────────────────────────────────────
        const wasmModule = await import("@/pkg/rust_wasm.js");
        await wasmModule.default();

        const { HorarioGAProblemRunner, GAConfig } = wasmModule;

        // ── Criar runner ──────────────────────────────────────────────────────
        const cfg = new GAConfig();
        cfg.population_size = regrasPencilmark.quadro.length * 4;
        cfg.crossover_rate = 0.9;
        cfg.mutation_rate = 0.9;
        cfg.mutation_gene_rate = 1 / regrasPencilmark.quadro.length; // em média 1 gene mutado por indivíduo
        cfg.tournament_size = 10;
        cfg.max_stagnation = 5000;
        cfg.diversity_check = false;

        console.log("Configurações do GA:", formData, cfg);
        const runner = new HorarioGAProblemRunner(formData, cfg);

        let lastBestFitness: number | undefined = undefined;
        let bestGenes: number[] | null = null;

        // ── Loop de gerações ──────────────────────────────────────────────────
        const MAX_ITERS = 1000;
        const GENS_PER_ITER = 500;

        for (let i = 0; i < MAX_ITERS; i++) {
            let startTime = performance.now();
            runner.run(GENS_PER_ITER);
            let elapsed = performance.now() - startTime;
            const info = runner.get_info() as {
                generation: number;
                best_fitness: number;
                stagnated_for: number;
                best_genes: number[] | null;
            };

            if (!info.best_genes) continue;
            bestGenes = info.best_genes;

            // Só posta progresso quando o fitness melhora
            if (lastBestFitness !== undefined && lastBestFitness >= info.best_fitness) continue;
            lastBestFitness = info.best_fitness;

            const { violacoes, algumaViolacao } = obterRegrasVioladas(bestGenes, regrasPencilmark);

            postMsg({
                type: "message",
                value: {
                    solucao: construirQuadro(bestGenes, violacoes, regrasPencilmark, diasAtivos),
                    violacoes,
                    iter: info.generation,
                    depth: info.stagnated_for,
                    msPorGeracao: elapsed / GENS_PER_ITER
                },
            });

            // Se não há violação, encontramos uma solução perfeita
            if (!algumaViolacao) break;
        }

        runner.free();

        // ── Resultado final ───────────────────────────────────────────────────
        if (!bestGenes || bestGenes.length === 0) {
            postMsg({
                type: "success",
                value: {
                    solucao: undefined,
                    violacoes: [
                        ...Array.from({ length: regrasPencilmark.quadro.length }, () => undefined as string | undefined),
                        "Não foi possível encontrar uma solução viável para este horário com as restrições dadas.",
                    ],
                    iter: 0,
                    depth: 0,
                },
            });
            return;
        }

        const { violacoes } = obterRegrasVioladas(bestGenes, regrasPencilmark);

        postMsg({
            type: "success",
            value: {
                solucao: construirQuadro(bestGenes, violacoes, regrasPencilmark, diasAtivos),
                violacoes,
                iter: 0,
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
