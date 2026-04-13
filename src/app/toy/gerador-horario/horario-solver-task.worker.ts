/// <reference lib="webworker" />

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
                    value: solucionarQuadroHorario(data.baseIter, data.formData, data.diasAtivos, data.solverType, postMessage)
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
