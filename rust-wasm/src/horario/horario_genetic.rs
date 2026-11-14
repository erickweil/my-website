use crate::{console_log, genetic::{ga::GAConfig, operators::{CrossoverIPX, poisson_knuth_sample}, problems::GAProblem}, horario::{DiaSemana, Horario, QUANTOS_DIAS, QuadroHorario, RegrasHorario}, random::{random_bool, random_range, random_range_except}};

#[derive(Clone)]
pub struct HorarioGAState {
    crossover_ipx: CrossoverIPX<i32>,

    //  -1 = não dá aula
    //   0 = não está definido
    // > 0 = Índice da disciplina
    prof_matriz: Vec<Horario>,
}

impl GAProblem for RegrasHorario {
    /// Representação linearizada do multiconjunto que é o quadro de horários
    /// > Wikipedia: Em matemática, um multiconjunto (ou ainda multiset ou mset) é uma modificação do conceito de um conjunto que, diferentemente de um conjunto, permite várias instâncias para cada um de seus elementos.
    type Gene = QuadroHorario;
    type State = HorarioGAState;

    fn initial_state(&self) -> Self::State { 
        HorarioGAState {
            // Capacidade = tamanho do slice de uma turma (pior caso do IPX)
            crossover_ipx: CrossoverIPX::new(QUANTOS_DIAS * self.n_tempos),
            // Pré-aloca e pré-popula para evitar alocações no hot path do fitness
            prof_matriz: self.professores.iter().map(|p| p.horarios.clone()).collect(),
        }
    }

    fn max_fitness(&self) -> Option<f64> {
        Some(0.0)
    }

    fn hash(&self, _genes: &Self::Gene) -> Option<u64> {
        None
    }

    /// Gerar um quadro aleatório respeitando as restrições iniciais:
    /// - Somente alocar disciplinas nos horários possíveis para a turma
    /// - Somente alocar disciplinas na turma correta 
    /// - Respeitar o número de aulas de cada disciplina (mas sem se preocupar com agrupamento, para não bloquear o solver)
    fn random_genes(&self) -> Self::Gene {
        let mut genes = self.get_quadro_vazio();

        for turma in &self.turmas {
            // Cria um mapa de disciplinas da turma com suas aulas restantes para controle durante a alocação
            // DEVE ficar fora do loop de dias: o contador é global para a semana toda da turma
            let mut disciplina_map: Vec<(usize, i32)> = self.disciplinas.iter()
                .filter(|d| d.turma_id == turma.id)
                .map(|d| (d.id, d.aulas))
                .collect();
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
                    if disponiveis.is_empty() {
                        // deveria ser um erro?
                        console_log!("Nenhuma disciplina restante para alocar na turma '{}'", turma.nome);
                        continue;
                    }

                    let escolha = disponiveis[random_range(0, disponiveis.len())];
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
        // Começa 0, para cada coisa errada subtrai
        let mut fitness: f64 = 0.0;

        // Reseta as matrizes de disponibilidade dos professores para contagem de fitness
        // Reset in-place: sem alocação (copy_from_slice sobre Vec já existente)
        for (state_prof, prof) in state.prof_matriz.iter_mut().zip(self.professores.iter()) {
            state_prof.slots.copy_from_slice(&prof.horarios.slots);
        }

        // Pass 1: conta quantas turmas precisam de cada (prof, dia, tempo).
        // Isso evita o viés em que a turma com id menor sempre "ganha" o professor.
        for turma in &self.turmas {
            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                for tempo in 0..self.n_tempos {
                    // Slots inativos: nada a verificar
                    if turma.horarios.get(dia, tempo) != 1 { continue; }

                    let id_disciplina = quadro[self.to_quadro_index(turma.id, dia, tempo)] - 1;
                    if id_disciplina < 0 { continue; } // slot vazio

                    let disciplina = &self.disciplinas[id_disciplina as usize];

                    // prof_matriz começa como cópia de prof.horarios (0, 1)
                    // Para cada disciplina alocada, decrementa a disponibilidade dos professores daquela disciplina
                    for &prof_id in &disciplina.professores {
                        state.prof_matriz[prof_id].desmarcar(dia, tempo);
                    }
                }
            }
        }

        // Pass 2: conta a pontuação de cada slot com base na disponibilidade dos professores e nas disciplinas unidas
        for turma in &self.turmas {
            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                for tempo in 0..self.n_tempos {
                    let index = self.to_quadro_index(turma.id, dia, tempo);

                    if turma.horarios.get(dia, tempo) != 1 {
                        // Deveria ser vazio
                        if quadro[index] != -1 {
                            fitness -= 1000.0;
                        }
                        continue;
                    }

                    let id_disciplina = quadro[index] - 1;
                    if id_disciplina < 0 {
                        // Deveria ter uma disciplina alocada
                        fitness -= 1000.0;
                        continue; // slot vazio
                    }

                    let disciplina = &self.disciplinas[id_disciplina as usize];

                    // Regra: Disponibilidade do professor e sem conflito entre turmas
                    for &prof_id in &disciplina.professores {
                        let disponibilidade = state.prof_matriz[prof_id].get(dia, tempo);
                        // Penaliza proporcional ao Nº de conflitos
                        if disponibilidade <= 0 {
                            fitness += disponibilidade as f64 * 50.0;
                        }
                    }

                    // Regra: Disciplinas unidas devem ocupar o mesmo (dia, tempo)
                    for &unida_id in &disciplina.disciplinas_unidas {
                        let unida_turma_id = self.disciplinas[unida_id].turma_id;
                        let valor = quadro[self.to_quadro_index(unida_turma_id, dia, tempo)];
                        // Penaliza disciplinas que não estão juntas quando deveriam
                        if valor != unida_id as i32 + 1 {
                            fitness -= 30.0;
                        }
                    }
                }
            }
        }

