//! Busca local do horário: parte de um quadro completo (com violações) e o melhora por pequenos
//! movimentos, aceitando às vezes um movimento que piora para sair de onde o algoritmo genético
//! fica preso.
//!
//! # Por que existe
//!
//! O genético chega perto e para: sobram poucas aulas fora de bloco ou em choque, e consertar uma
//! delas exige mover três ou quatro aulas em sequência, passando por quadros piores que o atual. A
//! seleção do genético descarta esses quadros de passagem. Aqui o critério de aceitação
//! (*late acceptance*, Burke e Bykov) compara o quadro novo com o custo de algumas milhares de
//! iterações atrás, e por isso tolera a piora temporária.
//!
//! # Como funciona
//!
//! - **Movimentos**, sempre dentro de uma turma (o conjunto de aulas de cada turma não muda, como
//!   nos operadores do genético): trocar duas aulas de lugar, ou trocar um grupo de aulas seguidas
//!   da mesma disciplina com outro trecho do mesmo tamanho. Numa aula em conjunto, a troca é
//!   repetida nas turmas que participam.
//! - **Custo**: o mesmo número do fitness do genético com o sinal trocado
//!   ([`RegrasHorario::fitness_rapido`]), com as mesmas regras obrigatórias, as mesmas regras de
//!   qualidade e os mesmos pesos. 0 = nada a melhorar. As aulas fixadas são uma regra obrigatória
//!   como as outras (ver [`PesosFitness::fixa`]): nenhum movimento é proibido.
//! - **Avaliação incremental**: o fitness percorre o quadro inteiro; aqui cada regra guarda a sua
//!   contagem e um movimento recalcula só o que tocou (os recursos das aulas movidas, as
//!   disciplinas agrupadas, as linhas e os turnos das células). Os testes conferem, movimento a
//!   movimento, que o custo incremental é igual ao fitness calculado do zero.
//! - **Cadeias**: várias buscas independentes a partir do mesmo quadro, com sorteios diferentes,
//!   uma por thread quando há pool. Vale a melhor.

use std::sync::Arc;

use rayon::prelude::*;

use crate::{
    horario::{
        horario_avaliacao::AvaliacaoIncremental as Avaliacao,
        horario_movimentos::{sortear_movimento, RascunhoMovimentos},
        horario_tabelas::TabelasHorario,
        ConfigMovimentos, QuadroHorario, RegrasHorario,
    },
    paralelo::pool_disponivel,
};

/// Comprimento da lista do late acceptance: com quantas iterações de atraso o custo é comparado.
/// Maior = aceita piorar por mais tempo (explora mais, converge mais devagar).
///
/// Medido no técnico real (19 turmas, 614 aulas), 10 sementes, a partir do quadro em que o
/// genético para: ver `examples/bench_busca_local.rs`.
pub const LISTA_PADRAO: usize = 5_000;

/// Os números que regulam a busca. O padrão é o que a página usa; os outros valores servem aos
/// benchmarks (`examples/grade_busca_local.rs`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ParametrosBusca {
    /// Comprimento da lista do late acceptance (ver [`LISTA_PADRAO`]).
    pub lista: usize,
    /// Configuração dos operadores de movimento (blocos, aulas em conjunto, cadeias de Kempe).
    pub movimentos: ConfigMovimentos,
    /// Sem melhorar o melhor quadro por este número de listas inteiras, a busca estacionou (o late
    /// acceptance só aceita piorar enquanto a lista tem custos mais altos que o atual). A cadeia
    /// então volta para o melhor quadro com uma folga: a lista é preenchida com o custo dele mais a
    /// folga, e por uma lista inteira ela pode piorar até ali. Ver [`Cadeia::folga`].
    pub listas_sem_melhora: u64,
    /// Número de folgas diferentes: depois da maior, volta para a menor.
    pub folgas: u32,
    /// Folga na escala da qualidade: fração do custo do melhor quadro, por degrau.
    pub folga_de_qualidade: f64,
    /// Com o melhor quadro válido, as voltas alternam entre folga de qualidade e folga de violações
    /// obrigatórias (sair dos válidos e voltar por outro caminho). false = só folga de qualidade.
    pub sair_dos_validos: bool,
    pub atualizacao: AtualizacaoDaLista,
    /// A cada volta ao melhor quadro, a lista é multiplicada por este fator (1 = não cresce), até
    /// `lista_max`: começa curta (rápida nos quadros fáceis) e fica longa nos difíceis.
    pub crescer_lista: f64,
    pub lista_max: usize,
    /// Estacionou sem chegar a um horário válido: em vez de voltar ao melhor quadro, recomeça de
    /// um quadro novo (uma descida nova). A parada passa a contar o progresso da tentativa atual.
    pub recomecar: bool,
    /// Com várias cadeias, o comprimento da lista de cada uma é `lista` vezes um destes fatores,
    /// em rodízio (ver [`FATORES_DA_LISTA`]).
    pub fatores_da_lista: &'static [f64],
}

