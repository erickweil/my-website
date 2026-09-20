use std::env;
use std::time::Instant;
use rust_wasm::genetic::{
    ga::{GAConfig, GeneticAlgorithm},
    problems::OneMaxGAProblem,
};

fn main() {
    let args: Vec<String> = env::args().collect();
    
    // args: [genes] [pop_size] [max_gens] [mode: fixed/optimal] [runs] [seed]
    let genes: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(1024);
    let pop_size: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(64);
    let max_gens: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(100);
    let mode: String = args.get(4).cloned().unwrap_or_else(|| "fixed".to_string());
    let runs: usize = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(1);
    let seed: Option<u64> = args.get(6).and_then(|s| s.parse().ok());

    if let Some(s) = seed {
        fastrand::seed(s);
    }

    let config = GAConfig {
        population_size: pop_size,
        crossover_rate: 0.9,
        mutation_rate: 0.9,
        mutation_gene_rate: 1.0 / (genes as f64),
        tournament_size: 5,
        diversity_check: false,
        max_stagnation: None,
    };

    println!("=== Rust OneMax Benchmark ===");
    println!("genes={} pop={} max_gens={} mode={} runs={}", genes, pop_size, max_gens, mode, runs);

    let mut total_time_ms = 0.0;
    let mut total_gens_executed = 0usize;
    let mut reached_optimal_count = 0usize;
    let mut gens_to_optimal_sum = 0usize;
    let mut best_fitness_last = 0.0;

    let overall_start = Instant::now();

    for r in 0..runs {
        let problem = OneMaxGAProblem::new(genes);
        let mut ga = GeneticAlgorithm::new(problem, config.clone());
        ga.initialize_population(false);

        let run_start = Instant::now();
        let mut gens_in_this_run = 0usize;
        let mut reached_optimal = false;

        if mode == "optimal" {
            // Roda até atingir o ótimo ou atingir max_gens
            for g in 1..=max_gens {
                let best_fit = ga.run_step();
                gens_in_this_run = g;
                if best_fit >= genes as f64 {
                    reached_optimal = true;
                    break;
                }
            }
        } else {
            // Modo fixed: roda exatamente max_gens
            for _ in 0..max_gens {
                ga.run_step();
            }
            gens_in_this_run = max_gens;
            let best_fit = ga.get_info().best_fitness.unwrap_or(0.0);
            if best_fit >= genes as f64 {
                reached_optimal = true;
            }
        }

        let run_elapsed = run_start.elapsed().as_secs_f64() * 1000.0;
        total_time_ms += run_elapsed;
        total_gens_executed += gens_in_this_run;
        if reached_optimal {
            reached_optimal_count += 1;
            gens_to_optimal_sum += gens_in_this_run;
        }
        best_fitness_last = ga.get_info().best_fitness.unwrap_or(0.0);

        if runs > 1 && (r + 1) % (runs / 5).max(1) == 0 {
            println!("  run {}/{}: {} gens in {:.2} ms (best fit: {}/{})", 
                r + 1, runs, gens_in_this_run, run_elapsed, best_fitness_last, genes);
        }
    }

    let overall_elapsed = overall_start.elapsed().as_secs_f64() * 1000.0;
    let avg_time_per_gen_ms = total_time_ms / (total_gens_executed as f64);
    let avg_time_per_gen_us = avg_time_per_gen_ms * 1000.0;

    println!("--------------------------------------------------");
    println!("Tempo total: {:.3} ms (overall: {:.3} ms)", total_time_ms, overall_elapsed);
    println!("Gerações executadas no total: {}", total_gens_executed);
    println!("Tempo médio por geração: {:.4} ms ({:.1} µs)", avg_time_per_gen_ms, avg_time_per_gen_us);
    println!("Último melhor fitness: {} / {}", best_fitness_last, genes);
    if reached_optimal_count > 0 {
        let avg_gens_opt = gens_to_optimal_sum as f64 / reached_optimal_count as f64;
        println!("Atingiu o ótimo: {}/{} corridas (média de {:.1} gerações)", reached_optimal_count, runs, avg_gens_opt);
    } else {
        println!("Atingiu o ótimo: 0/{} corridas dentro do limite de gerações", runs);
    }
}
