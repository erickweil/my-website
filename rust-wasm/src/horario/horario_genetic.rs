use crate::{
    console_log,
    genetic::{
        ga::GAConfig,
        operators::{poisson_knuth_sample, CrossoverIPX},
        problems::GAProblem,
    },
    horario::{
        horario_avaliacao::{fitness_do_quadro, BuffersAvaliacao},
        horario_movimentos::{sortear_movimento, RascunhoMovimentos, RngThread},
        horario_tabelas::TabelasHorario,
        ConfigMovimentos, DiaSemana, QuadroHorario, RegrasHorario, QUANTOS_DIAS,
    },
    random::{random_bool, random_range},
};

/// Operadores do algoritmo genético que podem ser ligados e desligados (para comparar no benchmark
/// `bench_operadores_horario`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OperadoresGA {
    /// População inicial com as aulas agrupadas já montadas em blocos (em vez de aula por aula).
    pub blocos_iniciais: bool,
    /// Operadores de movimento compartilhados com a busca local (troca de blocos, propagação em
    /// aulas conjuntas e cadeias de Kempe; ver `horario_movimentos.rs`).
    pub movimentos: ConfigMovimentos,
    /// Medir a taxa de mutação nas células ativas (`ativas.len()`) em vez do quadro inteiro.
    pub taxa_em_ativas: bool,
    /// Quantas vezes tentar `sortear_movimento` por mutação se o sorteio retornar `false`
    /// (1 = sem re-tentativa).
    pub tentativas_mutacao: u8,
    /// Crossover por componentes conexos de turmas ligadas por aula em conjunto (`false` = turma a
    /// turma, podendo separar aulas conjuntas).
    pub crossover_por_componentes: bool,
    /// Probabilidade de usar `CrossoverIPX` (em vez de cópia inteira da turma) numa turma
    /// individual durante o crossover (`0.0` = nunca usa IPX, `0.5` = valor original).
    pub p_ipx: f64,
}

impl OperadoresGA {
    /// Só os operadores originais: inicialização aula por aula, troca simples de duas células e
    /// crossover turma a turma com 50% IPX.
    pub const ORIGINAIS: Self = Self {
        blocos_iniciais: false,
        movimentos: ConfigMovimentos::SIMPLES,
        taxa_em_ativas: false,
        tentativas_mutacao: 1,
        crossover_por_componentes: false,
        p_ipx: 0.5,
    };
}

impl Default for OperadoresGA {
    fn default() -> Self {
        Self {
            blocos_iniciais: true,
            movimentos: ConfigMovimentos { p_kempe: 0.1, ..ConfigMovimentos::default() },
            taxa_em_ativas: false,
            tentativas_mutacao: 4,
            crossover_por_componentes: true,
            p_ipx: 0.25,
        }
    }
}

#[derive(Clone)]
pub struct HorarioGAState {
    crossover_ipx: CrossoverIPX<i32>,
    /// Cópia das tabelas por estado/thread (ver `situacao-gerador-horario.md` §4.7).
    tabelas: TabelasHorario,
    /// Buffers reaproveitados pela avaliação em lote (em `horario_avaliacao.rs`).
    avaliacao: BuffersAvaliacao,
    /// Buffers reaproveitados pelo sorteio de movimentos (em `horario_movimentos.rs`).
    movimentos: RascunhoMovimentos,
}

impl GAProblem for RegrasHorario {
    /// Representação linearizada do multiconjunto que é o quadro de horários
    /// > Wikipedia: Em matemática, um multiconjunto (ou ainda multiset ou mset) é uma modificação do conceito de um conjunto que, diferentemente de um conjunto, permite várias instâncias para cada um de seus elementos.
    type Gene = QuadroHorario;
    type State = HorarioGAState;

    fn initial_state(&self) -> Self::State {
        let tabelas = TabelasHorario::new(self);
        let avaliacao = BuffersAvaliacao::new(&tabelas);
        let movimentos = RascunhoMovimentos::new(tabelas.n_turmas);
        HorarioGAState {
            // Capacidade = tamanho do slice de uma turma (pior caso do IPX)
            crossover_ipx: CrossoverIPX::new(QUANTOS_DIAS * self.n_tempos),
            tabelas,
            avaliacao,
            movimentos,
        }
    }

    fn max_fitness(&self) -> Option<f64> {
        Some(0.0)
    }

    /// Usado pelo `diversity_check` do motor para achar filhos repetidos.
    fn hash(&self, genes: &Self::Gene) -> Option<u64> {
        use std::hash::{Hash, Hasher};
        let mut h = rustc_hash::FxHasher::default();
        genes.hash(&mut h);
        Some(h.finish())
    }

