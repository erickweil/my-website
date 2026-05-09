use serde::{Deserialize, Serialize};

use crate::{genetic::{operators::{CrossoverOX1, mutation_combine, mutation_neighbor_swap, mutation_random_swap}, problems::GAProblem}, random::{random_f64, random_shuffle}};

/** Uma cidade com coordenadas no espaço 2D (normalizadas: 0..1). */
// Serializável para facilitar a passagem entre JS e Rust via WASM
#[derive(Serialize, Deserialize, Clone)]
pub struct TSPCity {
    pub x: f32,
    pub y: f32,
}

impl TSPCity {
    #[inline(always)]
    pub fn distance(&self, other: &TSPCity) -> f32 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }
}

/**
 * Problema do Caixeiro Viajante (TSP) para o motor genético.
 *
 * - **Genes**: permutação de índices de cidades `[0..N-1]`.
 * - **Fitness**: `1 / distânciaTotalDaRota` — quanto menor a distância, maior o fitness.
 * - **Mutação**: combinação de Swap aleatório + Shift (deslocamento), controlada por `mutationGeneRate`.
 * - **Crossover**: Order Crossover OX1, que preserva a validade da permutação (sem cidades duplicadas).
 */
pub struct TSPGAProblem {
    cities: Vec<TSPCity>,
    crossover_ox1: CrossoverOX1,
}

impl TSPGAProblem {
    pub fn new(cities: Vec<TSPCity>) -> Self {
        Self { 
            crossover_ox1: CrossoverOX1::new(cities.len()),
            cities,
        }
    }

    pub fn generate_random_cities(count: usize) -> Vec<TSPCity> {
        (0..count)
            .map(|_| TSPCity {
                x: random_f64() as f32,
                y: random_f64() as f32,
            })
            .collect()
    }

    /**
     * Soma das distâncias entre cada rota descrita pelos genes (ciclo fechado).
     */
    pub fn total_route_distance(genes: &[usize], cities: &[TSPCity]) -> f32 {
        let len = genes.len();
        let mut total_distance = 0.0;
        let mut from = &cities[genes[len - 1]];
        for i in 0..len {
            let to = &cities[genes[i]];
            total_distance += from.distance(to);

            from = to;
        }
        total_distance
    }
}

impl GAProblem for TSPGAProblem {
    type Gene = Vec<usize>;

    fn max_fitness(&self) -> Option<f64> {
        None
    }

    fn random_genes(&self) -> Self::Gene {
        let mut genes: Vec<usize> = (0..self.cities.len()).collect();
        random_shuffle(&mut genes);
        genes
    }

    fn fitness(&mut self, genes: &Self::Gene) -> f64 {
        return -Self::total_route_distance(genes, &self.cities) as f64;
    }

    fn mutate(&mut self, genes: &mut Self::Gene, mutation_rate: f64) {
        mutation_combine(genes, mutation_rate, 
            (0.5, mutation_random_swap), 
            (0.5, mutation_neighbor_swap)
        );
    }

    fn crossover(
        &mut self,
        child_a: &mut Self::Gene,
        child_b: &mut Self::Gene,
        parent_a: &Self::Gene,
        parent_b: &Self::Gene,
    ) {
        self.crossover_ox1.crossover(child_a, child_b, parent_a, parent_b, |gene| *gene);
    }

    fn hash(&self, genes: &Self::Gene) -> Option<u64> {
        // Depois usar FxHasher
        let mut h: u64 = 5381;
        for &gene in genes.iter() {
            h = h.wrapping_mul(31).wrapping_add(gene as u64);
        }
        Some(h)
    }
}

crate::ga_runner! {
    /// Runner concreto do problema OneMax exposto ao JS via WASM.
    TSPGAProblemRunner,
    problem: TSPGAProblem,
    new(cities: wasm_bindgen::JsValue) => TSPGAProblem::new(
        serde_wasm_bindgen::from_value(cities).expect("Invalid cities array")
    ),
}


#[cfg(test)]
mod tests {
    use crate::genetic::ga::{GAConfig, GeneticAlgorithm};
    use crate::console_log;

    use super::*;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test(unsupported = test)]
    fn it_works() {
        // Run a small GA to solve OneMax
        const PROBLEM_SIZE: usize = 10;
        let cities = TSPGAProblem::generate_random_cities(PROBLEM_SIZE);
        let mut ga = GeneticAlgorithm::new(
            TSPGAProblem::new(cities.clone()), 
            GAConfig {
                population_size: PROBLEM_SIZE * 2,
                crossover_rate: 0.9,
                mutation_rate: 0.9,
                mutation_gene_rate: 1.0 / (PROBLEM_SIZE as f64),
                tournament_size: 5,
                reset_population: false,
                diversity_check: false,
                max_stagnation: 50000,
            }
        );

        ga.run(1);
        let info_before = ga.get_info();

        ga.run(1000);
        let info_after = ga.get_info();

        assert!(info_after.best_fitness > info_before.best_fitness, "Fitness should improve after running the GA");
        assert!(info_after.stagnated_for > 100, "Should have stagnated for more than 1000 generations (found best solution already");
        console_log!("Best fitness found: {:?}", info_after.best_fitness);
        console_log!("Best genes: {:?}", info_after.best_genes);
    }
}
