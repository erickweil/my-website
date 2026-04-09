import { crossover1PointOperator } from "../crossoverOperators.ts";
import { mutationReplaceOperator } from "../mutationOperators.ts";
import { GAProblemArray } from "../problem.ts";

/**
 * OneMax: maximizar o número de bits `1` em um vetor binário.
 *
 * "Hello World" dos algoritmos genéticos
 * Solução ótima: todos os bits = 1, fitness = size.
 */
export class OneMaxGAProblem extends GAProblemArray<boolean[]> {
    constructor(size: number) { 
        super(
            size, 
            size // fitness máximo é quando todos os bits são 1
        );
    }

    crossover = crossover1PointOperator<boolean[]>(this.size);
    mutate = mutationReplaceOperator<boolean[]>((v) => !v);

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

    toStatusString(genes: boolean[], maxLength: number = 64): string {
        return genes.slice(0,maxLength).map(bit => bit ? "1" : "0").join("");
    }
}
