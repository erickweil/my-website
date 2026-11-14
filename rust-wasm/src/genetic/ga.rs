#[cfg(debug_assertions)]
use crate::console_log;
use crate::{
    genetic::{
        operators::tournament_selection,
        problems::{GAProblem, Individual},
    },
    paralelo::pool_disponivel,
    random::{random_f64, random_range},
};
use rayon::prelude::*;
use rustc_hash::FxHashSet;
use serde::Serialize;
use std::mem;
// `std::time::Instant` não existe no wasm32; o web-time usa performance.now() no navegador
use web_time::{Duration, Instant};
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

    /// Uso do pool de threads do rayon (o resultado é idêntico em qualquer modo):
    /// - 0 = automático: mede algumas gerações em sequência e em paralelo e usa o mais rápido;
    /// - 1 = sempre sequencial;
    /// - outro valor = sempre paralelo. O número de threads é o do pool (`initThreadPool(n)` no
    ///   navegador), não este valor.
    ///
    /// Sem pool disponível (ex.: thread principal do navegador) roda sempre em sequência.
    /// Padrão 0
    pub threads: usize,
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
            threads: 0,
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

    // Execução em blocos (ver `run_generation`)
    /// Um estado de trabalho por bloco da população, reaproveitado entre gerações.
    estados: Vec<P::State>,
    /// Semente de cada bloco na geração atual (buffer reaproveitado).
    sementes: Vec<u64>,
    /// Gerador do motor: só sorteia as sementes dos blocos e do trecho sequencial. Assim a
    /// evolução depende apenas da semente inicial, não de quantas threads executam os blocos.
    rng: fastrand::Rng,
    calibragem: Calibragem,

    pub config: GAConfig,
}

/// Um bloco da população com o seu estado de trabalho.
type Bloco<'a, P> = (&'a mut [Individual<<P as GAProblem>::Gene>], &'a mut <P as GAProblem>::State);

/// Parâmetros de uma geração, copiados para cada bloco.
#[derive(Clone, Copy)]
struct ParamsGeracao {
    crossover_rate: f64,
    mutation_rate: f64,
    mutation_gene_rate: f64,
    tournament_size: usize,
}

/// Indivíduos por bloco. Depende SÓ do tamanho da população (nunca do número de threads), para
/// que a mesma semente dê a mesma evolução com qualquer número de threads. É par, porque os
/// filhos são gerados em pares.
///
/// Medido com 4 threads (examples/bench_ga_threads): blocos pequenos balanceiam melhor a carga
/// entre as threads (8 foi igual ou melhor que 16, 32, 64 e 128 em todos os problemas; 4 já
/// perde para o custo por bloco). O teto de 256 blocos limita a quantidade de estados.
fn tamanho_bloco(pop: usize) -> usize {
    pop.div_ceil(256).max(8).next_multiple_of(2)
}

/// Gerações medidas em cada modo na calibragem do modo automático.
const GERACOES_CALIBRAGEM: u32 = 8;
/// De quantas em quantas gerações o modo automático mede de novo (o custo da geração muda
/// conforme a população evolui).
const INTERVALO_CALIBRAGEM: usize = 5000;

/// Modo automático (`config.threads == 0`): mede algumas gerações em sequência e em paralelo e
/// fica com o mais rápido. Como os dois modos produzem exatamente a mesma evolução, alternar
/// entre eles não muda o resultado, só o tempo.
#[derive(Clone, Copy, Debug)]
enum Calibragem {
    /// Medindo `restantes` gerações no modo `paralelo`. `aquecendo`: a primeira geração paralela
    /// não conta (acorda as threads do pool). `seq`: tempo já medido do modo sequencial.
    Medindo { paralelo: bool, aquecendo: bool, restantes: u32, soma: Duration, seq: Option<Duration> },
    /// Decidido para a população de tamanho `pop`, até a geração `ate`.
    Decidido { paralelo: bool, pop: usize, ate: usize },
}

