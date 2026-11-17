//! Benchmark da busca local do horário (`horario_busca_local.rs`).
//!
//! Para cada semente: de que custo partiu, em quanto tempo chegou a um horário válido (sem
//! violação obrigatória) e o custo no fim. O custo é o fitness do genético com o sinal trocado;
//! abaixo de 20 só restam regras de qualidade.
//!
//! Uso: cargo run --release --example bench_busca_local -- <instancia.json> [opções]
//!
//! De onde a busca parte (padrão: um quadro sorteado com os blocos montados, o mesmo da população
//! inicial do genético):
//!   --de ARQ       um quadro em arquivo, no formato `{ turma: { dia: [aula por tempo] } }`
//!   --ga N         o melhor quadro do genético depois de N segundos (configuração da página)
//!
//!   --segundos N   orçamento da busca local por semente (padrão: 20)
//!   --sementes N   número de sementes (padrão: 5)
//!   --lista N      comprimento da lista do late acceptance (padrão: LISTA_PADRAO)
//!   --cadeias N    buscas independentes em paralelo (padrão: 1)

use std::{collections::HashMap, env, fs, time::Instant};

use rust_wasm::{
    genetic::{ga::GeneticAlgorithm, problems::GAProblem},
    horario::{config_ga_horario, BuscaLocal, DiaSemana, QuadroHorario, RegrasHorario, LISTA_PADRAO},
};

/// Lê um quadro `{ turma: { dia: [aula por tempo] } }`; o que sobra marcado sem aula fica vago.
fn carregar_quadro(regras: &RegrasHorario, caminho: &str) -> QuadroHorario {
    let texto = fs::read_to_string(caminho).unwrap_or_else(|e| panic!("não foi possível ler '{caminho}': {e}"));
    let dados: HashMap<String, HashMap<String, Vec<Option<String>>>> = serde_json::from_str(&texto).expect("quadro com formato inválido");
    let mut quadro = regras.get_quadro_vazio();
    for (nome_turma, dias) in &dados {
        let turma = regras.turmas.iter().find(|t| &t.nome == nome_turma).unwrap_or_else(|| panic!("turma '{nome_turma}' não existe na instância"));
        for (dia, tempos) in dias {
            let dia = DiaSemana::try_from(dia.as_str()).unwrap_or_else(|d| panic!("dia '{d}' inválido"));
            for (tempo, aula) in tempos.iter().enumerate().take(regras.n_tempos) {
                let Some(aula) = aula else { continue };
                let d = regras.disciplinas.iter().find(|d| &d.nome == aula && d.turma_id == turma.id)
                    .unwrap_or_else(|| panic!("aula '{aula}' não existe na turma '{nome_turma}'"));
                quadro[regras.to_quadro_index(turma.id, dia, tempo)] = d.id as i32 + 1;
            }
        }
    }
    for v in quadro.iter_mut().filter(|v| **v == 0) {
        *v = regras.vago();
    }
    quadro
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let arg = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let caminho = args.get(1).expect("informe a instância");
    let regras = RegrasHorario::de_arquivo(caminho);
    let de = arg("--de");
    let ga_segundos: Option<f64> = arg("--ga").map(|s| s.parse().unwrap());
    let segundos: f64 = arg("--segundos").map_or(20.0, |s| s.parse().unwrap());
    let sementes: u64 = arg("--sementes").map_or(5, |s| s.parse().unwrap());
    let lista: usize = arg("--lista").map_or(LISTA_PADRAO, |s| s.parse().unwrap());
    let cadeias: usize = arg("--cadeias").map_or(1, |s| s.parse().unwrap());

    println!("{caminho}: {} turmas, {} aulas | lista {lista}, {cadeias} cadeia(s), {segundos} s por semente", regras.turmas.len(), regras.aulas_a_alocar());
    println!("{:>7} {:>10} {:>12} {:>14} {:>10} {:>12} {:>10}", "semente", "partida", "válido em", "movimentos", "final", "final em", "M mov/s");

    let mut state = regras.initial_state();
    let (mut validos, mut tempos) = (0, Vec::new());
    for semente in 1..=sementes {
        fastrand::seed(semente);
        let inicial = match (&de, ga_segundos) {
            (Some(arquivo), _) => carregar_quadro(&regras, arquivo),
            (None, Some(s)) => {
                let mut ga = GeneticAlgorithm::new(regras.clone(), config_ga_horario(&regras));
                let inicio = Instant::now();
                while inicio.elapsed().as_secs_f64() < s && ga.get_info().best_fitness != Some(0.0) {
                    ga.run(20);
                }
                ga.get_info().best_genes.expect("o genético tem um melhor quadro")
            }
            (None, None) => regras.genes_com_blocos(),
        };
        let partida = -regras.fitness(&mut state, &inicial);

        let mut busca = BuscaLocal::new(&regras, &inicial, cadeias, lista);
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
        // Conferência: o custo que a busca diz é o fitness do quadro que ela entrega
        let conferido = -regras.fitness_rapido(&mut state, busca.melhor());
        assert_eq!(conferido, busca.melhor_custo(), "custo incremental diferente do fitness");

        if let Some((t, _)) = valido_em {
            validos += 1;
            tempos.push(t);
        }
        let q = regras.qualidade(busca.melhor()).0;
        println!("{:>7} {:>10.2} {:>12} {:>14} {:>10.4} {:>11.2}s {:>10.2}   evitar {} jornada {}min descanso {}min intervalo {} turno {} janela {}",
            semente, partida,
            valido_em.map_or("-".to_string(), |(t, _)| format!("{t:.2}s")),
            valido_em.map_or("-".to_string(), |(_, n)| n.to_string()),
            busca.melhor_custo(), melhor_em, busca.iteracoes as f64 / total / 1e6,
            q.evitar, q.jornada_min, q.descanso_min, q.intervalo, q.troca_de_turno, q.janela);
    }
    tempos.sort_by(|a, b| a.total_cmp(b));
    println!("válidos: {validos}/{sementes}{}", if tempos.is_empty() { String::new() } else { format!(" | tempo até válido: mediana {:.2}s, pior {:.2}s", tempos[tempos.len() / 2], tempos[tempos.len() - 1]) });
}
