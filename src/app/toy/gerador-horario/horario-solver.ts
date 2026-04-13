import { newPossib, PencilmarkSolver, Possib } from "@/lib/pencilmark";
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

function obterRegrasVioladas(
    quadro: number[], 
    regras: HorarioSolverPencilmark
): string[] {
    const violacoes: string[] = [];
    
    const regrasFn = regras.gerarRegrasFn();
    const possibs = newPossib(0, regras.nPossibs);

    // Atualizar cache, verificar Todo o quadro
    if(!regrasFn(quadro, null)) {
        violacoes.push("Regras básicas violadas (ex: número de aulas, alocação em horários possíveis, etc)");
        return violacoes;
    }

    for(let i = 0; i < quadro.length; i++) {
        // Remove cada marcação e verifica se ela é uma das possibilidades
        const valor = quadro[i];
        if(valor === -1) continue; // espaço vazio ou sem aula, não tem regra a violar
        if(valor === 0) {
            violacoes.push(`Espaço ${i} não alocado`);
            continue;
        }
        
        possibs.resetar(true);
        possibs.index = i;
        if(!regrasFn(quadro, possibs)) {
            violacoes.push(`Marcações no espaço ${i} violam as regras`);
        }
        if(possibs.contar() <= 0 || !possibs.ler(valor - 1)) {
            violacoes.push(`Valor ${valor} no espaço ${i} não é uma possibilidade válida`);
        }
    }

    return violacoes;
}

export function solucionarQuadroHorario(
    baseIter: number | null,
    formData: FormularioHorario,
    diasAtivos: HorarioDia[],
    solverType: "pencilmark" | "genetic",
    postMessage?: (msg: WorkerResponseMsg<HorarioWorkerTaskValue>) => void
) {
    const regrasPencilmark = new HorarioSolverPencilmark(formData);
    let stats: { 
        iter: number;
        solucoes: number[][];
        melhor?: number[];
    } | undefined;

    if(solverType === "pencilmark") {
        const regras = regrasPencilmark;
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
        const regras = new HorarioGAProblem(formData);

        console.log(`Carregou ${regras.turmas.length} turmas, ${regras.disciplinas.length} disciplinas, ${regras.professores.length} professores. com ${regras.nTempos} tempos, total espaços no quadro: ${regras.size} Gerando soluções com solver genético...`);

        const ga = new GeneticAlgorithm(regras, {
            populationSize: regras.size * 2,
            maxStagnation: 3000,
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

        
        for(let i = 0; i < 1000; i++) {
            const {current, fitness, generation, genes, stagnatedFor} = ga.run(1000);
            stats = {
                iter: generation,
                solucoes: genes ? [genes] : [],
                melhor: genes,
            }

            const violacoes = obterRegrasVioladas(genes, regrasPencilmark);
            if(violacoes.length === 0) {
                break; // solução completa encontrada, pode parar
            }
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

    const violacoes = obterRegrasVioladas(quadroSolucionado, regrasPencilmark);
    for(const violacao of violacoes) {
        console.warn("Quadro solucionado viola regras:", violacao);
    }

    return {
        solucao: construirQuadro(quadroSolucionado, regrasPencilmark, diasAtivos),
        completo: violacoes.length === 0,
        iter: stats?.iter || 0,
        depth: 0
    };
}