    /// Gerar um quadro aleatório respeitando as restrições iniciais:
    /// - Somente alocar disciplinas nos horários possíveis para a turma
    /// - Somente alocar disciplinas na turma correta 
    /// - Respeitar o número de aulas de cada disciplina (mas sem se preocupar com agrupamento, para não bloquear o solver)
    /// - Os horários que sobram (folga da turma) ficam vagos; as trocas da mutação os movem como
    ///   qualquer aula
    fn random_genes(&self) -> Self::Gene {
        // Continuar de um horário: a população são variações dele (ver horario_inicial.rs)
        if let Some(inicial) = &self.inicial {
            return self.variacao_do_inicial(inicial);
        }
        if self.operadores.blocos_iniciais {
            return self.genes_com_blocos();
        }
        let mut genes = self.get_quadro_vazio();

        for turma in &self.turmas {
            // Cria um mapa de disciplinas da turma com suas aulas restantes para controle durante a alocação
            // DEVE ficar fora do loop de dias: o contador é global para a semana toda da turma
            let mut disciplina_map: Vec<(usize, i32)> = self.disciplinas.iter()
                .filter(|d| d.turma_id == turma.id)
                .map(|d| (d.id, d.aulas))
                .collect();
            let mut vagos_restantes = turma.folga;
            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                for tempo in 0..self.n_tempos {
                    let idx = self.to_quadro_index(turma.id, dia, tempo);
                    // só preenche os espaços do horário ativo
                    if genes[idx] != 0 { continue }

                    // Escolhe aleatoriamente uma disciplina que ainda tenha aulas restantes
                    let disponiveis: Vec<usize> = disciplina_map.iter()
                        .enumerate()
                        .filter(|(_i, (_, aulas))| *aulas > 0)
                        .map(|(i, _)| i)
                        .collect();
                    // A turma tem mais horários que aulas: o horário fica vago (sorteado como se
                    // fosse mais uma disciplina, para os vagos começarem espalhados)
                    let opcoes = disponiveis.len() + (vagos_restantes > 0) as usize;
                    if opcoes == 0 {
                        // Não acontece: a folga da turma cobre os horários que sobram
                        console_log!("Nenhuma disciplina restante para alocar na turma '{}'", turma.nome);
                        continue;
                    }
                    let escolha = random_range(0, opcoes);
                    if escolha == disponiveis.len() {
                        genes[idx] = self.vago();
                        vagos_restantes -= 1;
                        continue;
                    }
                    let escolha = disponiveis[escolha];
                    let disc_id = disciplina_map[escolha].0;
                    genes[idx] = disc_id as i32 + 1;
                    // Decrementa o contador de aulas restantes para a disciplina escolhida
                    disciplina_map[escolha].1 -= 1;
                }
            }
        }

        genes
    }

    fn fitness(&self, state: &mut Self::State, quadro: &Self::Gene) -> f64 {
        self.fitness_rapido(state, quadro)
    }

    fn mutate(&self, state: &mut Self::State, quadro: &mut Self::Gene, mutation_rate: f64) {
        let base = if self.operadores.taxa_em_ativas { state.tabelas.ativas.len() } else { quadro.len() };
        let n_mutations = poisson_knuth_sample((base as f64) * mutation_rate);
        let tentativas = self.operadores.tentativas_mutacao.max(1);
        for _ in 0..n_mutations {
            for _ in 0..tentativas {
                if sortear_movimento(&state.tabelas, quadro, self.operadores.movimentos, &mut state.movimentos, &mut RngThread) {
                    for &(a, b) in &state.movimentos.trocas {
                        quadro.swap(a as usize, b as usize);
                    }
                    break;
                }
            }
        }
    }

    fn crossover(
        &self,
        state: &mut Self::State,
        child_a: &mut Self::Gene,
        child_b: &mut Self::Gene,
        parent_a: &Self::Gene,
        parent_b: &Self::Gene,
    ) {
        let por_turma = state.tabelas.por_turma;
        let copiar_turma = |turma_id: usize, trocar: bool, ca: &mut [i32], cb: &mut [i32]| {
            let start = turma_id * por_turma;
            let end = start + por_turma;
            if trocar {
                ca[start..end].clone_from_slice(&parent_b[start..end]);
                cb[start..end].clone_from_slice(&parent_a[start..end]);
            } else {
                ca[start..end].clone_from_slice(&parent_a[start..end]);
                cb[start..end].clone_from_slice(&parent_b[start..end]);
            }
        };

        let p_ipx = self.operadores.p_ipx;
        let n_comps = state.tabelas.componentes_de.len();
        // Salvaguarda: se todas as turmas formam 1 único componente gigante, cai no crossover por turma
        if !self.operadores.crossover_por_componentes || n_comps <= 1 {
            for turma_id in 0..state.tabelas.n_turmas {
                if p_ipx > 0.0 && fastrand::f64() < p_ipx {
                    let start = turma_id * por_turma;
                    let end = start + por_turma;
                    state.crossover_ipx.crossover(
                        &mut child_a[start..end],
                        &mut child_b[start..end],
                        &parent_a[start..end],
                        &parent_b[start..end],
                    );
                } else {
                    copiar_turma(turma_id, random_bool(), child_a, child_b);
                }
            }
            return;
        }

        for &(ini, fim) in &state.tabelas.componentes_de {
            let comp = &state.tabelas.componentes[ini as usize..fim as usize];
            if comp.len() == 1 && p_ipx > 0.0 && fastrand::f64() < p_ipx {
                let start = comp[0] as usize * por_turma;
                let end = start + por_turma;
                state.crossover_ipx.crossover(
                    &mut child_a[start..end],
                    &mut child_b[start..end],
                    &parent_a[start..end],
                    &parent_b[start..end],
                );
            } else {
                let trocar = random_bool();
                for &turma_id in comp {
                    copiar_turma(turma_id as usize, trocar, child_a, child_b);
                }
            }
        }
    }
}

