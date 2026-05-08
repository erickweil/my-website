use crate::random::{random_bool, random_range};

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
        let mut e = random_range(0, parent_a.len());
        if s == e { e = (e + 1) % parent_a.len(); }
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

pub struct CrossoverOX1<T: Clone> {
    // Controla quais genes já foram copiados para os filhos,
    // usando um sistema de marcação por epoch para evitar buscas O(n)
    marked_a: Vec<u64>,
    marked_b: Vec<u64>,
    epoch: u64,

    // precisa usar T
    _marker: std::marker::PhantomData<T>,
}

impl<T: Clone> CrossoverOX1<T>
{
    pub fn new(size: usize) -> Self {
        Self {
            marked_a: vec![0; size],
            marked_b: vec![0; size],
            epoch: 0,
            _marker: std::marker::PhantomData,
        }
    }

    pub fn crossover<F>(&mut self, child_a: &mut [T], child_b: &mut [T], parent_a: &[T], parent_b: &[T],
        get_index: F
    ) where F: Fn(&T) -> usize {
        let size = parent_a.len();
        debug_assert!(
               child_a.len() == size 
            && child_b.len() == size 
            && parent_a.len() == size
            && parent_b.len() == size
        , "Todos devem ser do tamanho size");

        // Incrementa o epoch para marcar os genes usados nesta execução
        self.epoch += 1;
        let stamp = self.epoch;

        // Sorteia dois pontos de corte distintos
        let (p1, p2) = {
            let mut s = random_range(0, size);
            let mut e = random_range(0, size);
            if s == e { e = (e + 1) % size; }
            if s > e { std::mem::swap(&mut s, &mut e); }
            (s, e)
        };

        // Copia o segmento selecionado e já marca os genes usados
        for i in p1..=p2 {
            let gene_a = parent_a[i].clone();
            self.marked_a[get_index(&gene_a)] = stamp;
            child_a[i] = gene_a;

            let gene_b = parent_b[i].clone();
            self.marked_b[get_index(&gene_b)] = stamp;
            child_b[i] = gene_b;
        }

        // Preenche os filhos com os genes restantes do outro pai,
        // na ordem em que aparecem, pulando os já copiados
        let mut idx_parent_b = (p2 + 1) % size;
        let mut idx_child_a  = idx_parent_b;
        let mut idx_parent_a = (p2 + 1) % size;
        let mut idx_child_b  = idx_parent_a;

        for _ in 0..size {
            // Preenche o filho A com os genes de B, na ordem em que aparecem, ignorando os já copiados
            let gene_a = parent_b[idx_parent_b].clone();
            if self.marked_a[get_index(&gene_a)] != stamp {
                child_a[idx_child_a] = gene_a;
                idx_child_a = (idx_child_a + 1) % size;
            }
            idx_parent_b = (idx_parent_b + 1) % size;

            // Preenche o filho B com os genes de A, na ordem em que aparecem, ignorando os já copiados
            let gene_b = parent_a[idx_parent_a].clone();
            if self.marked_b[get_index(&gene_b)] != stamp {
                child_b[idx_child_b] = gene_b;
                idx_child_b = (idx_child_b + 1) % size;
            }
            idx_parent_a = (idx_parent_a + 1) % size;
        }
    }
}
