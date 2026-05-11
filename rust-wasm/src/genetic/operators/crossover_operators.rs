use crate::random::{random_bool, random_range, random_range_except};

#[inline(always)]
fn wrap_increment(idx: usize, max: usize) -> usize {
    let next = idx + 1;
    if next >= max { 0 } else { next }
}

pub fn crossover_uniform<T: Clone>(
    child_a: &mut [T],
    child_b: &mut [T],
    parent_a: &[T],
    parent_b: &[T]
) {
    for i in 0..parent_a.len() {
        if random_bool() {
            child_a[i] = parent_a[i].clone();
            child_b[i] = parent_b[i].clone();
        } else {
            child_a[i] = parent_b[i].clone();
            child_b[i] = parent_a[i].clone();
        }
    }
}

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

pub fn crossover_2_point<T: Clone>(
    child_a: &mut [T],
    child_b: &mut [T],
    parent_a: &[T],
    parent_b: &[T]
) {
    let (start, end) = {
        let mut s = random_range(0, parent_a.len());
        let mut e = random_range_except(0, parent_a.len(), s);
        if s > e { std::mem::swap(&mut s, &mut e); }
        (s, e)
    };

    // Copia os segmentos dos pais para os filhos

    // normal, não será trocado
    child_a[..start].clone_from_slice(&parent_a[..start]);
    child_b[..start].clone_from_slice(&parent_b[..start]);

    // trocado, A recebe de B e vice-versa
    child_a[start..end].clone_from_slice(&parent_b[start..end]);
    child_b[start..end].clone_from_slice(&parent_a[start..end]);

    // normal, não será trocado
    child_a[end..].clone_from_slice(&parent_a[end..]);
    child_b[end..].clone_from_slice(&parent_b[end..]);
}

/**
 * https://en.wikipedia.org/wiki/Crossover_(evolutionary_algorithm)
 * Order crossover (OX1)
 * 
 1. select a random slice of consecutive genes from parent 1
 2. copy the slice to child 1 and mark out the genes in parent 2
 3. starting from the right side of the slice, copy genes from parent 2 as they appear to child 1 if they are not yet marked out.
*/

pub struct CrossoverOX1 {
    // Controla quais genes já foram copiados para os filhos,
    // usando um sistema de marcação por epoch para evitar buscas O(n)
    marked_a: Vec<u64>,
    marked_b: Vec<u64>,
    epoch: u64,
}

impl CrossoverOX1
{
    /// Cria um novo operador OX1 para um conjunto de genes com `possible_gene_values` valores distintos.
    pub fn new(possible_gene_values: usize) -> Self {
        Self {
            marked_a: vec![0; possible_gene_values],
            marked_b: vec![0; possible_gene_values],
            epoch: 0,
        }
    }

    /// Realiza o crossover OX1 entre os pais, gerando os filhos. 
    /// A função `get_index` deve retornar um índice único para cada gene, dentro do intervalo de `possible_gene_values`
    pub fn crossover<T: Clone, F>(&mut self, child_a: &mut [T], child_b: &mut [T], parent_a: &[T], parent_b: &[T],
        get_index: F
    ) where F: Fn(&T) -> usize {
        let size = parent_a.len();
        debug_assert!(size > 1, "Operador OX1 requer genes maior que 1");

        // Incrementa o epoch para marcar os genes usados nesta execução
        self.epoch += 1;
        let stamp = self.epoch;

        // Sorteia dois pontos de corte distintos
        // [A, B, C, D, E, F, G]
        //        p1    p2
        let (p1, p2) = {
            let mut s = random_range(0, size);
            let mut e = random_range_except(0, size, s);
            if s > e { std::mem::swap(&mut s, &mut e); }
            (s, e)
        };

        // Copia o segmento selecionado e já marca os genes que foram copiados
        // parentA [A, B, C, D, E, F, G]
        // childA  [_, _, C, D, E, _, _]

        // parentB [F, G, A, B, C, D, E]
        // childB  [_, _, A, B, C, _, _]
        //                p1    p2
        for i in p1..=p2 {
            let gene_a = parent_a[i].clone();
            self.marked_a[get_index(&gene_a)] = stamp;
            child_a[i] = gene_a;

            let gene_b = parent_b[i].clone();
            self.marked_b[get_index(&gene_b)] = stamp;
            child_b[i] = gene_b;
        }

        // Preenche os filhos com os genes restantes do outro pai, na ordem em que aparecem, pulando os já copiados
        // parentB [F, G, A, B, C, D, E]
        // childA  [A, B,_C,_D,_E, F, G]
        //
        // parentA [A, B, C, D, E, F, G]
        // childB  [D, E,_A,_B,_C, F, G]
        //                p1    p2
        let start = wrap_increment(p2, size);

        let mut idx_parent_b = start;
        let mut idx_child_a  = start;
        let mut idx_parent_a = start;
        let mut idx_child_b  = start;
        for _ in 0..size {
            // Preenche o filho A com os genes de B, na ordem em que aparecem, ignorando os já copiados do pai A
            let gene_a = &parent_b[idx_parent_b];
            if self.marked_a[get_index(gene_a)] != stamp {
                child_a[idx_child_a] = gene_a.clone();
                idx_child_a = wrap_increment(idx_child_a, size);
                if idx_child_a == p1 { break; }
            }
            idx_parent_b = wrap_increment(idx_parent_b, size);
        }
        for _ in 0..size {
            // Preenche o filho B com os genes de A, na ordem em que aparecem, ignorando os já copiados do pai B
            let gene_b = &parent_a[idx_parent_a];
            if self.marked_b[get_index(gene_b)] != stamp {
                child_b[idx_child_b] = gene_b.clone();
                idx_child_b = wrap_increment(idx_child_b, size);
                if idx_child_b == p1 { break; }
            }
            idx_parent_a = wrap_increment(idx_parent_a, size);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::random::random_shuffle;
    use wasm_bindgen_test::*;

    const ABC: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    fn get_index(gene: &char) -> usize {
        ABC.find(*gene).expect("Gene não encontrado no alfabeto")
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn test_crossover_ox1() {        
        let size = ABC.len();
        let mut crossover = CrossoverOX1::new(size);

        // Testa 50 cruzamentos para verificar que os filhos são permutações válidas dos pais, sem valores duplicados
        for _ in 0..50 {
            let mut parent_a = ABC.chars().take(size).collect::<Vec<_>>();
            random_shuffle(&mut parent_a);
            let mut parent_b = ABC.chars().take(size).collect::<Vec<_>>();
            random_shuffle(&mut parent_b);

            let mut child_a = vec!['_'; size];
            let mut child_b = vec!['_'; size];

            crossover.crossover(&mut child_a, &mut child_b, &parent_a, &parent_b, get_index);

            // Verifica que os filhos são permutações válidas dos pais, sem valores duplicados
            let mut check_a = vec![false; size];
            let mut check_b = vec![false; size];
            for i in 0..size {
                let idx_a = get_index(&child_a[i]);
                let idx_b = get_index(&child_b[i]);
                assert!(idx_a < size && idx_b < size, "Índice não está no tamanho correto");
                assert!(!check_a[idx_a], "Gene duplicado em child_a");
                assert!(!check_b[idx_b], "Gene duplicado em child_b");
                check_a[idx_a] = true;
                check_b[idx_b] = true;
            }
        }
    }
}
