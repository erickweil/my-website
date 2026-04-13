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
    initMessage?: (worker: number) => unknown;

    /** Callback para mensagens intermediárias (opcional) */
    onMessage?: (worker: number, msg: WorkerResponseMsg<T>) => void;
}

export interface RaceWorkersHandle<T> {
    /** Promise que resolve com o resultado do vencedor */
    promise: Promise<T>;
    /** Termina todos os workers e rejeita a promise com AbortError */
    abort: () => void;
}

/**
 * Executa N workers em paralelo e resolve com o resultado do primeiro que tiver sucesso.
 * Ao finalizar (sucesso ou todos falharam), todos os workers são terminados.
 * Retorna também uma função `abort` para cancelamento externo.
 */
export function raceWorkers<T>(options: RaceWorkersOptions<T>): RaceWorkersHandle<T> {
    const { n, createWorker, onMessage, initMessage } = options;
    const workers: Worker[] = [];

    const terminateAll = () => workers.forEach(w => w.terminate());

    // Captura reject fora da Promise para poder chamar via abort()
    let rejectFn!: (reason?: unknown) => void;
    let finished = false;

    const promise = new Promise<T>((resolve, reject) => {
        rejectFn = reject;
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

            worker.postMessage(initMessage ? initMessage(workerID) : null);
        }
    }).finally(terminateAll);

    const abort = () => {
        if (finished) return;
        finished = true;
        terminateAll();
        rejectFn(new DOMException("Geração interrompida pelo usuário.", "AbortError"));
    };

    return { promise, abort };
}
