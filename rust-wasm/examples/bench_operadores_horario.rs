//! Benchmark dos operadores do GA de horários: população inicial com blocos (I1), troca de blocos
//! na mutação (M1) e o `diversity_check` do motor, ligados e desligados.
//!
//! Todas as variantes recebem o mesmo orçamento de AVALIAÇÕES de fitness; o tempo é medido em
//! paralelo (com `--ilhas N`, cada ilha roda numa thread e o orçamento total é dividido entre elas).
//! Para cada instância, variante e semente: fitness final do melhor quadro (0 = sem violação;
//! valores acima da menor obrigatória são só qualidade), tempo/avaliações até o primeiro horário
//! válido e segundos totais.
//!
//! Uso: cargo run --release --example bench_operadores_horario -- <instancia.json>... [--sementes N]
//!      [--orcamento M] (milhões de avaliações por execução; padrão 10)
//!      [--segundos S] (opcional: para também ao atingir S segundos de relógio)
//!      [--ilhas N] (0 = modelo clássico, N > 1 = N ilhas; padrão 0)
//!      [--variantes originais,i1,m1,i1+m1,i1+m1+div,originais+div]
//!      [--csv] [--cabecalho]

use std::{env, path::Path, time::Instant};

use rust_wasm::{
    genetic::ga::GeneticAlgorithm,
    horario::{config_ga_horario_ilhas, ConfigMovimentos, OperadoresGA, RegrasHorario},
};

struct SpecVariante {
    op: OperadoresGA,
    div: Option<bool>,
    cx_rate: Option<f64>,
    pop: Option<usize>,
    torn: Option<usize>,
    stag: Option<Option<usize>>,
    epoca: Option<usize>,
    migracao: Option<usize>,
}

fn variante(nome: &str) -> SpecVariante {
    let mut op = OperadoresGA::ORIGINAIS;
    let mut div = None;
    let mut cx_rate = None;
    let mut pop = None;
    let mut torn = None;
    let mut stag = None;
    let mut epoca = None;
    let mut migracao = None;
    let padrao_mov = ConfigMovimentos::default();
    for parte in nome.split('+') {
        if let Some(p) = parte.strip_prefix("kempe:") {
            op.movimentos.p_kempe = p.parse().unwrap();
            continue;
        }
        if let Some(n) = parte.strip_prefix("retry:") {
            op.tentativas_mutacao = n.parse().unwrap();
            continue;
        }
        if let Some(r) = parte.strip_prefix("cxr:") {
            cx_rate = Some(r.parse().unwrap());
            continue;
        }
        if let Some(p) = parte.strip_prefix("ipx:") {
            op.p_ipx = p.parse().unwrap();
            continue;
        }
        if let Some(n) = parte.strip_prefix("pop:") {
            pop = Some(n.parse().unwrap());
            continue;
        }
        if let Some(t) = parte.strip_prefix("torn:") {
            torn = Some(t.parse().unwrap());
            continue;
        }
        if let Some(s) = parte.strip_prefix("stag:") {
            let n: usize = s.parse().unwrap();
            stag = Some((n > 0).then_some(n));
            continue;
        }
        if let Some(e) = parte.strip_prefix("epoca:") {
            epoca = Some(e.parse().unwrap());
            continue;
        }
        if let Some(m) = parte.strip_prefix("mig:") {
            migracao = Some(m.parse().unwrap());
            continue;
        }
        match parte {
            "originais" => { div = Some(false); }
            "padrao" => op = OperadoresGA::default(),
            "i1" => op.blocos_iniciais = true,
            "m1" => op.movimentos.p_bloco = padrao_mov.p_bloco,
            "unidas" => op.movimentos.propagar_unidas = true,
            "kempe" => op.movimentos.p_kempe = padrao_mov.p_kempe,
            "kbloco" => op.movimentos.kempe_de_blocos = true,
            "ativas" => op.taxa_em_ativas = true,
            "retry" => op.tentativas_mutacao = 4,
            "cx:orig" => { op.crossover_por_componentes = false; op.p_ipx = 0.5; }
            "cx:comp_ipx" => { op.crossover_por_componentes = true; op.p_ipx = 0.5; }
            "cx:comp" => { op.crossover_por_componentes = true; op.p_ipx = 0.0; }
            "div" => div = Some(true),
            "sem-div" => div = Some(false),
            _ => panic!("parte de variante desconhecida: {parte}"),
        }
    }
    SpecVariante { op, div, cx_rate, pop, torn, stag, epoca, migracao }
}

struct Execucao {
    fitness: f64,
    geracoes: usize,
    avaliacoes: u64,
    valido_aval: Option<u64>,
    valido_s: Option<f64>,
    segundos: f64,
}

