import { crossoverOX1Operator } from "../../../lib/genetic/crossoverOperators.ts";
import {
    mutationCombineOperator,
    mutationNeighborSwapOperator,
    mutationRandomSwapOperator,
    mutationShiftSwapOperator,
} from "../../../lib/genetic/mutationOperators.ts";
import { GAProblemArray } from "../../../lib/genetic/problem.ts";

/** Uma cidade com coordenadas no espaço 2D (normalizadas: 0..1). */
export type TSPCity = { 
    x: number; 
    y: number 
};

/**
 * Problema do Caixeiro Viajante (TSP) para o motor genético.
 *
 * - **Genes**: permutação de índices de cidades `[0..N-1]`.
 * - **Fitness**: `1 / distânciaTotalDaRota` — quanto menor a distância, maior o fitness.
 * - **Mutação**: combinação de Swap aleatório + Shift (deslocamento), controlada por `mutationGeneRate`.
 * - **Crossover**: Order Crossover OX1, que preserva a validade da permutação (sem cidades duplicadas).
 */
export class TSPProblem extends GAProblemArray<number[]> {
    readonly cities: { x: number; y: number }[];
    constructor(
        cities: { x: number; y: number }[]
    ) {
        super(cities.length);
        this.cities = cities;
    }

    // Mutação combinada: swap aleatório é o principal agente de diversidade;
    // shift move um gene para outra posição sem quebrar a permutação.
    mutate = mutationCombineOperator<number[]>([
        { 
            operator: mutationRandomSwapOperator<number[]>(), 
            chance: 0.5 
        }, { 
            operator: mutationNeighborSwapOperator<number[]>(),
            chance: 0.5 
        },
    ]);

    // OX1: preserva sub-segmentos de ordem relativos a um dos pais,
    // completando com genes do outro pai na ordem em que aparecem.
    // getIndex para genes numéricos é simplesmente a identidade.
    crossover = crossoverOX1Operator<number[], number>(
        this.size,
        (gene: number) => gene,
    );

    /** Gera uma permutação aleatória de [0..N-1] */
    randomGenes(): number[] {
        const genes = Array.from(
            { length: this.cities.length }, 
            (_, i) => i
        );
        // Embaralha a ordem
        genes.sort(() => Math.random() - 0.5);
        return genes;
    }

    /**
     * Fitness = 1 / distância total da rota.
     * Quanto menor a distância, maior o fitness (o GA maximiza).
     */
    fitness(genes: number[]): number {
        const dist = TSPProblem.totalRouteDistance(genes, this.cities);
        return dist === 0 ? 0 : 1 / dist;
    }

    /**
     * Hash simples para checagem de diversidade.
     * Usa djb2-like sobre os primeiros genes para identificar permutações idênticas.
     */
    hash(genes: number[]): number {
        let h = 5381;
        for (let i = 0; i < genes.length; i++) {
            h = (Math.imul(h, 31) + genes[i]) | 0;
        }
        return h;
    }

    /**
     * Distância total da rota descrita pelos genes (ciclo fechado).
     * O último ponto retorna ao primeiro.
     */
    static totalRouteDistance(genes: number[], cities: TSPCity[]): number {
        let total = 0;
        const n = genes.length;
        for (let i = 0; i < n; i++) {
            const from = cities[genes[i]];
            const to = cities[genes[(i + 1) % n]];

            const dx = from.x - to.x;
            const dy = from.y - to.y;
            total += Math.sqrt(dx * dx + dy * dy);
        }
        return total;
    }

    static generateRandomCities(count: number): TSPCity[] {
        return Array.from({ length: count }, () => ({
            x: Math.random(),
            y: Math.random(),
        }));
    }
}
