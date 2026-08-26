use wasm_bindgen::prelude::*;
use crate::console_log;

use genetic_algorithms::chromosomes::ListChromosome;
use genetic_algorithms::configuration::ProblemSolving;
use genetic_algorithms::ga::Ga;
use genetic_algorithms::genotypes::List as ListGenotype;
use genetic_algorithms::initializers::list_random_initialization_without_repetitions;
use genetic_algorithms::operations::{Crossover, Mutation, Selection, Survivor};
use genetic_algorithms::traits::{ConfigurationT, CrossoverConfig, MutationConfig, SelectionConfig, StoppingConfig};

/// Cidades fixas (x, y) para o teste de TSP
const CITIES: [(f64, f64); 6] = [
    (0.0, 0.0),
    (1.0, 0.0),
    (1.0, 1.0),
    (0.0, 1.0),
    (0.5, 0.5),
    (2.0, 0.5),
];

fn tsp_distance(dna: &[ListGenotype<usize>]) -> f64 {
    let n = dna.len();
    let mut dist = 0.0_f64;
    for i in 0..n {
        let (x1, y1) = CITIES[dna[i].value];
        let (x2, y2) = CITIES[dna[(i + 1) % n].value];
        dist += ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
    }
    dist
}

#[wasm_bindgen]
pub fn run_tsp_v2() -> f64 {
    let n_cities = CITIES.len();

    // Alelo único com todos os índices de cidades como valores possíveis
    let city_indices: Vec<usize> = (0..n_cities).collect();
    let alleles = vec![ListGenotype::new(0, city_indices, 0_usize).unwrap()];
    let alleles_clone = alleles.clone();

    let mut ga: Ga<ListChromosome<usize>> = Ga::new()
        .with_genes_per_chromosome(n_cities)
        .with_population_size(100)
        .with_initialization_fn(move |genes_per_chromosome, _, _| {
            list_random_initialization_without_repetitions(genes_per_chromosome, Some(&alleles_clone), None)
        })
        .with_fitness_fn(|dna: &[ListGenotype<usize>]| -tsp_distance(dna))
        .with_selection_method(Selection::Tournament)
        .with_crossover_method(Crossover::Order)
        .with_mutation_method(Mutation::Swap)
        .with_survivor_method(Survivor::Fitness)
        .with_problem_solving(ProblemSolving::Maximization)
        .with_max_generations(500)
        .build()
        .expect("Invalid configuration");

    let population = ga.run().expect("GA run failed");
    let best_distance = -population.best_chromosome.fitness;
    console_log!("Best TSP distance: {:.4}", best_distance);

    best_distance
}