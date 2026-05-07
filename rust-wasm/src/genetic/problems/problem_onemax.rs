use crate::genetic::operators::{crossover_1_point, mutation_replace};
use crate::genetic::problems::GAProblem;
use crate::random::random_f64;

pub struct OneMaxGAProblem {
    pub size: usize,
}

impl OneMaxGAProblem {
    pub fn new(size: usize) -> Self {
        Self { size }
    }
}

impl GAProblem for OneMaxGAProblem {
    type Gene = Vec<bool>;

    fn max_fitness(&self) -> Option<f64> {
        Some(self.size as f64)
    }

    fn random_genes(&self) -> Self::Gene {
        (0..self.size).map(|_| random_f64() < 0.5).collect()
    }

    fn fitness(&self, genes: &Self::Gene) -> f64 {
        // Conta diretamente os bits em true
        genes.iter().filter(|&&b| b).count() as f64
    }

    fn mutate(&self, genes: &mut Self::Gene, mutation_rate: f64) {
        mutation_replace(genes, mutation_rate, |val| !val);
    }

    fn crossover(
        &self,
        child_a: &mut Self::Gene,
        child_b: &mut Self::Gene,
        parent_a: &Self::Gene,
        parent_b: &Self::Gene,
    ) {
        crossover_1_point(child_a, child_b, parent_a, parent_b);
    }

    fn hash(&self, _genes: &Self::Gene) -> Option<u64> {
        // Para um vetor de bools, podemos usar um hash simples baseado em bits e xor
        let mut hash: u64 = 0;
        for (i, &bit) in _genes.iter().enumerate() {
            if bit {
                hash ^= 1 << (i % 64); // Usa o índice para definir o bit no hash
            }
        }
        Some(hash)
    }
}

// https://julien-decharentenay.medium.com/bridging-rust-traits-and-javascript-in-a-webassembly-renderer-6546fab6f1d4
crate::ga_runner! {
    /// Runner concreto do problema OneMax exposto ao JS via WASM.
    OneMaxGAProblemRunner,
    problem: OneMaxGAProblem,
    new(size: usize) => OneMaxGAProblem::new(size),
}


#[cfg(test)]
mod tests {
    use crate::genetic::ga::GAConfig;
    use crate::console_log;

    use super::*;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test(unsupported = test)]
    fn it_works() {
        // Run a small GA to solve OneMax
        const PROBLEM_SIZE: usize = 100;
        let mut ga_runner = OneMaxGAProblemRunner::new(PROBLEM_SIZE, GAConfig {
            population_size: PROBLEM_SIZE * 2,
            crossover_rate: 0.9,
            mutation_rate: 0.9,
            mutation_gene_rate: 1.0 / (PROBLEM_SIZE as f64),
            tournament_size: 5,
            reset_population: false,
            diversity_check: false,
            max_stagnation: 50000,
        });

        ga_runner.run(50000);

        let info = ga_runner.ga.get_info();

        assert_eq!(info.best_fitness, Some(PROBLEM_SIZE as f64));
        console_log!("Best fitness found: {:?}", info.best_fitness);
        console_log!("Best genes (as bytes): {:?}", info.best_genes);
    }
}
