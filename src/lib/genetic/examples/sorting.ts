import { GAProblem } from "../problem.ts";


export class SortingGAProblem implements GAProblem<number[]> {
    maxFitness?: number | undefined;
    markedA: boolean[];
    markedB: boolean[];
    constructor(private readonly size: number) { 
        this.maxFitness = (size - 1) * (size + 2);
        this.markedA = Array.from({ length: size }, () => false);
        this.markedB = Array.from({ length: size }, () => false);
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

    /**
     * https://en.wikipedia.org/wiki/Crossover_(evolutionary_algorithm)
     * Order crossover (OX1)
     * 
        1. select a random slice of consecutive genes from parent 1
        2. copy the slice to child 1 and mark out the genes in parent 2
        3. starting from the right side of the slice, copy genes from parent 2 as they appear to child 1 if they are not yet marked out.
     */
    crossover(childA: number[], childB: number[], parentA: number[], parentB: number[]): void {
        let crossoverPoint1 = Math.floor(Math.random() * this.size);
        let crossoverPoint2 = Math.floor(Math.random() * this.size);
        while(crossoverPoint2 === crossoverPoint1) {
            crossoverPoint2 = Math.floor(Math.random() * this.size);
        }
        if (crossoverPoint1 > crossoverPoint2) {
            let temp = crossoverPoint1;
            crossoverPoint1 = crossoverPoint2;
            crossoverPoint2 = temp;
        }

        for(let i = 0; i < this.size; i++) {
            this.markedA[i] = false;
            this.markedB[i] = false;
        }

        // Copia o segmento selecionado de A para o filho A e de B para o filho B
        for(let i = crossoverPoint1; i <= crossoverPoint2; i++) {
            let geneA = parentA[i]; childA[i] = geneA; this.markedA[geneA] = true;
            let geneB = parentB[i]; childB[i] = geneB; this.markedB[geneB] = true;
        }

        let indexParentB = (crossoverPoint2 + 1) % this.size;
        let indexChildA  = indexParentB;

        let indexParentA = (crossoverPoint2 + 1) % this.size;
        let indexChildB  = indexParentA;
        for(let i = 0; i < this.size; i++) {
            // Preenche o filho A com os genes de B, na ordem em que aparecem, ignorando os já copiados
            const geneA = parentB[indexParentB];
            //let foundIndexA = childA.indexOf(geneA);
            //if (foundIndexA === -1) {
            if (!this.markedA[geneA]) {
                childA[indexChildA] = geneA;
                indexChildA = (indexChildA + 1) % this.size;
            }

            indexParentB = (indexParentB + 1) % this.size;

            // Preenche o filho B com os genes de A, na ordem em que aparecem, ignorando os já copiados
            const geneB = parentA[indexParentA];
            //let foundIndexB = childB.indexOf(geneB);
            //if (foundIndexB === -1) {
            if (!this.markedB[geneB]) {
                childB[indexChildB] = geneB;
                indexChildB = (indexChildB + 1) % this.size;
            }

            indexParentA = (indexParentA + 1) % this.size;
        }
    }

    toString(genes: number[]): string {
        return genes.slice(0,32).map(num => num.toString()).join(", ");
    }
}