export type ArrayOrView = Array<unknown> | { [index: number]: unknown, length: number };
export type CloneOperator<G> = (genes: G, other: G) => void;
export type MutationOperator<G> = (genes: G, mutationRate: number) => void;
export type CrossoverOperator<G> = (childA: G, childB: G, parentA: G, parentB: G) => void;

/**
 * Define um problema a ser resolvido com um algoritmo genético.
 * G deve ser um tipo por referência (ex: array, objeto) para permitir mutação in-place.
 * G = tipo dos genes (ex: number[], boolean[], string[])
 */
export interface GAProblem<G extends object> {
    /** Fitness Máximo, solução perfeita */
    readonly maxFitness?: number;

    /** Inicializa os genes para uma nova população */
    randomGenes(): G;

    /**
     * Quão "boa" é a solução atual?
     * Retornar valores mais altos para soluções melhores.
     */
    fitness(genes: G): number;

    /** Copie o genoma de outro individuo sem manter referência */
    clone: CloneOperator<G>;

    /** Mutação: Aplique uma mutação neste genoma */
    mutate: MutationOperator<G>;

    /* Crossover entre dois genomas para criar dois filhos */
    crossover: CrossoverOperator<G>;

    toStatusString?(genes: G, maxLength?: number): string;
}

export function cloneArrayOperator<G extends ArrayOrView>(): (genes: G, other: G) => void {
    return (genes: G, other: G) => {
        for(let i = 0; i < genes.length; i++) {
            genes[i] = other[i];
        }
    };
}

export abstract class GAProblemArray<G extends ArrayOrView> implements GAProblem<G> {
    constructor(
        public readonly size: number,
        public readonly maxFitness?: number | undefined,
    ) {}
    clone = cloneArrayOperator<G>();

    abstract randomGenes(): G;
    abstract fitness(genes: G): number;
    abstract mutate: MutationOperator<G>;
    abstract crossover: CrossoverOperator<G>;

    toStatusString(genes: G, maxLength: number = 64): string {
        //return (""+genes.slice(0,maxLength)).substring(0,maxLength);
        let str = "";
        for(let i = 0; i < Math.min(genes.length, maxLength); i++) {
            str += genes[i] + " ";
        }
        return str.trim();
    }
}