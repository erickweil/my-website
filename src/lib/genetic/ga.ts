import { GAProblem } from "./problem.ts";

/**
 * Um indivíduo da população.
 * `genes` é opaco para o motor — o problema define o que significa.
 * `fitness` começa como undefined e é preenchido a cada geração.
 */
export interface Individual<G> {
    genes: G;
    fitness: number | undefined;
}

/** Configuração completa do motor genético. */
export interface GAConfig<G> {
    /** Tamanho da população por geração. Padrão: 100 */
    populationSize?: number;
    /** Limite de gerações antes de desistir. Padrão: 1_000_000 */
    maxGenerations?: number;
    /** Limiar da população que sobrevive para a próxima geração em relação à mediana (0–1). Padrão: 0.5 */
    survivalRate?: number;
    /** Tamanho do torneio para seleção de pais. Padrão: 10 */
    tournamentSize?: number;
    /** Limite de gerações sem melhora antes de desistir. Padrão: indefinido (sem limite) */
    maxStagnation?: number;

    /** Taxa de crossover entre indivíduos (probabilidade de cruzar dois indivíduos). Padrão: 0.5 */
    crossoverRate?: number;

    /** Taxa de mutação por indivíduo (probabilidade de mutar um indivíduo). Padrão: 0.5 */
    mutationRate?: number;
    /** Taxa de mutação por gene (probabilidade de mutar um gene). Padrão: 0.01 */
    mutationGeneRate?: number;


    /** Função chamada a cada melhora no melhor fitness encontrado. */
    progressCallback?: (event: {
        genes: G;
        generation: number;
        fitness: number;
        /** Quantas gerações se passaram desde a última melhora. */
        stagnatedFor: number;
    }) => void;
}

const DEFAULTS = {
    populationSize: 100,
    maxGenerations: 1_000_000,
    survivalRate: 0.5,
    tournamentSize: 10,
    maxStagnation: -1,
    crossoverRate: 0.5,
    mutationRate: 0.5,
    mutationGeneRate: 0.01,
} as const;

/**
 * Motor genético genérico.
 *
 * Estratégia: elitismo + mutação + crossover + seleção por torneio.
 */
export class GeneticAlgorithm<G extends object> {
    private readonly config: Required<GAConfig<G>>;
    private readonly population: Individual<G>[];
    constructor(
        private readonly problem: GAProblem<G>,
        config: GAConfig<G> = {},
    ) {
        this.config = {
            populationSize: config.populationSize ?? DEFAULTS.populationSize,
            maxGenerations: config.maxGenerations ?? DEFAULTS.maxGenerations,
            survivalRate: config.survivalRate ?? DEFAULTS.survivalRate,
            tournamentSize: config.tournamentSize ?? DEFAULTS.tournamentSize,
            maxStagnation: config.maxStagnation ?? DEFAULTS.maxStagnation,
            crossoverRate: config.crossoverRate ?? DEFAULTS.crossoverRate,
            mutationRate: config.mutationRate ?? DEFAULTS.mutationRate,
            mutationGeneRate: config.mutationGeneRate ?? DEFAULTS.mutationGeneRate,
            progressCallback: config.progressCallback ?? ((event) => {
                console.log(`Gen ${event.generation} | fitness ${event.fitness} (melhora após ${event.stagnatedFor} gens)`);
            }),
        };

        this.population = Array.from({ length: this.config.populationSize }, () => ({
            genes: this.problem.randomGenes(),
            fitness: undefined,
        }));
    }

    async run() {        
        let bestGenes = this.problem.randomGenes();
        this.problem.clone(bestGenes, this.population[0].genes);
        let bestFitness = this.problem.fitness(bestGenes);
        this.config.progressCallback({
            generation: 0,
            stagnatedFor: 0,
            fitness: bestFitness,
            genes: bestGenes
        });
        let lastImprovementGen = 0;

        const maxGenerations = this.config.maxGenerations;
        let gen = 0;
        for (; gen < maxGenerations; gen++) {
            // 1. Avalia a geração atual e produz a próxima, retornando o melhor indivíduo desta geração
            const currentBest = this.runGeneration();

            // 2. Verifica melhora global
            let improved = false;
            if (currentBest.fitness! > bestFitness) {
                this.problem.clone(bestGenes, currentBest.genes);
                bestFitness = currentBest.fitness!;
                improved = true;

                // Se atingiu o fitness máximo possível, podemos parar
                if (this.problem.maxFitness !== undefined && bestFitness >= this.problem.maxFitness) {
                    break;
                }
            }

            if (improved || gen % 500 === 0) {
                this.config.progressCallback({
                    generation: gen,
                    stagnatedFor: gen - lastImprovementGen,
                    genes: bestGenes,
                    fitness: bestFitness,
                });
            }

            if (improved) {
                lastImprovementGen = gen;
            } else if (
                this.config.maxStagnation >= 0
                && (gen - lastImprovementGen) >= this.config.maxStagnation
            ) {
                break;
            }

            // DEBUG
            //await new Promise(resolve => setTimeout(resolve, 100));
        }

        return {
            bestGenes: bestGenes,
            bestFitness: bestFitness,
            generations: gen
        };
    }

    // ---------------------------------------------------------------------------
    // Privados
    // ---------------------------------------------------------------------------

