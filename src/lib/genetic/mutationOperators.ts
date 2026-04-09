import { ArrayOrView, MutationOperator } from "./problem";

export function mutationCombineOperator<G>(config: {
    operator: MutationOperator<G>,
    chance: number
}[]): MutationOperator<G> {
    return (genes: G, mutationRate: number) => {
        for (const op of config) {
            op.operator(genes, mutationRate * op.chance);
        }
    };
}

export function calcMutationAmount(length: number, mutationRate: number): number {
    const value = Math.random() * (length * mutationRate * 2);
    // Round with chance
    const floor = Math.floor(value);
    const ceil = Math.ceil(value);
    return Math.random() < (value - floor) ? ceil : floor;
}

export function mutationRandomSwapOperator<G extends ArrayOrView>(): MutationOperator<G> {
    return (genes: G, mutationRate: number) => {
        const mutations = calcMutationAmount(genes.length, mutationRate);
        for(let i = 0; i < mutations; i++) {
            // Swap aleatório
            let randomIndex = Math.floor(Math.random() * genes.length);
            let swapWith = Math.floor(Math.random() * genes.length);
            while(swapWith === randomIndex) {
                swapWith = Math.floor(Math.random() * genes.length);
            }

            const temp = genes[randomIndex];
            genes[randomIndex] = genes[swapWith];
            genes[swapWith] = temp;  
        }
    };
}

export function mutationNeighborSwapOperator<G extends ArrayOrView>(): MutationOperator<G> {
    return (genes: G, mutationRate: number) => {
        const mutations = calcMutationAmount(genes.length, mutationRate);
        for(let i = 0; i < mutations; i++) {
            // Swap com vizinho
            let randomIndex = Math.floor(Math.random() * (genes.length - 2) + 1); // evitar as bordas
            let swapWith = randomIndex + (Math.random() < 0.5 ? -1 : 1);
            
            const temp = genes[randomIndex];
            genes[randomIndex] = genes[swapWith];
            genes[swapWith] = temp;  
        }
    };
}

export function mutationReplaceOperator<G extends ArrayOrView, K = G[number]>(getRandomGene: (old: K) => K): MutationOperator<G> {
    return (genes: G, mutationRate: number) => {
        const mutations = calcMutationAmount(genes.length, mutationRate);
        for(let i = 0; i < mutations; i++) {
            const randomIndex = Math.floor(Math.random() * genes.length);
            genes[randomIndex] = getRandomGene(genes[randomIndex] as K);
        }
    };
}

/**
 * De forma aleatória escolhe um elemento para ser deslocado para outra posição, deslocando os outros elementos.
 * Exemplo, da posição 1 para 3: [A, B, C, D, E] -> [A, C, D, B, E]
 */
export function mutationShiftSwapOperator<G extends ArrayOrView>(): MutationOperator<G> {
    return (genes: G, mutationRate: number) => {
        const mutations = calcMutationAmount(genes.length, mutationRate);
        for(let i = 0; i < mutations; i++) {
            let randomIndexSource = Math.floor(Math.random() * genes.length);
            let randomIndexDest = Math.floor(Math.random() * genes.length);
            while(randomIndexDest === randomIndexSource) {
                randomIndexDest = Math.floor(Math.random() * genes.length);
            }
            
            const temp = genes[randomIndexSource];
            if(randomIndexSource < randomIndexDest) {
                for(let j = randomIndexSource; j < randomIndexDest; j++) {
                    genes[j] = genes[j + 1];
                }
            } else {
                for(let j = randomIndexSource; j > randomIndexDest; j--) {
                    genes[j] = genes[j - 1];
                }
            }
            genes[randomIndexDest] = temp;
        }
    };
}