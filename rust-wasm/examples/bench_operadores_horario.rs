//! Benchmark dos operadores do GA de horários: população inicial com blocos (I1), troca de blocos
//! na mutação (M1) e o `diversity_check` do motor, ligados e desligados.
//!
//! Todas as variantes recebem o mesmo orçamento de AVALIAÇÕES de fitness; o tempo é informativo.
//! Para cada instância, variante e semente: fitness final do melhor quadro (0 = sem violação;
//! valores entre 0 e -20 são só qualidade) e as violações obrigatórias que sobraram.
//!
//! Uso: cargo run --release --example bench_operadores_horario -- <instancia.json>... [--sementes N]
//!      [--orcamento M] (milhões de avaliações por execução; padrão 10)
//!      [--variantes originais,i1,m1,i1+m1,i1+m1+div,originais+div]

use std::{env, time::Instant};

use rust_wasm::{
    genetic::ga::{GAConfig, GeneticAlgorithm},
    horario::{config_ga_horario, OperadoresGA, RegrasHorario},
};

fn variante(nome: &str) -> (OperadoresGA, bool) {
    let mut op = OperadoresGA::ORIGINAIS;
    let mut div = false;
    for parte in nome.split('+') {
        match parte {
            "originais" => {}
            "i1" => op.blocos_iniciais = true,
            "m1" => op.troca_de_blocos = OperadoresGA::default().troca_de_blocos,
            "div" => div = true,
            _ => panic!("parte de variante desconhecida: {parte}"),
        }
    }
    (op, div)
}

fn executar(regras: &RegrasHorario, op: OperadoresGA, div: bool, semente: u64, orcamento: u64) -> (f64, f64) {
    fastrand::seed(semente);
    let mut r = regras.clone();
    r.operadores = op;
    let cfg = GAConfig { diversity_check: div, ..config_ga_horario(&r) };
    let geracoes = (orcamento / cfg.population_size as u64).max(1) as usize;
    let inicio = Instant::now();
    let mut ga = GeneticAlgorithm::new(r, cfg);
    // Em blocos, para parar cedo se resolver tudo (fitness 0)
    while ga.get_info().generation < geracoes {
        let antes = ga.get_info().generation;
        ga.run((geracoes - antes).min(200));
        if ga.get_info().generation == antes {
            break;
        }
    }
    (ga.get_info().best_fitness.unwrap_or(f64::MIN), inicio.elapsed().as_secs_f64())
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut instancias = Vec::new();
    let (mut sementes, mut orcamento) = (2u64, 10.0f64);
    let mut variantes: Vec<String> = ["originais", "i1", "m1", "i1+m1", "originais+div", "i1+m1+div"].map(String::from).to_vec();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--sementes" => { sementes = args[i + 1].parse().unwrap(); i += 1; }
            "--orcamento" => { orcamento = args[i + 1].parse().unwrap(); i += 1; }
            "--variantes" => { variantes = args[i + 1].split(',').map(String::from).collect(); i += 1; }
            outro => instancias.push(outro.to_string()),
        }
        i += 1;
    }
    let orcamento = (orcamento * 1e6) as u64;

    for caminho in &instancias {
        let regras = RegrasHorario::de_arquivo(caminho);
        println!("\n=== {caminho}: {} turmas, {} aulas, pop {}, {:.0} M avaliações, {sementes} sementes",
            regras.turmas.len(), regras.aulas_a_alocar(), config_ga_horario(&regras).population_size, orcamento as f64 / 1e6);
        println!("{:<18} {:>10} {:>10} {:>10} {:>10} {:>8}", "variante", "mediana", "melhor", "pior", "válidas", "s/exec");
        for v in &variantes {
            let (op, div) = variante(v);
            let mut fits: Vec<f64> = Vec::new();
            let mut tempo = 0.0;
            for s in 1..=sementes {
                let (f, t) = executar(&regras, op, div, s, orcamento);
                fits.push(f);
                tempo += t;
            }
            fits.sort_by(|a, b| a.partial_cmp(b).unwrap());
            // Válido = sem violação obrigatória (a menor delas pesa 20)
            let validas = fits.iter().filter(|&&f| f > -20.0).count();
            println!("{:<18} {:>10.1} {:>10.1} {:>10.1} {:>7}/{:<2} {:>8.1}",
                v, fits[fits.len() / 2], fits[fits.len() - 1], fits[0], validas, sementes, tempo / sementes as f64);
        }
    }
}
