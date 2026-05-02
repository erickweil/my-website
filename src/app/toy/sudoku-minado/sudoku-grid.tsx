"use client";
import z from "zod";
import styles from "./sudoku.module.css";
import { Controller, SubmitHandler, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@/lib/classMerge";
import { useEffect, useState } from "react";
import { raceWorkers, WorkerResponseMsg } from "@/lib/workerRace";
import { WorkerTaskValue } from "./sudoku-minado-solver";

const LOCAL_STORAGE_KEY = "sudoku-minado-estado";

function mapTextoParaValor(v: string): number {
    v = v.trim();
    return v === "" ? 0 : v.endsWith("*") ? parseInt(v.substring(0, v.length-1), 10) + 6 : parseInt(v, 10)
}

function mapValorParaTexto(val: number): string {
    return val === 0 ? "" : val > 6 ? (val-6).toString()+"*" : val.toString();
}

const defaultQuadro: string[] = [
    "5*", "2*", "1*", "4*", "3", "6*",
    "4*", "6*", "3*", "1*", "5", "2",
    "3", "4", "5", "2*", "6", "1*",
    "6*", "1", "2", "5*", "4*", "3*",
    "2", "3", "4", "6", "1*", "5",
    "1", "5*", "6*", "3*", "2*", "4*",
];

const sudokuSchema = z.object({
    cell: z.array(z.string().regex(/^[1-9\s]*\*?$/)).length(6*6),
});

type DesafioStateType = {
    resolvido?: number[];
    desmarcado?: number[];
    status?: string;
    etapa?: string;
    progresso?: number;
    carregando: boolean;
};

async function executarSolverWorkers(
    n: number, 
    progressCallback: (workerID: number, iter: number, depth: number) => void
): Promise<{ solucaoCompleta: number[]; desmarcado: number[] }> {    
    const {promise, abort} = raceWorkers<WorkerTaskValue>({
        n: n,
        initMessage: (workerID) => ({ action: "solucionarQuadro", quadro: Array.from({ length: 36 }, () => 0) }),
        createWorker: () => new Worker(new URL('./solve-task.worker.ts', import.meta.url)),
        onMessage: (workerID, msg) => {
            if(!msg.value) return;
            progressCallback(workerID, msg.value.iter, msg.value.depth);
        }
    });
    const resultado = await promise;

    const quadro = resultado.solucao;
    if (!quadro) {
        throw new Error("Falha ao gerar solução!");
    }

    const desmarcarWorker = new Worker(new URL('./solve-task.worker.ts', import.meta.url));
    const desmarcado = await new Promise<number[]>((resolve, reject) => {
        desmarcarWorker.onmessage = (event: MessageEvent) => {
            const result = event.data as WorkerResponseMsg<WorkerTaskValue>;
            if (result.type === "success") {
                if(result.value?.solucao)
                resolve(result.value.solucao);
                else
                reject(new Error("Resposta de sucesso recebida, mas sem solução!"));
            } else if (result.type === "error") {
                reject(new Error(result.message || "Erro desconhecido ao desmarcar quadro"));
            } else if (result.type === "message") {
                progressCallback(-1, result.value?.iter || 0, result.value?.depth || 0);
            }
        };
        desmarcarWorker.onerror = (err) => {
            reject(new Error(`Worker de desmarcar quadro falhou: ${err.message}`));
        };
        desmarcarWorker.postMessage({ action: "desmarcarQuadro", quadro: quadro });
    }).finally(() => {
        // Garantir que o worker seja terminado após a conclusão da tarefa
        desmarcarWorker.terminate();
    });
    
    return { solucaoCompleta: quadro, desmarcado };
}

const defaultDesafioState: DesafioStateType = {
    carregando: false,
    resolvido: defaultQuadro.map(mapTextoParaValor),
    desmarcado: [
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 5,
        0, 0, 0, 0, 0, 0,
    ],
    progresso: 100,
};

const defaultCellValues = [
    "", "", "", "", "", "",
    "", "", "", "", "", "",
    "", "", "", "", "", "",
    "", "1", "", "", "", "",
    "", "", "", "", "", " ",
    "", "", "", "", "", "",
];

function carregarEstadoLocalStorage(): { desafio: DesafioStateType; cells: string[] } | null {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.desafio && parsed.cells) return parsed;
    } catch {}
    return null;
}

