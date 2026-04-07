import { GeneticAlgorithm } from "./ga.ts";
import { OneMaxProblem } from "./one.ts";

function nearestPowerOfTwo(n: number) {
  return Math.pow(2, Math.ceil(Math.log2(n)))
}

/** Barra de progresso ASCII proporcional ao fitness. */
const progressBar = (current: number, total: number, width = 30): string => {
    const filled = Math.round((current / total) * width);
    return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
};

// ─── Configuração ─────────────────────────────────────────────────────────────

const PROBLEM_SIZE = 1000;   // bits no vetor
const POP_SIZE = 1000;   // indivíduos por geração
const MAX_GENS = 1_000_000; // limite de gerações

// ─── Execução ─────────────────────────────────────────────────────────────────

async function runTest() {
    console.log(`\nOneMax — ${PROBLEM_SIZE} bits`);
    console.log(`População: ${POP_SIZE}  |  Limite: ${MAX_GENS.toLocaleString()} gerações\n`);

    const problem = new OneMaxProblem(PROBLEM_SIZE);
    const ga = new GeneticAlgorithm(
        problem, {
        populationSize: POP_SIZE,
        maxGenerations: MAX_GENS,
        survivalRate: 0.5,
        onImprovement: (event): void => {
            const { generation, fitness, stagnatedFor } = event;
            const bar = progressBar(fitness, nearestPowerOfTwo(fitness));
            const stag = stagnatedFor > 0 ? ` (+${stagnatedFor} gens)` : " (início)";
            process.stdout.write(
                `\rGen ${("" + generation).padStart(("" + MAX_GENS).length, " ")} | fitness ${("" + fitness).padStart(4)} / ${PROBLEM_SIZE} ${bar} ${stag}`,
            );
        },
    });

    const inicio = performance.now();
    const result = await ga.run();
    const fim = performance.now();

    console.log(`\nTempo total: ${((fim - inicio) / 1000).toFixed(2)}s`);
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Resultado: OneMax (${PROBLEM_SIZE} bits)`);
    console.log(`${"─".repeat(60)}`);
    console.log(`  Status     : ${result.bestFitness >= problem.maxFitness! ? "✓ Resolvido" : "✗ Limite atingido"}`);
    console.log(`  Gerações   : ${result.generations.toLocaleString()}`);
    console.log(`  Fitness    : ${result.bestFitness}`);
    console.log(`${"─".repeat(60)}\n`);


    // Confirma que todos os bits são true
    const allOnes = (result.bestGenes as boolean[]).every(Boolean);
    console.log(`Verificação independente: ${allOnes ? "✓ todos os bits são 1" : "✗ erro"}`);
}

runTest();