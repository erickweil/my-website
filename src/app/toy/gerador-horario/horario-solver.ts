import { PencilmarkSolver, Possib } from "@/lib/pencilmark";
import { WorkerResponseMsg } from "@/lib/workerRace";
import { GeneticAlgorithm } from "@/lib/genetic/ga";
import { FormularioHorario, Horario, HorarioDia, RegrasHorario, TurmaHorarioResult } from "./horario-regras";
import { HorarioSolverPencilmark } from "./horario-pencilmark";
import { HorarioGAProblem } from "./horario-genetic";

export type HorarioWorkerTaskValue = {
    solucao?: TurmaHorarioResult[];
    completo?: boolean;
    iter: number;
    depth: number;
};

function construirQuadro(quadro: number[], regras: RegrasHorario, diasAtivos: HorarioDia[]): TurmaHorarioResult[] {
    const resultado: TurmaHorarioResult[] = regras.turmas.map((turma) => ({
        turma: turma.nome,
        horario: diasAtivos.map((dia) => {
            const diaIdx = Horario.diaSemanaMap[dia];
            const tempos: (string | null)[] = [];
            for (let tempo = 0; tempo < regras.nTempos; tempo++) {
                const valor = quadro[regras.toQuadroIndex(turma.id, diaIdx, tempo)];
                if (valor === 0) {
                    tempos.push("???"); // Não resolvido
                } else if(valor === -1) {
                    tempos.push(null); // Sem aula
                } else {
                    const disc = regras.disciplinas[valor - 1];
                    tempos.push(disc?.nome || "Disciplina Desconhecida");
                }
            }
            return { dia, tempos };
        }),
    }));
    return resultado;
}

export function solucionarQuadroHorario(
    baseIter: number | null,
    formData: FormularioHorario,
    diasAtivos: HorarioDia[],
    solverType: "pencilmark" | "genetic",
    postMessage?: (msg: WorkerResponseMsg<HorarioWorkerTaskValue>) => void
) {
    let regras: HorarioSolverPencilmark | HorarioGAProblem;
    let stats: { 
        iter: number;
        solucoes: number[][];
        melhor?: number[];
    } | undefined;

    if(solverType === "pencilmark") {
        regras = new HorarioSolverPencilmark(formData);
        // A FAZER: Somar a quantidade de aulas de cada turma, para validar caso aconteça aulas demais para o horário
        console.log(`Carregou ${regras.turmas.length} turmas, ${regras.disciplinas.length} disciplinas, ${regras.professores.length} professores. com ${regras.nTempos} tempos, total espaços no quadro: ${regras.quadro.length} (${regras.nPossibs} possibilidades cada espaço) Gerando soluções usando método pencilmark...`);

        stats = PencilmarkSolver.solucionarQuadro(
            regras.quadro,
            regras.nPossibs,
            regras.gerarRegrasFn(),
            (iter, depth, melhor) => {
                postMessage?.({ 
                    type: "message", 
                    value: { 
                        solucao: melhor ? construirQuadro(melhor, regras, diasAtivos) : undefined,
                        iter, 
                        depth 
                    } 
                });
            },
            1, // maxSolucoes
            baseIter // baseIter - começa a iterar a partir de 2^8 iterações
        );
    } else if(solverType === "genetic") {
        regras = new HorarioGAProblem(formData);

        console.log(`Carregou ${regras.turmas.length} turmas, ${regras.disciplinas.length} disciplinas, ${regras.professores.length} professores. com ${regras.nTempos} tempos, total espaços no quadro: ${regras.size} Gerando soluções com solver genético...`);

        const ga = new GeneticAlgorithm(regras, {
            populationSize: regras.size * 2,
            maxStagnation: 4000,
            crossoverRate: 0.9,
            mutationRate: 0.9,
            mutationGeneRate: 1 / regras.size, // em média 1 gene mutado por indivíduo
            diversityCheck: true,
            progressCallback: (event) => {
                const { generation, stagnatedFor, genes, fitness, current } = event;
                postMessage?.({ 
                    type: "message", 
                    value: {
                        solucao: genes ? construirQuadro(genes, regras, diasAtivos) : undefined, 
                        iter: generation, 
                        depth: stagnatedFor 
                    } 
                });
            },
        });

        const {current, fitness, generation, genes, stagnatedFor} = ga.run(100000);
        stats = {
            iter: generation,
            solucoes: genes ? [genes] : [],
            melhor: genes,
        }
    } else {
        throw new Error(`Solver type "${solverType}" não reconhecido`);
    }
    
    let quadroSolucionado = stats?.solucoes.at(0);
    if(!quadroSolucionado && stats?.melhor) {
        // Se não encontrou solução completa, mas encontrou uma solução parcial melhor que o quadro inicial, usar essa solução parcial
        quadroSolucionado = stats.melhor;
    }
    if (!quadroSolucionado || quadroSolucionado.length <= 0) {
        // Retorno normal, para parar os outros workers, já que é impossível resolver
        return {
            solucao: undefined,
            completo: false,
            iter: stats?.iter || 0,
            depth: 0
        };
    }

    return {
        solucao: construirQuadro(quadroSolucionado, regras, diasAtivos),
        completo: stats.solucoes.length > 0,
        iter: stats?.iter || 0,
        depth: 0
    };
}