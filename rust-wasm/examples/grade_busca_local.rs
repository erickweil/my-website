//! Benchmark em grade da busca local do horário: uma variante de parâmetros, várias instâncias e
//! sementes, uma linha CSV por execução. Feito para rodar com uma thread só (uma cadeia), para o
//! tempo não depender da máquina estar ocupada com outra coisa. Com `--cadeias N`, roda as cadeias
//! em paralelo como a página (o tempo passa a ser de relógio).
//!
//! Uso:
//!   cargo run --release --example grade_busca_local -- --nome base \
//!       --instancias media,grande,real-tecnico-v4-dias --sementes 5 --segundos 8 [parâmetros] [--cabecalho]
//!
//! Parâmetros (padrão = o da página, ver `ParametrosBusca`):
//!   --lista N  --p-bloco X  --listas-sem-melhora N  --folgas N  --folga-qualidade X
//!   --sair-dos-validos 0|1  --classica  --partida blocos|aleatoria  --crescer F  --lista-max N
//!   --recomecar (estacionou sem válido: recomeça de um quadro novo)
//!   --p-kempe X (cadeia de Kempe)  --kempe-de-blocos
//!   --cadeias N (cadeias em paralelo; o pool do rayon segue RAYON_NUM_THREADS)  --passo N
//!   --fatores a:b:c (fatores da lista por cadeia, ex. 1:0.5:2:1)
//!   --parar-no-valido (para ao atender às regras obrigatórias: mede só essa fase)
//!
//! Colunas: variante, instância, semente, segundos até o horário atender às regras obrigatórias e
//! movimentos até lá (vazio se não chegou), custo final e as violações e observações do melhor
//! quadro, movimentos e segundos totais, e o melhor custo em 1, 2, 4, 8, 16 e 32 s (vazio depois
//! do fim).

use std::{env, time::Instant};

use rust_wasm::{
    genetic::problems::GAProblem,
    horario::{AtualizacaoDaLista, BuscaLocal, ParametrosBusca, RegrasHorario},
};

const MARCOS: [f64; 6] = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0];

fn main() {
    let args: Vec<String> = env::args().collect();
    let arg = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let tem = |nome: &str| args.iter().any(|a| a == nome);

    let nome = arg("--nome").unwrap_or_else(|| "base".into());
    let instancias = arg("--instancias").unwrap_or_else(|| "media,grande,real-tecnico-v4-dias".into());
    let sementes: u64 = arg("--sementes").map_or(5, |s| s.parse().unwrap());
    let primeira: u64 = arg("--primeira-semente").map_or(1, |s| s.parse().unwrap());
    let segundos: f64 = arg("--segundos").map_or(8.0, |s| s.parse().unwrap());
    let padrao = ParametrosBusca::default();
    let p = ParametrosBusca {
        lista: arg("--lista").map_or(padrao.lista, |s| s.parse().unwrap()),
        p_bloco: arg("--p-bloco").map_or(padrao.p_bloco, |s| s.parse().unwrap()),
        listas_sem_melhora: arg("--listas-sem-melhora").map_or(padrao.listas_sem_melhora, |s| s.parse().unwrap()),
        folgas: arg("--folgas").map_or(padrao.folgas, |s| s.parse().unwrap()),
        folga_de_qualidade: arg("--folga-qualidade").map_or(padrao.folga_de_qualidade, |s| s.parse().unwrap()),
        sair_dos_validos: arg("--sair-dos-validos").map_or(padrao.sair_dos_validos, |s| s == "1"),
        atualizacao: if tem("--classica") { AtualizacaoDaLista::Classica } else { padrao.atualizacao },
        crescer_lista: arg("--crescer").map_or(padrao.crescer_lista, |s| s.parse().unwrap()),
        lista_max: arg("--lista-max").map_or(padrao.lista_max, |s| s.parse().unwrap()),
        recomecar: tem("--recomecar"),
        p_kempe: arg("--p-kempe").map_or(padrao.p_kempe, |s| s.parse().unwrap()),
        kempe_de_blocos: tem("--kempe-de-blocos"),
        fatores_da_lista: arg("--fatores").map_or(padrao.fatores_da_lista, |s| {
            Box::leak(s.split(':').map(|x| x.parse().unwrap()).collect::<Vec<f64>>().into_boxed_slice())
        }),
    };
    let parar_no_valido = tem("--parar-no-valido");
    let cadeias: usize = arg("--cadeias").map_or(1, |s| s.parse().unwrap());
    // Movimentos por cadeia entre duas sincronizações (a página usa 20 mil)
    let passo: u64 = arg("--passo").map_or(if cadeias > 1 { 20_000 } else { 2_000 }, |s| s.parse().unwrap());
    let aleatoria = arg("--partida").is_some_and(|s| s == "aleatoria");

    if tem("--cabecalho") {
        println!("variante,instancia,semente,valido_s,valido_mov,custo,violacoes,observacoes,movimentos,segundos,c1,c2,c4,c8,c16,c32");
    }
    let dir = format!("{}/tests/instancias", env!("CARGO_MANIFEST_DIR"));
    for instancia in instancias.split(',') {
        let regras = RegrasHorario::de_arquivo(&format!("{dir}/{instancia}.json"));
        for semente in primeira..primeira + sementes {
            fastrand::seed(semente);
            let inicial = if aleatoria { regras.random_genes() } else { regras.genes_com_blocos() };
            let mut busca = BuscaLocal::com_parametros(&regras, &inicial, cadeias, p);
            let inicio = Instant::now();
            let mut valido: Option<(f64, u64)> = None;
            let mut marcos = [None; MARCOS.len()];
            let mut proximo = 0;
            loop {
                // Blocos pequenos: o tempo até válido sai com precisão de ~1 ms
                let resolvido = busca.executar(passo);
                let agora = inicio.elapsed().as_secs_f64();
                while proximo < MARCOS.len() && agora >= MARCOS[proximo] {
                    marcos[proximo] = Some(busca.melhor_custo());
                    proximo += 1;
                }
                if valido.is_none() && busca.valido() {
                    valido = Some((agora, busca.iteracoes));
                }
                if resolvido || agora >= segundos || (parar_no_valido && valido.is_some()) {
                    break;
                }
            }
            let total = inicio.elapsed().as_secs_f64();
            // Depois de parar (custo 0), os marcos seguintes valem o custo final
            if busca.resolvido() {
                for m in marcos.iter_mut().take(MARCOS.iter().filter(|&&s| s <= segundos).count()) {
                    m.get_or_insert(0.0);
                }
            }
            let observacoes = regras.qualidade(busca.melhor()).1.len();
            let custo = busca.melhor_custo();
            let fmt = |x: Option<f64>| x.map_or(String::new(), |v| format!("{v:.6}"));
            println!(
                "{nome},{instancia},{semente},{},{},{custo:.6},{},{observacoes},{},{total:.3},{}",
                valido.map_or(String::new(), |(t, _)| format!("{t:.3}")),
                valido.map_or(String::new(), |(_, m)| m.to_string()),
                busca.violacoes_do_melhor(),
                busca.iteracoes,
                marcos.iter().map(|&m| fmt(m)).collect::<Vec<_>>().join(","),
            );
        }
    }
}
