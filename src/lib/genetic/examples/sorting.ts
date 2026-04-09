import { crossoverOX1Operator } from "../crossoverOperators.ts";
import { mutationCombineOperator, mutationNeighborSwapOperator, mutationRandomSwapOperator, mutationShiftSwapOperator } from "../mutationOperators.ts";
import { cloneArrayOperator, GAProblem, GAProblemArray } from "../problem.ts";


export class SortingGAProblem extends GAProblemArray<number[]> {
    constructor(size: number) { 
        super(
            size,
            (size - 1) * (size + 2) /* maxFitness */
        );
    }

    mutate = mutationCombineOperator([
        { 
            operator: mutationRandomSwapOperator<number[]>(), 
            chance: 0.5 
        }, { 
            operator: mutationNeighborSwapOperator<number[]>(), 
            chance: 0.5 
        }, /*{
            operator: mutationShiftSwapOperator<number[]>(), 
            chance: 0.50
        },*/
    ]);
    crossover = crossoverOX1Operator<number[]>(this.size, gene => gene);

    randomGenes(): number[] {
        // Iniciar com um array ordenado
        const array = Array.from({ length: this.size }, (_, i) => i);
        // Embaralhar o array
        array.sort(() => Math.random() - 0.5);
        return array;
    }

    fitness(genes: number[]): number {
        let fitness = 0;
        for (let i = 0; i < genes.length; i++) {
            const b = genes[i + 0];
            if(i < genes.length - 1) {
                const c = genes[i + 1];
                if (b < c) {
                    fitness++;
                }
            }
            if(i > 0) {
                const a = genes[i - 1];
                if (a < b) {
                    fitness++;
                }
            }
            // Recompensa proporcional à proximidade da posição correta:
            // máximo (size-1) pontos quando b === i, decrescendo com a distância
            fitness += (this.size - 1) - Math.abs(b - i);
        }
        return fitness;
    }

    toStatusString(genes: number[], maxLength: number = 64): string {
        return genes.slice(0,maxLength/2).map(num => num.toString()).join(", ").substring(0, maxLength);
    }
}