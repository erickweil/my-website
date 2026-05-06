use crate::{genetic::operators::{for_each_poisson}};

pub fn mutation_replace<T, F>(
    genes: &mut [T],
    mutation_rate: f64,
    mut get_random_gene: F,
) where
    F: FnMut(&T) -> T,
{
    for_each_poisson(genes.len(), mutation_rate, |idx| {
        genes[idx] = get_random_gene(&genes[idx]);
    });
}
