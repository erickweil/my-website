"use client";
import z, { set } from "zod";
import styles from "./sudoku.module.css";
import { Controller, SubmitHandler, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@/lib/classMerge";
import { printarQuadro, regrasSudokuMinado } from "./sudoku-minado-solver";
import { PencilmarkSolver } from "@/lib/pencilmark";
import { useState } from "react";

const sudokuSchema = z.object({
    cell: z.array(z.string().regex(/^[1-9]*\*?$/)).length(6*6),
});

type DesafioStateType = {
    resolvido?: number[];
    desmarcado?: number[];
    status?: string;
    carregando: boolean;
};

export default function SudokuGrid() {
    const [desafioState, setDesafioState] = useState<DesafioStateType>({
        carregando: false
    });

    const { register, handleSubmit, control, watch, formState: { errors }, setValue, getValues } = useForm({
        resolver: zodResolver(sudokuSchema),
        defaultValues: {
            cell: Array.from({ length: 6 * 6 }).map(() => ""),
        },
    });

    const preencherQuadro = (valores: number[]) => {
        // Atualiza os valores do formulário com a solução
        for(let i = 0; i < valores.length; i++) {
            const val = valores[i];
            setValue(`cell.${i}`, val === 0 ? "" : val > 6 ? (val-6).toString()+"*" : val.toString());
        }
    };

    const onSubmit: SubmitHandler<{
        cell: string[];
    }> = (data) => {
        console.log("Submitted data:", data);

        const quadro: number[] = data.cell.map((v) => v === "" ? 0 : v.endsWith("*") ? parseInt(v.substring(0, v.length-1), 10) + 6 : parseInt(v, 10));
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

        /*if(!quadro.includes(0)) {
            console.log("O quadro já está completo. Desmarcando...");

            const desmarcado = PencilmarkSolver.desmarcarQuadro(quadro, 12, regrasSudokuMinado);
            preencherQuadro(desmarcado);
            return;
        }

        const {iter, solucoes} = PencilmarkSolver.solucionarQuadro(quadro, 12, regrasSudokuMinado);
        console.log(`Sudoku Minado solucionado em ${iter} iterações, Soluções encontradas: ${solucoes.length}`);
        const solucao = solucoes[0];
        printarQuadro(solucao);

        if(solucao) {
            preencherQuadro(solucao);
        }*/

        /*// Obter possibilidades de cada célula
        for(let i = 0; i < quadro.length; i++) {
            const possibs = new Possib(i, 12);
            regrasSudokuMinado(quadro, possibs);
            
            let str = "";
            let nPossibs = 0;
            for(let v = 1; v <= 12; v++) {
                if(possibs.p[v - 1]) {
                    str += v > 6 ? (v-6).toString()+"* " : v.toString()+" ";
                    nPossibs++;
                }
            }
            if(nPossibs === 1) {
                setValue(`cell.${i}`, str.trim());
            }
        }*/
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

    console.log("Renderizando SudokuGrid, estado do desafio:", desafioState);
    return (
        <>
        {
            desafioState.carregando && <p className="text-red-400 text-4xl border-4 border-red-400 p-4 mb-4">
                Gerando novo desafio (Pode demorar até 1 minuto)... 
                { desafioState.status }
            </p>
        }
        <input type="button" value="Gerar Novo Sudoku Minado" disabled={desafioState.carregando} onClick={() => {
            setDesafioState({carregando: true});

            setTimeout(async () => {
                // 1. Gerar quadro completo solucionado
                const quadro: number[] = Array.from({ length: 6 * 6 }).map(() => 0);
                const {iter, solucoes} = await PencilmarkSolver.solucionarQuadro(quadro, 12, regrasSudokuMinado, async (iter, depth) => {
                    setDesafioState((prevState) => ({
                        ...prevState,
                        status: `Iterações: ${iter}, Profundidade: ${depth}`
                    }));
                });
                console.log(`Sudoku Minado completo gerado em ${iter} iterações, Soluções encontradas: ${solucoes.length}`);
                const solucaoCompleta = solucoes[0];
                printarQuadro(solucaoCompleta);

                if(!solucaoCompleta) {
                    alert("Falha ao gerar Sudoku Minado completo!");
                    setDesafioState({carregando: false});
                    return;
                }

                // 2. Remover valores para criar desafio (desmarcar)
                const desmarcado = [...solucaoCompleta];
                await PencilmarkSolver.desmarcarQuadro(desmarcado, 12, regrasSudokuMinado);
                
                setDesafioState({
                    resolvido: solucaoCompleta,
                    desmarcado: desmarcado,
                    carregando: false,
                });
                preencherQuadro(desmarcado);
            }, 0);
        }}/>
        {
            desafioState.resolvido && 
            <input type="button" value="Mostrar Solução" onClick={() => {
                if(desafioState.resolvido) {
                    preencherQuadro(desafioState.resolvido);
                }
            }}/>
        }
        {
            desafioState.desmarcado && 
            <input type="button" value="Reiniciar" onClick={() => {
                if(desafioState.desmarcado) {
                    preencherQuadro(desafioState.desmarcado);
                }
            }}/>
        }
        <form className="flex flex-row gap-2" onSubmit={handleSubmit(onSubmit)}>
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
                            />
                        )}
                    />;
                });
            })}
            <div>
                <input type="submit" value="Verificar"/>
            </div>
        </form>
        </>
    );
}