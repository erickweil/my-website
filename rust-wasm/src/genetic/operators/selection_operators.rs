use crate::{
    genetic::problems::{GAProblem, Individual},
    random::{random_range, random_range_except},
};

/// Realiza a seleção por torneio, retornando o índice do indivíduo selecionado.
/// 1. Seleciona `tournament_size` indivíduos aleatórios da população (ignorando `exclude_idx`).
/// 2. Retorna o índice do indivíduo com maior fitness entre os selecionados.
pub fn tournament_selection<P: GAProblem>(
    population: &[Individual<P::Gene>],
    tournament_size: usize,
    exclude: Option<usize>,
) -> usize {
    let pop_len = population.len();
    let exclude_hash = exclude.and_then(|idx| population[idx].hash);
    let mut best: Option<(usize, f64)> = None; // (índice, fitness)

    for _ in 0..tournament_size {
        // Sorteia um índice aleatório, garantindo que seja diferente do índice excluído (se houver)
        let ind_i = match exclude {
            Some(except) => random_range_except(0, pop_len, except),
            None => random_range(0, pop_len),
        };
        let ind = &population[ind_i];

        // Se tem hash, e é igual ao hash do indivíduo excluído, pula essa iteração
        if let Some(exclude_hash) = exclude_hash
            && let Some(hash) = ind.hash
        {
            if hash == exclude_hash {
                continue;
            }
        }

        let fitness = ind.fitness.unwrap_or(f64::MIN);
        if best.is_none_or(|(_, best_fit)| fitness > best_fit) {
            best = Some((ind_i, fitness));
        }
    }

    best.map(|(i, _)| i)
        .unwrap_or_else(|| random_selection::<P>(population, exclude))
}

pub fn random_selection<P: GAProblem>(
    population: &[Individual<P::Gene>],
    exclude: Option<usize>,
) -> usize {
    let exclude_hash = exclude.and_then(|idx| population[idx].hash);
    let mut fallback_idx: Option<usize> = None;

    let pop_len = population.len();
    let start = random_range(0, pop_len);
    for i in 0..pop_len {
        let idx = (start + i) % pop_len;

        if let Some(exclude_idx) = exclude {
            if idx == exclude_idx {
                continue;
            }
            // Se ainda não tem um fallback, salva o primeiro encontrado
            if fallback_idx.is_none() {
                fallback_idx = Some(idx);
            }

            if let Some(exclude_hash) = exclude_hash
                && let Some(hash) = population[idx].hash
            {
                if hash == exclude_hash {
                    continue;
                } // pula se for o mesmo hash
            }
        }

        return idx;
    }

    fallback_idx.unwrap_or_else(|| {
        panic!("Não foi possível selecionar um indivíduo aleatório diferente de exclude_idx");
    })
}
