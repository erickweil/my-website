"use client";
import z, { set } from "zod";
import styles from "./sudoku.module.css";
import { SubmitHandler, useForm } from "react-hook-form";
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
    carregando: boolean;
};

export default function SudokuGrid() {
    const [desafioState, setDesafioState] = useState<DesafioStateType>({
        carregando: false,
    });

    const { register, handleSubmit, watch, formState: { errors }, setValue, getValues } = useForm({
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

        if(!quadro.includes(0)) {
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
        }

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

    return (
        <>
        {
            desafioState.carregando && <p className="text-red-400 text-4xl border-4 border-red-400 p-4 mb-4">
                Gerando novo desafio... por favor aguarde isso pode demorar bastante!
            </p>
        }
        <input type="button" value="Gerar Novo Sudoku Minado" onClick={() => {
            setDesafioState({carregando: true});

            setTimeout(() => {
                // 1. Gerar quadro completo solucionado
                const quadro: number[] = Array.from({ length: 6 * 6 }).map(() => 0);
                const {iter, solucoes} = PencilmarkSolver.solucionarQuadro(quadro, 12, regrasSudokuMinado);
                console.log(`Sudoku Minado completo gerado em ${iter} iterações, Soluções encontradas: ${solucoes.length}`);
                const solucaoCompleta = solucoes[0];
                printarQuadro(solucaoCompleta);

                if(!solucaoCompleta) {
                    alert("Falha ao gerar Sudoku Minado completo!");
                    setDesafioState({carregando: false});
                    return;
                }

                // 2. Remover valores para criar desafio (desmarcar)
                const desmarcado = PencilmarkSolver.desmarcarQuadro(solucaoCompleta, 12, regrasSudokuMinado);
                
                setDesafioState({
                    resolvido: solucaoCompleta,
                    desmarcado: desmarcado,
                    carregando: false,
                });
                preencherQuadro(desmarcado);
            }, 0);
        }}/>
        <form className="flex flex-row gap-2" onSubmit={handleSubmit(onSubmit)}>
            {gerarTabela(3,2, styles.sudokuTable, styles.sudokuGroup, (rowGroup, colGroup) => {
                return gerarTabela(2,3, styles.sudokuTable, styles.sudokuCell, (row, col) => {
                    const cellId = (rowGroup * 2 + row) * 6 + (colGroup * 3 + col);
                    return <input 
                        type="text" 
                        //inputMode="numeric"
                        //pattern="[1-6]*" 
                        title="Insira apenas números de 1 a 6" 
                        className={cn(styles.sudokuInput, errors.cell && errors.cell[cellId]?.message ? "text-red-400" : "")} 
                        {
                            ...register(`cell.${cellId}`, 
                            { required: false })
                        }
                    />;
                });
            })}
            <div>
                <input type="submit" value="Resolver"/>
            </div>
        </form>
        </>
    );
}