        // Regra: Agrupamento em blocos de G aulas consecutivas
        for disc in &self.disciplinas {
            if disc.agrupar <= 0 { continue; }
            let g = disc.agrupar;
            let turma_id = disc.turma_id;

            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                let mut run_start: i32 = -1;

                for tempo in 0..=self.n_tempos {
                    // Sentinela no final do dia: força o fechamento do último run
                    let v = if tempo < self.n_tempos {
                        quadro[self.to_quadro_index(turma_id, dia, tempo)]
                    } else {
                        -1
                    };

                    if v == disc.id as i32 + 1 {
                        if run_start == -1 { run_start = tempo as i32; }
                    } else if run_start != -1 {
                        let run_length = tempo as i32 - run_start;

                        // Penalizar proporcional ao quanto o run se aproxima do ideal (multiplo de G, ou igual a G se dividir)
                        let ideal = if disc.dividir {
                            g
                        } else {
                            ((run_length as f64 / g as f64).round() as i32) * g
                        };
                        let diff = (run_length - ideal).abs();
                        fitness -= diff as f64 * 20.0;

                        run_start = -1;
                    }
                }
            }
        }

        fitness
    }

    fn mutate(&self, _: &mut Self::State, quadro: &mut Self::Gene, mutation_rate: f64) {
        // Mutação de trocas dentro das turmas
        let n_mutations = poisson_knuth_sample((quadro.len() as f64) * mutation_rate);
        for _ in 0..n_mutations {            
            // 1. Escolhe aleatoriamente o primeiro índice (somente slots ativos).
            // Se nenhuma tentativa acertar um slot ativo, pula esta mutação: usar um índice
            // padrão (ex.: 0) poderia trocar um slot inativo (-1) para dentro do horário da
            // turma, quebrando a invariante de multiconjunto por turma.
            let Some(idx) = (0..10)
                .map(|_| random_range(0, quadro.len()))
                .find(|&i| quadro[i] != -1)
            else { continue };

            // 2. Escolhe aleatoriamente outro slot ativo dentro da mesma turma para trocar
            let turma_id = (idx / self.n_tempos) / QUANTOS_DIAS;
            let start_turma = turma_id * self.n_tempos * QUANTOS_DIAS;
            let end_turma =  (turma_id + 1) * self.n_tempos * QUANTOS_DIAS;
            let Some(outro_idx) = (0..10)
                .map(|_| random_range_except(start_turma, end_turma, idx))
                .find(|&i| quadro[i] != -1)
            else { continue };

            quadro.swap(idx, outro_idx);
        }
    }

    fn crossover(
        &self,
        state: &mut Self::State,
        child_a: &mut Self::Gene,
        child_b: &mut Self::Gene,
        parent_a: &Self::Gene,
        parent_b: &Self::Gene
    )
    {
        // Crossover por blocos de turmas: para cada turma, escolhe aleatoriamente um dos pais
        // Os filhos recebem blocos complementares (se childA ← parentA, childB ← parentB)
        // A FAZER: crossover de um jeito que não cause genes inválidos
        for turma in &self.turmas {
            let start = turma.id * self.n_tempos * QUANTOS_DIAS;
            let end = (turma.id + 1) * self.n_tempos * QUANTOS_DIAS;
            let child_a_slice = &mut child_a[start..end];
            let child_b_slice = &mut child_b[start..end];
            let parent_a_slice = &parent_a[start..end];
            let parent_b_slice = &parent_b[start..end];
            
            if random_bool() {
                // Apenas copia blocos inteiros de turmas
                if random_bool() {
                    child_a_slice.clone_from_slice(parent_a_slice);
                    child_b_slice.clone_from_slice(parent_b_slice);
                } else {
                    child_a_slice.clone_from_slice(parent_b_slice);
                    child_b_slice.clone_from_slice(parent_a_slice);
                }
            } else {
                // Crossover IPX
                state.crossover_ipx.crossover(
                    child_a_slice, 
                    child_b_slice, 
                    parent_a_slice, 
                    parent_b_slice
                );
            }
        }        
    }
}