impl Default for ParametrosBusca {
    fn default() -> Self {
        Self {
            lista: LISTA_PADRAO,
            movimentos: ConfigMovimentos::default(),
            listas_sem_melhora: 100,
            folgas: 6,
            folga_de_qualidade: 0.05,
            sair_dos_validos: true,
            atualizacao: AtualizacaoDaLista::SoBaixa,
            crescer_lista: 1.0,
            lista_max: LISTA_PADRAO,
            recomecar: false,
            fatores_da_lista: &FATORES_DA_LISTA,
        }
    }
}

/// Com várias cadeias, o comprimento da lista de cada uma é o pedido vezes um destes fatores, em
/// rodízio: listas curtas resolvem depressa os quadros fáceis, as longas insistem nos difíceis.
/// Com a lista padrão: 5000, 2500, 1000, 20000. A ordem importa porque com menos cadeias só os
/// primeiros entram (com 2: 5000 e 2500).
///
/// Medido com 4 cadeias em threads (`docs/estudo-busca-local.md` §8, sementes novas): contra os
/// fatores anteriores `[1, 0,5, 2, 1]`, a instância média caiu de 0,25 para 0,10 s, a grande de
/// 1,03 para 0,84 s e o técnico real v3 de 1,10 para 0,46 s; o v4 chegou a válido nas mesmas
/// 10 de 12 sementes, com mediana de 2,1 s em vez de 3,1 s.
pub const FATORES_DA_LISTA: [f64; 4] = [1.0, 0.5, 0.2, 4.0];

/// Como a lista do late acceptance é atualizada depois de cada iteração.
///
/// Medido em 17/11/2026 (`bench_busca_local`, 10 sementes, uma cadeia, lista 5000, 20 s), tempo até
/// um horário válido (mediana) e quantas sementes chegaram lá:
///
/// | Instância | `SoBaixa` | `Classica` |
/// | :--- | :--- | :--- |
/// | média (10 turmas) | 0,27 s, 10/10 | 1,28 s, 10/10 |
/// | grande (25 turmas) | 0,75 s, 10/10 | 9,75 s, 6/10 |
/// | técnico real v3 (19 turmas) | 1,59 s, 10/10 | 2,49 s, 10/10 |
/// | técnico real v4 (19 turmas) | 3,63 s, 5/10 | 3,03 s, 4/10 |
///
/// O custo final de qualidade ficou igual nas duas. Por isso o padrão é `SoBaixa`; a clássica fica
/// para comparação (`--classica` no benchmark).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AtualizacaoDaLista {
    /// Só baixa: `L[k] ← min(L[k], custo atual)`, e o candidato precisa ser estritamente melhor que
    /// `L[k]`.
    SoBaixa,
    /// Como no artigo de Burke e Bykov: `L[k] ← custo atual` sempre (a lista pode subir), e aceita
    /// o candidato que não piora em relação a `L[k]`.
    Classica,
}

type Tabelas = TabelasHorario;

