import { GeneticAlgorithm } from "./ga.ts";
import { OneMaxGAProblem } from "./examples/one.ts";
import { StringGAProblem } from "./examples/string.ts";
import { SortingGAProblem } from "./examples/sorting.ts";
import { SudokuGAProblem } from "./examples/sudoku.ts";

function nearestPowerOfTwo(n: number) {
  return Math.pow(2, Math.ceil(Math.log2(n)))
}

/** Barra de progresso ASCII proporcional ao fitness. */
const progressBar = (current: number, total: number, width = 30): string => {
    const filled = Math.round((current / total) * width);
    return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
};

// ─── Configuração ─────────────────────────────────────────────────────────────

const PROBLEM_SIZE = 9 * 9;   // bits no vetor
const POP_SIZE = PROBLEM_SIZE * 2;   // indivíduos por geração
const MAX_GENS = 10_000_000; // limite de gerações
const MAX_STAGNATION = 10_000; // gerações sem melhoria para considerar estagnado
// ─── Execução ─────────────────────────────────────────────────────────────────

async function runTest() {
    console.log(`\n${PROBLEM_SIZE} bits`);
    console.log(`População: ${POP_SIZE}  |  Limite: ${MAX_GENS.toLocaleString()} gerações\n`);

    //const problem = new OneMaxGAProblem(PROBLEM_SIZE);
    //const problem = new SortingGAProblem(PROBLEM_SIZE);
    //const problem = new StringGAProblem(PROBLEM_SIZE);
    const problem = SudokuGAProblem.fromString(
      //"530070000600195000098000060800060003400803001700020006060000280000419005000080079"
      "000000000000000000000000000000000000000000000000000000000000000000000000000000000"
    );
    const ga = new GeneticAlgorithm(problem, {
        populationSize: POP_SIZE,
        crossoverRate: 0.9,
        mutationRate: 0.9, 
        mutationGeneRate: 1 / PROBLEM_SIZE,
        tournamentSize: 10,
        maxStagnation: MAX_STAGNATION,
        diversityCheck: true,
        progressCallback: (event): void => {
            const { generation, stagnatedFor, genes, fitness, current } = event;
            const bar = progressBar(fitness, nearestPowerOfTwo(fitness));
            const maxgenlen = ("" + MAX_GENS).length;
            const stag = stagnatedFor > 0 ? ` (+${(""+stagnatedFor).padStart(maxgenlen)} gens` : " (início)";
            process.stdout.write(
                `\rGen ${("" + generation).padStart(maxgenlen, " ")} | fitness ${("" + current).padStart(4)} / ${problem.maxFitness} (best ${("" + fitness).padStart(4)}) ${bar} ${stag} Best:\n${problem.toStatusString(genes, 32)}`,
            );
        },
    });

    const inicio = performance.now();
    const result = ga.run(MAX_GENS);
    const fim = performance.now();

    console.log(`\n${"─".repeat(60)}`);
    console.log(`Resultado, size: ${PROBLEM_SIZE}`);
    console.log(`${"─".repeat(60)}`);
    console.log(`  Status     : ${result.fitness >= problem.maxFitness! ? "✓ Resolvido" : "✗ Limite atingido"}`);
    console.log(`  Fitness    : ${result.fitness}/${problem.maxFitness}`);
    console.log(`  Gerações   : ${result.generation}`);
    console.log(`  Tempo total: ${((fim - inicio) / 1000).toFixed(2)}s (${(result.generation / ((fim - inicio) / 1000)).toFixed(1)} gen/s)`);
    console.log(`${"─".repeat(60)}\n`);


    console.log(`Melhor solução encontrada:`);
    console.log(problem.toStatusString(result.genes, 4096));
    /*const setNumbers = new Set(result.bestGenes as number[]);
    const allUnique = setNumbers.size === (result.bestGenes as number[]).length;
    console.log(`Verificação independente: ${allUnique ? "✓ todos os números são únicos" : "✗ erro"}`);
    for(let i = 0; i < PROBLEM_SIZE; i++) {
        // verifica se estão em ordem crescente
        const a = (result.bestGenes as number[])[i];
        const b = (result.bestGenes as number[])[i + 1];
        if (b !== undefined && a >= b) {
            console.log(`✗ erro: ${a} não é menor que ${b} na posição ${i}`);
            break;
        }
    }*/
    // Confirma que todos os bits são true
    //const allOnes = (result.bestGenes as boolean[]).every(Boolean);
    //console.log(`Verificação independente: ${allOnes ? "✓ todos os bits são 1" : "✗ erro"}`);
}

runTest();