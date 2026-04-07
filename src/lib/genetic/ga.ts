import { boolean } from "zod";
import { GAProblem } from "./problem";

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
export interface GAConfig {
    /** Tamanho da população por geração. Padrão: 100 */
    populationSize?: number;
    /** Limite de gerações antes de desistir. Padrão: 10_000 */
    maxGenerations?: number;
    /** Limiar da população que sobrevive para a próxima geração em relação à mediana (0–1). Padrão: 0.5 */
    survivalRate?: number;
    /** Tamanho do torneio para seleção de pais. Padrão: 5 */
    tournamentSize?: number;
    /** Limite de gerações sem melhora antes de desistir. Padrão: indefinido (sem limite) */
    maxStagnation?: number;

    /** Função chamada a cada melhora no melhor fitness encontrado. */
    onImprovement?: (event: {
        generation: number;
        fitness: number;
        /** Quantas gerações se passaram desde a última melhora. */
        stagnatedFor: number;
    }) => void;
}

const DEFAULTS = {
    populationSize: 100,
    maxGenerations: 10_000,
    survivalRate: 0.5,
    tournamentSize: 10,
    maxStagnation: -1,
} as const;

/**
 * Motor genético genérico.
 *
 * Estratégia: elitismo + mutação.
 * - Os `survivalRate`% melhores sobrevivem intactos (elitismo garante que nunca regredimos).
 * - O restante é preenchido com mutações de sobreviventes escolhidos aleatoriamente.
 * - Crossover será adicionado na Etapa 2, junto com genomas de permutação.
 *
 * Complexidade por geração: O(P log P) por causa do sort de fitness.
 * Para P ≤ 1000 isso é irrelevante; acima disso considere um heap parcial.
 */
export class GeneticAlgorithm<G extends object> {
    private readonly config: Required<GAConfig>;
    private readonly population: Individual<G>[];
    constructor(
        private readonly problem: GAProblem<G>,
        config: GAConfig = {},
    ) {
        this.config = {
            populationSize: config.populationSize ?? DEFAULTS.populationSize,
            maxGenerations: config.maxGenerations ?? DEFAULTS.maxGenerations,
            survivalRate: config.survivalRate ?? DEFAULTS.survivalRate,
            tournamentSize: config.tournamentSize ?? DEFAULTS.tournamentSize,
            maxStagnation: config.maxStagnation ?? DEFAULTS.maxStagnation,
            onImprovement: config.onImprovement ?? ((event) => {
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
        this.config.onImprovement({
            generation: 0,
            stagnatedFor: 0,
            fitness: bestFitness,
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

            if (improved || gen % 100 === 0) {
                this.config.onImprovement({
                    generation: gen,
                    stagnatedFor: gen - lastImprovementGen,
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
            // await new Promise(resolve => setTimeout(resolve, 1000));
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
                const fitness = this.problem.fitness(ind.genes);
                ind.fitness = fitness;
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
        let survivorsCount = 0;
        for (let i = this.population.length - 1; i >= survivorsCount;) {
            const ind = this.population[i];
            if (
                ind !== worse // o pior sempre morre
                && (ind === best // o melhor sempre sobrevive
                || ind.fitness! > threshold)
            ) {
                //this.survivors[survivorsCount++] = ind;
                
                // 1. Troca o sobrevivente para o início do array (in-place)
                // 2. Incrementa apenas o contador de sobreviventes
                // (No próximo loop vai repetir para o indivíduo trocado)
                this.population[i] = this.population[survivorsCount];
                this.population[survivorsCount] = ind;
                survivorsCount++;
            } else {
                i--;
            }
        }

        // Atravessa o restante da população (os eliminados) e preenche com novos indivíduos derivados dos sobreviventes
        for(let i = survivorsCount; i < this.population.length; i++) {
            const ind = this.population[i];
            // Seleciona um pai aleatório entre os sobreviventes
            const parent = GeneticAlgorithm.tournamentSelection(this.population, survivorsCount, this.config.tournamentSize);
            
            if (this.problem.crossover && Math.random() < 0.5) {
                // Crossover entre o pai e outro indivíduo aleatório
                const otherParent = GeneticAlgorithm.tournamentSelection(this.population, survivorsCount, this.config.tournamentSize);
                this.problem.crossover(ind.genes, parent.genes, otherParent.genes);
            } else {
                // Mutação simples a partir do pai
                this.problem.clone(ind.genes, parent.genes);
                this.problem.mutate(ind.genes);
            }
            ind.fitness = undefined;
        }

        return best;
    }

    static tournamentSelection<G>(survivors: Individual<G>[], survivorsCount: number, tournamentSize: number): Individual<G> {
        let best: Individual<G> | undefined;
        do {
            let individual = survivors[Math.floor(Math.random() * survivorsCount)];
            if(
                best?.fitness === undefined 
                || individual.fitness! > best.fitness
            ) {
                best = individual;
            }
        } while (--tournamentSize > 0);

        return best;
    }
}