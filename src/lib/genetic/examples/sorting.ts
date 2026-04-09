import { crossoverOX1Operator } from "../operators.ts";
import { GAProblem } from "../problem.ts";


export class SortingGAProblem implements GAProblem<number[]> {
    maxFitness?: number | undefined;
    constructor(private readonly size: number) { 
        this.maxFitness = (size - 1) * (size + 2);
    }

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

    clone(result: number[], genes: number[]): void {
        for(let i = 0; i < this.size; i++) {
            result[i] = genes[i];
        }
    }

    mutate(genes: number[], mutationRate: number): void {
        const mutations = Math.random() * Math.round(genes.length * mutationRate * 2);
        for(let i = 0; i < mutations; i++) {
            let randomIndex, swapWith;
            if(Math.random() < 0.5) {
                // Swap aleatório
                randomIndex = Math.floor(Math.random() * genes.length);
                swapWith = Math.floor(Math.random() * genes.length);
            } else {
                // Swap com vizinho
                randomIndex = Math.floor(Math.random() * genes.length);
                swapWith = randomIndex + (Math.random() < 0.5 ? -1 : 1);
                if (swapWith < 0) swapWith = 0;
                if (swapWith >= genes.length) swapWith = genes.length - 1;
            }
            
            // Faz alguns swaps
            const temp = genes[randomIndex];
            genes[randomIndex] = genes[swapWith];
            genes[swapWith] = temp;  
        }
    }

    crossover = crossoverOX1Operator<number[]>(this.size, gene => gene);

    toString(genes: number[]): string {
        return genes.slice(0,16).map(num => num.toString()).join(", ");
    }
}