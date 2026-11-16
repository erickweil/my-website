//! Benchmark do motor genético em vários problemas, para guiar a paralelização.
//!
//! Para cada problema mede:
//! - gerações/s do motor completo;
//! - o custo de UMA avaliação de fitness isolada (µs);
//! - que fração da geração é avaliação (o resto é seleção + crossover + mutação).
//!
//! Uso: cargo run --release --example bench_ga_threads -- [--segundos N] [--threads 1,2,4]
//!      [--ilhas N] [--epoca N] [--migracao F] [--migrar-elite]

use std::{env, time::Instant};

use rust_wasm::{
    genetic::{
        ga::{GAConfig, GeneticAlgorithm},
        problems::{GAProblem, OneMaxGAProblem, TSPGAProblem},
    },
    horario::{config_ga_horario, RegrasHorario},
};

fn carregar_horario(nome: &str) -> RegrasHorario {
    RegrasHorario::de_arquivo(nome)
}

fn config(pop: usize, genes: usize) -> GAConfig {
    GAConfig {
        population_size: pop,
        crossover_rate: 0.9,
        mutation_rate: 0.9,
        mutation_gene_rate: 1.0 / genes.max(1) as f64,
        tournament_size: 10,
        max_stagnation: None,
        diversity_check: false,
        threads: 0,
        ..GAConfig::new()
    }
}

/// Custo de uma avaliação isolada, em µs (média sobre genes aleatórios).
fn custo_fitness<P: GAProblem>(problema: &P) -> f64 {
    let mut estado = problema.initial_state();
    let genes: Vec<P::Gene> = (0..64).map(|_| problema.random_genes()).collect();
    let mut soma = 0.0;
    let mut n = 0u64;
    let inicio = Instant::now();
    while inicio.elapsed().as_secs_f64() < 0.3 {
        for g in &genes {
            soma += problema.fitness(&mut estado, g);
            n += 1;
        }
    }
    std::hint::black_box(soma);
    inicio.elapsed().as_secs_f64() * 1e6 / n as f64
}

/// Opções de ilhas da linha de comando, aplicadas a todos os problemas.
#[derive(Clone, Copy)]
struct Ilhas {
    ilhas: usize,
    epoca: usize,
    migracao: f64,
    migrar_elite: bool,
}

fn medir<P: GAProblem>(nome: &str, criar: impl Fn() -> P, mut cfg: GAConfig, segundos: f64, threads: &[usize], il: Ilhas) {
    cfg.ilhas = il.ilhas;
    cfg.epoca = il.epoca;
    cfg.migracao = il.migracao;
    cfg.migrar_elite = il.migrar_elite;
    // Com ilhas, uma geração avalia `ilhas` vezes mais indivíduos: conta gerações equivalentes
    let fator = il.ilhas.max(1) as f64;
    let us_fitness = custo_fitness(&criar());
    let pop = cfg.population_size;
    print!("{nome:<26} pop {pop:>5} | fitness {us_fitness:>8.2} µs |");

    for &t in threads {
        fastrand::seed(1);
        let mut cfg = cfg.clone();
        cfg.threads = t;
        let mut ga = GeneticAlgorithm::new(criar(), cfg);
        ga.run(20); // aquecimento
        let g0 = ga.get_info().generation;
        let inicio = Instant::now();
        while inicio.elapsed().as_secs_f64() < segundos {
            ga.run(20);
        }
        let dt = inicio.elapsed().as_secs_f64();
        let geracoes = (ga.get_info().generation - g0) as f64 * fator;
        let us_geracao = dt * 1e6 / geracoes;
        let fracao = us_fitness * pop as f64 / us_geracao * 100.0;
        if t == threads[0] {
            print!(" {t}t: {:>8.0} ger/s ({us_geracao:>8.1} µs/ger, {fracao:>3.0}% fitness)", geracoes / dt);
        } else {
            print!(" | {t}t: {:>8.0} ger/s", geracoes / dt);
        }
    }
    println!();
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let arg = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let segundos: f64 = arg("--segundos").map_or(2.0, |s| s.parse().unwrap());
    let threads: Vec<usize> = arg("--threads").map_or(vec![1], |s| s.split(',').map(|t| t.parse().unwrap()).collect());

    let il = Ilhas {
        ilhas: arg("--ilhas").map_or(0, |s| s.parse().unwrap()),
        epoca: arg("--epoca").map_or(100, |s| s.parse().unwrap()),
        migracao: arg("--migracao").map_or(0.1, |s| s.parse().unwrap()),
        migrar_elite: args.iter().any(|a| a == "--migrar-elite"),
    };

    println!("threads do rayon disponíveis: {}", rayon::current_num_threads());
    if il.ilhas > 1 {
        println!("{} ilhas, época de {} gerações: ger/s em gerações equivalentes (x{})", il.ilhas, il.epoca, il.ilhas);
    }

    for nome in ["faculdade-anonimizado", "media", "grande"] {
        let config = config_ga_horario(&carregar_horario(nome));
        medir(&format!("horário {nome:.10}"), || carregar_horario(nome), config.clone(), segundos, &threads, il);
    }
    for (cidades, pop) in [(100, 500), (500, 500), (2000, 500)] {
        fastrand::seed(7);
        let mapa = TSPGAProblem::generate_random_cities(cidades);
        medir(&format!("TSP {cidades} cidades"), || TSPGAProblem::new(mapa.clone()), config(pop, cidades), segundos, &threads, il);
    }
    for (bits, pop) in [(1_000, 200), (100_000, 200)] {
        // max_fitness faria o GA parar ao resolver; aqui só interessa a vazão
        medir(&format!("OneMax {bits} bits"), || OneMaxGAProblem::new(bits), config(pop, bits), segundos, &threads, il);
    }
}
