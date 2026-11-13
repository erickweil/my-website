//! Benchmark nativo dos solvers de horários (GA e Pencilmark).
//!
//! Roda os mesmos solvers usados no WASM — `GeneticAlgorithm<RegrasHorario>` com a configuração da
//! página (`config_ga_horario`) ou o Pencilmark (`HorarioRegrasPencilmark`) —
//! compilados para a máquina local, sem browser.
//!
//! Uso:
//!   cargo run --release --example bench_horario -- <instancia.json> [opções]
//!
//! Opções:
//!   --segundos N   orçamento de tempo por execução (padrão: 10)
//!   --runs N       número de execuções independentes (padrão: 3)
//!   --seed N       semente da 1ª execução; a execução i usa seed+i (padrão: 1)
//!   --pop-mult N   população = tamanho do quadro × N (padrão: 4, igual ao worker)
//!   --csv ARQ      grava a curva de convergência (run,ms,geracao,fitness) em ARQ (só GA)
//!   --solver S     ga (padrão) ou pencilmark
//!   --base-iter N  Pencilmark: reinícios com orçamento 2^N, 2^(N+1)…; "none" = sem reinícios,
//!                  como o worker 0 do site (padrão: none)
//!
//! Se existir `<instancia>.solucao.json` ao lado da instância (gerado por
//! `tests/instancias/gerar.mjs`), o fitness da solução de referência é conferido antes
//! do benchmark — prova de que a instância admite fitness 0 segundo as regras do Rust.

use std::{collections::HashMap, env, fs, io::Write, path::Path, process, time::Instant};

use rust_wasm::{
    genetic::{
        ga::{GAConfig, GeneticAlgorithm},
        problems::GAProblem,
    },
    horario::{config_ga_horario, DiaSemana, FomularioHorario, HorarioRegrasPencilmark, QUANTOS_DIAS, QuadroHorario, RegrasHorario},
    pencilmark::ExecucaoPencilmark,
};

/// Nós do Pencilmark processados entre cada verificação do relógio.
const ITER_POR_PASSO: u64 = 2048;

/// Gerações executadas entre cada medição. Pequeno o bastante para a curva ter resolução,
/// grande o bastante para o custo de `get_info()` (que clona os genes) ser desprezível.
const GERACOES_POR_PASSO: usize = 50;

struct Opcoes {
    instancia: String,
    segundos: f64,
    runs: usize,
    seed: u64,
    pop_mult: usize,
    csv: Option<String>,
    solver: String,
    base_iter: Option<u32>,
}

fn uso(msg: &str) -> ! {
    eprintln!("erro: {msg}\n");
    eprintln!("uso: cargo run --release --example bench_horario -- <instancia.json> [--segundos N] [--runs N] [--seed N] [--pop-mult N] [--csv ARQ] [--solver ga|pencilmark] [--base-iter N|none]");
    process::exit(2);
}

fn ler_opcoes() -> Opcoes {
    let mut args = env::args().skip(1);
    let mut op = Opcoes { instancia: String::new(), segundos: 10.0, runs: 3, seed: 1, pop_mult: 4, csv: None, solver: "ga".into(), base_iter: None };
    while let Some(a) = args.next() {
        let mut valor = |nome: &str| args.next().unwrap_or_else(|| uso(&format!("{nome} precisa de um valor")));
        match a.as_str() {
            "--segundos" => op.segundos = valor("--segundos").parse().unwrap_or_else(|_| uso("--segundos inválido")),
            "--runs" => op.runs = valor("--runs").parse().unwrap_or_else(|_| uso("--runs inválido")),
            "--seed" => op.seed = valor("--seed").parse().unwrap_or_else(|_| uso("--seed inválido")),
            "--pop-mult" => op.pop_mult = valor("--pop-mult").parse().unwrap_or_else(|_| uso("--pop-mult inválido")),
            "--csv" => op.csv = Some(valor("--csv")),
            "--solver" => op.solver = match valor("--solver").as_str() {
                s @ ("ga" | "pencilmark") => s.to_string(),
                s => uso(&format!("solver desconhecido: {s} (use ga ou pencilmark)")),
            },
            "--base-iter" => op.base_iter = match valor("--base-iter").as_str() {
                "none" => None,
                n => Some(n.parse().unwrap_or_else(|_| uso("--base-iter inválido"))),
            },
            _ if a.starts_with("--") => uso(&format!("opção desconhecida: {a}")),
            _ if op.instancia.is_empty() => op.instancia = a,
            _ => uso(&format!("argumento inesperado: {a}")),
        }
    }
    if op.instancia.is_empty() {
        uso("informe o arquivo da instância");
    }
    op
}

/// A config do GA usada na página, com o multiplicador de população da linha de comando.
fn config_do_worker(size: usize, pop_mult: usize) -> GAConfig {
    GAConfig { population_size: size * pop_mult, ..config_ga_horario(size) }
}

