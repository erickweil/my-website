import { crossover1PointOperator } from "../operators.ts";
import { GAProblem } from "../problem.ts";

/**
 * OneMax: maximizar o número de bits `1` em um vetor binário.
 *
 * "Hello World" dos algoritmos genéticos
 * Solução ótima: todos os bits = 1, fitness = size.
 */
export class OneMaxGAProblem implements GAProblem<boolean[]> {
    maxFitness?: number | undefined;
    constructor(
        private readonly size: number,
        public crossover = crossover1PointOperator(size)
    ) { 
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

    toString(genes: boolean[]): string {
        return genes.slice(0,32).map(bit => bit ? "1" : "0").join("");
    }
}
