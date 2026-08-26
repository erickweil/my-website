use wasm_bindgen::prelude::*;
use crate::console_log;

use genetic_algorithms::chromosomes::ListChromosome;
use genetic_algorithms::configuration::ProblemSolving;
use genetic_algorithms::ga::Ga;
use genetic_algorithms::genotypes::List as ListGenotype;
use genetic_algorithms::initializers::list_random_initialization_without_repetitions;
use genetic_algorithms::operations::{Crossover, Mutation, Selection, Survivor};
use genetic_algorithms::traits::{ConfigurationT, CrossoverConfig, ElitismConfig, MutationConfig, SelectionConfig, StoppingConfig};

fn tsp_distance(dna: &[ListGenotype<usize>], cities: &[(f64, f64)]) -> f64 {
    let n = dna.len();
    let mut dist = 0.0_f64;
    for i in 0..n {
        let (x1, y1) = cities[dna[i].value];
        let (x2, y2) = cities[dna[(i + 1) % n].value];
        dist += ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
    }
    dist
}

/// Recebe as cidades como um Float64Array plano: [x0, y0, x1, y1, x2, y2, ...]
#[wasm_bindgen]
pub fn run_tsp_v2(cities_flat: Vec<f64>, max_generations: usize) -> f64 {
    let raw = cities_flat.to_vec();
    if raw.len() % 2 != 0 || raw.is_empty() {
        console_log!("run_tsp_v2: cities_flat deve ter comprimento par e não vazio");
        return f64::NAN;
    }

    let cities: Vec<(f64, f64)> = raw
        .chunks_exact(2)
        .map(|c| (c[0], c[1]))
        .collect();
    let n_cities = cities.len();

    let city_indices: Vec<usize> = (0..n_cities).collect();
    let alleles = vec![ListGenotype::new(0, city_indices, 0_usize).unwrap()];
    let alleles_clone = alleles.clone();

    let mut ga: Ga<ListChromosome<usize>> = Ga::new()
        .with_genes_per_chromosome(n_cities)
        .with_population_size(n_cities * 2)
        .with_elitism(1)
        .with_initialization_fn(move |genes_per_chromosome, _, _| {
            list_random_initialization_without_repetitions(genes_per_chromosome, Some(&alleles_clone), None)
        })
        .with_fitness_fn(move |dna: &[ListGenotype<usize>]| -tsp_distance(dna, &cities))
        .with_selection_method(Selection::Tournament)
        .with_crossover_method(Crossover::Order)
        .with_mutation_method(Mutation::Swap)
        .with_survivor_method(Survivor::Fitness)
        .with_problem_solving(ProblemSolving::Maximization)
        .with_max_generations(max_generations)
        .build()
        .expect("Invalid configuration");

    let population = ga.run().expect("GA run failed");
    let best_distance = -population.best_chromosome.fitness;
    console_log!("Best TSP distance: {:.4}", best_distance);

    best_distance
}