/// Converte `{ turma: { dia: [disciplina por tempo] } }` no quadro linearizado.
fn carregar_solucao(regras: &RegrasHorario, caminho: &Path) -> QuadroHorario {
    let texto = fs::read_to_string(caminho).expect("erro ao ler solução de referência");
    let sol: HashMap<String, HashMap<String, Vec<Option<String>>>> =
        serde_json::from_str(&texto).expect("solução de referência com formato inválido");

    let mut quadro = regras.get_quadro_vazio();
    for (nome_turma, dias) in &sol {
        let turma = regras.turmas.iter().find(|t| &t.nome == nome_turma)
            .unwrap_or_else(|| panic!("turma '{nome_turma}' da solução não existe na instância"));
        for (dia_str, tempos) in dias {
            let dia = DiaSemana::try_from(dia_str.as_str())
                .unwrap_or_else(|d| panic!("dia '{d}' inválido na solução de referência"));
            for (tempo, disc) in tempos.iter().enumerate() {
                let Some(nome_disc) = disc else { continue };
                let disc = regras.disciplinas.iter().find(|d| &d.nome == nome_disc)
                    .unwrap_or_else(|| panic!("disciplina '{nome_disc}' da solução não existe na instância"));
                quadro[regras.to_quadro_index(turma.id, dia, tempo)] = disc.id as i32 + 1;
            }
        }
    }
    quadro
}

fn main() {
    let op = ler_opcoes();

    let texto = fs::read_to_string(&op.instancia)
        .unwrap_or_else(|e| uso(&format!("não foi possível ler '{}': {e}", op.instancia)));
    // Aceita tanto o formulário puro quanto o arquivo do botão "Exportar JSON" da UI,
    // que tem o formato { "formData": {...}, "config": {...} }.
    let mut json: serde_json::Value = serde_json::from_str(&texto)
        .unwrap_or_else(|e| uso(&format!("JSON inválido em '{}': {e}", op.instancia)));
    if let Some(form) = json.get_mut("formData") {
        json = form.take();
    }
    let formulario: FomularioHorario = serde_json::from_value(json)
        .unwrap_or_else(|e| uso(&format!("formulário inválido em '{}': {e}", op.instancia)));

    let regras = RegrasHorario::new(formulario.clone())
        .unwrap_or_else(|e| uso(&format!("formulário inválido em '{}': {e}", op.instancia)));
    let size = regras.turmas.len() * QUANTOS_DIAS * regras.n_tempos;
    let slots_ativos = regras.get_quadro_vazio().iter().filter(|&&v| v == 0).count();
    let cfg = config_do_worker(size, op.pop_mult);

    println!("=== Benchmark nativo: {} de horários ===", if op.solver == "ga" { "GA" } else { "Pencilmark" });
    println!("instância: {}", op.instancia);
    println!(
        "turmas={} disciplinas={} professores={} tempos/dia={} quadro={} (ativos={})",
        regras.turmas.len(), regras.disciplinas.len(), regras.professores.len(),
        regras.n_tempos, size, slots_ativos,
    );
    if op.solver == "ga" { println!(
        "pop={} crossover={} mutação={} mutação/gene={:.5} torneio={} max_estagnação={:?}",
        cfg.population_size, cfg.crossover_rate, cfg.mutation_rate,
        cfg.mutation_gene_rate, cfg.tournament_size, cfg.max_stagnation,
    ); }

    // Confere a solução de referência, se houver
    let caminho_sol = Path::new(&op.instancia).with_extension("solucao.json");
    if caminho_sol.exists() {
        let quadro = carregar_solucao(&regras, &caminho_sol);
        let mut state = regras.initial_state();
        let fit = regras.fitness(&mut state, &quadro);
        println!("solução de referência ({}): fitness = {fit}", caminho_sol.display());
        if fit != 0.0 {
            eprintln!("AVISO: a solução de referência não tem fitness 0 — instância ou regras divergem");
        }
    } else {
        println!("solução de referência: não há (instância pode ser inviável)");
    }

    if op.solver == "pencilmark" {
        bench_pencilmark(&op, &formulario, slots_ativos);
        return;
    }

    let mut csv = op.csv.as_ref().map(|arq| {
        let mut f = fs::File::create(arq).unwrap_or_else(|e| uso(&format!("não foi possível criar '{arq}': {e}")));
        writeln!(f, "run,seed,ms,geracao,fitness").unwrap();
        f
    });

    println!();
    println!("{:>3} {:>6} {:>10} {:>10} {:>12} {:>10} {:>14}", "run", "seed", "fitness", "gerações", "ms p/ ótimo", "gen/s", "avaliações/s");

    let mut resumo = Vec::new();
    for run in 0..op.runs {
        let seed = op.seed + run as u64;
        fastrand::seed(seed);

        let mut ga = GeneticAlgorithm::new(RegrasHorario::new(formulario.clone()).unwrap(), cfg.clone());
        let inicio = Instant::now();
        let mut melhor = f64::NEG_INFINITY;
        let mut ms_otimo = None;

        loop {
            ga.run(GERACOES_POR_PASSO);
            let info = ga.get_info();
            let ms = inicio.elapsed().as_secs_f64() * 1000.0;
            let fit = info.best_fitness.unwrap_or(f64::NEG_INFINITY);

            if fit > melhor {
                melhor = fit;
                if let Some(f) = csv.as_mut() {
                    writeln!(f, "{run},{seed},{ms:.1},{},{fit}", info.generation).unwrap();
                }
            }
            if fit >= 0.0 {
                ms_otimo = Some(ms);
                break;
            }
            if ms >= op.segundos * 1000.0 {
                break;
            }
        }

        let seg = inicio.elapsed().as_secs_f64();
        let geracoes = ga.get_info().generation;
        let gen_s = geracoes as f64 / seg;
        let aval_s = gen_s * cfg.population_size as f64;
        println!(
            "{:>3} {:>6} {:>10} {:>10} {:>12} {:>10.0} {:>14.0}",
            run, seed, melhor, geracoes,
            ms_otimo.map_or("-".to_string(), |m| format!("{m:.0}")),
            gen_s, aval_s,
        );
        resumo.push((melhor, ms_otimo, gen_s, aval_s));
    }

    let n = resumo.len() as f64;
    let resolvidos: Vec<f64> = resumo.iter().filter_map(|r| r.1).collect();
    println!();
    println!("resolvidas (fitness 0): {}/{}", resolvidos.len(), resumo.len());
    println!("fitness médio final:    {:.1}", resumo.iter().map(|r| r.0).sum::<f64>() / n);
    if !resolvidos.is_empty() {
        println!("tempo médio p/ ótimo:   {:.0} ms", resolvidos.iter().sum::<f64>() / resolvidos.len() as f64);
    }
    println!("gerações/s (média):     {:.0}", resumo.iter().map(|r| r.2).sum::<f64>() / n);
    println!("avaliações/s (média):   {:.0}", resumo.iter().map(|r| r.3).sum::<f64>() / n);
    if let Some(arq) = &op.csv {
        println!("curva de convergência:  {arq}");
    }
}