fn executar(regras: &RegrasHorario, spec: &SpecVariante, ilhas: usize, semente: u64, orcamento: u64, segundos: Option<f64>) -> Execucao {
    fastrand::seed(semente);
    let mut r = regras.clone();
    r.operadores = spec.op;
    let p = r.pesos;
    let menor_obrigatoria = [p.professor, p.conflito, p.unidas, p.agrupar]
        .into_iter()
        .filter(|&x| x > 0.0)
        .reduce(f64::min)
        .unwrap_or(20.0);
    let mut cfg = config_ga_horario_ilhas(&r, ilhas);
    if let Some(d) = spec.div {
        cfg.diversity_check = d;
    }
    if let Some(r) = spec.cx_rate {
        cfg.crossover_rate = r;
    }
    if let Some(pop) = spec.pop {
        cfg.population_size = pop;
    }
    if let Some(t) = spec.torn {
        cfg.tournament_size = t;
    }
    if let Some(s) = spec.stag {
        cfg.max_stagnation = s;
    }
    if let Some(e) = spec.epoca {
        cfg.epoca = e;
    }
    if let Some(m) = spec.migracao {
        cfg.migracao = m;
    }
    let por_geracao = (cfg.population_size * cfg.ilhas.max(1)) as u64;
    let geracoes = (orcamento / por_geracao).max(1) as usize;
    let passo = (geracoes / 200).clamp(1, 50);
    let inicio = Instant::now();
    let mut ga = GeneticAlgorithm::new(r, cfg);
    let (mut valido_aval, mut valido_s) = (None, None);
    while ga.get_info().generation < geracoes {
        let antes = ga.get_info().generation;
        ga.run((geracoes - antes).min(passo));
        let info = ga.get_info();
        let agora = inicio.elapsed().as_secs_f64();
        let aval = info.generation.max(antes + 1) as u64 * por_geracao;
        if valido_s.is_none() && info.best_fitness.is_some_and(|f| f > -menor_obrigatoria) {
            valido_s = Some(agora);
            valido_aval = Some(aval);
        }
        if info.generation == antes || info.best_fitness == Some(0.0) {
            break;
        }
        if segundos.is_some_and(|lim| agora >= lim) {
            break;
        }
    }
    let info = ga.get_info();
    Execucao {
        fitness: info.best_fitness.unwrap_or(f64::MIN),
        geracoes: info.generation,
        avaliacoes: info.generation as u64 * por_geracao,
        valido_aval,
        valido_s,
        segundos: inicio.elapsed().as_secs_f64(),
    }
}

fn nome_instancia(caminho: &str) -> &str {
    Path::new(caminho).file_stem().and_then(|s| s.to_str()).unwrap_or(caminho)
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut instancias = Vec::new();
    let (mut sementes, mut orcamento, mut ilhas) = (2u64, 10.0f64, 0usize);
    let mut segundos: Option<f64> = None;
    let (mut csv, mut cabecalho) = (false, false);
    let mut variantes: Vec<String> = ["originais", "i1", "m1", "i1+m1", "originais+div", "i1+m1+div"].map(String::from).to_vec();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--sementes" => { sementes = args[i + 1].parse().unwrap(); i += 1; }
            "--orcamento" => { orcamento = args[i + 1].parse().unwrap(); i += 1; }
            "--segundos" => { segundos = Some(args[i + 1].parse().unwrap()); i += 1; }
            "--ilhas" => { ilhas = args[i + 1].parse().unwrap(); i += 1; }
            "--variantes" => { variantes = args[i + 1].split(',').map(String::from).collect(); i += 1; }
            "--csv" => { csv = true; }
            "--cabecalho" => { cabecalho = true; }
            outro => instancias.push(outro.to_string()),
        }
        i += 1;
    }
    let orcamento = (orcamento * 1e6) as u64;

    if csv && cabecalho {
        println!("variante,ilhas,instancia,semente,orcamento,geracoes,avaliacoes,valido_aval,valido_s,fitness,segundos");
    }

    for caminho in &instancias {
        let regras = RegrasHorario::de_arquivo(caminho);
        let nome = nome_instancia(caminho);
        let pop = config_ga_horario_ilhas(&regras, ilhas).population_size;
        if !csv {
            println!(
                "\n=== {caminho}: {} turmas, {} aulas, pop {pop}{}, {:.1} M avaliações, {sementes} sementes",
                regras.turmas.len(),
                regras.aulas_a_alocar(),
                if ilhas > 1 { format!(" x {ilhas} ilhas") } else { String::new() },
                orcamento as f64 / 1e6,
            );
            println!("{:<28} {:>9} {:>9} {:>9} {:>8} {:>9} {:>7} {:>8}", "variante", "mediana", "melhor", "pior", "válidas", "val. med", "s/exec", "ger/s");
        }
        for v in &variantes {
            let spec = variante(v);
            let mut fits: Vec<f64> = Vec::new();
            let mut tempos_val: Vec<f64> = Vec::new();
            let (mut tempo, mut total_ger) = (0.0, 0usize);
            for s in 1..=sementes {
                let e = executar(&regras, &spec, ilhas, s, orcamento, segundos);
                if csv {
                    println!(
                        "{v},{ilhas},{nome},{s},{orcamento},{},{},{},{},{:.6},{:.3}",
                        e.geracoes,
                        e.avaliacoes,
                        e.valido_aval.map_or(String::new(), |a| a.to_string()),
                        e.valido_s.map_or(String::new(), |t| format!("{t:.3}")),
                        e.fitness,
                        e.segundos,
                    );
                }
                fits.push(e.fitness);
                if let Some(t) = e.valido_s {
                    tempos_val.push(t);
                }
                tempo += e.segundos;
                total_ger += e.geracoes;
            }
            if !csv {
                fits.sort_by(|a, b| a.total_cmp(b));
                tempos_val.sort_by(|a, b| a.total_cmp(b));
                let val_txt = if tempos_val.is_empty() { "-".into() } else { format!("{:.2}s", tempos_val[tempos_val.len() / 2]) };
                println!(
                    "{:<28} {:>9.1} {:>9.1} {:>9.1} {:>5}/{:<2} {:>9} {:>7.2} {:>8.0}",
                    v,
                    fits[fits.len() / 2],
                    fits[fits.len() - 1],
                    fits[0],
                    tempos_val.len(),
                    sementes,
                    val_txt,
                    tempo / sementes as f64,
                    total_ger as f64 / tempo.max(1e-9),
                );
            }
        }
    }
}