/// Uma busca: um quadro andando por movimentos, e o melhor quadro por onde ela passou.
#[derive(Clone)]
struct Cadeia {
    atual: Avaliacao,
    custo: f64,
    melhor: QuadroHorario,
    melhor_custo: f64,
    /// Violações obrigatórias do melhor quadro (0 = válido).
    melhor_violacoes: i64,
    /// Lista do late acceptance: o custo de `lista.len()` iterações atrás.
    lista: Vec<f64>,
    iteracao: u64,
    /// Iteração em que o melhor quadro melhorou pela última vez, ou em que a cadeia voltou para ele.
    melhorou_em: u64,
    /// Com `p.recomecar`: o melhor custo da tentativa atual e quando ele melhorou.
    melhor_da_tentativa: f64,
    melhorou_a_tentativa_em: u64,
    /// Degrau da folga da próxima volta ao melhor quadro, de 1 a `p.folgas` (ver [`Self::folga`]).
    degrau: u32,
    rng: fastrand::Rng,
    /// Buffers dos movimentos sorteados (trocas, cadeia de Kempe).
    movimentos: RascunhoMovimentos,
    p: ParametrosBusca,
}

impl Cadeia {
    fn new(t: &Tabelas, atual: Avaliacao, lista: usize, semente: u64) -> Self {
        let custo = atual.custo(t);
        Self {
            melhor: atual.quadro.clone(),
            melhor_custo: custo,
            melhor_violacoes: atual.violacoes(),
            lista: vec![custo; lista.max(1)],
            iteracao: 0,
            melhorou_em: 0,
            melhor_da_tentativa: custo,
            melhorou_a_tentativa_em: 0,
            degrau: 1,
            rng: fastrand::Rng::with_seed(semente),
            movimentos: RascunhoMovimentos::new(t.n_turmas),
            p: ParametrosBusca::default(),
            atual,
            custo,
        }
    }

    /// Sorteia um movimento e deixa as trocas dele em `self.movimentos.trocas`. Retorna false se o
    /// sorteio não deu em movimento nenhum (conta como uma iteração sem efeito).
    #[inline]
    fn sortear(&mut self, t: &Tabelas) -> bool {
        sortear_movimento(t, &self.atual.quadro, self.p.movimentos, &mut self.movimentos, &mut self.rng)
    }

    /// Uma iteração: sorteia um movimento, aplica, e desfaz se o late acceptance não aceitar (aceita
    /// o que não piora o quadro atual, ou o que é melhor que o custo de uma lista atrás).
    #[inline]
    fn passo(&mut self, t: &Tabelas, regras: &RegrasHorario) {
        let k = (self.iteracao % self.lista.len() as u64) as usize;
        let classica = self.p.atualizacao == AtualizacaoDaLista::Classica;
        // O candidato passa pela lista? (`custo` = o dele, ou um mínimo dele)
        let passa_na_lista = |custo: f64, lista: f64| if classica { custo <= lista } else { custo < lista };
        if self.sortear(t) {
            for &(a, b) in &self.movimentos.trocas {
                self.atual.trocar(t, a as usize, b as usize);
            }
            // Só com as regras obrigatórias já dá para recusar a maioria: a qualidade só soma custo
            self.atual.acertar_obrigatorias(t);
            let minimo = self.atual.custo_obrigatorio(t);
            if minimo > self.custo && !passa_na_lista(minimo, self.lista[k]) {
                for &(a, b) in self.movimentos.trocas.iter().rev() {
                    self.atual.trocar(t, a as usize, b as usize);
                }
                self.atual.desfazer_obrigatorias();
            } else {
                self.atual.acertar_qualidade(t);
                let novo = self.atual.custo(t);
                if novo <= self.custo || passa_na_lista(novo, self.lista[k]) {
                    self.custo = novo;
                    if novo < self.melhor_da_tentativa {
                        self.melhor_da_tentativa = novo;
                        self.melhorou_a_tentativa_em = self.iteracao;
                    }
                    if novo < self.melhor_custo {
                        self.melhor_custo = novo;
                        self.melhor_violacoes = self.atual.violacoes();
                        self.melhor.clone_from(&self.atual.quadro);
                        self.melhorou_em = self.iteracao;
                        self.degrau = 1;
                    }
                } else {
                    for &(a, b) in self.movimentos.trocas.iter().rev() {
                        self.atual.trocar(t, a as usize, b as usize);
                    }
                    self.atual.acertar(t);
                }
            }
        }
        if classica || self.custo < self.lista[k] {
            self.lista[k] = self.custo;
        }
        self.iteracao += 1;

        // Estacionou sem horário válido e com `recomecar`: uma tentativa nova, de um quadro novo
        let limite = self.p.listas_sem_melhora.saturating_mul(self.lista.len() as u64);
        if self.p.recomecar && self.melhor_violacoes > 0 {
            if self.iteracao - self.melhorou_a_tentativa_em > limite {
                fastrand::seed(self.rng.u64(..));
                self.atual = Avaliacao::new(t, regras.genes_com_blocos());
                self.custo = self.atual.custo(t);
                if self.p.crescer_lista > 1.0 {
                    let n = ((self.lista.len() as f64 * self.p.crescer_lista) as usize).min(self.p.lista_max.max(self.lista.len()));
                    self.lista.resize(n, self.custo);
                }
                self.lista.fill(self.custo);
                self.melhor_da_tentativa = self.custo;
                self.melhorou_a_tentativa_em = self.iteracao;
                self.melhorou_em = self.iteracao;
            }
            return;
        }

        // Estacionou: volta para o melhor quadro, com folga para piorar
        if self.iteracao - self.melhorou_em > limite {
            if self.atual.quadro != self.melhor {
                self.atual = Avaliacao::new(t, self.melhor.clone());
            }
            self.custo = self.melhor_custo;
            let teto = self.melhor_custo + self.folga(t);
            if self.p.crescer_lista > 1.0 {
                let n = ((self.lista.len() as f64 * self.p.crescer_lista) as usize).min(self.p.lista_max.max(self.lista.len()));
                self.lista.resize(n, teto);
            }
            self.lista.fill(teto);
            self.degrau = self.degrau % self.p.folgas.max(1) + 1;
            self.melhorou_em = self.iteracao;
        }
    }

