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

export interface GAProgressEvent<G> {
    genes: G;
    generation: number;
    fitness: number;
    current: number;
    /** Quantas gerações se passaram desde a última melhora. */
    stagnatedFor: number;
}

/** Configuração completa do motor genético. */
export interface GAConfig<G> {
    /** Tamanho da população por geração. Padrão: 100 */
    populationSize?: number;
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
    progressCallback?: (event: GAProgressEvent<G>) => void;

    resetPopulation?: boolean;
}

const DEFAULTS = {
    populationSize: 100,
    tournamentSize: 10,
    maxStagnation: -1,
    crossoverRate: 0.5,
    mutationRate: 0.5,
    mutationGeneRate: 0.01,
    diversityCheck: false,
    resetPopulation: true,
    progressCallback: (event) => {
        console.log(`Gen ${event.generation} | fitness ${event.fitness} (melhora após ${event.stagnatedFor} gens)`);
    }
} satisfies GAConfig<unknown>;

/**
 * Motor genético genérico.
 *
 * Estratégia: elitismo + mutação + crossover + seleção por torneio.
 */
export class GeneticAlgorithm<G extends object> {
    readonly problem: GAProblem<G>;
    population: Individual<G>[];

    private offspring: Individual<G>[];
    private populationHashes: Set<number>;

    private gen: number;
    private bestGenes: G;
    private bestFitness: number;

    // Controle de estagnação
    private stagStart: number;   // Geração em que a estagnação começou (última melhora)
    private stagFitness: number; // Fitness para controle de estagnação (fitness da última melhora)
    private mutationMultiplier: number;
    private tournamentMultiplier: number;

    private config: Required<GAConfig<G>>;
    private hashFn?: (genes: G) => number;

    constructor(
        problem: GAProblem<G>,
        _config: GAConfig<G> = {}
    ) {
        this.problem = problem;
        this.population = [];
        this.offspring = [];
        this.populationHashes = new Set();

        // Controle da execução
        this.gen = 0;
        this.bestGenes = this.problem.randomGenes();
        this.bestFitness = 0;
        this.stagFitness = 0;
        this.stagStart = 0;
        this.mutationMultiplier = 1;
        this.tournamentMultiplier = 1;
        this.config = {
            ...DEFAULTS,
            ..._config
        };
        this.hashFn = this.problem.hash?.bind(this.problem);        
    }

    updateConfig(newConfig: Partial<GAConfig<G>>) {
        this.config = {
            ...this.config,
            ...newConfig
        };
    }

    run(generations: number): GAProgressEvent<G> {                
        // 0. Inicializa a população (gera indivíduos aleatórios para preencher a população até o tamanho definido)
        this.initializePopulation(this.config.populationSize, this.config.resetPopulation);

        if(this.population.length === 0) {
            return {
                generation: 0,
                stagnatedFor: 0,
                genes: this.bestGenes,
                fitness: this.bestFitness,
                current: this.stagFitness,
            }
        }

        const maxGenerations = this.gen + generations;
        for (; this.gen < maxGenerations; this.gen++) {
            // 1. Avalia a geração atual e produz a próxima, retornando o melhor indivíduo desta geração
            const currentBest = this.runGeneration();

            // 2. Verifica melhora global
            if (currentBest.fitness! > this.bestFitness) {
                this.problem.clone(this.bestGenes, currentBest.genes);
                this.bestFitness = currentBest.fitness!;

                // Se atingiu o fitness máximo possível, podemos parar
                if (this.problem.maxFitness !== undefined && this.bestFitness >= this.problem.maxFitness) {
                    break;
                }
            }

            let improved = false;
            const stagnatedFor = this.gen - this.stagStart;
            // https://stackoverflow.com/questions/4915462/how-should-i-do-floating-point-comparison
            if (currentBest.fitness! > (this.stagFitness + Number.EPSILON)) {
                this.stagFitness = currentBest.fitness!;
                this.stagStart = this.gen;
                this.mutationMultiplier = 1;
                this.tournamentMultiplier = 1;
                improved = true;
            } else {
                // Experimento: Controle de estagnação adaptativo
                // Se não houve melhora, podemos aumentar a taxa de mutação para tentar escapar de platôs

                // Aumenta a taxa de mutação em até 2x após STAG/2 gerações sem melhora
                const halfStag = Math.floor(this.config.maxStagnation * 0.5);
                // 1.0 ... 2.0+
                this.mutationMultiplier = 1 + Math.max(0, stagnatedFor - halfStag) / halfStag;

                // Diminui o torneio para aumentar diversidade, até mínimo de 2 participantes
                this.tournamentMultiplier = Math.max(0, 1 - Math.max(0, stagnatedFor - halfStag) / halfStag);

                if(stagnatedFor === halfStag) {
                    // Re-introduz o melhor indivíduo
                    const randomIndex = Math.floor(Math.random() * this.population.length);
                    this.problem.clone(this.population[randomIndex].genes, this.bestGenes);
                    this.population[randomIndex].fitness = this.bestFitness;
                    this.population[randomIndex].hash = undefined;
                }

                // Se ficou estagnado mais tempo do que o recorde de melhoria sem melhora
                if (stagnatedFor > this.config.maxStagnation) {
                    console.log(`Estagnado por ${stagnatedFor} gerações, realizando assassinato de TODOS`);
                    this.initializePopulation(this.config.populationSize, true);
                    this.stagFitness = 0;
                    this.stagStart = this.gen;
                    this.mutationMultiplier = 1;
                    this.tournamentMultiplier = 1;
                }
            }

            if (improved || this.gen % 1000 === 0) {
                this.config.progressCallback({
                    generation: this.gen,
                    stagnatedFor: this.gen - this.stagStart,
                    genes: this.bestGenes,
                    fitness: this.bestFitness,
                    current: this.stagFitness,
                });
            }

            // DEBUG
            //await new Promise(resolve => setTimeout(resolve, 100));
        }

        return {
            generation: this.gen,
            stagnatedFor: this.gen - this.stagStart,
            genes: this.bestGenes,
            fitness: this.bestFitness,
            current: this.stagFitness,
        };
    }

