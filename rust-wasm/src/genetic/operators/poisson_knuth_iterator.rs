use crate::random::random_f64;

const POISSON_THRESHOLD: f64 = 0.1;

#[inline]
/// `ln_1_minus_rate` deve ser pré-calculado como: `(-rate).ln_1p()`
fn geometric_poisson_gap(ln_1_minus_rate: f64) -> usize {
    let u = random_f64().max(f64::MIN_POSITIVE);
    (u.ln() / ln_1_minus_rate).floor() as usize
}

#[inline]
/// começa a divergir para taxas altas
pub fn exponential_poisson_gap(rate: f64) -> usize {
    let u = random_f64().max(f64::MIN_POSITIVE);
    (-u.ln() / rate).floor() as usize
}

/// Aplica uma função de mutação a cada índice de um array, de acordo com a taxa de mutação
/// Para taxas de mutação muito baixas (< 0.1), utiliza um iterador de "gap" baseado no algoritmo de Knuth para Poisson, que é mais eficiente
/// Para taxas de mutação mais altas, verifica cada índice diretamente
/// 
/// Veja:
/// - https://www.johndcook.com/blog/2010/06/14/generating-poisson-random-values/
pub fn for_each_poisson<F: FnMut(usize)>(length: usize, rate: f64, mut f: F) {
    if rate <= 0.0 { return; }

    if rate < POISSON_THRESHOLD {
        // https://docs.rs/num/latest/num/trait.Float.html#tymethod.ln_1p
        // Returns ln(1+n) (natural logarithm) more accurately than if the operations were performed separately.
        let ln_1_minus_rate = (-rate).ln_1p(); 
        // Iterador de "gap" usando o algoritmo de Knuth para Poisson
        // Em vez de verificar cada índice, pulamos diretamente para os próximos índices a serem mutados
        let mut current = geometric_poisson_gap(ln_1_minus_rate);
        while current < length {
            f(current);
            current += 1 + geometric_poisson_gap(ln_1_minus_rate);
        }
    } else {
        // Para taxas de mutação mais altas, deve verificar cada índice diretamente
        // Pois o outro método começa a divergir da distribuição real e pode ser menos eficiente
        for idx in 0..length {
            if random_f64() < rate {
                f(idx);
            }
        }
    }
}


/*
    for idx in PoissonIndices::new(genes.len(), mutation_rate) {
        genes[idx] = get_random_gene(&genes[idx]);
    }
*/
/// Um iterador que gera índices de mutação usando o algoritmo de Knuth para Poisson
/// mas utiliza uma abordagem de "gap" para pular diretamente para os próximos índices a serem mutados
/// OBS: quanto maior o mutation_rate, menos eficiente será essa abordagem, também causará divergências em relação à distribuição real
pub struct PoissonIterator {
    current: usize,
    length: usize,
    ln_1_minus_rate: f64,
}

impl PoissonIterator {
    pub fn new(length: usize, mutation_rate: f64) -> Self {
        let ln_1_minus_rate = (-mutation_rate).ln_1p();
        Self { 
            current: geometric_poisson_gap(ln_1_minus_rate),
            length, 
            ln_1_minus_rate
        }
    }
}

impl Iterator for PoissonIterator {
    type Item = usize;

    #[inline]
    fn next(&mut self) -> Option<usize> {
        if self.current >= self.length {
            return None;
        }
        let idx = self.current;
        self.current += 1 + geometric_poisson_gap(self.ln_1_minus_rate);
        Some(idx)
    }
}

/// Gera um número de Poisson usando o algoritmo de Knuth
/// Lambda deve ser o valor esperado (média) da distribuição, ou seja, o número médio de mutações esperadas
pub fn poisson_knuth_sample(lambda: f64) -> usize {
    let l = (-lambda).exp();
    let mut k = 0usize;
    let mut p = 1.0_f64;
    loop {
        k += 1;
        p *= random_f64();
        if p <= l {
            return k - 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use web_time::{Instant};

    use super::*;
    use crate::console_log;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test(unsupported = test)]
    fn test_poisson_knuth() {
        // Em arrays com 1000 genes e taxa de mutação de 0.01, esperamos em média 10 mutações
        // 1. Atravessando cada valor e verificando com random_f64
        // 2. Calcular valor da distribuição de Poisson
        // 3. Utilizar iterador de Poisson para contar mutações e comparar com o valor esperado

        let length = 1000;
        let samples = 5000;
        let mutation_rate = 0.05;
        //let mutation_rate = 5.0 / (length as f64);
        let expected_mutations = (length as f64) * mutation_rate;

        // Testando com random_f64
        let start_random = Instant::now();
        let mut count_random = 0;
        for _ in 0..samples {
            for _ in 0..length {
                if random_f64() < mutation_rate {
                    count_random += 1;
                }
            }
        }
        console_log!("Duration: {:?}", start_random.elapsed());
        let average_random = count_random as f64 / samples as f64;
        console_log!("Average Random: {}", average_random);
        

        // Testando o iterador de Poisson
        let start_poisson = Instant::now();
        let mut count_iterator = 0;
        for _ in 0..samples {
            for _idx in PoissonIterator::new(length, mutation_rate) {
                count_iterator += 1;
            }
        }
        console_log!("Duration: {:?}", start_poisson.elapsed());
        let average_iterator = count_iterator as f64 / samples as f64;
        console_log!("Average iterator: {}", average_iterator);
        // A média deve estar próxima de 10, mas pode variar devido à natureza estocástica do processo
        

        // Testando o for_each_mutation
        let start_for_each = Instant::now();
        let mut count_for_each = 0;
        for _ in 0..samples {
            for_each_poisson(length, mutation_rate, |_| {
                count_for_each += 1;
            });
        }
        console_log!("Duration: {:?}", start_for_each.elapsed());
        let average_for_each = count_for_each as f64 / samples as f64;
        console_log!("Average for_each: {}", average_for_each);


        assert!((average_random - expected_mutations).abs() < 1.0, "Average Random should be close to {}, got {}", expected_mutations, average_random);
        assert!((average_iterator - expected_mutations).abs() < 1.0, "Average iterator should be close to {}, got {}", expected_mutations, average_iterator);
        assert!((average_for_each - expected_mutations).abs() < 1.0, "Average for_each should be close to {}, got {}", expected_mutations, average_for_each);

        
        // Testando a função de Poisson diretamente
        let start_poisson_direct = Instant::now();
        let mut count_poisson = 0;
        for _ in 0..samples {
            count_poisson += poisson_knuth_sample(expected_mutations);
        }
        console_log!("Duration: {:?}", start_poisson_direct.elapsed());
        let average_poisson = count_poisson as f64 / samples as f64;
        console_log!("Average Poisson: {}", average_poisson);
        assert!((average_poisson - expected_mutations).abs() < 1.0, "Average Poisson should be close to {}, got {}", expected_mutations, average_poisson);
        
    }
}