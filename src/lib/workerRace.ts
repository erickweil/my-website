/**
 * Utilitário genérico para corrida de N workers concorrentes.
 * 
 * Inicia `n` instâncias do mesmo worker. O primeiro que produzir um resultado
 * de sucesso vence — todos os demais são terminados imediatamente.
 */

export type WorkerResponseMsg<T> = {
    type: "success" | "error" | "message";
    message?: string;
    value?: T;       
}
export interface RaceWorkersOptions<T> {
    /** Número de workers concorrentes */
    n: number;
    /** Fábrica que cria cada worker */
    createWorker: () => Worker;
    /** Mensagem enviada para iniciar cada worker (padrão: `null`) */
    initMessage?: unknown;

    /** Callback para mensagens intermediárias (opcional) */
    onMessage?: (worker: number, msg: WorkerResponseMsg<T>) => void;
}

/**
 * Executa N workers em paralelo e resolve com o resultado do primeiro que tiver sucesso.
 * Ao finalizar (sucesso ou todos falharam), todos os workers são terminados.
 */
export function raceWorkers<T>(options: RaceWorkersOptions<T>): Promise<T> {
    const { n, createWorker, onMessage, initMessage = null } = options;
    const workers: Worker[] = [];

    const promise = new Promise<T>((resolve, reject) => {
        let finished = false;
        let errorCount = 0;

        for (let i = 0; i < n; i++) {
            const workerID = i;
            const worker = createWorker();
            workers.push(worker);

            worker.onmessage = (event: MessageEvent) => {
                if (finished) return;

                const result = event.data as WorkerResponseMsg<T>;
                if (result.type === "success") {
                    finished = true;
                    resolve(result.value!);
                } else if (result.type === "error") {
                    errorCount++;
                    if (errorCount >= n) {
                        reject(new Error(`Todos os ${n} workers falharam. Último erro: ${result.message}`));
                    }
                } else if (result.type === "message") {
                    onMessage?.(workerID, result);
                }
            };

            worker.onerror = (err) => {
                console.error(`Worker ${workerID} error:`, err);
                if (finished) return;

                errorCount++;
                if (errorCount >= n) {
                    reject(new Error(`Todos os ${n} workers falharam com erro inesperado.`));
                }
            };

            worker.postMessage(initMessage);
        }
    });

    return promise.finally(() => {
        workers.forEach(w => w.terminate());
    });
}
