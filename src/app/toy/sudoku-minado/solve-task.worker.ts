/// <reference lib="webworker" />

import { PencilmarkSolver } from "@/lib/pencilmark";
import { RegrasSudokuMinado, WorkerTaskValue } from "./sudoku-minado-solver";
import { WorkerResponseMsg } from "@/lib/workerRace";

declare const self: DedicatedWorkerGlobalScope;

const postMessage = (msg: WorkerResponseMsg<WorkerTaskValue>) => {
    self.postMessage(msg);
};

// if(typeof self === "undefined" || typeof self.postMessage !== "function") {
//     throw new Error("Deve ser executado em um ambiente de Web Worker!");
// }

function solucionarQuadro({quadro}: { quadro: number[] }) {
    const regrasSudokuMinado = new RegrasSudokuMinado();

    const stats = PencilmarkSolver.solucionarQuadro(
        quadro,
        12,
        regrasSudokuMinado.gerarRegrasFn(),
        (iter, depth) => {
            postMessage({ type: "message", value: { iter, depth } });
        },
        1, // maxSolucoes
        10 // baseIter - começa a iterar a partir de 2^8 iterações
    );

    const solucaoCompleta = stats?.solucoes.at(0);
    if (!solucaoCompleta) {
        throw new Error("Falha ao gerar solução!");
    }

    return {
        solucao: solucaoCompleta,
        iter: stats.iter,
        depth: 0
    };
}

function desmarcarQuadro({quadro}: { quadro: number[] }) {
    const regrasSudokuMinado = new RegrasSudokuMinado();
    regrasSudokuMinado.quadro = quadro;
    regrasSudokuMinado.printarQuadro();

    // 2. Remover valores para criar desafio
    const desmarcado = [...quadro];
    PencilmarkSolver.desmarcarQuadro(desmarcado, 12, regrasSudokuMinado.gerarRegrasFn(), (iter, depth) => {
        postMessage({ type: "message", value: { iter, depth } });
    });

    return {
        solucao: desmarcado,
        iter: 0,
        depth: 0
    };
}

self.onmessage = async (message) => {
    const data = message.data;

    try {
        switch (data.action) {
            case "solucionarQuadro":
                postMessage({ 
                    type: "success", 
                    value: solucionarQuadro(data)
                });
            break;
            case "desmarcarQuadro":
                postMessage({ 
                    type: "success", 
                    value: desmarcarQuadro(data)
                });
            break;
            default: throw new Error(`Ação desconhecida: ${data.action}`);
        }
    } catch (error) {
        postMessage({ 
            type: "error", 
            message: error instanceof Error ? error.message : "Erro desconhecido" 
        });
        return;
    }
};