    /// Quanto a cadeia pode piorar ao voltar para o melhor quadro. Cresce a cada volta que não
    /// adianta e recomeça quando o melhor quadro melhora.
    ///
    /// - Melhor quadro com violação: 1, 2, 3… violações obrigatórias (da regra de menor peso).
    /// - Melhor quadro válido: as voltas se alternam entre uma folga pequena, na escala da
    ///   qualidade (a busca fica só entre horários válidos, trocando uma observação por outra), e
    ///   uma de violações obrigatórias (sai dos válidos e volta por outro caminho).
    fn folga(&self, t: &Tabelas) -> f64 {
        if self.melhor_violacoes == 0 && !self.p.sair_dos_validos {
            self.melhor_custo * self.p.folga_de_qualidade * self.degrau as f64
        } else if self.melhor_violacoes == 0 && self.degrau % 2 == 1 {
            self.melhor_custo * self.p.folga_de_qualidade * self.degrau.div_ceil(2) as f64
        } else if self.melhor_violacoes == 0 {
            (self.degrau / 2) as f64 * t.menor_obrigatoria
        } else {
            self.degrau as f64 * t.menor_obrigatoria
        }
    }
}

/// Busca local a partir de um quadro: uma ou mais cadeias independentes.
pub struct BuscaLocal {
    regras: RegrasHorario,
    tabelas: Arc<Tabelas>,
    cadeias: Vec<Cadeia>,
    /// Iterações feitas, somando as cadeias.
    pub iteracoes: u64,
}

impl BuscaLocal {
    /// `inicial`: um quadro completo, como os do genético ([`RegrasHorario::genes_com_blocos`] ou o
    /// melhor de uma população). `cadeias`: quantas buscas independentes saem dele (uma por thread
    /// rende mais). `lista`: ver [`LISTA_PADRAO`]; com mais de uma cadeia, ver [`FATORES_DA_LISTA`].
    ///
    /// Os sorteios de cada cadeia saem do gerador global (`fastrand`): fixar a semente dele antes
    /// fixa a busca inteira, com qualquer número de threads.
    pub fn new(regras: &RegrasHorario, inicial: &[i32], cadeias: usize, lista: usize) -> Self {
        Self::com_parametros(regras, inicial, cadeias, ParametrosBusca { lista, ..Default::default() })
    }

