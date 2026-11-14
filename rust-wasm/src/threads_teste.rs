//! Teste simples de threads (rayon) no WASM, usado por `/toy/threads-teste`.
//!
//! Roda `n_tarefas` tarefas pesadas e independentes, em sequência ou com rayon, e registra em qual
//! thread do pool cada uma rodou. Cada tarefa escreve no console a thread em que rodou. Se o pool
//! funcionar, aparecem várias threads diferentes e o modo paralelo leva menos tempo.

use rayon::prelude::*;
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Trabalho de CPU puro e determinístico (xorshift64), para medir o ganho sem depender de memória.
pub fn trabalho_pesado(semente: u64, passos: u32) -> u64 {
    let mut x = semente.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut acc = 0u64;
    for _ in 0..passos {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        acc = acc.wrapping_add(x);
    }
    acc
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct ResultadoTeste {
    /// Threads no pool global do rayon (o número passado ao `initThreadPool`).
    pub threads_no_pool: usize,
    /// Quantas threads diferentes executaram ao menos uma tarefa.
    pub threads_usadas: usize,
    /// Índice da thread do rayon em que cada tarefa rodou (`null` = fora do pool, ou seja, sequencial).
    pub thread_por_tarefa: Vec<Option<usize>>,
    /// Soma dos resultados (como string: u64 não cabe num Number). Igual nos dois modos.
    pub checksum: String,
}

pub fn executar(n_tarefas: u32, passos: u32, paralelo: bool) -> ResultadoTeste {
    let tarefa = |i: u32| {
        let thread = rayon::current_thread_index();
        let r = trabalho_pesado(i as u64 + 1, passos);
        crate::console_log!(
            "[threads-teste] tarefa {i:>2} rodou na thread {}",
            thread.map_or("principal (fora do pool)".to_string(), |t| t.to_string())
        );
        (r, thread)
    };

    let resultados: Vec<(u64, Option<usize>)> = if paralelo {
        (0..n_tarefas).into_par_iter().map(tarefa).collect()
    } else {
        (0..n_tarefas).map(tarefa).collect()
    };

    let mut usadas: Vec<usize> = resultados.iter().filter_map(|&(_, t)| t).collect();
    usadas.sort_unstable();
    usadas.dedup();

    ResultadoTeste {
        threads_no_pool: rayon::current_num_threads(),
        threads_usadas: usadas.len(),
        thread_por_tarefa: resultados.iter().map(|&(_, t)| t).collect(),
        checksum: resultados.iter().fold(0u64, |acc, &(r, _)| acc.wrapping_add(r)).to_string(),
    }
}

/// Exposto ao JS. `paralelo = false` roda tudo na thread que chamou (para comparar o tempo).
#[wasm_bindgen]
pub fn teste_threads(n_tarefas: u32, passos: u32, paralelo: bool) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(&executar(n_tarefas, passos, paralelo)).map_err(|e| JsError::new(&e.to_string()))
}

// ── Benchmark do motor genético: sequencial × paralelo ───────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct ResultadoGA {
    pub problema: String,
    pub populacao: usize,
    pub geracoes_por_s_sequencial: f64,
    pub geracoes_por_s_paralelo: f64,
    pub ganho: f64,
    /// A mesma semente deu o mesmo melhor fitness nos dois modos? (tem que ser sempre true)
    pub resultado_identico: bool,
    /// O que o modo automático escolheu para este problema.
    pub automatico_escolheu_paralelo: bool,
}

fn medir_ga<P: crate::genetic::problems::GAProblem>(
    nome: &str,
    criar: impl Fn() -> P,
    pop: usize,
    genes: usize,
    segundos: f64,
) -> ResultadoGA {
    use crate::genetic::ga::{GAConfig, GeneticAlgorithm};
    use web_time::Instant;

    let config = |threads| GAConfig {
        population_size: pop,
        crossover_rate: 0.9,
        mutation_rate: 0.9,
        mutation_gene_rate: 1.0 / genes as f64,
        tournament_size: 10,
        max_stagnation: None,
        diversity_check: false,
        threads,
    };
    let novo = |threads| {
        fastrand::seed(1);
        GeneticAlgorithm::new(criar(), config(threads))
    };

    // Vazão: 1 = sequencial, 2 = sempre paralelo
    let vazao = |threads| {
        let mut ga = novo(threads);
        ga.run(10); // aquecimento
        let (g0, inicio) = (ga.get_info().generation, Instant::now());
        while inicio.elapsed().as_secs_f64() < segundos {
            ga.run(10);
        }
        (ga.get_info().generation - g0) as f64 / inicio.elapsed().as_secs_f64()
    };
    let (seq, par) = (vazao(1), vazao(2));

    // Mesma semente, mesmo número de gerações: o melhor fitness tem que ser igual
    let melhor = |threads| {
        let mut ga = novo(threads);
        ga.run(60);
        ga.get_info().best_fitness
    };
    let resultado_identico = melhor(1) == melhor(2);

    let mut auto = novo(0);
    auto.run(60);

    ResultadoGA {
        problema: nome.to_string(),
        populacao: pop,
        geracoes_por_s_sequencial: seq,
        geracoes_por_s_paralelo: par,
        ganho: par / seq,
        resultado_identico,
        automatico_escolheu_paralelo: auto.usando_threads(),
    }
}

pub fn executar_ga(segundos: f64) -> Vec<ResultadoGA> {
    use crate::genetic::problems::{OneMaxGAProblem, TSPGAProblem};

    let mut resultados = Vec::new();
    for cidades in [100, 2000] {
        fastrand::seed(7);
        let mapa = TSPGAProblem::generate_random_cities(cidades);
        resultados.push(medir_ga(&format!("TSP {cidades} cidades"), || TSPGAProblem::new(mapa.clone()), 500, cidades, segundos));
    }
    for bits in [1_000, 100_000] {
        resultados.push(medir_ga(&format!("OneMax {bits} bits"), || OneMaxGAProblem::new(bits), 200, bits, segundos));
    }
    resultados
}

/// Exposto ao JS: mede o motor genético em sequência e em paralelo, `segundos` por modo e problema.
#[wasm_bindgen]
pub fn teste_ga_threads(segundos: f64) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(&executar_ga(segundos)).map_err(|e| JsError::new(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paralelo_da_o_mesmo_resultado_e_usa_varias_threads() {
        let seq = executar(16, 200_000, false);
        let par = executar(16, 200_000, true);
        assert_eq!(seq.checksum, par.checksum);
        assert!(seq.thread_por_tarefa.iter().all(Option::is_none), "sequencial roda fora do pool");
        assert!(par.thread_por_tarefa.iter().all(Option::is_some), "paralelo roda dentro do pool");
        if rayon::current_num_threads() > 1 {
            assert!(par.threads_usadas > 1, "{par:?}");
        }
    }

    #[test]
    fn benchmark_do_ga_da_resultado_identico_nos_dois_modos() {
        let resultados = executar_ga(0.05);
        assert_eq!(resultados.len(), 4);
        for r in &resultados {
            assert!(r.resultado_identico, "{r:?}");
            assert!(r.geracoes_por_s_sequencial > 0.0 && r.geracoes_por_s_paralelo > 0.0, "{r:?}");
        }
    }
}

