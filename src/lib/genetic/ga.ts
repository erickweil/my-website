import { GAProblem } from "./problem.ts";

/**
 * Um indivíduo da população.
 * `genes` é opaco para o motor — o problema define o que significa.
 * `fitness` começa como undefined e é preenchido a cada geração.
 */
export interface Individual<G> {
    genes: G;
    // lazy, preenchido só quando necessário
    fitness: number | undefined;
    hash: number | undefined;
}

/** Configuração completa do motor genético. */
export interface GAConfig<G> {
    /** Tamanho da população por geração. Padrão: 100 */
    populationSize?: number;
    /** Limite de gerações antes de desistir. Padrão: 1_000_000 */
    maxGenerations?: number;
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


    /**
     * Se true previne indivíduos idênticos (problema deve implementar `hash()`)
     * Padrão false
     */
    diversityCheck?: boolean;

    /** Função chamada a cada melhora no melhor fitness encontrado. */
    progressCallback?: (event: {
        genes: G;
        generation: number;
        fitness: number;
        current: number;
        /** Quantas gerações se passaram desde a última melhora. */
        stagnatedFor: number;
    }) => void;
}

const DEFAULTS = {
    populationSize: 100,
    maxGenerations: 1_000_000,
    tournamentSize: 10,
    maxStagnation: -1,
    crossoverRate: 0.5,
    mutationRate: 0.5,
    mutationGeneRate: 0.01,
    diversityCheck: false,
} as const;

/**
 * Motor genético genérico.
 *
 * Estratégia: elitismo + mutação + crossover + seleção por torneio.
 */
export class GeneticAlgorithm<G extends object> {
    private population: Individual<G>[];
    private offspring: Individual<G>[];
    private populationHashes: Set<number>;
    constructor(
        private readonly problem: GAProblem<G>
    ) {
        this.population = [];
        this.offspring = [];
        this.populationHashes = new Set();
    }

