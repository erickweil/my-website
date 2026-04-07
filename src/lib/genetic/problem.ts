/**
 * Define um problema a ser resolvido com um algoritmo genético.
 * G deve ser um tipo por referência (ex: array, objeto) para permitir mutação in-place.
 * G = tipo dos genes (ex: number[], boolean[], string[])
 */
export interface GAProblem<G extends object> {
    /** Inicializa os genes para uma nova população */
    randomGenes(): G;

    /**
     * Quão "boa" é a solução atual?
     * Retornar valores mais altos para soluções melhores.
     */
    fitness(genes: G): number;

    /** Copie o genoma de outro individuo sem manter referência */
    clone(genes: G, other: G): void;

    /** Mutação: Aplique uma mutação neste genoma */
    mutate(genes: G): void;

    /* Crossover entre dois genomas para criar um filho */
    crossover?(genes: G, parentA: G, parentB: G): void;

    /** Fitness Máximo, solução perfeita */
    readonly maxFitness?: number;
}