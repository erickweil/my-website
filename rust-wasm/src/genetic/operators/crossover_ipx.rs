use crate::random::random_range;

/// Identity Preserving Crossover (IPX) com scratch buffers reutilizáveis.
///
/// A struct armazena os buffers de trabalho para eliminar alocações no hot path.
/// A partir da segunda chamada (ou quando os pais têm ≤ capacidade inicial),
/// `crossover` não aloca nenhum byte.
///
/// Requer `T: Clone + PartialEq`.
pub struct CrossoverIPX<T: Clone> {
    diff_positions: Vec<usize>,
    bank_a: Vec<T>,
    bank_b: Vec<T>,
}

impl<T: Clone + PartialEq> CrossoverIPX<T> {
    /// Cria um novo operador IPX com buffers pré-alocados.
    pub fn new(size: usize) -> Self {
        Self {
            diff_positions: Vec::with_capacity(size),
            bank_a: Vec::with_capacity(size),
            bank_b: Vec::with_capacity(size),
        }
    }

    /// Identity Preserving Crossover (IPX)
    ///
    /// Projetado para cromossomos que são multiconjuntos (permutações com repetição),
    /// como grades de horários onde disciplinas e slots vazios se repetem.
    ///
    /// Propriedade garantida: cada filho preserva exatamente a frequência de cada gene
    /// do respectivo pai.
    ///
    /// Algoritmo:
    /// 1. **Identidade** — posições onde `parent_a[i] == parent_b[i]`: filho herda direto.
    /// 2. **Banco** — genes das posições divergentes de cada pai formam `bank_a` e `bank_b`.
    /// 3. **Preenchimento guloso** — para cada posição divergente, tenta herdar do outro pai
    ///    (remove com `swap_remove` se disponível); caso contrário sorteia do banco restante.
    pub fn crossover(
        &mut self,
        child_a: &mut [T],
        child_b: &mut [T],
        parent_a: &[T],
        parent_b: &[T],
    ) {
        self.diff_positions.clear();
        self.bank_a.clear();
        self.bank_b.clear();

        // --- Passo 1: identidade e montagem dos bancos ---
        for (i, (a, b)) in parent_a.iter().zip(parent_b.iter()).enumerate() {
            if a == b {
                // Identidade: Se os genes são iguais, herda direto
                child_a[i] = a.clone();
                child_b[i] = b.clone();
            } else {
                self.diff_positions.push(i);
                self.bank_a.push(a.clone());
                self.bank_b.push(b.clone());
            }
        }

        // --- Passo 2: preenche os filhos herandando do outro pai ou sorteando do banco ---
        Self::fill_child(child_a, parent_b, &self.diff_positions, &mut self.bank_a);
        Self::fill_child(child_b, parent_a, &self.diff_positions, &mut self.bank_b);
    }

    /// Para cada posição divergente, tenta colocar o gene de `source` no filho.
    /// Se o gene de `source[pos]` estiver disponível no banco, usa-o (`swap_remove`);
    /// caso contrário sorteia um gene aleatório do banco.
    fn fill_child(
        child: &mut [T],
        source: &[T],
        diff_positions: &[usize],
        bank: &mut Vec<T>,
    ) {
        for &pos in diff_positions {
            // Como usamos `swap_remove`, com rposition encontrar o match mais perto do final
            let idx = match bank.iter().rposition(|g| g == &source[pos]) {
                Some(i) => i,
                None => random_range(0, bank.len()),
            };

            child[pos] = bank.swap_remove(idx);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::random::random_shuffle;
    use wasm_bindgen_test::*;

    const ABC: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    #[wasm_bindgen_test(unsupported = test)]
    fn test_crossover_ipx() {
        /// 1. gera uma permutação de 16 letras distintas (metade do tamanho)
        /// 2. duplica cada letra para garantir que o multiconjunto seja preservado
        /// 3. embaralha para criar a configuração final dos pais
        fn random_duplicated_permutation(size: usize) -> Vec<char> {
            let mut chars: Vec<char> = ABC.chars().collect::<Vec<char>>();
            random_shuffle(&mut chars);
            chars.truncate(size / 2);
            chars = chars.into_iter().flat_map(|c| vec![c, c]).collect();
            random_shuffle(&mut chars);
            chars
        }

        let size = 32;
        let mut crossover = CrossoverIPX::new(ABC.len());

        for _ in 0..50 {
            // Gera pais aleatórios, que podem ter genes repetidos (multiconjunto) Para simplificar cada letra deve aparecer 2 vezes

            let parent_a = random_duplicated_permutation(size);
            let parent_b = random_duplicated_permutation(size);

            // Gera filhos vazios
            let mut child_a = vec!['_'; size];
            let mut child_b = vec!['_'; size];

            crossover.crossover(&mut child_a, &mut child_b, &parent_a, &parent_b);

            // Verifica que cada filho é uma permutação válida dos pais
            for i in 0..size {
                // Genes iguais entre os pais devem só ser copiados direto
                if parent_a[i] == parent_b[i] {
                    assert_eq!(
                        child_a[i], parent_a[i],
                        "Child A deveria herdar gene concordante"
                    );
                    assert_eq!(
                        child_b[i], parent_b[i],
                        "Child B deveria herdar gene concordante"
                    );
                } else {
                    // Genes divergentes devem ser herdados do outro pai ou sorteados do banco
                    let valid_a = child_a[i] == parent_b[i] || parent_a.contains(&child_a[i]);
                    let valid_b = child_b[i] == parent_a[i] || parent_b.contains(&child_b[i]);
                    assert!(valid_a, "Child A tem gene inválido na posição {}", i);
                    assert!(valid_b, "Child B tem gene inválido na posição {}", i);
                }

                // O gene deve ser uma letra válida do alfabeto
                assert!(
                    ABC.contains(child_a[i]),
                    "Child A tem gene inválido '{}'",
                    child_a[i]
                );
                assert!(
                    ABC.contains(child_b[i]),
                    "Child B tem gene inválido '{}'",
                    child_b[i]
                );
            }

            // Verifica que a frequência de cada gene é preservada (2 de cada letra)
            for c in ABC.chars() {
                let count_in_child_a = child_a.iter().filter(|&x| x == &c).count();
                let count_in_child_b = child_b.iter().filter(|&x| x == &c).count();
                assert!(
                    count_in_child_a == 0 || count_in_child_a == 2,
                    "Child A deveria ter 0 ou 2 ocorrências de '{}'",
                    c
                );
                assert!(
                    count_in_child_b == 0 || count_in_child_b == 2,
                    "Child B deveria ter 0 ou 2 ocorrências de '{}'",
                    c
                );
            }
        }
    }
}