fn bench_pencilmark(op: &Opcoes, formulario: &FomularioHorario, slots_ativos: usize) {
    println!("base_iter={}", op.base_iter.map_or("none (sem reinícios)".to_string(), |b| b.to_string()));
    println!();
    println!("{:>3} {:>6} {:>10} {:>12} {:>14} {:>12} {:>10}", "run", "seed", "resolveu", "iterações", "preenchidos", "ms", "iter/s");

    let mut resolvidos = Vec::new();
    for run in 0..op.runs {
        let seed = op.seed + run as u64;
        fastrand::seed(seed);

        let regras = HorarioRegrasPencilmark::new(RegrasHorario::new(formulario.clone()).unwrap());
        let (quadro, n_possibs) = (regras.quadro_vazio(), regras.n_possibs());
        let inativos = quadro.iter().filter(|&&v| v != 0).count();
        let mut exec = ExecucaoPencilmark::new(regras, quadro, n_possibs, 1, op.base_iter);

        let inicio = Instant::now();
        while !exec.executar(ITER_POR_PASSO) && inicio.elapsed().as_secs_f64() < op.segundos {}
        let ms = inicio.elapsed().as_secs_f64() * 1000.0;

        let s = &exec.solver;
        let resolveu = match s.solucoes.first() {
            Some(sol) => {
                // Checagem cruzada: a solução do Pencilmark precisa ter fitness 0 nas regras do GA
                let mut state = s.regras.regras.initial_state();
                let fit = s.regras.regras.fitness(&mut state, sol);
                if fit != 0.0 {
                    eprintln!("AVISO: solução do Pencilmark tem fitness {fit} no GA — regras divergem");
                }
                resolvidos.push(ms);
                "sim"
            }
            None if exec.terminou() => "impossível",
            None => "não",
        };
        // Células de aula preenchidas no melhor quadro parcial
        let preenchidos = s.melhor_preenchidos.saturating_sub(inativos);
        println!(
            "{:>3} {:>6} {:>10} {:>12} {:>14} {:>12.0} {:>10.0}",
            run, seed, resolveu, s.iter, format!("{preenchidos}/{slots_ativos}"), ms, s.iter as f64 / (ms / 1000.0),
        );
    }

    println!();
    println!("resolvidas: {}/{}", resolvidos.len(), op.runs);
    if !resolvidos.is_empty() {
        println!("tempo médio p/ solução: {:.0} ms", resolvidos.iter().sum::<f64>() / resolvidos.len() as f64);
    }
}
