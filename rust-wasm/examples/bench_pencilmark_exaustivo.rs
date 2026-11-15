//! Benchmark da busca exaustiva em paralelo do Pencilmark ([`BuscaExaustiva`]).
//!
//! Dois tipos de carga:
//! - `rainhas N`: enumera TODAS as soluções das N rainhas (problema genérico, definido aqui mesmo,
//!   para mostrar que o motor não depende do horário);
//! - `horario <arquivo.json>`: procura um horário; se não existe, prova que é impossível.
//!
//! Uso: cargo run --release --example bench_pencilmark_exaustivo -- rainhas 12 [--fatia N] [--sequencial]
//!      cargo run --release --example bench_pencilmark_exaustivo -- horario inst.json [--limite-s N] [--todas]
//! O número de threads vem de RAYON_NUM_THREADS.

use std::{env, time::Instant};

use rust_wasm::{
    horario::{HorarioRegrasPencilmark, RegrasHorario},
    pencilmark::{BuscaExaustiva, Possib, RegrasQuadro, NOS_POR_FATIA},
};

/// N rainhas: a célula `i` é a linha `i`, o valor é a coluna da rainha.
#[derive(Clone)]
struct Rainhas;

impl RegrasQuadro for Rainhas {
    fn verificar_quadro(&mut self, _quadro: &[i32]) -> bool {
        true
    }
    fn verificar_celula(&mut self, quadro: &[i32], possib: &mut Possib) -> bool {
        let n = quadro.len() as i32;
        let linha = possib.index as i32;
        for (outra, &v) in quadro.iter().enumerate() {
            if v <= 0 { continue; }
            let (outra, coluna) = (outra as i32, v - 1);
            for c in [coluna, coluna + (linha - outra), coluna - (linha - outra)] {
                if (0..n).contains(&c) {
                    possib.desmarcar(c as usize);
                }
            }
        }
        true
    }
}

fn rodar<R: RegrasQuadro + Clone + Send>(nome: &str, mut busca: BuscaExaustiva<R>, limite_s: f64) {
    let inicio = Instant::now();
    // Em chamadas, como um worker faria para mostrar progresso
    while !busca.executar(2_000_000) && inicio.elapsed().as_secs_f64() < limite_s {}
    let s = inicio.elapsed().as_secs_f64();
    let resultado = if busca.impossivel() {
        "IMPOSSÍVEL (provado)".to_string()
    } else if busca.esgotou() {
        format!("{} soluções (todas)", busca.solucoes.len())
    } else if busca.terminou() {
        format!("{} solução(ões)", busca.solucoes.len())
    } else {
        format!("não terminou em {limite_s} s ({} tarefas em aberto)", busca.tarefas_pendentes())
    };
    println!("{nome} | threads {} | {resultado} | {} nós | {} tarefas | {:.2} s | {:.0} nós/s",
        if busca.usando_threads() { rayon::current_num_threads() } else { 1 },
        busca.nos, busca.tarefas, s, busca.nos as f64 / s);
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let arg = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let tem = |nome: &str| args.iter().any(|a| a == nome);
    let fatia: u64 = arg("--fatia").map_or(NOS_POR_FATIA, |s| s.parse().unwrap());
    let limite_s: f64 = arg("--limite-s").map_or(f64::MAX, |s| s.parse().unwrap());
    let threads = if tem("--sequencial") { 1 } else { 0 };
    fastrand::seed(arg("--semente").map_or(1, |s| s.parse().unwrap()));

    match args.get(1).map(String::as_str) {
        Some("rainhas") => {
            let n: usize = args[2].parse().unwrap();
            let mut busca = BuscaExaustiva::new(Rainhas, vec![0; n], n, usize::MAX);
            busca.nos_por_fatia = fatia;
            busca.threads = threads;
            rodar(&format!("{n} rainhas"), busca, limite_s);
        }
        Some("horario") => {
            let regras = HorarioRegrasPencilmark::new(RegrasHorario::de_arquivo(&args[2]));
            let (quadro, n) = (regras.quadro_vazio(), regras.n_possibs());
            let mut busca = BuscaExaustiva::new(regras, quadro, n, if tem("--todas") { usize::MAX } else { 1 });
            busca.nos_por_fatia = fatia;
            busca.threads = threads;
            rodar(args[2].rsplit('/').next().unwrap(), busca, limite_s);
        }
        _ => eprintln!("uso: bench_pencilmark_exaustivo rainhas N | horario <arquivo.json> [--fatia N] [--sequencial] [--limite-s N] [--todas]"),
    }
}
