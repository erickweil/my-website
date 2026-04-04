/// <reference lib="webworker" />

import { PencilmarkSolver } from "@/lib/pencilmark";
import { RegrasSudokuMinado, WorkerTaskValue } from "./sudoku-minado-solver";
import { WorkerResponseMsg } from "@/lib/workerRace";

declare const self: DedicatedWorkerGlobalScope;

// if(typeof self === "undefined" || typeof self.postMessage !== "function") {
//     throw new Error("Deve ser executado em um ambiente de Web Worker!");
// }

self.onmessage = async () => {
    const regrasSudokuMinado = new RegrasSudokuMinado();
    const quadro: number[] = Array.from({ length: 36 }, () => 0);

    const stats = PencilmarkSolver.solucionarQuadro(
        quadro,
        12,
        regrasSudokuMinado.gerarRegrasFn(),
        (iter, depth) => {
            self.postMessage({ type: "message", value: { iter, depth } } satisfies WorkerResponseMsg<WorkerTaskValue>);
        },
        1, // maxSolucoes
    );

    const solucaoCompleta = stats?.solucoes.at(0);
    if (!solucaoCompleta) {
        self.postMessage({ 
            type: "error", 
            message: "Falha ao gerar solução!" 
        } satisfies WorkerResponseMsg<WorkerTaskValue>);
        return;
    }

    self.postMessage({ 
        type: "success", 
        value: { 
            solucao: solucaoCompleta,
            iter: stats.iter,
            depth: 0 
        } 
    } satisfies WorkerResponseMsg<WorkerTaskValue>);
};
