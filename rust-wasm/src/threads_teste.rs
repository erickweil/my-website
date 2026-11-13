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
}