export default function SudokuGrid() {
    const [desafioState, setDesafioState] = useState<DesafioStateType>(
        defaultDesafioState
    );

    const { handleSubmit, control, formState: { errors }, setValue, getValues } = useForm({
        resolver: zodResolver(sudokuSchema),
        defaultValues: {
            cell: defaultCellValues,
        },
    });

    // Carrega estado do localStorage ao montar o componente
    useEffect(() => {
        const estadoSalvo = typeof window !== "undefined" ? carregarEstadoLocalStorage() : null;
        if (estadoSalvo) {
            setDesafioState(estadoSalvo.desafio);
            const cells = estadoSalvo.cells;
            for(let i = 0; i < cells.length; i++) {
                setValue(`cell.${i}`, cells[i]);
            }
        }
    }, []);

    // Salva no localStorage sempre que o desafioState mudar
    useEffect(() => {
        if (desafioState.carregando) return;
        const cells = getValues("cell");
        const estadoParaSalvar = { desafio: desafioState, cells };
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(estadoParaSalvar));
        } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [desafioState]);

    const calcularProgressoGeracao = (iter: number) => {
        const progressoPorIteracao = Math.log((iter * iter) + 1);
        return Math.max(12, Math.min(82, Math.round(12 + progressoPorIteracao)));
    };

    const salvarCells = () => {
        if (desafioState.carregando) return;
        const cells = getValues("cell");
        const estadoParaSalvar = { desafio: desafioState, cells };
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(estadoParaSalvar));
        } catch {}
    };

    const usuarioFezMarcacoes = (): boolean => {
        if (!desafioState.desmarcado) return false;
        const cells = getValues("cell");
        for (let i = 0; i < cells.length; i++) {
            const atual = cells[i].trim();
            const inicial = mapValorParaTexto(desafioState.desmarcado[i]).trim();
            if (atual !== inicial) return true;
        }
        return false;
    };

    const preencherQuadro = (valores: number[]) => {
        // Atualiza os valores do formulário com a solução
        for(let i = 0; i < valores.length; i++) {
            const val = valores[i];
            setValue(`cell.${i}`, mapValorParaTexto(val));
        }
    };

    const onSubmit: SubmitHandler<{
        cell: string[];
    }> = (data) => {
        console.log("Submitted data:", data);

        const quadro: number[] = data.cell.map(mapTextoParaValor);
        const solucao = desafioState.resolvido!;
        let vazios = false;
        for(let i = 0; i < quadro.length; i++) {
            const v = quadro[i];
            if(isNaN(v) || v < 0 || v > 12) {
                alert(`Valor inválido na célula ${i + 1}. Insira números de 1 a 6, opcionalmente seguidos de '*', ou deixe em branco.`);
                return;
            }
            if(v === 0) {
                vazios = true;
                continue;
            }
            if(v !== solucao[i]) {
                alert(`Valor incorreto na célula ${i + 1}.`);
                return;
            }
        }

        if(!vazios)
        alert("Parabéns! Você resolveu o Sudoku Minado corretamente!");
        else
        alert("Até agora tudo certo! Continue preenchendo o Sudoku Minado.");
    };

    const gerarTabela = (y: number, x: number, tableClassName: string, cellClassName: string, callback: (row: number, col: number) => React.ReactNode) => {
        return <table className={tableClassName}><tbody>
            {
                Array.from({ length: y }).map((_, rowIndex) => (
                    <tr key={rowIndex}>
                        {
                            Array.from({ length: x }).map((_, colIndex) => (
                                <td key={colIndex} className={cellClassName}>
                                    {callback(rowIndex, colIndex)}
                                </td>
                            ))
                        }
                    </tr>
                ))
            }
        </tbody></table>;
    };

    return (
        <>
        {
            desafioState.carregando && (
                <div className={styles.loadingCard}>
                    <div className={styles.loadingHeader}>
                        <div>
                            <p className={styles.loadingTitle}>Gerando novo Sudoku Minado</p>
                            <p className={styles.loadingSubtitle}>Pode demorar até 1 minuto.</p>
                        </div>
                        <span className={styles.loadingPercent}>{desafioState.progresso ?? 0}%</span>
                    </div>
                    <div
                        className={styles.progressBar}
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={desafioState.progresso ?? 0}
                        aria-label="Progresso da geração do Sudoku Minado"
                    >
                        <div
                            className={styles.progressFill}
                            style={{ width: `${desafioState.progresso ?? 0}%` }}
                        />
                    </div>
                    <div className={styles.loadingMeta}>
                        <span>{desafioState.etapa ?? "Preparando..."}</span>
                        <span>{desafioState.status ?? "Iniciando geração do desafio..."}</span>
                    </div>
                </div>
            )
        }
        <div className={styles.actionsRow}>
            <input className={cn(styles.gameButton, styles.primaryButton)} type="button" value="Gerar Novo Sudoku Minado" disabled={desafioState.carregando} onClick={() => {
                if (usuarioFezMarcacoes() && !confirm("Você tem marcações no tabuleiro. Tem certeza que deseja gerar um novo Sudoku Minado? O progresso atual será perdido.")) {
                    return;
                }
                setDesafioState({
                    carregando: true,
                    progresso: 5,
                    etapa: "Preparando tabuleiro",
                    status: "Inicializando o solucionador..."
                });

                const nWorkers = navigator.hardwareConcurrency || 8;
                executarSolverWorkers(nWorkers, (workerID, iter, depth) => {
                    const progresso = workerID === -1 ? 95 : calcularProgressoGeracao(iter);
                    setDesafioState((prevState) => ({
                        ...prevState,
                        progresso: prevState.progresso! < progresso ? progresso : prevState.progresso,
                        etapa: 
                            workerID === -1 ? "Desmarcando quadro para criar desafio" :
                            `Gerando um novo desafio com ${nWorkers} workers paralelos...`
                        ,
                        status: prevState.progresso! < progresso ? `ID:${workerID} Iterações: ${iter}, Profundidade: ${depth}` : prevState.status,
                    }));
                }).then(({ solucaoCompleta, desmarcado }) => {
                    setDesafioState({
                        resolvido: solucaoCompleta,
                        desmarcado,
                        progresso: 100,
                        carregando: false,
                    });
                    preencherQuadro(desmarcado);
                    setTimeout(salvarCells, 0);
                }).catch((e) => {
                    alert(e instanceof Error ? e.message : "Erro desconhecido ao gerar Sudoku Minado!");
                    setDesafioState({ carregando: false });
                });
            }}/>
        {
            desafioState.resolvido && 
            <input className={styles.gameButton} type="button" value="Mostrar Solução" onClick={() => {
                if(desafioState.resolvido) {
                    preencherQuadro(desafioState.resolvido);
                }
            }}/>
        }
        {
            desafioState.desmarcado && 
            <input className={styles.gameButton} type="button" value="Reiniciar" onClick={() => {
                if(desafioState.desmarcado) {
                    preencherQuadro(desafioState.desmarcado);
                }
            }}/>
        }
        </div>
        <form onSubmit={handleSubmit(onSubmit)}>
            <div className="flex flex-row gap-2 max-w-screen">
            {gerarTabela(3,2, styles.sudokuTable, styles.sudokuGroup, (rowGroup, colGroup) => {
                return gerarTabela(2,3, styles.sudokuTable, styles.sudokuCell, (row, col) => {
                    const cellId = (rowGroup * 2 + row) * 6 + (colGroup * 3 + col);
                    /*return <input 
                        type="text" 
                        //inputMode="numeric"
                        //pattern="[1-6]*" 
                        title="Insira apenas números de 1 a 6" 
                        className={cn(styles.sudokuInput, errors.cell && errors.cell[cellId]?.message ? "text-red-400" : "")} 
                        {
                            ...register(`cell.${cellId}`, 
                            { required: false })
                        }
                    />;*/
                    return <Controller
                        name={`cell.${cellId}`}
                        control={control}
                        render={({ field }) => (
                            <input 
                                type="text" 
                                //inputMode="numeric"
                                //pattern="[1-6]*" 
                                title="Insira apenas números de 1 a 6, opcionalmente seguidos de '*'" 
                                className={cn(
                                    styles.sudokuInput, 
                                    errors.cell && errors.cell[cellId]?.message ? "text-red-600" : "",
                                    field.value === "" ? styles.minesweeperfog :
                                    field.value === " " ? styles.minesweeperclear :
                                    field.value.endsWith("*") ? styles.minesweepermine : 
                                    field.value === "1" ? styles.minesweeper1 :
                                    field.value === "2" ? styles.minesweeper2 :
                                    field.value === "3" ? styles.minesweeper3 :
                                    field.value === "4" ? styles.minesweeper4 :
                                    field.value === "5" ? styles.minesweeper5 :
                                    field.value === "6" ? styles.minesweeper6 : "italic"
                                )} 
                                {...field}
                                onChange={(e) => {
                                    field.onChange(e);
                                    // Salva no localStorage após a atualização do estado do formulário
                                    setTimeout(salvarCells, 0);
                                }}
                            />
                        )}
                    />;
                });
            })}
            </div>
            <div className="flex flex-row gap-4 mt-4">
                <input className={cn(styles.gameButton, styles.submitButton)} type="submit" value="Verificar"/>
            </div>
        </form>
        </>
    );
}