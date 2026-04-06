/// <reference lib="webworker" />

import { PencilmarkSolver } from "@/lib/pencilmark";
import { WorkerResponseMsg } from "@/lib/workerRace";
import { HorarioWorkerTaskValue, solucionarQuadroHorario } from "./horario-solver";

declare const self: DedicatedWorkerGlobalScope;

const postMessage = (msg: WorkerResponseMsg<HorarioWorkerTaskValue>) => {
    self.postMessage(msg);
};

self.onmessage = async (message) => {
    const data = message.data;

    try {
        switch (data.action) {
            case "solucionarQuadroHorario":
                postMessage({ 
                    type: "success", 
                    value: solucionarQuadroHorario(data.formData, data.diasAtivos, postMessage)
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
