//! Compara variantes do FITNESS do GA de horários (pesos das regras e medida do agrupamento).
//!
//! Todas as variantes usam o mesmo motor, a mesma configuração e o mesmo orçamento de avaliações.
//! Como cada variante tem a sua escala de fitness, a comparação usa uma régua comum:
//! - resolvidas: sementes que chegaram a um quadro sem nenhuma violação (fitness 0 em qualquer variante);
//! - avaliações até resolver (mediana das resolvidas);
//! - violações restantes: fitness ORIGINAL do melhor quadro de cada semente (mediana e média).
//!
//! Uso: cargo run --release --example bench_horario_fitness -- <instancia> [--sementes N] [--orcamento M]
//!      [--ilhas N] [--variantes nome=professor:unidas:agrupar:movAgrupar:movProfessor[:conflito],...]   (mov = 0 ou 1)

use std::{env, time::Instant};

use rust_wasm::{
    genetic::{ga::GeneticAlgorithm, problems::GAProblem},
    horario::{config_ga_horario, PesosFitness, RegrasHorario},
};

fn carregar(nome: &str) -> RegrasHorario {
    RegrasHorario::de_arquivo(nome)
}

fn mediana(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let arg = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let instancia = args.get(1).expect("informe a instância");
    let sementes: u64 = arg("--sementes").map_or(10, |s| s.parse().unwrap());
    let orcamento = (arg("--orcamento").map_or(5.0, |s| s.parse::<f64>().unwrap()) * 1e6) as u64;
    let ilhas: usize = arg("--ilhas").map_or(0, |s| s.parse().unwrap());
    let variantes: Vec<(String, PesosFitness)> = arg("--variantes")
        .unwrap_or("original=50:30:20:0,movimentos=50:30:20:1".into())
        .split(',')
        .map(|v| {
            let (nome, pesos) = v.split_once('=').expect("variante no formato nome=prof:unidas:agrupar:mov");
            let p: Vec<f64> = pesos.split(':').map(|x| x.parse().unwrap()).collect();
            (nome.to_string(), PesosFitness {
                professor: p[0],
                unidas: p[1],
                agrupar: p[2],
                agrupar_por_movimentos: p[3] != 0.0,
                professor_por_movimentos: p.get(4).is_some_and(|&x| x != 0.0),
                // 6º campo opcional: peso do conflito (padrão: igual ao do professor)
                conflito: p.get(5).copied().unwrap_or(p[0]),
            })
        })
        .collect();

    let base = carregar(instancia);
    let mut cfg = config_ga_horario(base.tamanho_quadro());
    cfg.ilhas = ilhas;
    let por_geracao = (cfg.population_size * ilhas.max(1)) as u64;
    let total = (orcamento / por_geracao) as usize;
    let passo = (total / 400).max(1);

    println!("== {instancia} | pop {} | ilhas {ilhas} | {:.1} M avaliações | {sementes} sementes",
        cfg.population_size, orcamento as f64 / 1e6);
    println!("{:<26} {:>10} {:>14} {:>12} {:>12} {:>9}", "variante", "resolvidas", "aval. até res.", "viol. (med)", "viol. (méd)", "s/exec");
    let mut estado = base.initial_state();
    for (nome, pesos) in &variantes {
        let (mut ate, mut viol) = (Vec::new(), Vec::new());
        let inicio = Instant::now();
        for semente in 1..=sementes {
            fastrand::seed(semente);
            let mut regras = base.clone();
            regras.pesos = *pesos;
            let mut ga = GeneticAlgorithm::new(regras, cfg.clone());
            let mut resolveu = None;
            while ga.get_info().generation < total {
                let antes = ga.get_info().generation;
                ga.run(passo.min(total - antes));
                let info = ga.get_info();
                if info.best_fitness == Some(0.0) {
                    resolveu = Some(info.generation.max(antes + 1) as u64 * por_geracao);
                    break;
                }
                if info.generation == antes { break; }
            }
            if let Some(a) = resolveu { ate.push(a as f64); }
            // Régua comum: violações do melhor quadro medidas pelo fitness original
            let melhor = ga.get_info().best_genes.unwrap();
            viol.push(-base.fitness_original(&mut estado, &melhor));
        }
        let seg = inicio.elapsed().as_secs_f64() / sementes as f64;
        let media = viol.iter().sum::<f64>() / viol.len() as f64;
        let ate_txt = if ate.is_empty() { "—".to_string() } else { format!("{:.2} M", mediana(&mut ate) / 1e6) };
        println!("{:<26} {:>7}/{:<2} {:>14} {:>12.0} {:>12.1} {:>9.1}", nome, ate.len(), sementes, ate_txt, mediana(&mut viol), media, seg);
    }
}