/// Configuração do GA para o quadro de horários usada pela página (a mesma do antigo worker em TS).
/// `tamanho` é o número de células do quadro ([`RegrasHorario::tamanho_quadro`]).
pub fn config_ga_horario(tamanho: usize) -> GAConfig {
    GAConfig {
        population_size: tamanho * 4,
        crossover_rate: 0.9,
        mutation_rate: 0.9,
        // em média 1 gene mutado por indivíduo
        mutation_gene_rate: 1.0 / tamanho.max(1) as f64,
        tournament_size: 10,
        max_stagnation: Some(5000),
        diversity_check: false,
        threads: 0,
        ..GAConfig::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::ga::{GAConfig, GeneticAlgorithm};
    use crate::horario::horario_regras::{
        FomularioHorario, FomularioHorarioDisciplina, FomularioHorarioProfessor, FomularioHorarioTurma,
    };
    use std::collections::HashMap;
    use wasm_bindgen_test::*;

    fn horarios(dias: &[(&str, &[i32])]) -> HashMap<String, Vec<i32>> {
        dias.iter().map(|(d, t)| (d.to_string(), t.to_vec())).collect()
    }

    /// Instância com POUCOS slots ativos (3 de 21 por turma, ~14%), para que o sorteio
    /// de índice ativo falhe com frequência e o caminho de "nenhum índice encontrado" seja exercitado.
    fn regras_esparsas() -> RegrasHorario {
        let disc = |nome: &str, turma: &str, aulas: i32| FomularioHorarioDisciplina {
            nome: nome.into(), turma: turma.into(), aulas, agrupar: 0, dividir: false,
        };
        RegrasHorario::new(FomularioHorario {
            turmas: vec![
                FomularioHorarioTurma { nome: "A".into(), horarios: horarios(&[("seg", &[1, 2, 3])]) },
                FomularioHorarioTurma { nome: "B".into(), horarios: horarios(&[("seg", &[1, 2, 3])]) },
            ],
            disciplinas: vec![
                disc("Mat A", "A", 2), disc("Port A", "A", 1),
                disc("Mat B", "B", 1), disc("Port B", "B", 2),
            ],
            disciplinas_unidas: vec![],
            professores: vec![
                FomularioHorarioProfessor {
                    nome: "P1".into(),
                    disciplinas: vec!["Mat A".into(), "Mat B".into()],
                    horarios: horarios(&[("seg", &[1, 2, 3])]),
                },
                FomularioHorarioProfessor {
                    nome: "P2".into(),
                    disciplinas: vec!["Port A".into(), "Port B".into()],
                    horarios: horarios(&[("seg", &[1, 2, 3])]),
                },
            ],
        }).unwrap()
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
}
