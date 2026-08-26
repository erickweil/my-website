#[cfg(debug_assertions)]
use crate::console_log;
use crate::{
    genetic::{
        operators::tournament_selection,
        problems::{GAProblem, Individual},
    },
    random::{random_f64, random_range},
};
use rustc_hash::FxHashSet;
use serde::Serialize;
use std::mem;
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug)]
#[wasm_bindgen]
pub struct GAConfig {
    /// Tamanho da população por geração. Padrão: 100
    pub population_size: usize,
    /// Tamanho do torneio para seleção. Padrão: 10
    pub tournament_size: usize,
    /// Limite de gerações sem melhora antes de desistir. Padrão: indefinido (sem limite)
    pub max_stagnation: Option<usize>,
    /// Taxa de crossover entre indivíduos (probabilidade de cruzar dois indivíduos). Padrão: 0.5 
    pub crossover_rate: f64,
    /// Taxa de mutação por indivíduo (probabilidade de mutar um indivíduo). Padrão: 0.5
    pub mutation_rate: f64,
    /// Taxa de mutação por gene (probabilidade de mutar um gene). Padrão: 0.01
    pub mutation_gene_rate: f64,

    /// Se true previne indivíduos idênticos (problema deve implementar `hash()`)
    /// Padrão false
    pub diversity_check: bool,
}

#[wasm_bindgen]
impl GAConfig {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            population_size: 100,
            tournament_size: 10,
            max_stagnation: None,
            crossover_rate: 0.5,
            mutation_rate: 0.5,
            mutation_gene_rate: 0.01,
            diversity_check: false,
        }
    }
}

impl Default for GAConfig {
    fn default() -> Self { Self::new() }
}

#[derive(Serialize)]
pub struct GAInfo<P: GAProblem> {
    /// Geração atual da execução do algoritmo genético
    pub generation: usize,
    /// Número de gerações sem melhora.
    pub stagnated_for: usize,
    /// Fitness do melhor indivíduo encontrado até agora.
    pub best_fitness: Option<f64>,
    /// Os melhores genes encontrados até agora.
    pub best_genes: Option<P::Gene>,
}

pub struct GeneticAlgorithm<P: GAProblem> {
    pub problem: P,
    problem_state: P::State,
    population: Vec<Individual<P::Gene>>,
    offspring: Vec<Individual<P::Gene>>,
    population_hashes: FxHashSet<u64>,

    generation: usize,
    best_genes: Option<P::Gene>,
    best_fitness: Option<f64>,

    // Controle de estagnação
    /// Geração em que a última melhora foi observada
    stag_start: usize,
    /// Fitness da última melhora observada
    stag_fitness: Option<f64>,
    mutation_multiplier: f64,
    tournament_multiplier: f64,

    pub config: GAConfig,
}

impl<P: GAProblem> GeneticAlgorithm<P> {
    pub fn new(problem: P, config: GAConfig) -> Self {
        Self {
            problem_state: problem.initial_state(),
            problem,
            population: Vec::new(),
            offspring: Vec::new(),
            population_hashes: FxHashSet::default(),
            generation: 0,
            best_genes: None,
            best_fitness: None,
            stag_start: 0,
            stag_fitness: None,
            mutation_multiplier: 1.0,
            tournament_multiplier: 1.0,
            config,
        }
    }

    pub fn reset_population(&mut self) {
        self.stag_fitness = None;
        self.stag_start = self.generation;
        self.mutation_multiplier = 1.0;
        self.tournament_multiplier = 1.0;
        self.initialize_population(true);
    }

