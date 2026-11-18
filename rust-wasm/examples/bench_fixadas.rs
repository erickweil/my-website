//! Benchmark da busca local com aulas fixadas (`horario_inicial.rs`).
//!
//! Para cada semente: aquece com uma busca local curta a partir de um quadro sorteado, fixa uma
//! fração das aulas que estão em células sem conflito (professor ou ambiente disponível e sem
//! outra aula dele no mesmo horário) e mede a busca a partir daí. Mesmas colunas do
//! `bench_busca_local`, para comparar.
//!
//! Uso: cargo run --release --example bench_fixadas -- <instancia.json> [opções]
//!   --fixar F       fração das aulas a fixar (padrão: 0.1)
//!   --aquecer N     segundos de busca antes de escolher as fixadas (padrão: 2)
//!   --ate-valido    aquece até o horário ficar válido (no máximo `--aquecer` segundos); a semente
//!                   em que ele não fica válido é pulada. Assim as fixadas saem de um horário que
//!                   atende a todas as regras obrigatórias, inclusive a divisão em blocos
//!   --partida P     sorteio: só as fixadas vêm do aquecimento, o resto é sorteado (como "Limpar" e
//!                   gerar); continuar: parte do quadro inteiro do aquecimento (como "Continuar")
//!   --peso P        custo de cada fixada fora do lugar (padrão: `PesosFitness::PADRAO.fixa`)
//!   --segundos N    orçamento da busca por semente (padrão: 20)
//!   --sementes N    número de sementes (padrão: 10)

use std::{env, fs, time::Instant};

use rust_wasm::{
    genetic::problems::GAProblem,
    horario::{BuscaLocal, PesosFitness, QuadroHorario, RegrasHorario, LISTA_PADRAO},
};

