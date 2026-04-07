import { GAProblem } from "./problem";

/**
 * OneMax: maximizar o número de bits `1` em um vetor binário.
 *
 * É o "Hello World" dos algoritmos genéticos — simples o suficiente para
 * verificar que o motor está funcionando corretamente, mas não trivial
 * para populações pequenas com alta dimensão.
 *
 * Solução ótima: todos os bits = 1, fitness = size.
 */
export class OneMaxProblem implements GAProblem<boolean[]> {
    maxFitness?: number | undefined;
    constructor(private readonly size: number) { 
        this.maxFitness = size;
    }

    randomGenes(): boolean[] {
        return Array.from({ length: this.size }, () => Math.random() < 0.5);
    }

    fitness(genes: boolean[]): number {
        let count = 0;
        for (const bit of genes) {
            if (bit) count++;
        }
        return count;
    }

    clone(result: boolean[], genes: boolean[]): void {
        for(let i = 0; i < genes.length; i++) {
            result[i] = genes[i];
        }
    }

    mutate(genes: boolean[]) {
        const randomIndex = Math.floor(Math.random() * genes.length);
        genes[randomIndex] = !genes[randomIndex];
    }

    crossover(genes: boolean[], parentA: boolean[], parentB: boolean[]): void {
        const crossoverPoint = Math.floor(Math.random() * genes.length);
        for(let i = 0; i < genes.length; i++) {
            genes[i] = i < crossoverPoint ? parentA[i] : parentB[i];
        }
    }
}