#[cfg(debug_assertions)]
use crate::console_log;
use crate::{
    genetic::{
        operators::tournament_selection,
        problems::{GAProblem, Individual},
    },
    paralelo::pool_disponivel,
    random::random_f64,
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

    /// Modelo de ilhas: número de subpopulações que evoluem separadas, em anel. 0 ou 1 = uma
    /// população só (modelo clássico). Com ilhas, `population_size` é o tamanho de CADA ilha (a
    /// população total é `population_size * ilhas`), o torneio só enxerga a própria ilha e o
    /// elitismo é por ilha. O controle de estagnação e o reinício continuam globais.
    /// Cada ilha roda numa thread, com uma sincronização por época em vez de uma por geração.
    ///
    /// Quando usar (medido em examples/bench_ga_qualidade, mesmo número de avaliações):
    /// - ajuda em problemas com ótimos locais e população pequena (horário pequeno: 16 a 18 de 20
    ///   execuções resolvidas com 8 ou 16 ilhas, contra 10 de 20 no modelo clássico), e quando a
    ///   geração é curta demais para dividir em blocos (o paralelismo por geração rende pouco);
    /// - não ajuda em problemas fáceis (OneMax gasta 5 a 7 vezes mais avaliações) nem nos
    ///   grandes, em que é melhor usar as threads para acelerar uma população só.
    /// Padrão 0
    pub ilhas: usize,
    /// Com ilhas: gerações que cada ilha evolui sozinha entre uma migração e outra.
    /// Medido: 100 a 200 foi o melhor no horário; o TSP preferiu 50; 1000 foi pior nos dois.
    /// Padrão 100
    pub epoca: usize,
    /// Com ilhas: fração de cada ilha que passa para a ilha vizinha a cada época (0.0 a 1.0).
    /// A migração é um giro do array da população: a fronteira entre as ilhas desliza.
    /// Medido no horário: de 0% a 50% a diferença ficou dentro do ruído entre sementes.
    /// Padrão 0.1
    pub migracao: f64,
    /// Com ilhas: quem migra. false = indivíduos quaisquer (o melhor de cada ilha fica nela);
    /// true = o melhor de cada ilha vai junto (espalha mais rápido, mas aumenta a pressão de
    /// seleção). Medido: sem diferença clara entre os dois. Padrão false
    pub migrar_elite: bool,
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
            ilhas: 0,
            epoca: 100,
            migracao: 0.1,
            migrar_elite: false,
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

    // Modelo de ilhas (ver `run_ilhas`)
    /// Gerações que faltam para a próxima migração (0 = ainda não começou uma época).
    ate_migrar: usize,
    /// Estado do gerador aleatório de cada ilha, guardado entre um trecho e outro: assim a
    /// evolução não depende de em quantas chamadas de `run` uma época é dividida.
    sementes_ilhas: Vec<u64>,
    /// Com `diversity_check`: hashes já vistos na geração atual de cada ilha.
    hashes_ilhas: Vec<FxHashSet<u64>>,

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
            ate_migrar: 0,
            sementes_ilhas: Vec::new(),
            hashes_ilhas: Vec::new(),
            config,
        }
    }

    /// Há como rodar em paralelo? (configuração permite, existe pool e ele tem mais de uma thread)
    fn pode_usar_threads(&self) -> bool {
        self.config.threads != 1 && pool_disponivel() && rayon::current_num_threads() >= 2
    }

    /// Número de ilhas (1 = modelo clássico, uma população só).
    fn n_ilhas(&self) -> usize {
        self.config.ilhas.max(1)
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
        // Com ilhas não há calibragem: a sincronização é por época, então o paralelo sempre compensa
        self.pode_usar_threads() && self.n_ilhas() > 1 || self.pode_usar_threads() && match (self.config.threads, self.calibragem) {
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
            // 1. Avalia a geração atual e produz a(s) próxima(s)
            let (best_idx, geracoes, fim_de_epoca) = if self.n_ilhas() > 1 {
                self.run_ilhas(max_generations - self.generation)
            } else {
                let paralelo = self.usar_threads();
                // Só mede o tempo durante a calibragem do modo automático (e só se houver pool)
                if self.config.threads == 0 && matches!(self.calibragem, Calibragem::Medindo { .. }) && self.pode_usar_threads() {
                    let inicio = Instant::now();
                    self.run_generation(paralelo);
                    self.registrar_tempo(inicio.elapsed());
                } else {
                    self.run_generation(paralelo);
                }
                // O elite fica na posição 0; no modelo clássico cada geração é uma "época"
                (0, 1, true)
            };

            // 2. Melhor global (a cada trecho: não interfere na evolução). Empate também troca
            // (`>=`, aqui e na escolha do elite): a busca anda pelos platôs, e quem acompanha o
            // progresso vê que o melhor mudou. A estagnação continua contando só melhora de verdade.
            let current_best_fitness = self.population[best_idx].fitness.unwrap_or(f64::MIN);
            if self.best_fitness.is_none_or(|bf| current_best_fitness >= bf) {
                if let Some(bg) = &mut self.best_genes {
                    // clone_from previne realocação
                    bg.clone_from(&self.population[best_idx].genes);
                }
                self.best_fitness = Some(current_best_fitness);

                // Se atingiu o fitness máximo possível, podemos parar
                if let Some(max_fit) = self.problem.max_fitness()
                    && current_best_fitness >= max_fit {
                    break;
                }
            }
            self.generation += geracoes;

            // 3. Estagnação e reinício: só no fim da época, para a evolução não depender de em
            // quantas chamadas de `run` a época foi dividida
            if fim_de_epoca {
                let epoca = if self.n_ilhas() > 1 { self.config.epoca.max(1) } else { 1 };
                self.controlar_estagnacao(current_best_fitness, epoca);
            }
        }
    }

    /// Controle global de estagnação, chamado a cada `passo` gerações (1 no modelo clássico; uma
    /// época com ilhas): mutação adaptativa, reintrodução do melhor e reinício da população.
    /// `current_best_fitness` é o melhor fitness da população atual.
    fn controlar_estagnacao(&mut self, current_best_fitness: f64, passo: usize) {
        // Última geração rodada, e há quantas gerações ela está sem melhora
        let ultima = self.generation - 1;
        let stagnated_for = ultima.saturating_sub(self.stag_start);
        // A FAZER: usar i64 para comparação de fitness para evitar problemas de precisão
        #[cfg(debug_assertions)]
        let mut improved = false;
        if self.stag_fitness.is_none_or(|sf| current_best_fitness > (sf + f64::EPSILON)) {
            self.stag_fitness = Some(current_best_fitness);
            self.stag_start = ultima;
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

            // A estagnação cruzou a metade do limite neste passo (com passo 1: chegou nela)
            if stagnated_for >= half_stag && stagnated_for - half_stag < passo {
                // Re-introduz o melhor indivíduo (sorteio no gerador do motor: ver `rng`)
                let r_idx = self.rng.usize(0..self.population.len());
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
                self.stag_start = ultima;
                self.mutation_multiplier = 1.0;
                self.tournament_multiplier = 1.0;
            }
        }

        // A FAZER: implementar progressCallback
        #[cfg(debug_assertions)]
        {
            if improved || ultima.is_multiple_of(1000) {
                console_log!(
                    "[GA] Gen {:>8} | fitness {:>4} / {:>4} (best {:>4}) | stag: {}",
                    ultima, current_best_fitness, self.problem.max_fitness().unwrap_or(0.0),
                    self.best_fitness.unwrap_or(0.0),
                    ultima - self.stag_start
                );
            }
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
        // Com ilhas, `population_size` é o tamanho de cada ilha
        let n_ilhas = self.n_ilhas();
        let pop_size = self.config.population_size * n_ilhas;

        // Um estado de trabalho por bloco (modelo clássico) ou por ilha
        let n_estados = if n_ilhas > 1 { n_ilhas } else { pop_size.div_ceil(tamanho_bloco(pop_size)) };
        let problem = &self.problem;
        self.estados.resize_with(n_estados, || problem.initial_state());
        self.hashes_ilhas.resize_with(if n_ilhas > 1 { n_ilhas } else { 0 }, FxHashSet::default);
        let rng = &mut self.rng;
        self.sementes_ilhas.resize_with(if n_ilhas > 1 { n_ilhas } else { 0 }, || rng.u64(..));

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

    /// Modelo de ilhas: evolui todas as ilhas por um trecho de até `max_geracoes` gerações (o
    /// trecho termina na próxima migração, se ela vier antes) e, se a época acabou, faz a migração.
    /// Retorna (índice do melhor indivíduo da população, gerações rodadas, se a época terminou).
    ///
    /// A ilha `i` é a fatia `[i * tam, (i + 1) * tam)` do array da população. As ilhas são
    /// independentes durante o trecho, então rodam em sequência ou uma por thread com exatamente
    /// o mesmo resultado — e as threads só se sincronizam uma vez por trecho, não a cada geração.
    ///
    /// Migração: o array é girado em `migracao * tam` posições, ou seja, a fronteira entre as ilhas
    /// desliza e os indivíduos de uma ponta de cada ilha passam a pertencer à vizinha (anel).
    /// O elite fica na posição 0 da ilha; girar para a direita leva embora os ÚLTIMOS (filhos em
    /// ordem qualquer) e o elite fica; girar para a esquerda leva os PRIMEIROS, elite incluído.
    fn run_ilhas(&mut self, max_geracoes: usize) -> (usize, usize, bool) {
        let tam = self.config.population_size;
        let epoca = self.config.epoca.max(1);
        if self.ate_migrar == 0 || self.ate_migrar > epoca {
            self.ate_migrar = epoca;
        }
        let geracoes = max_geracoes.min(self.ate_migrar);

        let tournament_size = ((self.config.tournament_size as f64) * self.tournament_multiplier).floor() as usize;
        let params = ParamsGeracao {
            crossover_rate: self.config.crossover_rate,
            mutation_rate: self.config.mutation_rate * self.mutation_multiplier,
            mutation_gene_rate: self.config.mutation_gene_rate * self.mutation_multiplier,
            tournament_size: tournament_size.max(2),
        };
        let diversity_check = self.config.diversity_check;
        // Uma sincronização por trecho: com pool, o paralelo sempre compensa (não há calibragem)
        let paralelo = self.pode_usar_threads();
        let problem = &self.problem;

        let ilha = |((((pop, filhos), estado), hashes), semente): Ilha<P>| {
            evoluir_ilha(problem, pop, filhos, estado, hashes, semente, geracoes, diversity_check, params);
        };
        if paralelo {
            self.population.par_chunks_mut(tam)
                .zip(self.offspring.par_chunks_mut(tam))
                .zip(self.estados.par_iter_mut())
                .zip(self.hashes_ilhas.par_iter_mut())
                .zip(self.sementes_ilhas.par_iter_mut())
                .for_each(ilha);
        } else {
            self.population.chunks_mut(tam)
                .zip(self.offspring.chunks_mut(tam))
                .zip(self.estados.iter_mut())
                .zip(self.hashes_ilhas.iter_mut())
                .zip(self.sementes_ilhas.iter_mut())
                .for_each(ilha);
        }

        // Depois de um número ímpar de gerações, a geração mais nova de todas as ilhas está em `offspring`
        if geracoes % 2 == 1 {
            mem::swap(&mut self.population, &mut self.offspring);
        }
        // Migração no fim da época
        self.ate_migrar -= geracoes;
        let fim_de_epoca = self.ate_migrar == 0;
        if fim_de_epoca {
            let migrantes = ((self.config.migracao.clamp(0.0, 1.0) * tam as f64).round() as usize).min(tam);
            if self.config.migrar_elite {
                self.population.rotate_left(migrantes);
            } else {
                self.population.rotate_right(migrantes);
            }
        }

        // Todos saem avaliados de `evoluir_ilha`; o melhor global é o melhor entre as ilhas
        let mut best_idx = 0;
        let mut best_fitness = f64::MIN;
        for (i, ind) in self.population.iter().enumerate() {
            let fit = ind.fitness.unwrap_or(f64::MIN);
            if fit >= best_fitness {
                best_fitness = fit;
                best_idx = i;
            }
        }
        (best_idx, geracoes, fim_de_epoca)
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
            if fit >= best_fitness {
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

/// O que uma ilha precisa para evoluir sozinha: as suas fatias da população e dos filhos, o seu
/// estado de trabalho, os hashes da geração (para `diversity_check`) e o estado do seu gerador.
type Ilha<'a, P> = (
    (((&'a mut [Individual<<P as GAProblem>::Gene>], &'a mut [Individual<<P as GAProblem>::Gene>]), &'a mut <P as GAProblem>::State), &'a mut FxHashSet<u64>),
    &'a mut u64,
);

/// Evolui uma ilha por `geracoes` gerações, sem olhar para as outras: o torneio sorteia pais só
/// dentro dela e o elitismo guarda o melhor dela. A cada geração `pop` e `filhos` trocam de papel;
/// depois de um número ímpar de gerações, a geração mais nova está na fatia que era `filhos`.
#[allow(clippy::too_many_arguments)]
fn evoluir_ilha<'a, P: GAProblem>(
    problem: &P,
    mut pop: &'a mut [Individual<P::Gene>],
    mut filhos: &'a mut [Individual<P::Gene>],
    estado: &mut P::State,
    hashes: &mut FxHashSet<u64>,
    semente: &mut u64,
    geracoes: usize,
    diversity_check: bool,
    p: ParamsGeracao,
) {
    // Como nos blocos: a sequência aleatória depende da ilha, não da thread que a executa.
    // O gerador global da thread continua de onde esta ilha parou no trecho anterior.
    fastrand::seed(*semente);

    for _ in 0..geracoes {
        // Avalia quem falta (ilha nova, reiniciada, ou que recebeu migrantes ainda sem fitness)
        let mut melhor = 0;
        let mut melhor_fitness = f64::MIN;
        for (i, ind) in pop.iter_mut().enumerate() {
            let fit = *ind.fitness.get_or_insert_with(|| problem.fitness(estado, &ind.genes));
            if fit >= melhor_fitness {
                melhor_fitness = fit;
                melhor = i;
            }
        }

        // Elitismo da ilha: o melhor dela vai para a posição 0 da próxima geração
        filhos[0].genes.clone_from(&pop[melhor].genes);
        filhos[0].fitness = Some(melhor_fitness);
        filhos[0].hash = None;

        reproduzir(problem, pop, &mut filhos[1..], estado, p);

        // Diversidade dentro da ilha: filho igual a outro já visto recebe mais uma mutação
        if diversity_check {
            hashes.clear();
            for filho in filhos.iter_mut() {
                let mut hash = problem.hash(&filho.genes);
                if hash.is_some_and(|h| hashes.contains(&h)) {
                    problem.mutate(estado, &mut filho.genes, p.mutation_gene_rate);
                    filho.fitness = Some(problem.fitness(estado, &filho.genes));
                    hash = problem.hash(&filho.genes);
                }
                filho.hash = hash;
                if let Some(h) = hash {
                    hashes.insert(h);
                }
            }
        }

        mem::swap(&mut pop, &mut filhos);
    }

    *semente = fastrand::get_seed();
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
    reproduzir(problem, population, filhos, estado, p);
}

/// Seleção, crossover, mutação e avaliação de `filhos`, com pais sorteados em `population`.
/// Usa o gerador global da thread (quem chama é responsável por semeá-lo).
#[inline(always)]
fn reproduzir<P: GAProblem>(
    problem: &P,
    population: &[Individual<P::Gene>],
    filhos: &mut [Individual<P::Gene>],
    estado: &mut P::State,
    p: ParamsGeracao,
) {
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
    use crate::horario::RegrasHorario;

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
            ..GAConfig::new()
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
            RegrasHorario::de_arquivo(&format!("{}/tests/instancias/pequena.json", env!("CARGO_MANIFEST_DIR")))
        };
        let tamanho = criar().tamanho_quadro();
        assert_paralelo_igual_ao_sequencial(criar, config(tamanho * 2, tamanho), 150);
    }

    // ── Modelo de ilhas ─────────────────────────────────────────────────────────────────────

    fn config_ilhas(pop_por_ilha: usize, genes: usize, ilhas: usize, epoca: usize, migracao: f64, migrar_elite: bool) -> GAConfig {
        GAConfig { ilhas, epoca, migracao, migrar_elite, ..config(pop_por_ilha, genes) }
    }

    #[test]
    fn ilhas_paralelo_igual_ao_sequencial() {
        fastrand::seed(9);
        let cidades = TSPGAProblem::generate_random_cities(40);
        // Época ímpar (troca população/filhos no fim), par, e maior que as gerações de cada chamada
        for (epoca, migrar_elite) in [(7, false), (10, true), (500, false)] {
            let cfg = config_ilhas(60, 40, 5, epoca, 0.1, migrar_elite);
            assert_paralelo_igual_ao_sequencial(|| TSPGAProblem::new(cidades.clone()), cfg, 150);
        }
        assert_paralelo_igual_ao_sequencial(|| OneMaxGAProblem::new(300), config_ilhas(31, 300, 4, 5, 0.25, false), 120);
        let cfg = GAConfig { diversity_check: true, ..config_ilhas(40, 12, 3, 6, 0.1, false) };
        fastrand::seed(10);
        let poucas = TSPGAProblem::generate_random_cities(12);
        assert_paralelo_igual_ao_sequencial(|| TSPGAProblem::new(poucas.clone()), cfg, 120);
    }

    #[test]
    fn ilhas_horario_paralelo_igual_ao_sequencial() {
        let criar = || {
            RegrasHorario::de_arquivo(&format!("{}/tests/instancias/pequena.json", env!("CARGO_MANIFEST_DIR")))
        };
        let tamanho = criar().tamanho_quadro();
        assert_paralelo_igual_ao_sequencial(criar, config_ilhas(tamanho, tamanho, 4, 20, 0.1, false), 150);
    }

    #[test]
    fn ilhas_multiplicam_a_populacao_e_uma_ilha_e_o_modelo_classico() {
        let (_, pop) = evoluir(OneMaxGAProblem::new(100), config_ilhas(30, 100, 4, 10, 0.1, false), 1, 20);
        assert_eq!(pop.len(), 120);

        // ilhas = 0 ou 1: exatamente o modelo clássico
        let (info_classico, pop_classico) = evoluir(OneMaxGAProblem::new(100), config(30, 100), 1, 60);
        for ilhas in [0, 1] {
            let (info, pop) = evoluir(OneMaxGAProblem::new(100), config_ilhas(30, 100, ilhas, 10, 0.1, false), 1, 60);
            assert_eq!(pop.len(), 30);
            assert_eq!(info.best_fitness, info_classico.best_fitness);
            assert!(pop == pop_classico, "ilhas = {ilhas} deveria ser igual ao modelo clássico");
        }
    }

    /// A migração acontece a cada `epoca` gerações, não importa em quantas chamadas o `run` é dividido.
    #[test]
    fn ilhas_cadencia_nao_depende_das_chamadas_ao_run() {
        fastrand::seed(11);
        let cidades = TSPGAProblem::generate_random_cities(30);
        let rodar = |passos: &[usize]| {
            fastrand::seed(42);
            let mut ga = GeneticAlgorithm::new(TSPGAProblem::new(cidades.clone()), config_ilhas(40, 30, 4, 15, 0.2, false));
            for &p in passos {
                ga.run(p);
            }
            (ga.generation, ga.best_fitness, ga.population.iter().map(|i| i.genes.clone()).collect::<Vec<_>>())
        };
        let de_uma_vez = rodar(&[120]);
        assert_eq!(de_uma_vez.0, 120);
        assert!(de_uma_vez == rodar(&[50, 50, 20]), "50+50+20");
        assert!(de_uma_vez == rodar(&[1; 120]), "120 chamadas de 1 geração");
        assert!(de_uma_vez == rodar(&[7, 15, 30, 68]), "7+15+30+68");
    }

    /// Sem migração e sem reinício, o melhor de cada ilha nunca piora (elitismo por ilha), e as
    /// ilhas evoluem de forma diferente umas das outras.
    #[test]
    fn ilhas_tem_elitismo_proprio() {
        let (ilhas, tam) = (4, 30);
        let cfg = GAConfig { max_stagnation: None, ..config_ilhas(tam, 200, ilhas, 5, 0.0, false) };
        fastrand::seed(5);
        let mut ga = GeneticAlgorithm::new(OneMaxGAProblem::new(200), cfg);
        let melhores = |ga: &GeneticAlgorithm<OneMaxGAProblem>| -> Vec<f64> {
            ga.population.chunks(tam).map(|ilha| ilha.iter().filter_map(|i| i.fitness).fold(f64::MIN, f64::max)).collect()
        };
        ga.run(5);
        let mut anterior = melhores(&ga);
        assert_eq!(anterior.len(), ilhas);
        for _ in 0..20 {
            ga.run(5);
            let atual = melhores(&ga);
            for (i, (a, b)) in anterior.iter().zip(&atual).enumerate() {
                assert!(b >= a, "ilha {i} piorou: {a} -> {b}");
            }
            anterior = atual;
        }
        assert!(anterior.iter().any(|&f| f != anterior[0]), "ilhas isoladas deveriam divergir: {anterior:?}");
        // O melhor global é o melhor entre as ilhas
        assert_eq!(ga.best_fitness, Some(anterior.iter().cloned().fold(f64::MIN, f64::max)));
    }

    /// Girar o array muda quem pertence a cada ilha, sem criar nem perder indivíduos.
    #[test]
    fn migracao_desloca_a_fronteira_das_ilhas() {
        let (ilhas, tam) = (3, 20);
        for (migrar_elite, deslocamento) in [(false, 5isize), (true, -5)] {
            // Taxas zeradas: sem crossover nem mutação os genes só são copiados, e dá para segui-los
            let cfg = GAConfig { crossover_rate: 0.0, mutation_rate: 0.0, max_stagnation: None, ..config_ilhas(tam, 64, ilhas, 4, 0.25, migrar_elite) };
            fastrand::seed(6);
            let mut ga = GeneticAlgorithm::new(OneMaxGAProblem::new(64), cfg);
            ga.run(3); // falta 1 geração para a migração
            let antes: Vec<_> = ga.population.iter().map(|i| i.genes.clone()).collect();
            // Roda a última geração da época numa cópia sem migração, para comparar posição a posição
            let mut sem_migrar = GeneticAlgorithm::new(OneMaxGAProblem::new(64), GAConfig { migracao: 0.0, ..ga.config.clone() });
            fastrand::seed(6);
            sem_migrar = { let mut g = GeneticAlgorithm::new(OneMaxGAProblem::new(64), sem_migrar.config.clone()); g.run(4); g };
            ga.run(1);
            assert_eq!(antes.len(), ilhas * tam);
            let n = (ilhas * tam) as isize;
            for (i, ind) in sem_migrar.population.iter().enumerate() {
                let destino = (i as isize + deslocamento).rem_euclid(n) as usize;
                assert!(ga.population[destino].genes == ind.genes, "elite={migrar_elite}: indivíduo {i} deveria estar em {destino}");
            }
        }
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