    /// Como [`Self::new`], com todos os parâmetros (`p.lista` é o comprimento da lista).
    pub fn com_parametros(regras: &RegrasHorario, inicial: &[i32], cadeias: usize, p: ParametrosBusca) -> Self {
        let lista = p.lista;
        let tabelas = Arc::new(Tabelas::new(regras));
        let avaliacao = Avaliacao::new(&tabelas, inicial.to_vec());
        let cadeias = (0..cadeias.max(1))
            .map(|i| {
                let fatores = if p.fatores_da_lista.is_empty() { &[1.0][..] } else { p.fatores_da_lista };
                let lista = (lista as f64 * fatores[i % fatores.len()]) as usize;
                let mut c = Cadeia::new(&tabelas, avaliacao.clone(), lista, fastrand::u64(..));
                c.p = p;
                c
            })
            .collect();
        Self { regras: regras.clone(), tabelas, cadeias, iteracoes: 0 }
    }

    /// Troca a regra de atualização da lista do late acceptance (padrão: [`AtualizacaoDaLista::SoBaixa`]).
    pub fn com_atualizacao(mut self, atualizacao: AtualizacaoDaLista) -> Self {
        for c in &mut self.cadeias {
            c.p.atualizacao = atualizacao;
        }
        self
    }

    /// Faz `iteracoes` movimentos em cada cadeia (em paralelo, se há pool de threads). Para antes
    /// se alguma cadeia chegar a custo 0. Retorna true se chegou.
    pub fn executar(&mut self, iteracoes: u64) -> bool {
        if self.resolvido() {
            return true;
        }
        let t = &*self.tabelas;
        let r = &self.regras;
        let rodar = |c: &mut Cadeia| {
            for _ in 0..iteracoes {
                c.passo(t, r);
                if c.melhor_custo <= 0.0 { break; }
            }
        };
        let antes: u64 = self.cadeias.iter().map(|c| c.iteracao).sum();
        if self.cadeias.len() > 1 && pool_disponivel() {
            self.cadeias.par_iter_mut().for_each(rodar);
        } else {
            self.cadeias.iter_mut().for_each(rodar);
        }
        self.iteracoes += self.cadeias.iter().map(|c| c.iteracao).sum::<u64>() - antes;
        self.resolvido()
    }

    fn melhor_cadeia(&self) -> &Cadeia {
        self.cadeias.iter().min_by(|a, b| a.melhor_custo.total_cmp(&b.melhor_custo)).expect("há pelo menos uma cadeia")
    }

    /// O melhor quadro encontrado até agora.
    pub fn melhor(&self) -> &[i32] {
        &self.melhor_cadeia().melhor
    }

    /// O custo do melhor quadro: o fitness dele com o sinal trocado.
    pub fn melhor_custo(&self) -> f64 {
        self.melhor_cadeia().melhor_custo
    }

    /// true se o melhor quadro não quebra nenhuma regra obrigatória.
    pub fn valido(&self) -> bool {
        self.melhor_cadeia().melhor_violacoes == 0
    }

    /// Unidades de violação das regras obrigatórias no melhor quadro (0 = válido).
    pub fn violacoes_do_melhor(&self) -> i64 {
        self.melhor_cadeia().melhor_violacoes
    }

    /// true se o melhor quadro atende a todas as regras, obrigatórias e de qualidade.
    pub fn resolvido(&self) -> bool {
        self.melhor_custo() <= 0.0
    }

    pub fn cadeias(&self) -> usize {
        self.cadeias.len()
    }

