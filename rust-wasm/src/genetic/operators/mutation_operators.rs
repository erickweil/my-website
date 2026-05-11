use crate::{genetic::operators::for_each_poisson, random::{random_bool, random_range_except}};

pub fn mutation_replace<G, F>(
    genes: &mut [G],
    mutation_rate: f64,
    mut get_random_gene: F,
) where
    F: FnMut(&G) -> G,
{
    for_each_poisson(genes.len(), mutation_rate, |idx| {
        genes[idx] = get_random_gene(&genes[idx]);
    });
}

pub fn mutation_random_swap<G>(
    genes: &mut [G], 
    mutation_rate: f64
) {
    if genes.len() < 2 { return; }
    for_each_poisson(genes.len(), mutation_rate, |idx| {
        // Gera um índice aleatório diferente de idx
        let swap_idx = random_range_except(0, genes.len(), idx);
        genes.swap(idx, swap_idx);
    });
}

pub fn mutation_neighbor_swap<G>(
    genes: &mut [G], 
    mutation_rate: f64
) {
    if genes.len() < 2 { return; }
    for_each_poisson(genes.len(), mutation_rate, |idx| {
        let swap_idx = if random_bool() {
            (idx + 1) % genes.len() // Próximo
        } else {
            (idx + genes.len() - 1) % genes.len() // Anterior
        };
        genes.swap(idx, swap_idx);
    });
}

/// Executa cada operador de mutação com a probabilidade específica
/// Cada operador recebe uma fração da taxa de mutação total
pub fn mutation_combine<G, FA, FB>(
    genes: &mut [G],
    mutation_rate: f64,
    operator_a: (f64, FA),
    operator_b: (f64, FB),
) where
    FA: Fn(&mut [G], f64),
    FB: Fn(&mut [G], f64),
{
    operator_a.1(genes, mutation_rate * operator_a.0);
    operator_b.1(genes, mutation_rate * operator_b.0);
}