impl RegrasHorario {
    /// Quadro inicial com as aulas já divididas em pedaços: para cada disciplina, uma divisão
    /// sorteada entre as que atendem às regras dela; os pedaços (do maior para o menor) vão para
    /// posições sorteadas entre as que cabem, de preferência onde os professores estão disponíveis
    /// e sem encostar em outro pedaço da mesma disciplina (os dois virariam um só). Um pedaço que
    /// não cabe em lugar nenhum entra com as aulas soltas, assim como as disciplinas sem divisão
    /// possível; os horários vagos preenchem o resto, ao acaso. O multiconjunto de cada turma é o
    /// mesmo de `random_genes` sem blocos.
    pub fn genes_com_blocos(&self) -> QuadroHorario {
        let mut genes = self.get_quadro_vazio();
        self.completar_com_blocos(&mut genes, &vec![0; self.disciplinas.len()]);
        genes
    }

    /// Completa um quadro que já tem algumas aulas postas (as células com valor diferente de 0 ficam
    /// como estão; `postas` diz quantas aulas de cada disciplina já estão nele), do mesmo jeito que
    /// [`Self::genes_com_blocos`]: o que falta de cada disciplina, dividido em pedaços, nas células
    /// livres. Usado para partir de um horário com aulas fixadas (ver horario_inicial.rs).
    pub fn completar_com_blocos(&self, genes: &mut [i32], postas: &[i32]) {
        let n = self.n_tempos;
        let pode_prof = |d: usize, celula: usize| {
            let (_, dia, tempo) = self.from_quadro_index(celula);
            self.disciplinas[d].professores.iter().all(|&p| self.professores[p].horarios.get(dia, tempo) == 1)
        };
        for turma in &self.turmas {
            let inicio = turma.id * QUANTOS_DIAS * n;
            // (disciplina, tamanho) dos pedaços de mais de uma aula, e as aulas soltas
            let mut blocos: Vec<(usize, usize)> = Vec::new();
            let mut soltas: Vec<i32> = Vec::new();
            let mut faltam_total = 0;
            for d in self.disciplinas.iter().filter(|d| d.turma_id == turma.id) {
                let faltam = (d.aulas - postas[d.id]).max(0);
                faltam_total += faltam;
                let divisao = if d.divisao.agrupa() { d.divisao.sortear_divisao(faltam) } else { None };
                let divisao = divisao.unwrap_or_else(|| vec![1; faltam as usize]);
                for t in divisao {
                    if t > 1 { blocos.push((d.id, t as usize)) } else { soltas.push(d.id as i32 + 1) }
                }
            }
            // Os horários vagos: as células livres que sobram depois das aulas (no quadro vazio, a folga da turma)
            let livres_no_inicio = (inicio..inicio + QUANTOS_DIAS * n).filter(|&c| genes[c] == 0).count() as i32;
            soltas.extend((0..(livres_no_inicio - faltam_total).max(0)).map(|_| self.vago()));
            fastrand::shuffle(&mut blocos);
            blocos.sort_by_key(|&(_, k)| std::cmp::Reverse(k));

            let mut candidatos: Vec<(usize, bool)> = Vec::new();
            for (d, k) in blocos {
                let valor = d as i32 + 1;
                candidatos.clear();
                for dia in 0..QUANTOS_DIAS {
                    let linha = inicio + dia * n;
                    for t in 0..n.saturating_sub(k - 1) {
                        let ini = linha + t;
                        if genes[ini..ini + k].iter().any(|&x| x != 0) { continue; }
                        let encosta = (t > 0 && genes[ini - 1] == valor) || (t + k < n && genes[ini + k] == valor);
                        let bom = !encosta && (ini..ini + k).all(|c| pode_prof(d, c));
                        candidatos.push((ini, bom));
                    }
                }
                let bons = candidatos.iter().filter(|c| c.1).count();
                let escolhido = if bons > 0 {
                    candidatos.iter().filter(|c| c.1).nth(random_range(0, bons)).map(|c| c.0)
                } else if !candidatos.is_empty() {
                    Some(candidatos[random_range(0, candidatos.len())].0)
                } else {
                    None
                };
                match escolhido {
                    Some(ini) => genes[ini..ini + k].fill(valor),
                    None => soltas.extend((0..k).map(|_| valor)),
                }
            }

            // Soltas e vagos nas células que sobraram
            fastrand::shuffle(&mut soltas);
            let livres: Vec<usize> = (inicio..inicio + QUANTOS_DIAS * n).filter(|&c| genes[c] == 0).collect();
            for (c, v) in livres.into_iter().zip(soltas) {
                genes[c] = v;
            }
        }
    }

