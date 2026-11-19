//! Benchmark de QUALIDADE do motor genético: modelo clássico x modelo de ilhas.
//!
//! Todas as variantes recebem o mesmo orçamento de AVALIAÇÕES de fitness (indivíduos avaliados), que
//! é o que custa tempo. Como a evolução é determinística (não depende do número de threads), os
//! resultados são exatos e reproduzíveis; o tempo de relógio é só informativo.
//!
//! Para cada variante e problema, com várias sementes:
//! - fitness final (mediana e melhor/pior);
//! - quantas sementes atingiram o alvo (quando o problema tem um) e com quantas avaliações (mediana).
//!
//! Uso: cargo run --release --example bench_ga_qualidade -- <problema> [--sementes N] [--orcamento N]
//!      [--ilhas N] [--variantes classico,classico-x,ilhas:EPOCA:MIGRACAO:elite|normal,...]
//! Problemas: onemax, tsp100, tsp500, horario-pequena, horario-faculdade, horario-media

use std::{env, time::Instant};

use rust_wasm::{
    genetic::{
        ga::{GAConfig, GeneticAlgorithm},
        problems::{GAProblem, OneMaxGAProblem, TSPGAProblem},
    },
    horario::{config_ga_horario, RegrasHorario},
};

fn carregar_horario(nome: &str) -> RegrasHorario {
    RegrasHorario::de_arquivo(nome)
}

#[derive(Clone, Debug)]
enum Variante {
    /// Uma população de tamanho P.
    Classico,
    /// Uma população de tamanho P x ilhas (controle: mesmo total de indivíduos das ilhas).
    ClassicoX,
    /// `ilhas` populações de tamanho P.
    Ilhas { epoca: usize, migracao: usize, migrar_elite: bool },
}

impl Variante {
    fn ler(texto: &str) -> Self {
        let p: Vec<&str> = texto.split(':').collect();
        match p[0] {
            "classico" => Self::Classico,
            "classico-x" => Self::ClassicoX,
            "ilhas" => Self::Ilhas { epoca: p[1].parse().unwrap(), migracao: p[2].parse().unwrap(), migrar_elite: p.get(3) == Some(&"elite") },
            _ => panic!("variante desconhecida: {texto}"),
        }
    }

    fn nome(&self, ilhas: usize) -> String {
        match self {
            Self::Classico => "clássico P".into(),
            Self::ClassicoX => format!("clássico P x{ilhas}"),
            Self::Ilhas { epoca, migracao, migrar_elite } =>
                format!("{ilhas} ilhas ép.{epoca} mig.{migracao}{}", if *migrar_elite { " +elite" } else { "" }),
        }
    }

    fn aplicar(&self, base: &GAConfig, ilhas: usize) -> GAConfig {
        let mut cfg = base.clone();
        match self {
            Self::Classico => {}
            Self::ClassicoX => cfg.population_size *= ilhas,
            Self::Ilhas { epoca, migracao, migrar_elite } => {
                cfg.ilhas = ilhas;
                cfg.epoca = *epoca;
                cfg.migracao = *migracao;
                cfg.migrar_elite = *migrar_elite;
            }
        }
        cfg
    }
}

struct Execucao {
    fitness: f64,
    /// Avaliações até atingir o alvo, se atingiu.
    ate_alvo: Option<u64>,
}

fn executar<P: GAProblem>(problema: P, cfg: GAConfig, semente: u64, orcamento: u64, alvo: Option<f64>) -> Execucao {
    fastrand::seed(semente);
    let por_geracao = (cfg.population_size * cfg.ilhas.max(1)) as u64;
    let total = (orcamento / por_geracao).max(1) as usize;
    // Confere o alvo ~400 vezes ao longo da execução
    let passo = (total / 400).max(1);
    let mut ga = GeneticAlgorithm::new(problema, cfg);
    let mut ate_alvo = None;
    while ga.get_info().generation < total {
        let antes = ga.get_info().generation;
        ga.run(passo.min(total - antes));
        let info = ga.get_info();
        if let (Some(alvo), Some(fit)) = (alvo, info.best_fitness)
            && fit >= alvo
        {
            ate_alvo = Some(info.generation.max(antes + 1) as u64 * por_geracao);
            break;
        }
        if info.generation == antes {
            break; // parou sozinho (fitness máximo)
        }
    }
    Execucao { fitness: ga.get_info().best_fitness.unwrap_or(f64::MIN), ate_alvo }
}