    pub fn run(&mut self, generations: usize) {
        // 0. Inicializa a população (gera indivíduos aleatórios para preencher a população até o tamanho definido)
        self.initialize_population(false);
        if self.population.is_empty() { 
            return; 
        }

        if self.best_genes.is_none() {
            self.best_genes = Some(self.population[0].genes.clone());
        }

        let max_generations = self.generation + generations;
        while self.generation < max_generations {
            // 1. Avalia a geração atual e produz a próxima
            self.run_generation();

            // 2. Verifica melhora global
            let current_best_fitness = self.population[0].fitness.unwrap_or(f64::MIN);
            if self.best_fitness.is_none_or(|bf| current_best_fitness > bf) {
                if let Some(bg) = &mut self.best_genes {
                    // clone_from previne realocação
                    bg.clone_from(&self.population[0].genes); 
                }
                self.best_fitness = Some(current_best_fitness);

                // Se atingiu o fitness máximo possível, podemos parar
                if let Some(max_fit) = self.problem.max_fitness()
                    && current_best_fitness >= max_fit {
                    break;
                }
            }

            let stagnated_for = self.generation - self.stag_start;
            // A FAZER: usar i64 para comparação de fitness para evitar problemas de precisão
            #[cfg(debug_assertions)]
            let mut improved = false;
            if self.stag_fitness.is_none_or(|sf| current_best_fitness > (sf + f64::EPSILON)) {
                self.stag_fitness = Some(current_best_fitness);
                self.stag_start = self.generation;
                self.mutation_multiplier = 1.0;
                self.tournament_multiplier = 1.0;
                #[cfg(debug_assertions)]
                { improved = true; }
            } else if let Some(max_stag) = self.config.max_stagnation {
                // Experimento: Controle de estagnação adaptativo
                // Se não houve melhora, podemos aumentar a taxa de mutação para tentar escapar de platôs

                // Aumenta a taxa de mutação em até 2x após STAG/2 gerações sem melhora
                let half_stag = (max_stag / 2).max(1); // evita divisão por zero quando max_stagnation <= 1

                let excess = stagnated_for.saturating_sub(half_stag);
                // 1.0 ... 2.0+
                self.mutation_multiplier = 1.0 + (excess as f64 / half_stag as f64);
                self.tournament_multiplier = 1.0 - (excess as f64 / half_stag as f64).min(1.0);

                if stagnated_for == half_stag {
                    // Re-introduz o melhor indivíduo
                    let r_idx = random_range(0, self.population.len());
                    if let Some(bg) = &self.best_genes {
                        self.population[r_idx].genes.clone_from(bg);
                    }
                    self.population[r_idx].fitness = self.best_fitness;
                    self.population[r_idx].hash = None;
                }

                // Se ficou estagnado mais tempo do que o recorde de melhoria sem melhora
                if stagnated_for > max_stag {
                    #[cfg(debug_assertions)]
                    console_log!("[GA] Estagnado por {} gens. Reiniciando população", stagnated_for);

                    self.initialize_population(true);
                    self.stag_fitness = None;
                    self.stag_start = self.generation;
                    self.mutation_multiplier = 1.0;
                    self.tournament_multiplier = 1.0;
                }
            }

            // A FAZER: implementar progressCallback
            #[cfg(debug_assertions)]
            {
                if improved || self.generation.is_multiple_of(1000) {
                    console_log!(
                        "[GA] Gen {:>8} | fitness {:>4} / {:>4} (best {:>4}) | stag: {}",
                        self.generation, current_best_fitness, self.problem.max_fitness().unwrap_or(0.0),
                        self.best_fitness.unwrap_or(0.0),
                        self.generation - self.stag_start
                    );
                }
            }

            self.generation += 1;
        }
    }

    /// Retorna uma struct owned com informações da execução atual do GA (Usado pelo JS)
    /// Obs: Dados do best_genes são clonados
    pub fn get_info(&self) -> GAInfo<P> {
        GAInfo {
            generation: self.generation,
            stagnated_for: (self.generation.saturating_sub(self.stag_start)),
            best_fitness: self.best_fitness,
            best_genes: self.best_genes.clone(),
        }
    }

    /// Retorna os genes do indivíduo no índice `idx` da população atual
    pub fn get_genes(&self, idx: usize) -> Option<&P::Gene> {
        self.population.get(idx).map(
            |ind| &ind.genes
        )
    }

    /// Inicializa a população com indivíduos aleatórios
    /// Se a população já tiver indivíduos e `reset_population` for true, eles serão re-inicializados com novos genes aleatórios
    fn initialize_population(&mut self, reset_population: bool) {
        let pop_size = self.config.population_size;

        // Re-inicializa os indivíduos existentes
        if reset_population {
            for ind in &mut self.population {
                ind.genes = self.problem.random_genes();
                ind.fitness = None;
                ind.hash = None;
            }
        }

        // Preenche o restante da população com novos indivíduos aleatórios
        while self.population.len() < pop_size {
            self.population.push(Individual {
                genes: self.problem.random_genes(), 
                fitness: None, 
                hash: None,
            });
            self.offspring.push(Individual {
                genes: self.problem.random_genes(), 
                fitness: None, 
                hash: None,
            });
        }
        // Remove indivíduos extras se a população atual for maior que o novo tamanho
        self.population.truncate(pop_size);
        self.offspring.truncate(pop_size);

        // Limpa o hash da população para não considerar indivíduos antigos
        self.population_hashes.clear();
    }

