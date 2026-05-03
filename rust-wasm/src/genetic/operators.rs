use crate::random::{random_f64, random_range};

pub fn calc_mutation_amount(length: usize, mutation_rate: f64) -> usize {
    let value = (length as f64) * mutation_rate * 2.0 * random_f64();
    let floor = value.floor();
    let ceil = value.ceil();
    if random_f64() < (value - floor) {
        ceil as usize
    } else {
        floor as usize
    }
}

pub fn crossover_1_point<T: Clone>(
    child_a: &mut [T],
    child_b: &mut [T],
    parent_a: &[T],
    parent_b: &[T]
) {
    let size = parent_a.len();
    let point = random_range(0, size);

    // Na arquitetura de memória, isso se traduz para um memcpy altamente otimizado
    child_a[..point].clone_from_slice(&parent_a[..point]);
    child_b[..point].clone_from_slice(&parent_b[..point]);

    child_a[point..].clone_from_slice(&parent_b[point..]);
    child_b[point..].clone_from_slice(&parent_a[point..]);
}

pub fn mutation_replace<T, F>(
    genes: &mut [T],
    mutation_rate: f64,
    mut get_random_gene: F,
) where
    F: FnMut(&T) -> T,
{
    let mutations = calc_mutation_amount(genes.len(), mutation_rate);
    for _ in 0..mutations {
        let idx = random_range(0, genes.len());
        genes[idx] = get_random_gene(&genes[idx]);
    }
}