fn mediana(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

#[allow(clippy::too_many_arguments)]
fn comparar<P: GAProblem>(
    nome: &str,
    criar: impl Fn() -> P,
    base: GAConfig,
    alvo: Option<f64>,
    orcamento: u64,
    sementes: u64,
    ilhas: usize,
    variantes: &[Variante],
) {
    println!("== {nome} | P = {} | orçamento {:.1} M avaliações | {sementes} sementes | alvo {}",
        base.population_size, orcamento as f64 / 1e6, alvo.map_or("—".into(), |a| a.to_string()));
    println!("{:<34} {:>12} {:>12} {:>12} {:>9} {:>16} {:>7}", "variante", "fit. mediana", "pior", "melhor", "no alvo", "aval. até alvo", "s/exec");
    for v in variantes {
        let cfg = v.aplicar(&base, ilhas);
        let inicio = Instant::now();
        let execs: Vec<Execucao> = (1..=sementes).map(|s| executar(criar(), cfg.clone(), s, orcamento, alvo)).collect();
        let seg = inicio.elapsed().as_secs_f64() / sementes as f64;
        let mut fits: Vec<f64> = execs.iter().map(|e| e.fitness).collect();
        let med = mediana(&mut fits);
        let mut ate: Vec<f64> = execs.iter().filter_map(|e| e.ate_alvo.map(|a| a as f64)).collect();
        let no_alvo = ate.len();
        let ate_txt = if ate.is_empty() { "—".to_string() } else { format!("{:.2} M", mediana(&mut ate) / 1e6) };
        println!("{:<34} {:>12.3} {:>12.3} {:>12.3} {:>6}/{:<2} {:>16} {:>7.1}",
            v.nome(ilhas), med, fits[0], fits[fits.len() - 1], no_alvo, sementes, ate_txt, seg);
    }
    println!();
}

fn config(pop: usize, genes: usize, max_stagnation: Option<usize>) -> GAConfig {
    GAConfig {
        population_size: pop,
        crossover_rate: 0.9,
        mutation_rate: 0.9,
        mutation_gene_rate: 1.0 / genes as f64,
        tournament_size: 8,
        max_stagnation,
        ..GAConfig::new()
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let arg = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let problema = args.get(1).cloned().unwrap_or_else(|| {
        eprintln!("uso: bench_ga_qualidade <onemax|tsp100|tsp500|horario-pequena|horario-faculdade|horario-media> [opções]");
        std::process::exit(2)
    });
    let sementes: u64 = arg("--sementes").map_or(5, |s| s.parse().unwrap());
    let ilhas: usize = arg("--ilhas").map_or(8, |s| s.parse().unwrap());
    let variantes: Vec<Variante> = arg("--variantes")
        .unwrap_or("classico,classico-x,ilhas:10:1,ilhas:50:1,ilhas:200:1,ilhas:10:1:elite,ilhas:50:1:elite,ilhas:200:1:elite".into())
        .split(',').map(Variante::ler).collect();
    let orc = |padrao: u64| arg("--orcamento").map_or(padrao, |s| (s.parse::<f64>().unwrap() * 1e6) as u64);

    match problema.as_str() {
        "onemax" => {
            let bits = 2000;
            comparar("OneMax 2000 bits", || OneMaxGAProblem::new(bits), config(200, bits, None), Some(bits as f64), orc(6_000_000), sementes, ilhas, &variantes);
        }
        "tsp100" | "tsp500" => {
            let cidades = if problema == "tsp100" { 100 } else { 500 };
            fastrand::seed(7);
            let mapa = TSPGAProblem::generate_random_cities(cidades);
            // Mesma configuração da página /toy/genetic
            comparar(&format!("TSP {cidades} cidades"), || TSPGAProblem::new(mapa.clone()), config(cidades * 2, cidades, Some(50_000)), None,
                orc(if cidades == 100 { 10_000_000 } else { 20_000_000 }), sementes, ilhas, &variantes);
        }
        p if p.starts_with("horario-") => {
            let nome = match p { "horario-faculdade" => "faculdade-anonimizado", outro => &outro["horario-".len()..] };
            let config = config_ga_horario(&carregar_horario(nome));
            // Mesma configuração da página do gerador de horários
            comparar(&format!("Horário {nome}"), || carregar_horario(nome), config.clone(), Some(0.0), orc(10_000_000), sementes, ilhas, &variantes);
        }
        outro => panic!("problema desconhecido: {outro}"),
    }
}