    /// Fitness do quadro: 0 quando não quebra nenhuma regra, obrigatória ou de qualidade; negativo
    /// proporcional às violações (ver `horario_avaliacao.rs` e [`PesosFitness`](super::PesosFitness)).
    #[inline]
    pub fn fitness_rapido(&self, state: &mut HorarioGAState, quadro: &[i32]) -> f64 {
        fitness_do_quadro(&state.tabelas, &mut state.avaliacao, quadro, &self.fixas, &self.pesos, &self.qualidade)
    }
}

/// Indivíduos por ilha no modelo de ilhas (medido nas Rodadas 5a–5c: cabe na cache L1/L2 e
/// maximiza gerações/s e taxa de resolução em todas as escalas de escola).
pub const POPULACAO_POR_ILHA: usize = 16;

/// Indivíduos no modo clássico (uma população só, sem ilhas).
pub const POPULACAO_CLASSICA: usize = 64;

/// Aplica os parâmetros opcionais vindos da configuração do projeto (`EntradaConfigGA`).
fn aplicar_config_ga(cfg: &mut GAConfig, ga: &super::horario_regras::EntradaConfigGA) {
    if let Some(p) = ga.populacao.filter(|&p| p >= 2) {
        cfg.population_size = p;
    }
    if let Some(m) = ga.migracao {
        cfg.migracao = m;
    }
    if let Some(e) = ga.epoca.filter(|&e| e >= 1) {
        cfg.epoca = e;
    }
    if let Some(s) = ga.estagnacao {
        cfg.max_stagnation = (s > 0).then_some(s);
    }
    cfg.tournament_size = cfg.tournament_size.min(cfg.population_size.saturating_sub(1)).max(2);
}

/// Configuração padrão do GA para o quadro de horários no modo clássico (uma população só).
/// Para o modelo de ilhas, use [`config_ga_horario_ilhas`].
pub fn config_ga_horario(regras: &RegrasHorario) -> GAConfig {
    let base = if regras.operadores.taxa_em_ativas {
        regras.turmas.iter().map(|t| t.horarios.slots.iter().filter(|&&v| v == 1).count()).sum()
    } else {
        regras.tamanho_quadro()
    };
    let mut cfg = GAConfig {
        population_size: POPULACAO_CLASSICA,
        crossover_rate: 0.9,
        mutation_rate: 0.9,
        // em média 1 movimento de mutação por indivíduo
        mutation_gene_rate: 1.0 / base.max(1) as f64,
        tournament_size: 3,
        max_stagnation: None,
        diversity_check: true,
        threads: 0,
        epoca: 200,
        migracao: 1,
        migrar_elite: false,
        ..GAConfig::new()
    };
    aplicar_config_ga(&mut cfg, &regras.ga_config);
    cfg
}