    // ---------------------------------------------------------------------------
    // Privados
    // ---------------------------------------------------------------------------

    /**
     * Inicializa a população para a primeira geração.
     * Se a população já tiver indivíduos (de execuções anteriores), eles serão re-inicializados
     */
    private initializePopulation(populationSize: number, resetPopulation: boolean) {
        // Re-inicializa os indivíduos existentes
        if(resetPopulation) for(let i = 0; i < this.population.length; i++) {
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
    private runGeneration(): Individual<G> {
        const crossoverRate = this.config.crossoverRate;
        const mutationRate = this.config.mutationRate * this.mutationMultiplier;
        const mutationGeneRate = this.config.mutationGeneRate * this.mutationMultiplier;
        const tournamentSize = Math.max(2, Math.floor(this.config.tournamentSize * this.tournamentMultiplier));

        if (this.config.diversityCheck && this.hashFn) {
            this.populationHashes.clear();
        }
        // Avalia fitness e encontra melhor e pior indivíduo da geração
        let best = this.population[0];
        for (const ind of this.population) {
            if (ind.fitness === undefined) {
                ind.fitness = this.problem.fitness(ind.genes);
            }
            if (ind.fitness > best.fitness!) {
                best = ind;
            }
        }  
       
        // Faz a seleção + reprodução, para criar a próxima geração
        for(let i = 1; i < this.population.length; i += 2) {
            const childA = this.offspring[i];
            const childB = (i+1) < this.population.length ? this.offspring[i + 1] : this.offspring[i - 1];
            childA.fitness = undefined;
            childB.fitness = undefined;

            for(let attempt = 3; attempt >= 0; attempt--) {
                // Seleciona pais aleatório da geração anterior
                const parentA = GeneticAlgorithm.tournamentSelection(this.population, this.population.length, tournamentSize);
                const parentB = GeneticAlgorithm.tournamentSelection(this.population, this.population.length, tournamentSize, parentA);
                
                // Crossover entre os pais para criar os filhos
                if (crossoverRate >= 1.0 || Math.random() < crossoverRate) {
                    this.problem.crossover(childA.genes, childB.genes, parentA.genes, parentB.genes);
                } else {
                    this.problem.clone(childA.genes, parentA.genes);
                    this.problem.clone(childB.genes, parentB.genes);
                }
                
                // Aplica mutação
                if (mutationRate >= 1.0 || Math.random() < mutationRate) {
                    this.problem.mutate(childA.genes, mutationGeneRate);
                }
                if (mutationRate >= 1.0 || Math.random() < mutationRate) {
                    this.problem.mutate(childB.genes, mutationGeneRate);
                }

                // Verificação de diversidade: remuta filhos duplicados da geração atual
                if (this.config.diversityCheck && this.hashFn) {
                    childA.hash = this.hashFn(childA.genes);
                    childB.hash = this.hashFn(childB.genes);

                    if (this.populationHashes.has(childA.hash) || this.populationHashes.has(childB.hash)) {
                        if(attempt > 0) {
                            // Tenta reproduzir novamente com outros pais
                            continue;
                        } else {
                            // Após 3 tentativas sem sucesso, aplica mutação mais uma vez nos filhos para tentar criar variação
                            this.problem.mutate(childA.genes, mutationGeneRate);
                            childA.hash = this.hashFn(childA.genes);

                            this.problem.mutate(childB.genes, mutationGeneRate);
                            childB.hash = this.hashFn(childB.genes);
                        }
                    }

                    this.populationHashes.add(childA.hash!);
                    this.populationHashes.add(childB.hash!);
                }

                // Se os filhos forem válidos, passamos para o próximo par
                break;
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
        for (let i = 0; i < tournamentSize; i++) {
            let individual = population[Math.floor(Math.random() * populationCount)];
            if (individual === exclude || (individual.hash !== undefined && individual.hash === exclude?.hash)) {
                continue;
            }
            if(
                best?.fitness === undefined 
                || individual.fitness! > best.fitness
            ) {
                best = individual;
            }
        }

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