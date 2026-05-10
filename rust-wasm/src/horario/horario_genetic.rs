use crate::{console_log, genetic::{operators::for_each_poisson, problems::GAProblem}, horario::{DiaSemana, QUANTOS_DIAS, QuadroHorario, RegrasHorario}, random::{random_bool, random_range}};

impl GAProblem for RegrasHorario {
    // Representação linearizada do quadro de horários
    type Gene = QuadroHorario;

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

    fn fitness(&mut self, quadro: &Self::Gene) -> f64 {
        // Começa 0, para cada coisa errada subtrai
        let mut fitness: f64 = 0.0;

        // Reseta as matrizes de disponibilidade dos professores para contagem de fitness
        // prof_matriz[prof_id] = cópia dos slots de horarios do professor
        let mut prof_matriz: Vec<Vec<i32>> = self.professores.iter()
            .map(|prof| prof.horarios.slots.clone())
            .collect();

        // Pass 1: conta quantas turmas precisam de cada (prof, dia, tempo).
        // Isso evita o viés em que a turma com id menor sempre "ganha" o professor.
        for turma in &self.turmas {
            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                for tempo in 0..self.n_tempos {
                    // Slots inativos: nada a verificar
                    if !turma.horarios.possui(dia, tempo) { continue; }

                    let id_disciplina = quadro[self.to_quadro_index(turma.id, dia, tempo)] - 1;
                    if id_disciplina < 0 { continue; } // slot vazio

                    let disciplina = &self.disciplinas[id_disciplina as usize];

                    // prof_matriz começa como cópia de prof.horarios (0, 1)
                    // Para cada disciplina alocada, decrementa a disponibilidade dos professores daquela disciplina
                    for &prof_id in &disciplina.professores {
                        let slot_idx = tempo * QUANTOS_DIAS + dia_idx;
                        prof_matriz[prof_id][slot_idx] -= 1;
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

                    if !turma.horarios.possui(dia, tempo) {
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
                    let slot_idx = tempo * QUANTOS_DIAS + dia_idx;

                    // Regra: Disponibilidade do professor e sem conflito entre turmas
                    for &prof_id in &disciplina.professores {
                        let disponibilidade = prof_matriz[prof_id][slot_idx];
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

    fn mutate(&mut self, quadro: &mut Self::Gene, mutation_rate: f64) {
        // Mutação de trocas dentro das turmas
        // A FAZER: sortear só valores válidos, desse jeito a taxa de mutação efetiva pode ser menor que a definida
        for_each_poisson(quadro.len(), mutation_rate, |idx| {
            let (turma_id, _dia, _tempo) = self.from_quadro_index(idx);

            // Escolhe aleatoriamente outro tempo dentro da mesma turma e dia para trocar
            let outro_idx = self.to_quadro_index(
                turma_id, 
                DiaSemana::from_index(random_range(0, QUANTOS_DIAS)),
                random_range(0, self.n_tempos)
            );

            // Só troca se ambos os tempos forem alocáveis (não -1)
            if quadro[idx] != -1 && quadro[outro_idx] != -1 {
                quadro.swap(idx, outro_idx);
            }
        });
    }

    fn crossover(
        &mut self,
        child_a: &mut Self::Gene,
        child_b: &mut Self::Gene,
        parent_a: &Self::Gene,
        parent_b: &Self::Gene
    )
    {
        // Crossover por blocos de turmas: para cada turma, escolhe aleatoriamente um dos pais
        // Os filhos recebem blocos complementares (se childA ← parentA, childB ← parentB)
        for turma in &self.turmas {
            let escolha_a = random_bool();
            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                for tempo in 0..self.n_tempos {
                    let idx = self.to_quadro_index(turma.id, dia, tempo);
                    if escolha_a {
                        child_a[idx] = parent_a[idx];
                        child_b[idx] = parent_b[idx];
                    } else {
                        child_a[idx] = parent_b[idx];
                        child_b[idx] = parent_a[idx];
                    }
                }
            }
        }            
    }
}

crate::ga_runner! {
    /// Runner concreto do problema de geração de horários exposto ao JS via WASM.
    HorarioGAProblemRunner,
    problem: RegrasHorario,
    new(formulario: wasm_bindgen::JsValue) => RegrasHorario::new(
        serde_wasm_bindgen::from_value(formulario).expect("Erro ao desserializar o formulário de regras de horário")
    ),
}