    /**
     * 1. Avalia o fitness de cada indivíduo (se ainda não avaliado).
     * 2. Elimina indivíduos de acordo com o critério de sobrevivência.
     * 3. Preenche o restante da população.
     * 4. Retorna o melhor indivíduo da geração (fitness mais alto).
     */
    private runGeneration(): Individual<G> {
        // Avalia fitness e encontra melhor e pior indivíduo da geração
        let best = this.population[0];
        let worse = this.population[1];
        for (const ind of this.population) {
            if (ind.fitness === undefined) {
                ind.fitness = this.problem.fitness(ind.genes);
            }
            if (ind.fitness > best.fitness!) {
                best = ind;
            }
            if (ind.fitness < worse.fitness!) {
                worse = ind;
            }
        }
        
        // Separa os sobreviventes para o início do array (in-place)
        // Worse -- AVG -- Best
        //  0.0     0.5     1.0
        // 0.0  survivalRate: só o melhor sobrevive
        // 0.5 survivalRate:  abaixo de 1.0x a mediana é eliminada
        // 1.0 survivalRate: só o pior é eliminado
        const threshold = worse.fitness! + (best.fitness! - worse.fitness!) * this.config.survivalRate;
        // Particiona a população em sobreviventes (fitness > threshold) e eliminados (fitness ≤ threshold)
        let left = 0;
        let right = this.population.length - 1;
        while (left <= right) {
            const current = this.population[left];
            if (
                current !== worse // o pior sempre morre
                && (current === best // o melhor sempre sobrevive
                || current.fitness! > threshold)
            ) {
                left++;
            } else {
                // [this.population[left], this.population[right]] = [this.population[right--], this.population[left]];
                this.population[left] = this.population[right];
                this.population[right] = current;
                right--;
            }
        }
        const survivorsCount = left;
        if(survivorsCount === this.population.length - 1) {
            // Só 1 indivíduo foi eliminado, podemos otimizar e evitar criar filhos novos
            const childA = this.population[survivorsCount];
            const parentA = GeneticAlgorithm.tournamentSelection(this.population, survivorsCount, this.config.tournamentSize);
            this.problem.clone(childA.genes, parentA.genes);
            if (Math.random() < this.config.mutationRate) {
                this.problem.mutate(childA.genes, this.config.mutationGeneRate);
            }
            childA.fitness = undefined;
        } else for(let i = survivorsCount; i < this.population.length; i += 2) {
            // Atravessa o restante da população (os eliminados) e preenche com novos indivíduos derivados dos sobreviventes
            const childA = this.population[i];
            const childB = (i+1) < this.population.length ? this.population[i + 1] : this.population[i - 1];

            // Aplicar crossover
            if (survivorsCount === 1) {
                // Só um sobrevivente, então o cruzamento é inútil, o filho é uma cópia do sobrevivente com possível mutação
                const parentA = this.population[0];
                this.problem.clone(childA.genes, parentA.genes);
                this.problem.clone(childB.genes, parentA.genes);                
            } else {
                // Seleciona pais aleatório entre os sobreviventes
                const parentA = GeneticAlgorithm.tournamentSelection(this.population, survivorsCount, this.config.tournamentSize);
                const parentB = GeneticAlgorithm.tournamentSelection(this.population, survivorsCount, this.config.tournamentSize, parentA);
                
                // Crossover entre os pais para criar os filhos com a taxa definida
                if (Math.random() < this.config.crossoverRate) {
                    this.problem.crossover(childA.genes, childB.genes, parentA.genes, parentB.genes);
                } else {
                    this.problem.clone(childA.genes, parentA.genes);
                    this.problem.clone(childB.genes, parentB.genes);
                }
            }

            // Aplica mutação com a taxa definida
            if (Math.random() < this.config.mutationRate) {
                this.problem.mutate(childA.genes, this.config.mutationGeneRate);
            }
            if (Math.random() < this.config.mutationRate) {
                this.problem.mutate(childB.genes, this.config.mutationGeneRate);
            }
            childA.fitness = undefined;
            childB.fitness = undefined;
        }

        return best;
    }

    /**
     * Seleciona um indivíduo dos sobreviventes usando seleção por torneio:
     *   1. Escolhe N indivíduos aleatórios dos sobreviventes.
     *   2. Retorna o indivíduo com o melhor fitness entre eles.
     * @param survivors Array de indivíduos sobreviventes (fitness > threshold).
     * @param survivorsCount Número de sobreviventes no array.
     * @param tournamentSize Número de indivíduos a serem comparados no torneio.
     * @returns 
     */
    static tournamentSelection<G>(survivors: Individual<G>[], survivorsCount: number, tournamentSize: number, exclude?: Individual<G>): Individual<G> {
        let best: Individual<G> | undefined;
        do {
            let individual = survivors[Math.floor(Math.random() * survivorsCount)];
            if (individual === exclude) {
                continue;
            }
            if(
                best?.fitness === undefined 
                || individual.fitness! > best.fitness
            ) {
                best = individual;
            }
        } while (--tournamentSize > 0);

        if(best) return best;

        for (let i = 0; i < survivorsCount; i++) {
            const individual = survivors[i];
            if (individual !== exclude) {
                return individual;
            }
        }

        throw new Error("Não foi possível selecionar um indivíduo (todos os sobreviventes foram excluídos)");
    }
}