    /**
     * 1. Avalia o fitness de cada indivíduo (se ainda não avaliado).
     * 2. Realiza seleção + reprodução, para criar a próxima geração:
     * 3. Torna os filhos a população da próxima geração
     * 4. O melhor indivíduo da geração estará na posição 0 ao final (fitness mais alto).
     */
    fn run_generation(&mut self) {
        let crossover_rate = self.config.crossover_rate;
        let mutation_rate = self.config.mutation_rate * self.mutation_multiplier;
        let mutation_gene_rate = self.config.mutation_gene_rate * self.mutation_multiplier;
        let tournament_size = ((self.config.tournament_size as f64) * self.tournament_multiplier).floor() as usize;
        let tournament_size = tournament_size.max(2);

        if self.config.diversity_check { self.population_hashes.clear(); }

        let mut best_idx = 0;
        let mut best_fitness = f64::MIN;

        // Avaliação
        for (i, ind) in self.population.iter_mut().enumerate() {
            if ind.fitness.is_none() {
                ind.fitness = Some(self.problem.fitness(&mut self.problem_state, &ind.genes));
            }
            let fit = ind.fitness.unwrap();
            if fit > best_fitness {
                best_fitness = fit;
                best_idx = i;
            }
        }

        // Elitismo explícito na geração
        self.offspring[0].genes.clone_from(&self.population[best_idx].genes);
        self.offspring[0].fitness = Some(best_fitness);

        if self.config.diversity_check {
            let hash = self.population[best_idx].hash.or_else(|| {
                self.problem.hash(&self.population[best_idx].genes)
            });
            self.offspring[0].hash = hash;
            if let Some(h) = hash {
                self.population_hashes.insert(h);
            }
        }

        // Faz a seleção + reprodução, para criar a próxima geração
        // Reprodução usando chunks paralelos mutáveis de forma segura
        // Começa em 1 pois em 0 está o melhor indivíduo (elitismo)
        let (chunks, remainder) = self.offspring[1..].as_chunks_mut::<2>();
        for [child_a, child_b] in chunks.iter_mut() {
            for attempt in (0..=3).rev() {
                // Seleciona pais aleatório da geração anterior
                let p1_idx = tournament_selection::<P>(&self.population, tournament_size, None);
                let p2_idx = tournament_selection::<P>(&self.population, tournament_size, Some(p1_idx));

                let parent_a = &self.population[p1_idx].genes;
                let parent_b = &self.population[p2_idx].genes;

                child_a.fitness = None;
                child_b.fitness = None;

                // Crossover entre os pais para criar os filhos
                if crossover_rate >= 1.0 || random_f64() < crossover_rate {
                    self.problem.crossover(&mut self.problem_state, &mut child_a.genes, &mut child_b.genes, parent_a, parent_b);
                } else {
                    child_a.genes.clone_from(parent_a);
                    child_b.genes.clone_from(parent_b);
                }

                // Aplica mutação
                if mutation_rate >= 1.0 || random_f64() < mutation_rate {
                    self.problem.mutate(&mut self.problem_state, &mut child_a.genes, mutation_gene_rate);
                }
                if mutation_rate >= 1.0 || random_f64() < mutation_rate {
                    self.problem.mutate(&mut self.problem_state, &mut child_b.genes, mutation_gene_rate);
                }

                // Verificação de diversidade: remuta filhos duplicados da geração atual
                if self.config.diversity_check {
                    let ha = self.problem.hash(&child_a.genes);
                    let hb = self.problem.hash(&child_b.genes);
                    if let (Some(ha), Some(hb)) = (ha, hb) {
                        if self.population_hashes.contains(&ha) || self.population_hashes.contains(&hb) {
                            if attempt > 0 { 
                                // Tenta reproduzir novamente com outros pais
                                continue; 
                            } else {
                                // Após 3 tentativas sem sucesso, aplica mutação mais uma vez nos filhos para tentar criar variação
                                self.problem.mutate(&mut self.problem_state, &mut child_a.genes, mutation_gene_rate);
                                child_a.hash = self.problem.hash(&child_a.genes);

                                self.problem.mutate(&mut self.problem_state, &mut child_b.genes, mutation_gene_rate);
                                child_b.hash = self.problem.hash(&child_b.genes);
                            }
                        } else {
                            child_a.hash = Some(ha);
                            child_b.hash = Some(hb);
                        }
                        if let Some(h) = child_a.hash { self.population_hashes.insert(h); }
                        if let Some(h) = child_b.hash { self.population_hashes.insert(h); }
                    }
                }
                // Se os filhos forem válidos, passamos para o próximo par
                break;
            }
        }

        // Estrutura de fallback para tamanho par da população 
        // [0,1,2,3,4,5] -> best: [0]  chunks: [(1, 2), (3, 4)], remainder: [5]
        if let Some(last_child) = remainder.first_mut() {
            let p1_idx = tournament_selection::<P>(&self.population, tournament_size, None);
            let parent_a = &self.population[p1_idx].genes;

            // Sem crossover
            last_child.fitness = None;
            last_child.genes.clone_from(parent_a);
        
            // Aplica mutação
            if mutation_rate >= 1.0 || random_f64() < mutation_rate {
                self.problem.mutate(&mut self.problem_state, &mut last_child.genes, mutation_gene_rate);
            }

            if self.config.diversity_check {
                last_child.hash = self.problem.hash(&last_child.genes);
                if let Some(h) = last_child.hash { self.population_hashes.insert(h); }
            }
        }

        // Em vez de criar um novo array, podemos simplesmente trocar os papéis dos arrays population e offspring para evitar cópias desnecessárias
        // Swap de ponteiros ultra performático O(1)
        mem::swap(&mut self.population, &mut self.offspring);
    }
}