/// Células com aula que não têm conflito: todos os recursos disponíveis e sem outra aula deles no
/// mesmo dia e tempo.
fn celulas_sem_conflito(r: &RegrasHorario, q: &[i32]) -> Vec<usize> {
    let mut uso = std::collections::HashMap::<(usize, usize), u32>::new();
    let pos = |c: usize| c % (7 * r.n_tempos);
    for (c, &v) in q.iter().enumerate() {
        if let Some(d) = r.disciplina_em(v) {
            for &p in &r.disciplinas[d].professores {
                *uso.entry((p, pos(c))).or_default() += 1;
            }
        }
    }
    (0..q.len())
        .filter(|&c| {
            let Some(d) = r.disciplina_em(q[c]) else { return false };
            let (_, dia, tempo) = r.from_quadro_index(c);
            r.disciplinas[d].professores.iter().all(|&p| r.professores[p].horarios.get(dia, tempo) == 1 && uso[&(p, pos(c))] == 1)
        })
        .collect()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let arg = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let caminho = args.get(1).expect("informe a instância");
    let fracao: f64 = arg("--fixar").map_or(0.1, |s| s.parse().unwrap());
    let aquecer: f64 = arg("--aquecer").map_or(2.0, |s| s.parse().unwrap());
    let continuar = arg("--partida").as_deref() == Some("continuar");
    let segundos: f64 = arg("--segundos").map_or(20.0, |s| s.parse().unwrap());
    let sementes: u64 = arg("--sementes").map_or(10, |s| s.parse().unwrap());
    let ate_valido = args.iter().any(|a| a == "--ate-valido");
    let peso_fixa: f64 = arg("--peso").map_or(PesosFitness::PADRAO.fixa, |s| s.parse().unwrap());

    let texto = fs::read_to_string(caminho).unwrap();
    let entrada: serde_json::Value = serde_json::from_str(&texto).unwrap();
    let base = RegrasHorario::from_json(&texto).unwrap();
    let n_fixar = (base.aulas_a_alocar() as f64 * fracao).round() as usize;
    println!(
        "{caminho}: {} turmas, {} aulas | {n_fixar} fixadas ({:.0}%, {}), aquecimento {aquecer} s{}, partida: {}, {segundos} s por semente",
        base.turmas.len(), base.aulas_a_alocar(), fracao * 100.0,
        format!("peso {peso_fixa}"),
        if ate_valido { " (até válido)" } else { "" }, if continuar { "continuar" } else { "sorteio" }
    );
    println!("{:>7} {:>10} {:>12} {:>14} {:>10} {:>12} {:>10} {:>9}", "semente", "partida", "válido em", "movimentos", "final", "final em", "M mov/s", "sem confl.");

    let (mut validos, mut tempos) = (0, Vec::new());
    for semente in 1..=sementes {
        // Aquecimento (semente própria, para o resto da medição ser comparável ao bench_busca_local)
        fastrand::seed(1000 + semente);
        let mut aquece = BuscaLocal::new(&base, &base.genes_com_blocos(), 1, LISTA_PADRAO);
        let inicio = Instant::now();
        while inicio.elapsed().as_secs_f64() < aquecer && !aquece.executar(20_000) && !(ate_valido && aquece.valido()) {}
        if ate_valido && !aquece.valido() {
            println!("{semente:>7}   (aquecimento não chegou a um horário válido em {aquecer} s: semente pulada)");
            continue;
        }
        let quente: QuadroHorario = aquece.melhor().to_vec();

        let mut candidatas = celulas_sem_conflito(&base, &quente);
        let sem_conflito = candidatas.len();
        fastrand::shuffle(&mut candidatas);
        let fixas: std::collections::HashSet<usize> = candidatas.into_iter().take(n_fixar).collect();

        // O horário de partida: só as fixadas, ou o quadro inteiro com as fixadas marcadas
        let inicial: Vec<serde_json::Value> = (0..quente.len())
            .filter(|c| continuar || fixas.contains(c))
            .filter_map(|c| base.disciplina_em(quente[c]).map(|d| (c, d)))
            .filter(|&(_, d)| base.disciplinas[d].disciplinas_unidas.iter().all(|&u| u > d))
            .map(|(c, d)| {
                let (_, dia, tempo) = base.from_quadro_index(c);
                serde_json::json!({ "aula": base.aulas[base.disciplinas[d].aula], "dia": dia.sigla(), "tempo": tempo + 1, "fixa": fixas.contains(&c) })
            })
            .collect();
        let mut com_inicial = entrada.clone();
        com_inicial["inicial"] = serde_json::Value::Array(inicial);

        fastrand::seed(semente);
        let mut regras = RegrasHorario::from_json(&com_inicial.to_string()).unwrap();
        regras.pesos.fixa = peso_fixa;
        let partida_q = regras.quadro_inicial();
        let mut state = regras.initial_state();
        let partida = -regras.fitness(&mut state, &partida_q);

        let mut busca = BuscaLocal::new(&regras, &partida_q, 1, LISTA_PADRAO);
        let inicio = Instant::now();
        let (mut valido_em, mut melhor, mut melhor_em) = (None, busca.melhor_custo(), 0.0);
        loop {
            let resolvido = busca.executar(20_000);
            let agora = inicio.elapsed().as_secs_f64();
            if busca.melhor_custo() < melhor {
                melhor = busca.melhor_custo();
                melhor_em = agora;
            }
            if valido_em.is_none() && busca.valido() {
                valido_em = Some((agora, busca.iteracoes));
            }
            if resolvido || agora >= segundos {
                break;
            }
        }
        let total = inicio.elapsed().as_secs_f64();
        // Num horário válido as fixadas estão no lugar
        let fora = regras.fixas.iter().filter(|&&(c, v)| busca.melhor()[c] != v).count();
        assert!(fora == 0 || !busca.valido(), "{fora} fixadas fora do lugar num horário válido");
        if let Some((t, _)) = valido_em {
            validos += 1;
            tempos.push(t);
        }
        println!(
            "{:>7} {:>10.2} {:>12} {:>14} {:>10.4} {:>11.2}s {:>10.2} {:>9}",
            semente, partida,
            valido_em.map_or("-".to_string(), |(t, _)| format!("{t:.2}s")),
            valido_em.map_or("-".to_string(), |(_, n)| n.to_string()),
            busca.melhor_custo(), melhor_em, busca.iteracoes as f64 / total / 1e6, sem_conflito
        );
    }
    tempos.sort_by(|a, b| a.total_cmp(b));
    println!("válidos: {validos}/{sementes}{}", if tempos.is_empty() { String::new() } else { format!(" | tempo até válido: mediana {:.2}s, pior {:.2}s", tempos[tempos.len() / 2], tempos[tempos.len() - 1]) });
}
