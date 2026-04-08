import { GAProblem } from "./problem";

/**
 * OneMax: maximizar o número de bits `1` em um vetor binário.
 *
 * "Hello World" dos algoritmos genéticos
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

    mutate(genes: boolean[], mutationRate: number): void {
        const mutations = Math.random() * Math.round(genes.length * mutationRate * 2);
        for(let i = 0; i < mutations; i++) {
            const randomIndex = Math.floor(Math.random() * genes.length);
            genes[randomIndex] = !genes[randomIndex];
        }
    }

    crossover(childA: boolean[], childB: boolean[], parentA: boolean[], parentB: boolean[]): void {
        const crossoverPoint = Math.floor(Math.random() * this.size);
        for(let i = 0; i < this.size; i++) {
            if (i < crossoverPoint) {
                childA[i] = parentA[i];
                childB[i] = parentB[i];
            } else {
                childA[i] = parentB[i];
                childB[i] = parentA[i];
            }
        }
    }
}