/// Configuração padrão do GA de horários com `ilhas` (0 ou 1 = modo clássico; >1 = `POPULACAO_POR_ILHA`
/// indivíduos por ilha, salvo se `regras.ga_config.populacao` estiver definido).
pub fn config_ga_horario_ilhas(regras: &RegrasHorario, ilhas: usize) -> GAConfig {
    let mut cfg = config_ga_horario(regras);
    cfg.ilhas = ilhas;
    if ilhas > 1 && regras.ga_config.populacao.filter(|&p| p >= 2).is_none() {
        cfg.population_size = POPULACAO_POR_ILHA;
    }
    cfg.tournament_size = cfg.tournament_size.min(cfg.population_size.saturating_sub(1)).max(2);
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::ga::{GAConfig, GeneticAlgorithm};
    use crate::horario::PesosFitness;
    use wasm_bindgen_test::*;

    /// Instância com POUCOS slots ativos (3 de 21 por turma, ~14%), para que o sorteio
    /// de índice ativo falhe com frequência e o caminho de "nenhum índice encontrado" seja exercitado.
    fn regras_esparsas() -> RegrasHorario {
        RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "A", "horarios": { "seg": [1, 2, 3] } }, { "id": "B", "horarios": { "seg": [1, 2, 3] } }],
            "aulas": [
                { "id": "Mat A", "turmas": ["A"], "recursos": ["P1"], "aulasSemana": 2 },
                { "id": "Port A", "turmas": ["A"], "recursos": ["P2"], "aulasSemana": 1 },
                { "id": "Mat B", "turmas": ["B"], "recursos": ["P1"], "aulasSemana": 1 },
                { "id": "Port B", "turmas": ["B"], "recursos": ["P2"], "aulasSemana": 2 }
            ],
            "recursos": [
                { "id": "P1", "disponibilidade": { "seg": [1, 2, 3] } },
                { "id": "P2", "disponibilidade": { "seg": [1, 2, 3] } }
            ]
        }"#).unwrap()
    }

    /// Verifica a invariante: slots inativos (-1) continuam nos mesmos lugares e o
    /// multiconjunto de disciplinas de cada turma é o mesmo do quadro de referência.
    fn assert_invariantes(regras: &RegrasHorario, referencia: &QuadroHorario, quadro: &QuadroHorario) {
        let vazio = regras.get_quadro_vazio();
        for (i, (&v, &base)) in quadro.iter().zip(vazio.iter()).enumerate() {
            assert_eq!(v == -1, base == -1, "slot {} mudou de ativo/inativo (valor {})", i, v);
        }
        let por_turma = QUANTOS_DIAS * regras.n_tempos;
        for t in 0..regras.turmas.len() {
            let mut a = referencia[t * por_turma..(t + 1) * por_turma].to_vec();
            let mut b = quadro[t * por_turma..(t + 1) * por_turma].to_vec();
            a.sort_unstable();
            b.sort_unstable();
            assert_eq!(a, b, "multiconjunto da turma {} mudou", t);
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn mutacao_preserva_invariantes() {
        fastrand::seed(42);
        let regras = regras_esparsas();
        let mut state = regras.initial_state();
        let referencia = regras.random_genes();
        let mut quadro = referencia.clone();
        for _ in 0..20_000 {
            regras.mutate(&mut state, &mut quadro, 0.5);
            assert_invariantes(&regras, &referencia, &quadro);
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn ga_preserva_invariantes_e_resolve_instancia_pequena() {
        fastrand::seed(7);
        let regras = regras_esparsas();
        let referencia = regras.random_genes();
        let mut ga = GeneticAlgorithm::new(regras, GAConfig {
            population_size: 32,
            mutation_rate: 0.9,
            crossover_rate: 0.9,
            mutation_gene_rate: 0.1,
            ..GAConfig::new()
        });
        ga.run(200);
        let info = ga.get_info();
        let genes = info.best_genes.expect("deveria ter um melhor indivíduo");
        assert_invariantes(&ga.problem, &referencia, &genes);
        assert_eq!(info.best_fitness, Some(0.0), "instância trivial deveria ser resolvida");
    }

    fn carregar(nome: &str) -> RegrasHorario {
        RegrasHorario::de_arquivo(&format!("{}/tests/instancias/{nome}.json", env!("CARGO_MANIFEST_DIR")))
    }

    /// Multiconjunto de cada turma, ordenado (para comparar quadros iniciais).
    fn por_turma(regras: &RegrasHorario, q: &QuadroHorario) -> Vec<Vec<i32>> {
        let n = QUANTOS_DIAS * regras.n_tempos;
        (0..regras.turmas.len()).map(|t| { let mut v = q[t * n..(t + 1) * n].to_vec(); v.sort_unstable(); v }).collect()
    }

    /// A população inicial com blocos tem as mesmas aulas (e vagos) por turma que a original, sem
    /// célula por resolver, e os blocos já montados: bem menos erro de agrupamento.
    #[test]
    fn inicial_com_blocos_mantem_as_aulas_e_monta_os_blocos() {
        for nome in ["faculdade-anonimizado", "pequena", "media"] {
            fastrand::seed(21);
            let mut original = carregar(nome);
            original.operadores = OperadoresGA::ORIGINAIS;
            let com_blocos = RegrasHorario { operadores: OperadoresGA::default(), ..original.clone() };
            let so_agrupar = |r: &RegrasHorario| RegrasHorario { pesos: PesosFitness { professor: 0.0, conflito: 0.0, unidas: 0.0, ..r.pesos }, ..r.clone() };
            let (ag_o, ag_b) = (so_agrupar(&original), so_agrupar(&com_blocos));
            let mut estado = original.initial_state();
            let (mut soma_o, mut soma_b) = (0.0, 0.0);
            for _ in 0..30 {
                let (a, b) = (original.random_genes(), com_blocos.random_genes());
                assert_eq!(por_turma(&original, &a), por_turma(&original, &b), "{nome}: mesmas aulas por turma");
                assert!(!b.contains(&0), "{nome}: nenhuma célula por resolver");
                assert_invariantes(&original, &a, &b);
                soma_o += ag_o.fitness_rapido(&mut estado, &a);
                soma_b += ag_b.fitness_rapido(&mut estado, &b);
            }
            assert!(soma_b > soma_o * 0.5, "{nome}: blocos iniciais deveriam ter bem menos erro de agrupamento ({soma_b} x {soma_o})");
        }
    }

    /// Com vagos: a turma tem folga, e eles também entram no quadro inicial com blocos.
    #[test]
    fn inicial_com_blocos_inclui_os_vagos() {
        fastrand::seed(22);
        let regras = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2, 3, 4, 5], "ter": [1, 2, 3] } }],
            "aulas": [{ "id": "A", "turmas": ["T"], "recursos": [], "aulasSemana": 4, "divisao": { "tamanhoMin": 2 } }, { "id": "B", "turmas": ["T"], "recursos": [], "aulasSemana": 1 }],
            "recursos": []
        }"#).unwrap();
        for _ in 0..50 {
            let q = regras.genes_com_blocos();
            assert_eq!(q.iter().filter(|&&v| v == regras.vago()).count(), 3);
            assert_eq!(q.iter().filter(|&&v| v == 1).count(), 4);
            assert!(!q.contains(&0));
        }
    }

    /// A troca de blocos preserva as invariantes (estrutura e multiconjunto de cada turma).
    #[test]
    fn troca_de_blocos_preserva_invariantes() {
        fastrand::seed(23);
        let mut regras = carregar("faculdade-anonimizado");
        regras.operadores.movimentos.p_bloco = 1.0;
        let mut estado = regras.initial_state();
        let referencia = regras.random_genes();
        let mut quadro = referencia.clone();
        let mut mudou = 0;
        for _ in 0..20_000 {
            let antes = quadro.clone();
            regras.mutate(&mut estado, &mut quadro, 0.01);
            mudou += (antes != quadro) as usize;
            assert_invariantes(&regras, &referencia, &quadro);
        }
        assert!(mudou > 1000, "a mutação deveria mudar o quadro");
    }

    /// Mutação compartilhada com Kempe (normal e de blocos) + propagação em aulas conjuntas
    /// preserva todas as invariantes.
    #[test]
    fn mutacao_com_kempe_e_unidas_preserva_invariantes() {
        fastrand::seed(29);
        let mut regras = carregar("media");
        regras.operadores.movimentos = ConfigMovimentos { p_bloco: 0.5, propagar_unidas: true, p_kempe: 0.5, kempe_de_blocos: true };
        regras.operadores.taxa_em_ativas = true;
        regras.operadores.tentativas_mutacao = 4;
        let mut estado = regras.initial_state();
        let referencia = regras.random_genes();
        let mut quadro = referencia.clone();
        let mut mudou = 0;
        for _ in 0..2_000 {
            let antes = quadro.clone();
            regras.mutate(&mut estado, &mut quadro, 0.02);
            mudou += (antes != quadro) as usize;
            assert_invariantes(&regras, &referencia, &quadro);
        }
        assert!(mudou > 500, "a mutação deveria mudar o quadro");
    }

    /// Com `propagar_unidas = true`, mover uma aula em conjunto alinhada mantém as turmas parceiras
    /// alinhadas após a mutação.
    #[test]
    fn mutacao_propaga_aula_em_conjunto() {
        fastrand::seed(31);
        let mut regras = RegrasHorario::from_json(r#"{
            "turmas": [
                { "id": "A", "horarios": { "seg": [1, 2, 3, 4] } },
                { "id": "B", "horarios": { "seg": [1, 2, 3, 4] } }
            ],
            "aulas": [
                { "id": "conj", "turmas": ["A", "B"], "recursos": [], "aulasSemana": 1 },
                { "id": "a1",   "turmas": ["A"],      "recursos": [], "aulasSemana": 3 },
                { "id": "b1",   "turmas": ["B"],      "recursos": [], "aulasSemana": 3 }
            ],
            "recursos": []
        }"#).unwrap();
        regras.operadores.movimentos = ConfigMovimentos { p_bloco: 0.0, propagar_unidas: true, p_kempe: 0.0, kempe_de_blocos: false };
        let mut estado = regras.initial_state();
        // Disciplinas: 1 = conj(A), 2 = conj(B), 3 = a1(A), 4 = b1(B)
        let mut quadro = regras.get_quadro_vazio();
        let n = regras.n_tempos;
        let idx = |turma: usize, t: usize| (turma * QUANTOS_DIAS + DiaSemana::Segunda.to_index()) * n + t;
        quadro[idx(0, 0)] = 1;
        quadro[idx(1, 0)] = 2;
        for t in 1..4 {
            quadro[idx(0, t)] = 3;
            quadro[idx(1, t)] = 4;
        }
        let mut mudou_pos_conj = 0;
        let mut pos_anterior = 0;
        for _ in 0..500 {
            regras.mutate(&mut estado, &mut quadro, 0.2);
            let pos_a = (0..4).find(|&t| quadro[idx(0, t)] == 1).unwrap();
            let pos_b = (0..4).find(|&t| quadro[idx(1, t)] == 2).unwrap();
            assert_eq!(pos_a, pos_b, "a aula conjunta deveria continuar alinhada nas duas turmas");
            if pos_a != pos_anterior {
                mudou_pos_conj += 1;
                pos_anterior = pos_a;
            }
        }
        assert!(mudou_pos_conj > 50, "a aula conjunta deveria ter se movido várias vezes");
    }

    /// Crossover por componentes nunca separa aulas em conjunto quando os dois pais têm a aula
    /// alinhada (e preserva invariantes em todos os modos).
    #[test]
    fn crossover_por_componentes_mantem_aulas_conjuntas_alinhadas() {
        fastrand::seed(37);
        let mut regras = RegrasHorario::from_json(r#"{
            "turmas": [
                { "id": "A", "horarios": { "seg": [1, 2, 3, 4] } },
                { "id": "B", "horarios": { "seg": [1, 2, 3, 4] } },
                { "id": "C", "horarios": { "seg": [1, 2, 3, 4] } }
            ],
            "aulas": [
                { "id": "conj", "turmas": ["A", "B"], "recursos": [], "aulasSemana": 1 },
                { "id": "a1",   "turmas": ["A"],      "recursos": [], "aulasSemana": 3 },
                { "id": "b1",   "turmas": ["B"],      "recursos": [], "aulasSemana": 3 },
                { "id": "c1",   "turmas": ["C"],      "recursos": [], "aulasSemana": 4 }
            ],
            "recursos": []
        }"#).unwrap();
        let n = regras.n_tempos;
        let idx = |turma: usize, t: usize| (turma * QUANTOS_DIAS + DiaSemana::Segunda.to_index()) * n + t;
        let montar = |pos_conj: usize| {
            let mut q = regras.get_quadro_vazio();
            for t in 0..4 {
                q[idx(0, t)] = if t == pos_conj { 1 } else { 3 };
                q[idx(1, t)] = if t == pos_conj { 2 } else { 4 };
                q[idx(2, t)] = 5;
            }
            q
        };
        let (pa, pb) = (montar(0), montar(3));
        regras.operadores.crossover_por_componentes = true;
        for p_ipx in [0.0, 0.25, 0.5] {
            regras.operadores.p_ipx = p_ipx;
            let mut estado = regras.initial_state();
            let (mut ca, mut cb) = (pa.clone(), pb.clone());
            for _ in 0..200 {
                regras.crossover(&mut estado, &mut ca, &mut cb, &pa, &pb);
                for q in [&ca, &cb] {
                    assert_invariantes(&regras, &pa, q);
                    let pos_a = (0..4).find(|&t| q[idx(0, t)] == 1).unwrap();
                    let pos_b = (0..4).find(|&t| q[idx(1, t)] == 2).unwrap();
                    assert_eq!(pos_a, pos_b, "p_ipx={p_ipx}: crossover separou aula conjunta");
                }
            }
        }
    }

    #[test]
    fn hash_igual_para_quadros_iguais() {
        let regras = carregar("pequena");
        let (a, b) = (regras.random_genes(), regras.random_genes());
        assert_eq!(regras.hash(&a), regras.hash(&a.clone()));
        assert_ne!(regras.hash(&a), regras.hash(&b));
    }

    /// Quadros variados: aleatórios, e cada vez mais evoluídos (inclui quadros quase certos).
    fn quadros_de_teste(regras: &RegrasHorario, n: usize) -> Vec<QuadroHorario> {
        let mut quadros: Vec<QuadroHorario> = (0..n).map(|_| regras.random_genes()).collect();
        let mut ga = GeneticAlgorithm::new(regras.clone(), GAConfig { population_size: 64, mutation_rate: 0.9, crossover_rate: 0.9, mutation_gene_rate: 0.02, threads: 1, ..GAConfig::new() });
        for _ in 0..n {
            ga.run(20);
            quadros.push(ga.get_info().best_genes.unwrap());
            quadros.extend((0..3).filter_map(|i| ga.get_genes(i).cloned()));
        }
        quadros
    }

    /// O fitness zera exatamente nos mesmos quadros com quaisquer pesos e medidas do professor:
    /// os pesos só mudam o relevo. Inclui soluções válidas do Pencilmark e versões com poucas trocas.
    #[test]
    fn fitness_zera_nos_mesmos_quadros_com_quaisquer_pesos() {
        for nome in ["pequena", "media", "faculdade-anonimizado"] {
            fastrand::seed(12);
            let regras = carregar(nome);
            let mut estado = regras.initial_state();
            let mut quadros = quadros_de_teste(&regras, 40);
            for semente in 1..=3 {
                fastrand::seed(semente);
                let pm = crate::horario::HorarioRegrasPencilmark::new(regras.clone());
                let (vazio, n) = (pm.quadro_vazio(), pm.n_possibs());
                let mut exec = crate::pencilmark::ExecucaoPencilmark::new(pm, vazio, n, 1, Some(10));
                exec.executar(200_000);
                let Some(sol) = exec.solver.solucoes.first() else { continue };
                assert!(regras.fitness_rapido(&mut estado, sol) > -regras.pesos.agrupar, "{nome}: solução do Pencilmark sem violação obrigatória");
                let mut q = sol.clone();
                let uma_troca = 1.0 / q.len() as f64;
                for _ in 0..6 {
                    regras.mutate(&mut estado, &mut q, uma_troca);
                    quadros.push(q.clone());
                }
            }
            for q in &quadros {
                let zero = regras.fitness_rapido(&mut estado, q) == 0.0;
                for (mov_professor, peso_professor, peso_agrupar) in [(false, 50.0, 20.0), (true, 300.0, 20.0), (true, 100.0, 5.0)] {
                    let mut r = regras.clone();
                    r.pesos = PesosFitness { professor_por_movimentos: mov_professor, professor: peso_professor, conflito: peso_professor / 3.0, agrupar: peso_agrupar, ..r.pesos };
                    let f = r.fitness_rapido(&mut estado, q);
                    assert_eq!(f == 0.0, zero, "{nome}: professor por movimentos={mov_professor}: {f}");
                    assert!(f <= 0.0);
                }
            }
        }
    }

    /// Desvio das regras de divisão calculado à mão (uma turma, um dia de 8 tempos, uma disciplina
    /// "A" e disciplinas soltas para preencher), em unidades.
    #[test]
    fn divisao_casos() {
        let caso = |divisao: &str, dia: &str| -> f64 {
            let aulas_a = dia.matches('A').count() as i32;
            let tempos: Vec<i32> = (1..=dia.len() as i32).collect();
            // Cada "." é uma disciplina diferente de 1 aula, livre
            let mut aulas = vec![format!(r#"{{ "id": "A", "turmas": ["T"], "recursos": [], "aulasSemana": {aulas_a}, "divisao": {divisao} }}"#)];
            for i in 0..dia.matches('.').count() {
                aulas.push(format!(r#"{{ "id": "x{i}", "turmas": ["T"], "recursos": [], "aulasSemana": 1 }}"#));
            }
            let regras = RegrasHorario::from_json(&format!(
                r#"{{ "turmas": [{{ "id": "T", "horarios": {{ "seg": {tempos:?} }} }}], "aulas": [{}], "recursos": [] }}"#,
                aulas.join(", "),
            )).unwrap();
            let mut quadro = regras.get_quadro_vazio();
            let mut solta = 2;
            for (t, c) in dia.chars().enumerate() {
                let i = regras.to_quadro_index(0, DiaSemana::Segunda, t);
                quadro[i] = if c == 'A' { 1 } else { solta += 1; solta - 1 };
            }
            let mut estado = regras.initial_state();
            -regras.fitness_rapido(&mut estado, &quadro) / regras.pesos.agrupar
        };
        // Blocos de 2, podendo emendar: tamanho a partir de 2, sem pedaços de tamanho ímpar
        let duplas = r#"{ "tamanhoMin": 2, "porTamanho": [{ "tamanho": 3, "min": 0, "max": 0 }] }"#;
        assert_eq!(caso(duplas, "AA.."), 0.0);
        assert_eq!(caso(duplas, "A.A."), 2.0, "bloco de 2 partido: dois pedaços de 1");
        assert_eq!(caso(duplas, "AAA.A..."), 2.0, "3 + 1: um pedaço de 3 e um abaixo do mínimo");
        assert_eq!(caso(duplas, "AAAA...."), 0.0, "4 seguidas valem");
        // Blocos de 2, sem emendar
        let so_duplas = r#"{ "tamanhoMin": 2, "tamanhoMax": 2 }"#;
        assert_eq!(caso(so_duplas, "AAAA...."), 2.0, "um pedaço de 4: 2 aulas acima do máximo");
        assert_eq!(caso(so_duplas, "AA.AA..."), 0.0);
        // 3 aulas, 2 + 1 ou 3: no máximo 2 pedaços
        let duas_vezes = r#"{ "quantidadeMax": 2 }"#;
        assert_eq!(caso(duas_vezes, "AA.A...."), 0.0);
        assert_eq!(caso(duas_vezes, "A.A.A..."), 1.0, "três pedaços: um a mais");
        // Livre: nada a medir
        assert_eq!(caso("{}", "A.A.A..."), 0.0);
    }

    #[test]
    fn config_ga_respeita_parametros_da_entrada() {
        let base = r#"{
            "turmas": [{ "id": "A", "horarios": { "seg": [1, 2] } }],
            "aulas": [{ "id": "M", "turmas": ["A"], "recursos": [], "aulasSemana": 2 }],
            "recursos": []
        }"#;
        let padrao = RegrasHorario::from_json(base).unwrap();
        let cfg_ilhas = config_ga_horario_ilhas(&padrao, 8);
        assert_eq!(cfg_ilhas.ilhas, 8);
        assert_eq!(cfg_ilhas.population_size, POPULACAO_POR_ILHA);
        assert_eq!(cfg_ilhas.migracao, 1);
        assert_eq!(cfg_ilhas.epoca, 200);
        assert_eq!(cfg_ilhas.max_stagnation, None);
        assert!(!cfg_ilhas.migrar_elite);

        let custom = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "A", "horarios": { "seg": [1, 2] } }],
            "aulas": [{ "id": "M", "turmas": ["A"], "recursos": [], "aulasSemana": 2 }],
            "recursos": [],
            "config": { "ga": { "populacao": 32, "migracao": 3, "epoca": 100, "estagnacao": 500 } }
        }"#).unwrap();
        let cfg_custom = config_ga_horario_ilhas(&custom, 4);
        assert_eq!(cfg_custom.ilhas, 4);
        assert_eq!(cfg_custom.population_size, 32);
        assert_eq!(cfg_custom.migracao, 3);
        assert_eq!(cfg_custom.epoca, 100);
        assert_eq!(cfg_custom.max_stagnation, Some(500));

        // estagnacao: 0 desativa; populacao: 2 limita tournament_size
        let minimo = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "A", "horarios": { "seg": [1, 2] } }],
            "aulas": [{ "id": "M", "turmas": ["A"], "recursos": [], "aulasSemana": 2 }],
            "recursos": [],
            "config": { "ga": { "populacao": 2, "migracao": 0, "estagnacao": 0 } }
        }"#).unwrap();
        let cfg_min = config_ga_horario_ilhas(&minimo, 4);
        assert_eq!(cfg_min.population_size, 2);
        assert_eq!(cfg_min.migracao, 0);
        assert_eq!(cfg_min.max_stagnation, None);
        assert_eq!(cfg_min.tournament_size, 2);
    }
}