    async run(_config: GAConfig<G> = {}) {
        const config = {
            populationSize: _config.populationSize ?? DEFAULTS.populationSize,
            maxGenerations: _config.maxGenerations ?? DEFAULTS.maxGenerations,
            tournamentSize: _config.tournamentSize ?? DEFAULTS.tournamentSize,
            maxStagnation: _config.maxStagnation ?? DEFAULTS.maxStagnation,
            crossoverRate: _config.crossoverRate ?? DEFAULTS.crossoverRate,
            mutationRate: _config.mutationRate ?? DEFAULTS.mutationRate,
            mutationGeneRate: _config.mutationGeneRate ?? DEFAULTS.mutationGeneRate,
            progressCallback: _config.progressCallback ?? ((event) => {
                console.log(`Gen ${event.generation} | fitness ${event.fitness} (melhora após ${event.stagnatedFor} gens)`);
            }),
            diversityCheck: _config.diversityCheck ?? DEFAULTS.diversityCheck,

            mutationMultiplier: 1,
        };

        const runGenConfig = {
            tournamentSize: config.tournamentSize,
            crossoverRate: config.crossoverRate,
            mutationRate: config.mutationRate,
            mutationGeneRate: config.mutationGeneRate, 
            hashFn: config.diversityCheck ? this.problem.hash?.bind(this.problem) : undefined,
        };
        
        let bestGenes = this.problem.randomGenes();
        let bestFitness = 0;
        let stagFitness = 0;
        let lastImprovementGen = 0;
        config.progressCallback({
            generation: 0,
            stagnatedFor: 0,
            fitness: bestFitness,
            current: bestFitness,
            genes: bestGenes
        });

        // 0. Inicializa a população (gera indivíduos aleatórios para preencher a população até o tamanho definido)
        this.initializePopulation(config.populationSize);

        let gen = 0;
        for (; gen < config.maxGenerations; gen++) {
            // 1. Avalia a geração atual e produz a próxima, retornando o melhor indivíduo desta geração
            runGenConfig.mutationRate = config.mutationRate * config.mutationMultiplier;
            runGenConfig.mutationGeneRate = config.mutationGeneRate * config.mutationMultiplier;
            const currentBest = this.runGeneration(runGenConfig);

            // 2. Verifica melhora global
            if (currentBest.fitness! > bestFitness) {
                this.problem.clone(bestGenes, currentBest.genes);
                bestFitness = currentBest.fitness!;

                // Se atingiu o fitness máximo possível, podemos parar
                if (this.problem.maxFitness !== undefined && bestFitness >= this.problem.maxFitness) {
                    break;
                }
            }

            let improved = false;
            if (currentBest.fitness! > stagFitness) {
                stagFitness = currentBest.fitness!;
                improved = true;
            }

            if (improved || gen % 1000 === 0) {
                config.progressCallback({
                    generation: gen,
                    stagnatedFor: gen - lastImprovementGen,
                    genes: bestGenes,
                    fitness: bestFitness,
                    current: stagFitness,
                });
            }

            if (improved) {
                lastImprovementGen = gen;
                config.mutationMultiplier = 1;
            } else if (config.maxStagnation > 0) {
                // Se não houve melhora, podemos aumentar a taxa de mutação para tentar escapar de platôs
                // Aumenta a taxa de mutação em até 2x após STAG/2 gerações sem melhora, e continua aumentando linearmente depois disso
                const stagnatedFor = gen - lastImprovementGen;
                
                // Experimento: aumentar taxa de mutação gradualmente
                const halfStagnation = config.maxStagnation * 0.5;
                // 1.0 ... 2.0+
                config.mutationMultiplier = 1 + Math.max(0, stagnatedFor - halfStagnation) / halfStagnation;

                if (stagnatedFor >= config.maxStagnation) {
                    console.log(`Estagnado por ${stagnatedFor} gerações, realizando assassinato de TODOS`);
                    this.initializePopulation(config.populationSize);
                    stagFitness = 0;
                }/* else if(stagnatedFor > config.maxStagnation * 0.50 && Math.random() < 0.0001) {
                    const survivor = this.population[Math.floor(Math.random() * this.population.length)];
                    const copy = this.problem.randomGenes();
                    this.problem.clone(copy, survivor.genes);

                    this.initializePopulation(config.populationSize);

                    // Mantém o aleatório
                    this.problem.clone(this.population[0].genes, copy);
                    this.population[0].fitness = undefined;
                }*/
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
     * Inicializa a população para a primeira geração.
     * Se a população já tiver indivíduos (de execuções anteriores), eles serão re-inicializados
     */
    private initializePopulation(populationSize: number) {
        // Re-inicializa os indivíduos existentes
        for(let i = 0; i < this.population.length; i++) {
            const ind = this.population[i];
            this.problem.clone(ind.genes, this.problem.randomGenes());
            ind.fitness = undefined;
            ind.hash = undefined;
        }
        // Preenche o restante da população com novos indivíduos aleatórios
        for(let i = this.population.length; i < populationSize; i++) {
            this.population.push({
                genes: this.problem.randomGenes(),
                fitness: undefined,
                hash: undefined,
            });
            this.offspring.push({
                genes: this.problem.randomGenes(),
                fitness: undefined,
                hash: undefined,
            });
        }
        // Remove o excesso
        if (this.population.length > populationSize) {
            this.population.length = populationSize;
            this.offspring.length = populationSize;
        }

        this.populationHashes.clear();
    }

    /**
     * 1. Avalia o fitness de cada indivíduo (se ainda não avaliado).
     * 2. Realiza seleção + reprodução, para criar a próxima geração:
     * 3. Torna os filhos a população da próxima geração
     * 4. Retorna o melhor indivíduo da geração (fitness mais alto).
     */
    private runGeneration(config: {
        tournamentSize: number;
        crossoverRate: number;
        mutationRate: number;
        mutationGeneRate: number;
        hashFn?: (genes: G) => number;
    }): Individual<G> {
        if (config.hashFn) {
            this.populationHashes.clear();
        }
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
       
        // Faz a seleção + reprodução, para criar a próxima geração
        for(let i = 1; i < this.population.length; i += 2) {
            // Atravessa o restante da população (os eliminados) e preenche com novos indivíduos derivados dos sobreviventes
            const childA = this.offspring[i];
            const childB = (i+1) < this.population.length ? this.offspring[i + 1] : this.offspring[i - 1];

            // Seleciona pais aleatório entre os sobreviventes
            const parentA = GeneticAlgorithm.tournamentSelection(this.population, this.population.length, config.tournamentSize);
            const parentB = GeneticAlgorithm.tournamentSelection(this.population, this.population.length, config.tournamentSize, parentA);
            
            // Crossover entre os pais para criar os filhos com a taxa definida
            if (Math.random() < config.crossoverRate) {
                this.problem.crossover(childA.genes, childB.genes, parentA.genes, parentB.genes);
            } else {
                this.problem.clone(childA.genes, parentA.genes);
                this.problem.clone(childB.genes, parentB.genes);
            }
            
            // Aplica mutação com a taxa definida
            if (Math.random() < config.mutationRate) {
                this.problem.mutate(childA.genes, config.mutationGeneRate);
            }
            if (Math.random() < config.mutationRate) {
                this.problem.mutate(childB.genes, config.mutationGeneRate);
            }
            childA.fitness = undefined;
            childB.fitness = undefined;

            // Verificação de diversidade: remuta filhos duplicados da geração atual
            if (config.hashFn) {
                childA.hash = config.hashFn(childA.genes);
                childB.hash = config.hashFn(childB.genes);

                let attempts = 0;
                while (this.populationHashes.has(childA.hash) && attempts++ < 10) {
                    this.problem.mutate(childA.genes, config.mutationGeneRate * attempts);
                    childA.hash = config.hashFn(childA.genes);
                }
                while (this.populationHashes.has(childB.hash) && attempts++ < 20) {
                    this.problem.mutate(childB.genes, config.mutationGeneRate * attempts);
                    childB.hash = config.hashFn(childB.genes);
                }

                this.populationHashes.add(childA.hash!);
                this.populationHashes.add(childB.hash!);
            }
        }

        // O melhor indivíduo da geração atual é copiado para a próxima geração (elitismo)
        this.problem.clone(this.offspring[0].genes, best.genes);
        this.offspring[0].fitness = best.fitness;
        this.offspring[0].hash = best.hash;

        // Torna os filhos a população da próxima geração
        // Em vez de criar um novo array, podemos simplesmente trocar os papéis dos arrays population e offspring para evitar cópias desnecessárias
        let temp = this.population;
        this.population = this.offspring;
        this.offspring = temp;

        return best;
    }

    /**
     * Seleciona um indivíduo da população usando seleção por torneio:
     *   1. Escolhe N indivíduos aleatórios da população (onde N é o tamanho do torneio).
     *   2. Retorna o indivíduo com o melhor fitness entre eles.
     * @param population Array que será selecionado
     * @param populationCount Até onde do array considerar para seleção
     * @param tournamentSize Número de indivíduos a serem comparados no torneio.
     * @param exclude Indivíduo a ser excluído da seleção (opcional, usado para evitar selecionar o mesmo indivíduo como pai A e pai B)
     * @returns 
     */
    static tournamentSelection<G>(population: Individual<G>[], populationCount: number, tournamentSize: number, exclude?: Individual<G>): Individual<G> {
        let best: Individual<G> | undefined;
        do {
            let individual = population[Math.floor(Math.random() * populationCount)];
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

        for (let i = 0; i < populationCount; i++) {
            const individual = population[i];
            if (individual !== exclude) {
                return individual;
            }
        }

        throw new Error("Não foi possível selecionar um indivíduo (todos os sobreviventes foram excluídos)");
    }
}