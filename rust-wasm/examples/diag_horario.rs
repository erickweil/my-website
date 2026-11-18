//! Diagnóstico do GA de horários: em que tipo de violação a busca fica presa?
//!
//! Roda o GA com várias sementes e, para o melhor quadro de cada uma, conta as violações por regra
//! e mostra as disciplinas envolvidas.
//!
//! Uso: cargo run --release --example diag_horario -- <instancia.json> [--sementes N] [--orcamento M]

use std::{collections::BTreeMap, env};

use rust_wasm::{
    genetic::ga::GeneticAlgorithm,
    horario::{config_ga_horario, DiaSemana, RegrasHorario},
};

fn carregar(caminho: &str) -> RegrasHorario {
    RegrasHorario::de_arquivo(caminho)
}

#[derive(Default, Debug)]
struct Violacoes {
    /// Aula num horário em que o professor não trabalha: (disciplina, professor)
    prof_indisponivel: Vec<(String, String)>,
    /// Professor em duas turmas ao mesmo tempo: (professor, dia/tempo, disciplinas)
    prof_conflito: Vec<(String, String, Vec<String>)>,
    /// Disciplina unida sem a parceira no mesmo horário
    unidas: Vec<String>,
    /// Divisão em pedaços que quebra as regras: (disciplina, pedaços da semana, desvio)
    divisao: Vec<(String, String, i32)>,
}

fn analisar(r: &RegrasHorario, q: &[i32]) -> Violacoes {
    let mut v = Violacoes::default();
    let disc = |i: usize, dia: DiaSemana, t: usize| {
        // Horário vago e fora do horário não são disciplina
        r.disciplina_em(q[r.to_quadro_index(i, dia, t)]).map(|d| &r.disciplinas[d])
    };
    for dia in DiaSemana::TODOS {
        for t in 0..r.n_tempos {
            let mut por_prof: BTreeMap<usize, Vec<String>> = BTreeMap::new();
            for turma in &r.turmas {
                let Some(d) = disc(turma.id, dia, t) else { continue };
                for &p in &d.professores {
                    por_prof.entry(p).or_default().push(d.nome.clone());
                    if r.professores[p].horarios.get(dia, t) == 0 {
                        v.prof_indisponivel.push((d.nome.clone(), r.professores[p].nome.clone()));
                    }
                }
                for &u in &d.disciplinas_unidas {
                    let ut = r.disciplinas[u].turma_id;
                    if q[r.to_quadro_index(ut, dia, t)] != u as i32 + 1 {
                        v.unidas.push(d.nome.clone());
                    }
                }
            }
            for (p, ds) in por_prof {
                if ds.len() > 1 {
                    v.prof_conflito.push((r.professores[p].nome.clone(), format!("{}{}", dia.sigla(), t + 1), ds));
                }
            }
        }
    }
    for d in r.disciplinas.iter().filter(|d| d.divisao.ativa) {
        let mut pedacos: Vec<u8> = Vec::new();
        for dia in DiaSemana::TODOS {
            let mut run = 0u8;
            for t in 0..=r.n_tempos {
                if t < r.n_tempos && q[r.to_quadro_index(d.turma_id, dia, t)] == d.id as i32 + 1 {
                    run += 1;
                } else if run > 0 {
                    pedacos.push(run);
                    run = 0;
                }
            }
        }
        let desvio = d.divisao.desvio(pedacos.iter().copied());
        if desvio > 0 {
            pedacos.sort_unstable_by(|a, b| b.cmp(a));
            let texto = pedacos.iter().map(|p| p.to_string()).collect::<Vec<_>>().join("+");
            v.divisao.push((d.nome.clone(), texto, desvio));
        }
    }
    v
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let arg = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let caminho = args.get(1).expect("informe a instância");
    let sementes: u64 = arg("--sementes").map_or(10, |s| s.parse().unwrap());
    let orcamento = (arg("--orcamento").map_or(3.0, |s| s.parse::<f64>().unwrap()) * 1e6) as usize;

    let mut regras = carregar(caminho);
    // --pesos professor:unidas:agrupar:movProfessor[:conflito]
    if let Some(p) = arg("--pesos") {
        let p: Vec<f64> = p.split(':').map(|x| x.parse().unwrap()).collect();
        regras.pesos = rust_wasm::horario::PesosFitness {
            professor: p[0], unidas: p[1], agrupar: p[2],
            professor_por_movimentos: p[3] != 0.0,
            conflito: p.get(4).copied().unwrap_or(p[0]),
            fixa: rust_wasm::horario::PesosFitness::PADRAO.fixa,
        };
    }
    let cfg = config_ga_horario(&regras);
    let ativos = regras.get_quadro_vazio().iter().filter(|&&v| v == 0).count();
    println!("{} turmas, {} disciplinas, {} professores, {} células ativas, pop {}, {:.1} M avaliações por semente",
        regras.turmas.len(), regras.disciplinas.len(), regras.professores.len(), ativos, cfg.population_size, orcamento as f64 / 1e6);

    let mut totais = [0usize; 4];
    for semente in 1..=sementes {
        fastrand::seed(semente);
        let mut ga = GeneticAlgorithm::new(regras.clone(), cfg.clone());
        ga.run(orcamento / cfg.population_size);
        let info = ga.get_info();
        let v = analisar(&regras, info.best_genes.as_ref().unwrap());
        println!("\nsemente {semente}: fitness {} | indisponível {} | conflito {} | unidas {} | divisão {}",
            info.best_fitness.unwrap(), v.prof_indisponivel.len(), v.prof_conflito.len(), v.unidas.len(), v.divisao.len());
        for (d, p) in &v.prof_indisponivel { println!("    indisponível: {p} em \"{d}\""); }
        for (p, quando, ds) in &v.prof_conflito { println!("    conflito: {p} em {quando}: {}", ds.join(" x ")); }
        for d in &v.unidas { println!("    unida fora do lugar: \"{d}\""); }
        for (d, pedacos, desvio) in &v.divisao { println!("    divisão {pedacos} (desvio {desvio}): \"{d}\""); }
        for (t, n) in totais.iter_mut().zip([v.prof_indisponivel.len(), v.prof_conflito.len(), v.unidas.len(), v.divisao.len()]) { *t += n; }
    }
    println!("\nTOTAL em {sementes} sementes: indisponível {} | conflito {} | unidas {} | divisão {}", totais[0], totais[1], totais[2], totais[3]);
}