impl Calibragem {
    const INICIO: Self = Self::Medindo { paralelo: false, aquecendo: false, restantes: GERACOES_CALIBRAGEM, soma: Duration::ZERO, seq: None };
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
            estados: Vec::new(),
            sementes: Vec::new(),
            // Semeado pelo gerador global: `fastrand::seed(n)` antes de criar o GA o torna reproduzível
            rng: fastrand::Rng::with_seed(fastrand::u64(..)),
            calibragem: Calibragem::INICIO,
            config,
        }
    }

    /// Há como rodar em paralelo? (configuração permite, existe pool e ele tem mais de uma thread)
    fn pode_usar_threads(&self) -> bool {
        self.config.threads != 1 && pool_disponivel() && rayon::current_num_threads() >= 2
    }

    /// Roda os blocos da próxima geração em várias threads?
    /// `config.threads`: 1 = nunca; 0 = automático (mede e escolhe); outro valor = sempre que houver pool.
    fn usar_threads(&mut self) -> bool {
        if !self.pode_usar_threads() {
            return false;
        }
        if self.config.threads != 0 {
            return true;
        }
        match self.calibragem {
            Calibragem::Medindo { paralelo, .. } => paralelo,
            Calibragem::Decidido { paralelo, pop, ate } => {
                if pop == self.population.len() && self.generation < ate {
                    return paralelo;
                }
                self.calibragem = Calibragem::INICIO;
                false
            }
        }
    }

    /// Modo automático: contabiliza o tempo da geração que acabou de rodar.
    fn registrar_tempo(&mut self, tempo: Duration) {
        let Calibragem::Medindo { paralelo, aquecendo, restantes, soma, seq } = self.calibragem else { return };
        self.calibragem = if aquecendo {
            Calibragem::Medindo { paralelo, aquecendo: false, restantes, soma, seq }
        } else if restantes > 1 {
            Calibragem::Medindo { paralelo, aquecendo, restantes: restantes - 1, soma: soma + tempo, seq }
        } else if !paralelo {
            // Terminou o sequencial: agora mede o paralelo
            Calibragem::Medindo { paralelo: true, aquecendo: true, restantes: GERACOES_CALIBRAGEM, soma: Duration::ZERO, seq: Some(soma + tempo) }
        } else {
            // Só vale a pena acordar as outras threads com um ganho claro (10%)
            let (t_seq, t_par) = (seq.unwrap_or(Duration::ZERO), soma + tempo);
            Calibragem::Decidido {
                paralelo: t_par.as_secs_f64() < t_seq.as_secs_f64() * 0.9,
                pop: self.population.len(),
                ate: self.generation + INTERVALO_CALIBRAGEM,
            }
        };
    }

    /// true se as gerações estão rodando em paralelo (no modo automático: a última decisão). Para diagnóstico.
    pub fn usando_threads(&self) -> bool {
        self.pode_usar_threads() && match (self.config.threads, self.calibragem) {
            (0, Calibragem::Decidido { paralelo, .. }) => paralelo,
            (0, Calibragem::Medindo { .. }) => false,
            _ => true,
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
            let paralelo = self.usar_threads();
            // Só mede o tempo durante a calibragem do modo automático (e só se houver pool)
            if self.config.threads == 0 && matches!(self.calibragem, Calibragem::Medindo { .. }) && self.pode_usar_threads() {
                let inicio = Instant::now();
                self.run_generation(paralelo);
                self.registrar_tempo(inicio.elapsed());
            } else {
                self.run_generation(paralelo);
            }

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

        // Um estado por bloco
        let n_blocos = pop_size.div_ceil(tamanho_bloco(pop_size));
        let problem = &self.problem;
        self.estados.resize_with(n_blocos, || problem.initial_state());

        // Os genes novos são sorteados nesta thread: semeia o gerador dela a partir do gerador do motor
        if reset_population || self.population.len() < pop_size {
            fastrand::seed(self.rng.u64(..));
        }

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

    /// Produz a próxima geração.
    ///
    /// 1. Avalia quem ainda não tem fitness (só acontece com população nova ou reiniciada).
    /// 2. Copia o melhor indivíduo para a posição 0 da próxima geração (elitismo).
    /// 3. Divide o resto da próxima geração em blocos. Cada bloco faz seleção, crossover, mutação
    ///    E avaliação dos seus filhos, com estado e semente próprios — os blocos são independentes,
    ///    então rodam em sequência ou em threads diferentes com exatamente o mesmo resultado.
    /// 4. (Só com `diversity_check`) remuta os filhos duplicados, em sequência.
    /// 5. Troca população e filhos.
    fn run_generation(&mut self, paralelo: bool) {
        let tournament_size = ((self.config.tournament_size as f64) * self.tournament_multiplier).floor() as usize;
        let params = ParamsGeracao {
            crossover_rate: self.config.crossover_rate,
            mutation_rate: self.config.mutation_rate * self.mutation_multiplier,
            mutation_gene_rate: self.config.mutation_gene_rate * self.mutation_multiplier,
            tournament_size: tournament_size.max(2),
        };
        let tam = tamanho_bloco(self.population.len());
        let problem = &self.problem;

        // 1. Avaliação do que falta
        if self.population.iter().any(|ind| ind.fitness.is_none()) {
            let avaliar = |(inds, estado): Bloco<P>| {
                for ind in inds.iter_mut().filter(|ind| ind.fitness.is_none()) {
                    ind.fitness = Some(problem.fitness(estado, &ind.genes));
                }
            };
            if paralelo {
                self.population.par_chunks_mut(tam).zip(self.estados.par_iter_mut()).for_each(avaliar);
            } else {
                self.population.chunks_mut(tam).zip(self.estados.iter_mut()).for_each(avaliar);
            }
        }

        let mut best_idx = 0;
        let mut best_fitness = f64::MIN;
        for (i, ind) in self.population.iter().enumerate() {
            let fit = ind.fitness.unwrap_or(f64::MIN);
            if fit > best_fitness {
                best_fitness = fit;
                best_idx = i;
            }
        }

        // 2. Elitismo explícito na geração
        self.offspring[0].genes.clone_from(&self.population[best_idx].genes);
        self.offspring[0].fitness = Some(best_fitness);

        if self.config.diversity_check {
            self.population_hashes.clear();
            let hash = self.population[best_idx].hash.or_else(|| problem.hash(&self.population[best_idx].genes));
            self.offspring[0].hash = hash;
            if let Some(h) = hash {
                self.population_hashes.insert(h);
            }
        }

        // 3. Reprodução + avaliação em blocos. Começa em 1 pois em 0 está o melhor indivíduo.
        let n_blocos = (self.offspring.len() - 1).div_ceil(tam);
        self.sementes.clear();
        self.sementes.extend((0..n_blocos).map(|_| self.rng.u64(..)));

        let population = &self.population[..];
        let bloco = |((filhos, estado), &semente): (Bloco<P>, &u64)| {
            reproduzir_bloco(problem, population, filhos, estado, semente, params);
        };
        if paralelo {
            self.offspring[1..].par_chunks_mut(tam)
                .zip(self.estados.par_iter_mut())
                .zip(self.sementes.par_iter())
                .for_each(bloco);
        } else {
            self.offspring[1..].chunks_mut(tam)
                .zip(self.estados.iter_mut())
                .zip(self.sementes.iter())
                .for_each(bloco);
        }

        // Daqui em diante é sequencial, nesta thread (que pode ou não ter executado blocos):
        // semeia o gerador dela para não depender disso.
        fastrand::seed(self.rng.u64(..));

        // 4. Diversidade: filho igual a outro já visto nesta geração recebe mais uma mutação
        if self.config.diversity_check {
            for filho in &mut self.offspring[1..] {
                let mut hash = problem.hash(&filho.genes);
                if hash.is_some_and(|h| self.population_hashes.contains(&h)) {
                    problem.mutate(&mut self.problem_state, &mut filho.genes, params.mutation_gene_rate);
                    filho.fitness = Some(problem.fitness(&mut self.problem_state, &filho.genes));
                    hash = problem.hash(&filho.genes);
                }
                filho.hash = hash;
                if let Some(h) = hash {
                    self.population_hashes.insert(h);
                }
            }
        }

        // 5. Troca os papéis de population e offspring: O(1), sem copiar indivíduos
        mem::swap(&mut self.population, &mut self.offspring);
    }
}

/// Gera e avalia os filhos de um bloco. Só lê a população e só escreve nos próprios filhos e no
/// próprio estado, então blocos diferentes podem rodar ao mesmo tempo.
fn reproduzir_bloco<P: GAProblem>(
    problem: &P,
    population: &[Individual<P::Gene>],
    filhos: &mut [Individual<P::Gene>],
    estado: &mut P::State,
    semente: u64,
    p: ParamsGeracao,
) {
    // Os operadores usam o gerador global da thread; o bloco inteiro roda numa thread só, então
    // semeá-lo aqui faz a sequência depender do bloco, e não de qual thread o executou.
    fastrand::seed(semente);

    let (pares, resto) = filhos.as_chunks_mut::<2>();
    for [child_a, child_b] in pares.iter_mut() {
        // Seleciona pais aleatórios da geração anterior
        let p1_idx = tournament_selection::<P>(population, p.tournament_size, None);
        let p2_idx = tournament_selection::<P>(population, p.tournament_size, Some(p1_idx));
        let parent_a = &population[p1_idx].genes;
        let parent_b = &population[p2_idx].genes;

        // Crossover entre os pais para criar os filhos
        if p.crossover_rate >= 1.0 || random_f64() < p.crossover_rate {
            problem.crossover(estado, &mut child_a.genes, &mut child_b.genes, parent_a, parent_b);
        } else {
            child_a.genes.clone_from(parent_a);
            child_b.genes.clone_from(parent_b);
        }

        for filho in [child_a, child_b] {
            if p.mutation_rate >= 1.0 || random_f64() < p.mutation_rate {
                problem.mutate(estado, &mut filho.genes, p.mutation_gene_rate);
            }
            filho.fitness = Some(problem.fitness(estado, &filho.genes));
            filho.hash = None;
        }
    }

    // População de tamanho par sobra um filho no último bloco: [0 = elite] [(1, 2), (3, 4)] [5]
    if let Some(filho) = resto.first_mut() {
        let p1_idx = tournament_selection::<P>(population, p.tournament_size, None);
        filho.genes.clone_from(&population[p1_idx].genes); // sem crossover
        if p.mutation_rate >= 1.0 || random_f64() < p.mutation_rate {
            problem.mutate(estado, &mut filho.genes, p.mutation_gene_rate);
        }
        filho.fitness = Some(problem.fitness(estado, &filho.genes));
        filho.hash = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::problems::{OneMaxGAProblem, TSPGAProblem};
    use crate::horario::{FomularioHorario, RegrasHorario};

    fn config(pop: usize, genes: usize) -> GAConfig {
        GAConfig {
            population_size: pop,
            crossover_rate: 0.9,
            mutation_rate: 0.9,
            mutation_gene_rate: 1.0 / genes as f64,
            tournament_size: 5,
            // Pequeno de propósito: exercita a reintrodução do melhor e o reinício da população
            max_stagnation: Some(40),
            diversity_check: false,
            threads: 0,
        }
    }

    /// Genes e fitness de cada indivíduo.
    type Populacao<P> = Vec<(<P as GAProblem>::Gene, Option<f64>)>;

    /// Estado completo após `geracoes`: melhor indivíduo e todos os genes e fitness da população.
    fn evoluir<P: GAProblem>(problema: P, mut cfg: GAConfig, threads: usize, geracoes: usize) -> (GAInfo<P>, Populacao<P>) {
        fastrand::seed(42);
        cfg.threads = threads;
        let mut ga = GeneticAlgorithm::new(problema, cfg);
        // Em duas chamadas, para passar também pelo caminho de continuar uma execução
        ga.run(geracoes / 2);
        ga.run(geracoes - geracoes / 2);
        let populacao = ga.population.iter().map(|ind| (ind.genes.clone(), ind.fitness)).collect();
        (ga.get_info(), populacao)
    }

    /// A mesma semente tem que dar exatamente a mesma evolução em sequência e em paralelo.
    fn assert_paralelo_igual_ao_sequencial<P: GAProblem>(criar: impl Fn() -> P, cfg: GAConfig, geracoes: usize)
    where
        P::Gene: PartialEq,
    {
        assert!(pool_disponivel() && rayon::current_num_threads() > 1, "o teste precisa de mais de uma thread");
        let (info_seq, pop_seq) = evoluir(criar(), cfg.clone(), 1, geracoes);
        assert!(pop_seq.iter().all(|(_, f)| f.is_some()), "todos os indivíduos saem avaliados");

        // 2 = sempre paralelo; 0 = automático, que alterna entre os dois modos durante a execução
        for (modo, threads) in [("paralelo", 2), ("automático", 0)] {
            let (info, pop) = evoluir(criar(), cfg.clone(), threads, geracoes);
            assert_eq!(info_seq.generation, info.generation, "{modo}");
            assert_eq!(info_seq.best_fitness, info.best_fitness, "{modo}");
            assert!(info_seq.best_genes == info.best_genes, "{modo}: melhores genes diferentes");
            assert!(pop_seq == pop, "{modo}: populações diferentes");
        }
    }

    #[test]
    fn onemax_paralelo_igual_ao_sequencial() {
        // 201: população ímpar (sem sobra de filho); 200: par (sobra um filho no último bloco)
        for pop in [201, 200, 37] {
            assert_paralelo_igual_ao_sequencial(|| OneMaxGAProblem::new(500), config(pop, 500), 120);
        }
    }

    #[test]
    fn tsp_paralelo_igual_ao_sequencial() {
        fastrand::seed(7);
        let cidades = TSPGAProblem::generate_random_cities(60);
        assert_paralelo_igual_ao_sequencial(|| TSPGAProblem::new(cidades.clone()), config(300, 60), 150);
    }

    #[test]
    fn tsp_com_diversidade_paralelo_igual_ao_sequencial() {
        fastrand::seed(8);
        let cidades = TSPGAProblem::generate_random_cities(12);
        let cfg = GAConfig { diversity_check: true, ..config(150, 12) };
        assert_paralelo_igual_ao_sequencial(|| TSPGAProblem::new(cidades.clone()), cfg, 150);
    }

    #[test]
    fn horario_paralelo_igual_ao_sequencial() {
        let criar = || {
            let caminho = format!("{}/tests/instancias/pequena.json", env!("CARGO_MANIFEST_DIR"));
            let f: FomularioHorario = serde_json::from_str(&std::fs::read_to_string(caminho).unwrap()).unwrap();
            RegrasHorario::new(f).unwrap()
        };
        let tamanho = criar().tamanho_quadro();
        assert_paralelo_igual_ao_sequencial(criar, config(tamanho * 2, tamanho), 150);
    }

    #[test]
    fn tamanho_do_bloco_e_par_e_limita_o_numero_de_blocos() {
        for pop in [1, 2, 15, 16, 17, 200, 336, 1400, 3500, 100_000] {
            let tam = tamanho_bloco(pop);
            assert!(tam >= 8 && tam.is_multiple_of(2), "pop {pop}: bloco {tam}");
            assert!(pop.div_ceil(tam) <= 256, "pop {pop}: {} blocos", pop.div_ceil(tam));
        }
    }
}