    /// true se as cadeias estão rodando em threads diferentes.
    pub fn usando_threads(&self) -> bool {
        self.cadeias.len() > 1 && pool_disponivel()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::problems::GAProblem;
    use crate::horario::PesosFitness;
    use wasm_bindgen_test::*;

    fn instancia(nome: &str) -> RegrasHorario {
        RegrasHorario::de_arquivo(&format!("{}/tests/instancias/{nome}.json", env!("CARGO_MANIFEST_DIR")))
    }

    /// Movimento a movimento, aceito ou desfeito, o custo incremental é exatamente o fitness
    /// calculado do zero, e as contagens de qualidade são as de `medir`.
    fn conferir_incremental(regras: &RegrasHorario, movimentos: usize) {
        conferir_incremental_com(regras, movimentos, AtualizacaoDaLista::SoBaixa);
    }

    fn conferir_incremental_com(regras: &RegrasHorario, movimentos: usize, atualizacao: AtualizacaoDaLista) {
        fastrand::seed(7);
        let t = Tabelas::new(regras);
        let mut state = regras.initial_state();
        let mut c = Cadeia::new(&t, Avaliacao::new(&t, regras.random_genes()), 50, 11);
        c.p.atualizacao = atualizacao;
        assert_eq!(c.custo, -regras.fitness(&mut state, &c.atual.quadro), "custo inicial");
        for i in 0..movimentos {
            c.passo(&t, regras);
            let esperado = -regras.fitness(&mut state, &c.atual.quadro);
            assert_eq!(c.atual.custo(&t), esperado, "custo depois do movimento {i}");
            assert_eq!(c.custo, esperado, "custo guardado depois do movimento {i}");
            if i % 97 == 0 {
                assert_eq!(c.atual.q, regras.qualidade(&c.atual.quadro).0, "qualidade depois do movimento {i}");
                assert_eq!(c.melhor_custo, -regras.fitness(&mut state, &c.melhor), "custo do melhor quadro");
            }
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_igual_ao_fitness() {
        // faculdade: horas, intervalos e ambientes; pequena e média: aulas em conjunto e blocos
        for nome in ["faculdade-anonimizado", "pequena", "media"] {
            conferir_incremental(&instancia(nome), 3000);
        }
    }

    /// Cadeia de Kempe (de um horário e de blocos): o custo incremental continua igual ao fitness e cada
    /// turma continua com as mesmas aulas.
    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_com_kempe() {
        for nome in ["faculdade-anonimizado", "pequena", "media"] {
            let regras = instancia(nome);
            fastrand::seed(9);
            let t = Tabelas::new(&regras);
            let mut state = regras.initial_state();
            let inicial = regras.random_genes();
            let mut c = Cadeia::new(&t, Avaliacao::new(&t, inicial.clone()), 50, 13);
            c.p.movimentos.p_kempe = 0.5;
            c.p.movimentos.kempe_de_blocos = nome != "media";
            for i in 0..3000 {
                c.passo(&t, &regras);
                assert_eq!(c.atual.custo(&t), -regras.fitness(&mut state, &c.atual.quadro), "{nome}: custo depois do movimento {i}");
            }
            let por_turma = t.por_turma;
            for u in 0..regras.turmas.len() {
                let conta = |q: &[i32]| { let mut v = q[u * por_turma..(u + 1) * por_turma].to_vec(); v.sort(); v };
                assert_eq!(conta(&c.atual.quadro), conta(&inicial), "{nome}: a turma {u} mudou de aulas");
            }
        }
    }

    /// Aulas fixadas, uma parte delas fora do lugar no começo.
    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_com_fixadas() {
        let mut regras = instancia("media");
        fastrand::seed(3);
        let outro = regras.genes_com_blocos();
        regras.fixas = (0..outro.len()).step_by(5).filter(|&c| regras.disciplina_em(outro[c]).is_some()).map(|c| (c, outro[c])).collect();
        assert!(!regras.fixas.is_empty());
        conferir_incremental(&regras, 3000);
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_igual_ao_fitness_com_a_lista_classica() {
        conferir_incremental_com(&instancia("pequena"), 3000, AtualizacaoDaLista::Classica);
    }

    /// Espalhar (regra de qualidade por linha) em todas as disciplinas.
    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_com_espalhar() {
        for nome in ["faculdade-anonimizado", "pequena", "media"] {
            let mut regras = instancia(nome);
            for d in &mut regras.disciplinas {
                d.espalhar = d.aulas > 1;
            }
            conferir_incremental(&regras, 3000);
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_igual_ao_fitness_com_o_professor_por_aula() {
        let mut regras = instancia("pequena");
        regras.pesos = PesosFitness { professor_por_movimentos: false, professor: 50.0, ..PesosFitness::PADRAO };
        conferir_incremental(&regras, 3000);
    }

    /// Horários vagos, horários a evitar e jornada: as regras de qualidade que as instâncias de
    /// arquivo não exercitam.
    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_com_vagos_e_evitar() {
        let tempos = [(420, 470, "m"), (470, 520, "m"), (520, 570, "m"), (590, 640, "m"), (780, 830, "t"), (830, 880, "t"), (1140, 1190, "n"), (1190, 1240, "n")]
            .map(|(i, f, t)| format!(r#"{{ "inicio": {i}, "fim": {f}, "turno": "{t}" }}"#))
            .join(", ");
        let todos = "[1, 2, 3, 4, 5, 6, 7, 8]";
        let regras = RegrasHorario::from_json(&format!(r#"{{
            "turmas": [
                {{ "id": "A", "horarios": {{ "seg": {todos}, "ter": {todos}, "qua": [1, 2, 3, 4] }} }},
                {{ "id": "B", "horarios": {{ "seg": {todos}, "ter": [1, 2, 3, 4, 7, 8], "qua": {todos} }} }}
            ],
            "aulas": [
                {{ "id": "Mat A", "turmas": ["A"], "recursos": ["P1", "S"], "aulasSemana": 6, "divisao": {{ "tamanhoMin": 2, "tamanhoMax": 2 }} }},
                {{ "id": "Port A", "turmas": ["A"], "recursos": ["P2"], "aulasSemana": 5 }},
                {{ "id": "Fis", "turmas": ["A", "B"], "recursos": ["P3", "S"], "aulasSemana": 3, "divisao": {{ "tamanhoMin": 3 }} }},
                {{ "id": "Mat B", "turmas": ["B"], "recursos": ["P1"], "aulasSemana": 8, "divisao": {{ "tamanhoMin": 2, "porTamanho": [{{ "tamanho": 3, "min": 0, "max": 0 }}, {{ "tamanho": 5, "min": 0, "max": 0 }}, {{ "tamanho": 7, "min": 0, "max": 0 }}], "espalhar": true }} }},
                {{ "id": "Port B", "turmas": ["B"], "recursos": ["P2", "P3"], "aulasSemana": 6 }}
            ],
            "recursos": [
                {{ "id": "P1", "disponibilidade": {{ "seg": {todos}, "ter": {todos}, "qua": {todos} }}, "evitar": {{ "seg": [1, 2], "qua": [8] }} }},
                {{ "id": "P2", "disponibilidade": {{ "seg": {todos}, "ter": [1, 2, 3, 4], "qua": {todos} }}, "evitar": {{ "ter": [1] }} }},
                {{ "id": "P3", "disponibilidade": {{ "seg": [5, 6, 7, 8], "ter": {todos}, "qua": {todos} }} }},
                {{ "id": "S", "ambiente": true, "disponibilidade": {{ "seg": {todos}, "ter": {todos}, "qua": {todos} }} }}
            ],
            "tempos": [{tempos}]
        }}"#)).unwrap();
        assert!(regras.turmas.iter().all(|t| t.folga > 0), "as duas turmas têm horários vagos");
        conferir_incremental(&regras, 6000);
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn resolve_a_instancia_pequena_a_partir_de_um_quadro_qualquer() {
        let regras = instancia("pequena");
        fastrand::seed(3);
        let mut busca = BuscaLocal::new(&regras, &regras.random_genes(), 2, 500);
        for _ in 0..200 {
            if busca.executar(20_000) { break; }
        }
        assert!(busca.valido(), "custo {}", busca.melhor_custo());
        let mut state = regras.initial_state();
        assert_eq!(-regras.fitness_rapido(&mut state, busca.melhor()), busca.melhor_custo());
    }

    /// A mesma semente dá a mesma busca.
    #[wasm_bindgen_test(unsupported = test)]
    fn mesma_semente_mesmo_resultado() {
        let regras = instancia("media");
        let rodar = || {
            fastrand::seed(5);
            let mut busca = BuscaLocal::new(&regras, &regras.genes_com_blocos(), 3, 300);
            busca.executar(5_000);
            (busca.melhor().to_vec(), busca.melhor_custo())
        };
        assert_eq!(rodar(), rodar());
    }
}
