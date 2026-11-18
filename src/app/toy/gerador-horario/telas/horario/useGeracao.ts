/**
 * A geração do horário num worker: inicia, acompanha o progresso e para.
 *
 * Cada quadro que o solver entrega substitui o anterior (`parcial`); quando a busca termina, ou
 * quando o usuário para, o último quadro recebido é salvo no projeto. Sair da tela no meio da
 * geração também para e salva.
 */

import { useEffect, useRef, useState } from "react";
import type { WorkerResponseMsg } from "@/lib/workerRace";
import type { HorarioWorkerTaskValue, ProgressoDoSolver, SolverHorario } from "../../horario-regras";
import type { HorarioGerado, ProjetoHorario } from "../../modelo/modelo";
import { doSolver, paraSolver } from "../../modelo/para-solver";
import { alocacoesNovas } from "./quadros";

export interface Progresso {
    solver: SolverHorario;
    valor: ProgressoDoSolver;
    /** Em que momento da busca (ms) o quadro mudou pela última vez. */
    msDaMudanca: number;
}

export function useGeracao(salvarHorario: (horario: HorarioGerado) => void) {
    const [gerando, setGerando] = useState(false);
    /** Quadro parcial enquanto a busca roda. */
    const [parcial, setParcial] = useState<HorarioGerado | null>(null);
    /** Progresso da busca em andamento (ou da última, depois que ela para). */
    const [progresso, setProgresso] = useState<Progresso | null>(null);
    /** Aulas que chegaram onde estão na última atualização do quadro parcial. */
    const [novas, setNovas] = useState<Set<string>>(new Set());
    const [erro, setErro] = useState<string | null>(null);
    /** Para a busca em andamento e fica com o último quadro que ela entregou. */
    const parar = useRef<(() => void) | null>(null);
    useEffect(() => () => parar.current?.(), []);

    const gerar = (projeto: ProjetoHorario, solver: SolverHorario, ilhas: boolean) => {
        setErro(null);
        setParcial(null);
        setProgresso(null);
        setNovas(new Set());
        setGerando(true);
        let msDaMudanca = 0;
        let ultimo: HorarioGerado | null = null;
        const worker = new Worker(new URL("../../horario-wasm.worker.ts", import.meta.url));
        const encerrar = () => {
            worker.terminate();
            parar.current = null;
            if (ultimo) salvarHorario(ultimo);
            setGerando(false);
            setParcial(null);
            setNovas(new Set());
        };
        worker.onmessage = (e: MessageEvent<WorkerResponseMsg<HorarioWorkerTaskValue>>) => {
            const msg = e.data;
            const resultado = msg.value?.resultado;
            if (msg.type === "error") {
                setErro(msg.message ?? "Erro desconhecido ao gerar o horário.");
            } else if (resultado?.alocacoes) {
                const novo = doSolver(projeto, resultado);
                setNovas(alocacoesNovas(ultimo, novo));
                ultimo = novo;
                msDaMudanca = msg.value!.progresso.ms;
                setParcial(novo);
            } else if (resultado && msg.type === "success") {
                // Terminou sem chegar a nenhum quadro: fica a mensagem do solver
                ultimo = doSolver(projeto, resultado);
            }
            if (msg.value?.progresso) setProgresso({ solver, valor: msg.value.progresso, msDaMudanca });
            if (msg.type !== "message") encerrar();
        };
        worker.onerror = () => {
            setErro("Erro desconhecido ao gerar o horário.");
            encerrar();
        };
        parar.current = encerrar;
        worker.postMessage({ action: "solucionarQuadroHorario", solver, entrada: paraSolver(projeto), ilhas });
    };

    return { gerando, parcial, progresso, novas, erro, gerar, parar: () => parar.current?.() };
}
