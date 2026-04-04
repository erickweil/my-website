/// <reference lib="webworker" />

import { RegrasSudokuMinado } from "./sudoku-minado-solver";
import { PencilmarkSolver } from "@/lib/pencilmark";

declare const self: DedicatedWorkerGlobalScope;

if(typeof self === "undefined" || typeof self.postMessage !== "function") {
    throw new Error("Deve ser executado em um ambiente de Web Worker!");
}

type WorkerResponse =
    | { type: "progress"; iter: number; depth: number }
    | { type: "desmarcando" }
    | { type: "done"; solucaoCompleta: number[]; desmarcado: number[] }
    | { type: "error"; message: string };

self.onmessage = () => {
    const regrasSudokuMinado = new RegrasSudokuMinado();
    const quadro: number[] = Array.from({ length: 36 }, () => 0);

    // 1. Gerar quadro completo solucionado
    const { solucoes } = PencilmarkSolver.solucionarQuadro(
        quadro,
        12,
        regrasSudokuMinado.gerarRegrasFn(),
        (iter, depth) => {
            console.log(`iter: ${iter} Depth: ${depth}`);
            self.postMessage({ type: "progress", iter, depth } satisfies WorkerResponse);
        }
    );

    const solucaoCompleta = solucoes[0];
    if (!solucaoCompleta) {
        self.postMessage({ type: "error", message: "Falha ao gerar Sudoku Minado completo!" } satisfies WorkerResponse);
        return;
    }

    regrasSudokuMinado.quadro = solucaoCompleta;
    regrasSudokuMinado.printarQuadro();

    // 2. Remover valores para criar desafio
    self.postMessage({ type: "desmarcando" } satisfies WorkerResponse);
    const desmarcado = [...solucaoCompleta];
    PencilmarkSolver.desmarcarQuadro(desmarcado, 12, regrasSudokuMinado.gerarRegrasFn());

    self.postMessage({ type: "done", solucaoCompleta, desmarcado } satisfies WorkerResponse);
};
