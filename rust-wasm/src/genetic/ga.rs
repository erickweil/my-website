use rustc_hash::FxHashSet;
use std::mem;
use crate::{console_log, genetic::problem::{GAProblem, Individual}, random::{random_f64, random_range}};

#[derive(Clone, Debug)]
pub struct GAConfig {
    /// Tamanho da população por geração. Padrão: 100
    pub population_size: usize,
    /// Tamanho do torneio para seleção. Padrão: 10
    pub tournament_size: usize,
    /// Limite de gerações sem melhora antes de desistir. Padrão: indefinido (sem limite)
    pub max_stagnation: isize,
    /// Taxa de crossover entre indivíduos (probabilidade de cruzar dois indivíduos). Padrão: 0.5 
    pub crossover_rate: f64,
    /// Taxa de mutação por indivíduo (probabilidade de mutar um indivíduo). Padrão: 0.5
    pub mutation_rate: f64,
    /// Taxa de mutação por gene (probabilidade de mutar um gene). Padrão: 0.01
    pub mutation_gene_rate: f64,

    /// Se true previne indivíduos idênticos (problema deve implementar `hash()`)
    /// Padrão false
    pub diversity_check: bool,
    /// padrão true, resetar população a cada chamada de run
    pub reset_population: bool,
}

impl Default for GAConfig {
    fn default() -> Self {
        Self {
            population_size: 100,
            tournament_size: 10,
            max_stagnation: -1,
            crossover_rate: 0.5,
            mutation_rate: 0.5,
            mutation_gene_rate: 0.01,
            diversity_check: false,
            reset_population: true,
        }
    }
}

pub struct GeneticAlgorithm<P: GAProblem> {
    pub problem: P,
    pub population: Vec<Individual<P::Gene>>,
    pub offspring: Vec<Individual<P::Gene>>,
    population_hashes: FxHashSet<u64>,

    pub generation: usize,
    pub best_genes: Option<P::Gene>,
    pub best_fitness: Option<f64>,

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

    pub fn update_config(&mut self, new_config: GAConfig) {
        self.config = new_config;
    }

