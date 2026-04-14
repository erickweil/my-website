import { newPossib, PencilmarkSolver, Possib } from "@/lib/pencilmark";
import { WorkerResponseMsg } from "@/lib/workerRace";
import { GeneticAlgorithm } from "@/lib/genetic/ga";
import { FormularioHorario, Horario, HorarioDia, RegrasHorario, TurmaHorarioResult } from "./horario-regras";
import { HorarioSolverPencilmark } from "./horario-pencilmark";
import { HorarioGAProblem } from "./horario-genetic";

export type HorarioWorkerTaskValue = {
    solucao?: TurmaHorarioResult[];
    violacoes?: Array<string | undefined>;
    iter: number;
    depth: number;
};

function construirQuadro(quadro: number[], violacoes: Array<string | undefined>, regras: RegrasHorario, diasAtivos: HorarioDia[]): TurmaHorarioResult[] {
    const resultado: TurmaHorarioResult[] = regras.turmas.map((turma) => ({
        turma: turma.nome,
        horario: diasAtivos.map((dia) => {
            const diaIdx = Horario.diaSemanaMap[dia];
            const tempos: Array<{
                descricao: string | null; // nome da disciplina, "???" para não resolvido, null para sem aula
                violacao?: string; // descrição da violação, se houver
            }> = [];
            for (let tempo = 0; tempo < regras.nTempos; tempo++) {
                const quadroIndex = regras.toQuadroIndex(turma.id, diaIdx, tempo);
                const valor = quadro[quadroIndex];
                let descricao: string | null = null;
                if (valor === 0) {
                    descricao = "???"; // Não resolvido
                } else if(valor === -1) {
                    descricao = null; // Sem aula
                } else {
                    const disc = regras.disciplinas[valor - 1];
                    descricao = disc?.nome || "Disciplina Desconhecida";
                }

                tempos.push({
                    descricao,
                    violacao: violacoes[quadroIndex] || undefined
                });
            }
            return { dia, tempos };
        }),
    }));
    return resultado;
}

export function obterRegrasVioladas(
    quadro: number[], 
    regras: HorarioSolverPencilmark
): { violacoes: Array<string | undefined>, algumaViolacao: boolean } {
    let algumaViolacao = false;
    const violacoes: Array<string | undefined> = quadro.map(() => undefined); // inicialmente sem violações
    violacoes.push(undefined);
    
    const regrasFn = regras.gerarRegrasFn();
    const possibs = newPossib(-1, regras.nPossibs);

    // Atualizar cache, verificar Todo o quadro
    if(!regrasFn(quadro, null)) {
        violacoes[violacoes.length - 1] = "Regras básicas violadas (ex: número de aulas, alocação em horários possíveis, etc)";
        algumaViolacao = true;
    }

    for(let i = 0; i < quadro.length; i++) {
        // Remove cada marcação e verifica se ela é uma das possibilidades
        const valor = quadro[i];
        if(valor === -1) continue; // espaço vazio ou sem aula, não tem regra a violar
        if(valor === 0) {
            violacoes[i] = "Este espaço não deveria estar vazio";
            algumaViolacao = true;
            continue;
        }
        
        // Remove a marcação atual para testar as possibilidades restantes
        quadro[i] = 0;
        // Atualiza o cache para refletir a remoção, já que algumas regras dependem do estado atual do quadro
        regrasFn(quadro, null);

        possibs.resetar(true);
        possibs.index = i;
        if(!regrasFn(quadro, possibs)) {
            violacoes[i] = "Algo de errado não está certo";
            algumaViolacao = true;
        } else if(possibs.contar() <= 0 || !possibs.ler(valor - 1)) {
            violacoes[i] = "Marcação não deveria estar aqui";
            algumaViolacao = true;
        }
        
        // Restaura o valor original para a próxima iteração
        quadro[i] = valor;
    }

    return {
        violacoes,
        algumaViolacao
    };
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
                        solucao: melhor ? construirQuadro(melhor, melhor.map((v) => v === 0 ? "Incompleto" : undefined), regras, diasAtivos) : undefined,
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
            populationSize: regras.size * 4,
            maxStagnation: 5000,
            crossoverRate: 0.9,
            mutationRate: 0.9,
            mutationGeneRate: 1 / regras.size, // em média 1 gene mutado por indivíduo
            diversityCheck: true
        });

        let lastFitness: number | undefined = undefined;
        for(let i = 0; i < 1000; i++) {
            const {current, fitness, generation, genes, stagnatedFor} = ga.run(500);
            stats = {
                iter: generation,
                solucoes: genes ? [genes] : [],
                melhor: genes,
            }

            if(lastFitness === undefined || lastFitness < fitness) {
                lastFitness = fitness;
            } else {
                continue;
            }

            const { violacoes, algumaViolacao} = obterRegrasVioladas(genes, regrasPencilmark);
            if(!algumaViolacao) {
                break; // solução completa encontrada, pode parar
            }

            postMessage?.({ 
                type: "message", 
                value: {
                    solucao: genes ? construirQuadro(genes, violacoes, regrasPencilmark, diasAtivos) : undefined, 
                    violacoes: violacoes,
                    iter: generation, 
                    depth: stagnatedFor 
                } 
            });
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
            violacoes: [
                ...Array.from({ length: regrasPencilmark.quadro.length }, () => undefined), 
                "Não foi possível encontrar uma solução viável para este horário com as restrições dadas."
            ],
            iter: stats?.iter || 0,
            depth: 0
        };
    }

    const {violacoes, algumaViolacao} = obterRegrasVioladas(quadroSolucionado, regrasPencilmark);
    
    return {
        solucao: construirQuadro(quadroSolucionado, violacoes, regrasPencilmark, diasAtivos),
        violacoes: violacoes,
        iter: stats?.iter || 0,
        depth: 0
    };
}