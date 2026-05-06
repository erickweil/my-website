use crate::random::{random_range};

pub fn crossover_1_point<T: Clone>(
    child_a: &mut [T],
    child_b: &mut [T],
    parent_a: &[T],
    parent_b: &[T]
) {
    let point = random_range(0, parent_a.len());

    // Na arquitetura de memória, isso se traduz para um memcpy altamente otimizado
    child_a[..point].clone_from_slice(&parent_a[..point]);
    child_b[..point].clone_from_slice(&parent_b[..point]);

    child_a[point..].clone_from_slice(&parent_b[point..]);
    child_b[point..].clone_from_slice(&parent_a[point..]);
}