    pub fn run(&mut self, generations: usize) {
        // 0. Inicializa a população (gera indivíduos aleatórios para preencher a população até o tamanho definido)
        if self.config.reset_population {
            self.stag_fitness = None;
            self.stag_start = self.generation;
            self.mutation_multiplier = 1.0;
            self.tournament_multiplier = 1.0;
        }

        self.initialize_population(self.config.reset_population);
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
            if self.best_fitness.map_or(true, |bf| current_best_fitness > bf) {
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

            let mut improved = false;
            let stagnated_for = self.generation - self.stag_start;

            // A FAZER: usar i64 para comparação de fitness para evitar problemas de precisão
            if self.stag_fitness.map_or(true, |sf| current_best_fitness > (sf + f64::EPSILON)) {
                self.stag_fitness = Some(current_best_fitness);
                self.stag_start = self.generation;
                self.mutation_multiplier = 1.0;
                self.tournament_multiplier = 1.0;
                improved = true;
            } else if self.config.max_stagnation > 0 {
                // Experimento: Controle de estagnação adaptativo
                // Se não houve melhora, podemos aumentar a taxa de mutação para tentar escapar de platôs

                // Aumenta a taxa de mutação em até 2x após STAG/2 gerações sem melhora
                let max_stag = self.config.max_stagnation as usize;
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
                    console_log!("[GA] Estagnado por {} gens. Reiniciando população", stagnated_for);
                    self.initialize_population(true);
                    self.stag_fitness = None;
                    self.stag_start = self.generation;
                    self.mutation_multiplier = 1.0;
                    self.tournament_multiplier = 1.0;
                }
            }

            // A FAZER: implementar progressCallback
            if improved || self.generation.is_multiple_of(1000) {
                console_log!(
                    "Gen {:>8} | fitness {:>4} / {:>4} (best {:>4}) | stag: {}",
                    self.generation, current_best_fitness, self.problem.max_fitness().unwrap_or(0.0),
                    self.best_fitness.unwrap_or(0.0),
                    self.generation - self.stag_start
                );
            }

            self.generation += 1;
        }
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
                ind.fitness = Some(self.problem.fitness(&ind.genes));
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
        for chunk in self.offspring[1..].chunks_mut(2) {
            let is_pair = chunk.len() == 2;

            for attempt in (0..=3).rev() {
                // Seleciona pais aleatório da geração anterior
                let p1_idx = Self::tournament_selection(&self.population, tournament_size, None);
                let p2_idx = Self::tournament_selection(&self.population, tournament_size, Some(p1_idx));

                let parent_a = &self.population[p1_idx].genes;
                let parent_b = &self.population[p2_idx].genes;

                if is_pair {
                    let (ca, cb) = chunk.split_at_mut(1);
                    let child_a = &mut ca[0];
                    let child_b = &mut cb[0];

                    child_a.fitness = None;
                    child_b.fitness = None;

                    // Crossover entre os pais para criar os filhos
                    if crossover_rate >= 1.0 || random_f64() < crossover_rate {
                        self.problem.crossover(&mut child_a.genes, &mut child_b.genes, parent_a, parent_b);
                    } else {
                        child_a.genes.clone_from(parent_a);
                        child_b.genes.clone_from(parent_b);
                    }

                    // Aplica mutação
                    if mutation_rate >= 1.0 || random_f64() < mutation_rate {
                        self.problem.mutate(&mut child_a.genes, mutation_gene_rate);
                    }
                    if mutation_rate >= 1.0 || random_f64() < mutation_rate {
                        self.problem.mutate(&mut child_b.genes, mutation_gene_rate);
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
                                    self.problem.mutate(&mut child_a.genes, mutation_gene_rate);
                                    child_a.hash = self.problem.hash(&child_a.genes);

                                    self.problem.mutate(&mut child_b.genes, mutation_gene_rate);
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
                } else {
                    // Estrutura de fallback para tamanho ímpar da população (último elemento)
                    let child_a = &mut chunk[0];
                    child_a.fitness = None;
                    child_a.hash = None; // hash stale após troca de genes
                    child_a.genes.clone_from(parent_a);

                    if mutation_rate >= 1.0 || random_f64() < mutation_rate {
                        self.problem.mutate(&mut child_a.genes, mutation_gene_rate);
                    }
                }

                // Se os filhos forem válidos, passamos para o próximo par
                break;
            }
        }

        // Em vez de criar um novo array, podemos simplesmente trocar os papéis dos arrays population e offspring para evitar cópias desnecessárias
        // Swap de ponteiros ultra performático O(1)
        mem::swap(&mut self.population, &mut self.offspring);
    }

    /// Realiza a seleção por torneio, retornando o índice do indivíduo selecionado.
    /// 1. Seleciona `tournament_size` indivíduos aleatórios da população (ignorando `exclude_idx`).
    /// 2. Retorna o índice do indivíduo com maior fitness entre os selecionados.
    fn tournament_selection(
        population: &[Individual<P::Gene>],
        tournament_size: usize,
        exclude_idx: Option<usize>
    ) -> usize {
        let pop_len = population.len();
        let mut best_idx = None;

        for _ in 0..tournament_size {
            let idx = random_range(0, pop_len);
            if Some(idx) == exclude_idx { continue; }

            let ind = &population[idx];

            if let (Some(ex_idx), Some(ih)) = (exclude_idx, ind.hash)
                && population[ex_idx].hash == Some(ih) { continue; }

            match best_idx {
                None => best_idx = Some(idx),
                Some(b_idx) => {
                    if ind.fitness.unwrap_or(f64::MIN) > population[b_idx].fitness.unwrap_or(f64::MIN) {
                        best_idx = Some(idx);
                    }
                }
            }
        }

        // Fallback: varredura linear a partir de um ponto aleatório para evitar viés de posição
        best_idx.unwrap_or_else(|| {
            let start = random_range(0, pop_len);
            for i in 0..pop_len {
                let idx = (start + i) % pop_len;
                if Some(idx) != exclude_idx { return idx; }
            }
            
            // Se chegar aqui é um problema de uso.
            panic!("Não foi possível selecionar um indivíduo (todos os sobreviventes foram excluídos)");
        })
    }
}
