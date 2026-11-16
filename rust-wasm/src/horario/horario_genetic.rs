use crate::{console_log, genetic::{ga::GAConfig, operators::{CrossoverIPX, poisson_knuth_sample}, problems::GAProblem}, horario::{BuffersQualidade, DiaSemana, Horario, QUANTOS_DIAS, QuadroHorario, RegrasHorario, TabelasQualidade}, random::{random_bool, random_range, random_range_except}};

/// # Regras obrigatórias e regras de qualidade
///
/// As regras OBRIGATÓRIAS (professor disponível e sem choque, aulas em conjunto, blocos) são as
/// mesmas da busca exata (Pencilmark): um horário só é válido se não quebra nenhuma.
///
/// As regras de QUALIDADE não invalidam o horário, só dizem qual horário válido é melhor: horários
/// a evitar, jornada e descanso do professor, grupos de aulas partidos pelo intervalo (ver
/// `horario_qualidade.rs`). Elas existem apenas aqui, no algoritmo genético; a busca exata as
/// ignora. Para uma regra de qualidade nunca ser trocada por uma obrigatória, todas as penalidades
/// de qualidade somadas valem menos que a menor penalidade obrigatória.
///
/// Pesos de cada regra no fitness (pontos descontados por unidade de violação) e como as violações
/// são medidas. O fitness é 0 exatamente quando o quadro não viola nenhuma regra, com quaisquer
/// pesos positivos: os pesos e as medidas só mudam o "relevo" que guia a busca.
///
/// O padrão ([`PesosFitness::PADRAO`]) mede tudo em AULAS QUE PRECISAM MUDAR DE LUGAR. Medido em
/// examples/bench_horario_fitness, com 100 sementes e 4 M de avaliações por semente:
///
/// | fitness            | quadro real de faculdade | instância pequena |
/// |--------------------|--------------------------|-------------------|
/// | original           | 3 resolvidas             | 26                |
/// | padrão             | 38                       | 37                |
///
/// O que cada mudança fez (quadro real): contar o conflito de professor uma vez em vez de duas
/// levou de 3 para ~15-28; dar ao conflito metade do peso do horário indisponível, para 38; medir
/// o agrupamento por movimentos vale 38 contra 27 da medida original. Motivo: a mutação troca uma
/// aula por vez, e mover um bloco para outro dia passa por estados com o bloco partido e com o
/// professor em duas turmas; se esses estados de passagem custam mais que o erro que está sendo
/// consertado, a busca fica presa.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PesosFitness {
    /// Por aula e por professor: horário em que ele não trabalha, ou cada turma a mais no mesmo horário.
    pub professor: f64,
    /// Por aula de disciplina unida sem a parceira no mesmo horário.
    pub unidas: f64,
    /// Por unidade de erro de agrupamento (ver `agrupar_por_movimentos`).
    pub agrupar: f64,
    /// Como medir o erro de agrupamento de uma disciplina:
    /// - false: soma, bloco a bloco, da distância até o tamanho ideal (fitness original);
    /// - true: número mínimo de aulas que precisam mudar de lugar para os blocos ficarem certos.
    pub agrupar_por_movimentos: bool,
    /// Como medir o erro de professor num horário com N turmas dele:
    /// - false: cada uma das N aulas conta (N - disponível) — um conflito de 2 turmas vale 2 (fitness original);
    /// - true: conta só as aulas que precisam sair (N - disponível) — um conflito de 2 turmas vale 1.
    pub professor_por_movimentos: bool,
    /// Só com `professor_por_movimentos`: peso de cada turma a mais do mesmo professor num horário
    /// em que ele trabalha (conflito). `professor` fica sendo o peso da aula em horário em que ele
    /// não trabalha. Sem `professor_por_movimentos` os dois casos usam `professor`.
    pub conflito: f64,
}

impl PesosFitness {
    /// Os pesos e a medida do fitness original.
    /// O padrão: tudo medido em aulas a mover, conflito com metade do peso do horário indisponível.
    pub const PADRAO: Self = Self {
        professor: 100.0,
        conflito: 50.0,
        unidas: 30.0,
        agrupar: 20.0,
        agrupar_por_movimentos: true,
        professor_por_movimentos: true,
    };

    pub const ORIGINAL: Self = Self {
        professor: 50.0,
        unidas: 30.0,
        agrupar: 20.0,
        agrupar_por_movimentos: false,
        professor_por_movimentos: false,
        conflito: 50.0,
    };
}

impl Default for PesosFitness {
    fn default() -> Self {
        Self::PADRAO
    }
}

/// Operadores do algoritmo genético que podem ser ligados e desligados (para comparar no benchmark
/// `bench_operadores_horario`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OperadoresGA {
    /// População inicial com as aulas agrupadas já montadas em blocos (em vez de aula por aula).
    pub blocos_iniciais: bool,
    /// Probabilidade de, ao sortear uma aula de disciplina agrupada, a mutação mover o trecho
    /// inteiro de aulas seguidas dela (troca com outro trecho do mesmo tamanho na turma) em vez de
    /// só a aula.
    pub troca_de_blocos: f64,
}

impl OperadoresGA {
    /// Só os operadores originais: inicialização aula por aula e troca de duas células.
    pub const ORIGINAIS: Self = Self { blocos_iniciais: false, troca_de_blocos: 0.0 };
}

impl Default for OperadoresGA {
    fn default() -> Self {
        Self { blocos_iniciais: true, troca_de_blocos: 0.5 }
    }
}

/// Tabelas derivadas das regras, montadas uma vez, para o fitness percorrer só o que interessa:
/// as células ativas e os dias com aula, sem seguir ponteiros de `Vec` dentro de `Vec`.
#[derive(Clone)]
struct TabelasFitness {
    /// Horários por professor (7 dias x n_tempos).
    slots: usize,
    /// Por professor e horário: 1 = disponível, 0 = não trabalha (cópia de `Professor::horarios`).
    disponibilidade: Vec<i32>,
    /// Células em que a turma tem aula: (índice no quadro, horário = tempo * 7 + dia).
    ativas: Vec<(u32, u32)>,
    /// Células em que a turma não tem aula (devem valer -1).
    inativas: Vec<u32>,
    /// Um dia de uma turma, se ela tem aula nele: intervalo [início, fim) no quadro.
    linhas: Vec<(u32, u32)>,
    /// Por disciplina: intervalo em `professores`.
    prof_de: Vec<(u32, u32)>,
    professores: Vec<u32>,
    /// Por disciplina: intervalo em `unidas` e o início da sua turma no quadro.
    unidas_de: Vec<(u32, u32)>,
    inicio_turma: Vec<u32>,
    /// (valor esperado na célula da turma parceira, início da turma parceira no quadro)
    unidas: Vec<(i32, u32)>,
    /// Por disciplina: tamanho do bloco (0 = sem agrupamento), se os blocos não podem se tocar,
    /// e onde começam os seus restos em `HorarioGAState::restos`.
    agrupar: Vec<i32>,
    dividir: Vec<bool>,
    restos_de: Vec<u32>,
}

impl TabelasFitness {
    fn new(r: &RegrasHorario) -> Self {
        let slots = QUANTOS_DIAS * r.n_tempos;
        let por_turma = QUANTOS_DIAS * r.n_tempos;
        let (mut ativas, mut inativas, mut linhas) = (Vec::new(), Vec::new(), Vec::new());
        for turma in &r.turmas {
            for dia in DiaSemana::TODOS {
                let inicio = r.to_quadro_index(turma.id, dia, 0);
                let mut tem_aula = false;
                for tempo in 0..r.n_tempos {
                    if turma.horarios.get(dia, tempo) == 1 {
                        ativas.push(((inicio + tempo) as u32, (tempo * QUANTOS_DIAS + dia.to_index()) as u32));
                        tem_aula = true;
                    } else {
                        inativas.push((inicio + tempo) as u32);
                    }
                }
                if tem_aula {
                    linhas.push((inicio as u32, (inicio + r.n_tempos) as u32));
                }
            }
        }

        let (mut prof_de, mut professores) = (Vec::new(), Vec::new());
        let (mut unidas_de, mut unidas) = (Vec::new(), Vec::new());
        let mut restos_de = Vec::new();
        let mut n_restos = 0u32;
        for d in &r.disciplinas {
            let ini = professores.len() as u32;
            professores.extend(d.professores.iter().map(|&p| p as u32));
            prof_de.push((ini, professores.len() as u32));

            let ini = unidas.len() as u32;
            unidas.extend(d.disciplinas_unidas.iter().map(|&u| (u as i32 + 1, (r.disciplinas[u].turma_id * por_turma) as u32)));
            unidas_de.push((ini, unidas.len() as u32));

            // Uma disciplina tem no máximo um bloco por aula
            restos_de.push(n_restos);
            n_restos += d.aulas.max(1) as u32;
        }
        restos_de.push(n_restos);

        Self {
            slots,
            disponibilidade: r.professores.iter().flat_map(|p| p.horarios.slots.iter().copied()).collect(),
            ativas,
            inativas,
            linhas,
            prof_de,
            professores,
            unidas_de,
            inicio_turma: r.disciplinas.iter().map(|d| (d.turma_id * por_turma) as u32).collect(),
            unidas,
            agrupar: r.disciplinas.iter().map(|d| d.agrupar.max(0)).collect(),
            dividir: r.disciplinas.iter().map(|d| d.dividir).collect(),
            restos_de,
        }
    }
}

#[derive(Clone)]
pub struct HorarioGAState {
    crossover_ipx: CrossoverIPX<i32>,

    //  -1 = não dá aula
    //   0 = não está definido
    // > 0 = Índice da disciplina
    prof_matriz: Vec<Horario>,

    tabelas: TabelasFitness,
    /// Por professor e horário: disponibilidade menos o número de turmas alocadas (buffer de trabalho).
    ocupacao: Vec<i32>,
    /// Restos dos blocos de cada disciplina (tamanho do bloco módulo G), e quantos há (buffers de trabalho).
    restos: Vec<u8>,
    n_restos: Vec<u8>,
    /// Por disciplina: aulas que precisam sair de onde estão (blocos grudados, com `dividir`).
    sobras: Vec<u16>,
    /// Regras de qualidade (ver `horario_qualidade.rs`).
    qualidade: TabelasQualidade,
    buffers_qualidade: BuffersQualidade,
}

impl GAProblem for RegrasHorario {
    /// Representação linearizada do multiconjunto que é o quadro de horários
    /// > Wikipedia: Em matemática, um multiconjunto (ou ainda multiset ou mset) é uma modificação do conceito de um conjunto que, diferentemente de um conjunto, permite várias instâncias para cada um de seus elementos.
    type Gene = QuadroHorario;
    type State = HorarioGAState;

    fn initial_state(&self) -> Self::State { 
        let menor_obrigatoria = self.pesos.professor.min(self.pesos.conflito).min(self.pesos.unidas).min(self.pesos.agrupar);
        let qualidade = TabelasQualidade::new(self, menor_obrigatoria);
        HorarioGAState {
            // Capacidade = tamanho do slice de uma turma (pior caso do IPX)
            crossover_ipx: CrossoverIPX::new(QUANTOS_DIAS * self.n_tempos),
            // Pré-aloca e pré-popula para evitar alocações no hot path do fitness
            prof_matriz: self.professores.iter().map(|p| p.horarios.clone()).collect(),
            ocupacao: vec![0; self.professores.len() * QUANTOS_DIAS * self.n_tempos],
            restos: vec![0; self.disciplinas.iter().map(|d| d.aulas.max(1) as usize).sum()],
            n_restos: vec![0; self.disciplinas.len()],
            sobras: vec![0; self.disciplinas.len()],
            tabelas: TabelasFitness::new(self),
            buffers_qualidade: qualidade.buffers(),
            qualidade,
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

    fn mutate(&self, _: &mut Self::State, quadro: &mut Self::Gene, mutation_rate: f64) {
        let troca_de_blocos = self.operadores.troca_de_blocos;
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

            // Aula de disciplina agrupada: às vezes move o trecho inteiro em vez de só a aula
            if troca_de_blocos > 0.0 && self.disciplina_em(quadro[idx]).is_some_and(|d| self.disciplinas[d].agrupar > 0)
                && fastrand::f64() < troca_de_blocos
                && self.trocar_trecho(quadro, idx)
            {
                continue;
            }

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

impl RegrasHorario {
    /// Mutação "troca de blocos": o trecho de aulas seguidas da mesma disciplina que contém a célula
    /// `idx` troca de lugar com outro trecho do mesmo tamanho, em outro dia ou tempo da turma (só
    /// células do horário dela). Assim um bloco muda de lugar inteiro, sem passar por estados com
    /// ele partido. Mantém o multiconjunto da turma. Retorna false se não achou para onde trocar.
    fn trocar_trecho(&self, quadro: &mut [i32], idx: usize) -> bool {
        let n = self.n_tempos;
        let v = quadro[idx];
        let linha = idx - idx % n;
        let (mut a, mut b) = (idx, idx + 1);
        while a > linha && quadro[a - 1] == v { a -= 1; }
        while b < linha + n && quadro[b] == v { b += 1; }
        let k = b - a;
        let inicio_turma = linha - linha % (QUANTOS_DIAS * n);
        for _ in 0..10 {
            let dia = random_range(0, QUANTOS_DIAS);
            let t = random_range(0, n - k + 1);
            let destino = inicio_turma + dia * n + t;
            // Sem sobrepor a origem e só dentro do horário da turma
            if destino < b && a < destino + k { continue; }
            if quadro[destino..destino + k].iter().any(|&x| x == -1) { continue; }
            for j in 0..k {
                quadro.swap(a + j, destino + j);
            }
            return true;
        }
        false
    }

    /// Quadro inicial com as aulas agrupadas já em blocos: para cada turma, os blocos (do maior para
    /// o menor) vão para posições sorteadas entre as que cabem, de preferência onde os professores
    /// estão disponíveis e, com "não emendar", sem encostar em outro bloco da mesma disciplina. Se um
    /// bloco não cabe em lugar nenhum, as aulas dele entram soltas. Depois as aulas sem agrupamento
    /// e os horários vagos preenchem o resto, ao acaso. O multiconjunto de cada turma é o mesmo de
    /// `random_genes` sem blocos.
    pub fn genes_com_blocos(&self) -> QuadroHorario {
        let n = self.n_tempos;
        let mut genes = self.get_quadro_vazio();
        let pode_prof = |d: usize, celula: usize| {
            let (_, dia, tempo) = self.from_quadro_index(celula);
            self.disciplinas[d].professores.iter().all(|&p| self.professores[p].horarios.get(dia, tempo) == 1)
        };
        for turma in &self.turmas {
            let inicio = turma.id * QUANTOS_DIAS * n;
            // (disciplina, tamanho) dos blocos, e as peças soltas
            let mut blocos: Vec<(usize, usize)> = Vec::new();
            let mut soltas: Vec<i32> = Vec::new();
            for d in self.disciplinas.iter().filter(|d| d.turma_id == turma.id) {
                let g = d.agrupar.max(0);
                let (n_blocos, resto) = if g > 0 { (d.aulas / g, d.aulas % g) } else { (0, d.aulas) };
                blocos.extend((0..n_blocos).map(|_| (d.id, g as usize)));
                soltas.extend((0..resto).map(|_| d.id as i32 + 1));
            }
            soltas.extend((0..turma.folga).map(|_| self.vago()));
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
                        let encosta = self.disciplinas[d].dividir
                            && ((t > 0 && genes[ini - 1] == valor) || (t + k < n && genes[ini + k] == valor));
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
        genes
    }

    /// Fitness original, em várias passadas pelo quadro. Mantido como referência: os testes
    /// conferem que `fitness_rapido` com os pesos originais dá exatamente o mesmo valor.
    pub fn fitness_original(&self, state: &mut HorarioGAState, quadro: &[i32]) -> f64 {
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

                    let Some(id_disciplina) = self.disciplina_em(quadro[self.to_quadro_index(turma.id, dia, tempo)]) else { continue }; // vago ou não resolvido

                    let disciplina = &self.disciplinas[id_disciplina];

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

                    if quadro[index] <= 0 {
                        // Deveria ter uma disciplina alocada (ou ficar vago)
                        fitness -= 1000.0;
                        continue; // slot vazio
                    }
                    let Some(id_disciplina) = self.disciplina_em(quadro[index]) else { continue }; // vago

                    let disciplina = &self.disciplinas[id_disciplina];

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

    /// Fitness do quadro: 0 quando não quebra nenhuma regra, obrigatória ou de qualidade; negativo
    /// proporcional às violações (ver [`PesosFitness`]). Um quadro VÁLIDO (sem violação obrigatória)
    /// tem fitness entre 0 e menos a menor penalidade obrigatória, exclusive. Faz uma passada pelas células ativas para a ocupação dos professores,
    /// outra para as penalidades de professor e de disciplinas unidas, e uma pelos dias com aula
    /// para os blocos.
    pub fn fitness_rapido(&self, state: &mut HorarioGAState, quadro: &[i32]) -> f64 {
        let HorarioGAState { tabelas: t, ocupacao, restos, n_restos, sobras, qualidade: tabelas_q, buffers_qualidade: buffers_q, .. } = state;
        let pesos = self.pesos;

        // Ocupação de cada professor em cada horário: disponibilidade (1 ou 0) menos uma por turma.
        // Contar todas as turmas antes de penalizar evita o viés de a turma de id menor "ganhar".
        //
        // Com `professor_por_movimentos` as unidades saem desta mesma passada: cada aula que deixa a
        // ocupação negativa é uma aula que precisa sair dali — todas, onde o professor não trabalha
        // (`u_professor`); todas menos a primeira, onde ele trabalha (`u_conflito`).
        let mut u_professor = 0i32;
        let mut u_conflito = 0i32;
        let n_disc = t.prof_de.len() as i32;
        ocupacao.copy_from_slice(&t.disponibilidade);
        for &(i, horario) in &t.ativas {
            let d = quadro[i as usize] - 1;
            if d < 0 || d >= n_disc { continue; } // não resolvido ou vago
            let (ini, fim) = t.prof_de[d as usize];
            for &p in &t.professores[ini as usize..fim as usize] {
                let k = p as usize * t.slots + horario as usize;
                ocupacao[k] -= 1;
                if pesos.professor_por_movimentos && ocupacao[k] < 0 {
                    if t.disponibilidade[k] == 0 { u_professor += 1 } else { u_conflito += 1 }
                }
            }
        }

        // Células fora do lugar (nunca acontece com os operadores do GA, que preservam a estrutura)
        let mut estrutura = 0u32;
        // Sem `professor_por_movimentos`: por aula, quanto a ocupação passou do disponível
        // Disciplinas unidas: aulas sem a parceira no mesmo horário
        let mut u_unidas = 0u32;
        for &(i, horario) in &t.ativas {
            let d = quadro[i as usize] - 1;
            if d < 0 {
                estrutura += 1; // deveria ter uma disciplina (ou ficar vago)
                continue;
            }
            if d >= n_disc { continue; } // vago
            let d = d as usize;
            if !pesos.professor_por_movimentos {
                let (ini, fim) = t.prof_de[d];
                for &p in &t.professores[ini as usize..fim as usize] {
                    let livre = ocupacao[p as usize * t.slots + horario as usize];
                    if livre < 0 {
                        u_professor -= livre;
                    }
                }
            }
            let (ini, fim) = t.unidas_de[d];
            for &(esperado, inicio_parceira) in &t.unidas[ini as usize..fim as usize] {
                if quadro[(i - t.inicio_turma[d] + inicio_parceira) as usize] != esperado {
                    u_unidas += 1;
                }
            }
        }
        for &i in &t.inativas {
            if quadro[i as usize] != -1 {
                estrutura += 1; // deveria estar vazio
            }
        }
        // Agrupamento: percorre cada dia uma vez, bloco a bloco
        n_restos.fill(0);
        sobras.fill(0);
        let mut u_agrupar = 0i32;
        for &(inicio, fim) in &t.linhas {
            let (mut i, fim) = (inicio as usize, fim as usize);
            while i < fim {
                let v = quadro[i];
                let mut j = i + 1;
                if v <= 0 || v > n_disc {
                    i = j;
                    continue;
                }
                while j < fim && quadro[j] == v {
                    j += 1;
                }
                let d = (v - 1) as usize;
                let g = t.agrupar[d];
                if g > 0 {
                    let tamanho = (j - i) as i32;
                    if !pesos.agrupar_por_movimentos {
                        // Distância do bloco ao tamanho ideal: G com dividir, senão o múltiplo de G mais próximo
                        let ideal = if t.dividir[d] { g } else { ((tamanho as f64 / g as f64).round() as i32) * g };
                        u_agrupar += (tamanho - ideal).abs();
                    } else {
                        let (blocos, resto) = (tamanho / g, tamanho % g);
                        if t.dividir[d] && blocos >= 1 {
                            // Blocos não podem se tocar: os blocos a mais e o resto têm que sair daqui
                            sobras[d] += ((blocos - 1) * g + resto) as u16;
                        } else if resto > 0 {
                            // Pedaço que pode ser completado por outras aulas ou desfeito: decide abaixo
                            let k = n_restos[d] as usize;
                            let ini = t.restos_de[d] as usize;
                            if ini + k < t.restos_de[d + 1] as usize {
                                restos[ini + k] = resto as u8;
                                n_restos[d] += 1;
                            }
                        }
                    }
                }
                i = j;
            }
        }
        if pesos.agrupar_por_movimentos {
            // Menor número de aulas a mover. Há R aulas fora de bloco: as que sobram de blocos
            // grudados (têm que sair) e as que estão em pedaços. Elas formam R / G blocos; vale mais
            // completar os pedaços maiores e desfazer os menores. Movem-se as sobras e as aulas dos
            // pedaços desfeitos — as dos pedaços completados ficam onde estão.
            for d in 0..n_restos.len() {
                let k = n_restos[d] as usize;
                if k == 0 && sobras[d] == 0 { continue; }
                let ini = t.restos_de[d] as usize;
                let pedacos = &mut restos[ini..ini + k];
                pedacos.sort_unstable_by(|a, b| b.cmp(a));
                let total: i32 = sobras[d] as i32 + pedacos.iter().map(|&r| r as i32).sum::<i32>();
                let completos = (total / t.agrupar[d]) as usize;
                let ficam: i32 = pedacos.iter().take(completos).map(|&r| r as i32).sum();
                u_agrupar += total - ficam;
            }
        }

        // Regras de qualidade: sempre menos que a menor penalidade obrigatória
        let qualidade = if tabelas_q.ativa { tabelas_q.custo(&tabelas_q.medir(self, quadro, buffers_q, None)) } else { 0.0 };

        -(estrutura as f64 * 1000.0
            + qualidade
            + u_professor as f64 * pesos.professor
            + u_conflito as f64 * pesos.conflito
            + u_unidas as f64 * pesos.unidas
            + u_agrupar as f64 * pesos.agrupar)
    }
}

/// Indivíduos da população por aula a alocar (ver [`config_ga_horario`]).
pub const POPULACAO_POR_AULA: usize = 4;

/// Configuração do GA para o quadro de horários usada pela página.
///
/// População: [`POPULACAO_POR_AULA`] por aula que de fato vai para o quadro
/// ([`RegrasHorario::aulas_a_alocar`]). Antes era por célula do quadro (turmas × 7 dias × tempos),
/// o que conta dias e turnos em que a turma não tem aula: no técnico (19 turmas em três turnos),
/// 1596 células para 614 aulas, uma população 2,6 vezes maior e gerações 2,6 vezes mais lentas.
///
/// A mutação continua medida no quadro todo (é nele que ela sorteia as posições): em média um
/// gene trocado por indivíduo.
pub fn config_ga_horario(regras: &RegrasHorario) -> GAConfig {
    let tamanho = regras.tamanho_quadro();
    GAConfig {
        population_size: (regras.aulas_a_alocar() * POPULACAO_POR_AULA).max(64),
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
            "aulas": [{ "id": "A", "turmas": ["T"], "recursos": [], "aulasSemana": 4, "bloco": 2 }, { "id": "B", "turmas": ["T"], "recursos": [], "aulasSemana": 1 }],
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
        regras.operadores.troca_de_blocos = 1.0;
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

    /// O fitness em uma passada tem que dar EXATAMENTE o valor do fitness original.
    #[test]
    fn fitness_rapido_igual_ao_original() {
        for nome in ["pequena", "media", "faculdade-anonimizado", "inviavel"] {
            fastrand::seed(11);
            let mut regras = carregar(nome);
            regras.pesos = PesosFitness::ORIGINAL;
            let mut estado = regras.initial_state();
            let quadros = quadros_de_teste(&regras, 40);
            let mut distintos = std::collections::HashSet::new();
            for q in &quadros {
                let original = regras.fitness_original(&mut estado, q);
                assert_eq!(regras.fitness_rapido(&mut estado, q), original, "{nome}");
                distintos.insert(original as i64);
            }
            assert!(distintos.len() > 10, "{nome}: os quadros de teste deveriam ter fitness variados");

            // Estrutura quebrada também é penalizada do mesmo jeito
            let mut q = quadros[0].clone();
            let ativa = q.iter().position(|&v| v > 0).unwrap();
            q[ativa] = 0;
            if let Some(inativa) = q.iter().position(|&v| v == -1) {
                q[inativa] = 1;
            }
            assert_eq!(regras.fitness_rapido(&mut estado, &q), regras.fitness_original(&mut estado, &q), "{nome}: estrutura");
        }
    }

    /// Medir o agrupamento por movimentos muda os valores, mas não o que é um quadro válido:
    /// vale 0 exatamente nos mesmos quadros, e nunca penaliza mais que a medida original.
    #[test]
    fn agrupar_por_movimentos_zera_nos_mesmos_quadros() {
        for nome in ["pequena", "media", "faculdade-anonimizado"] {
            fastrand::seed(12);
            let mut original = carregar(nome);
            original.pesos = PesosFitness::ORIGINAL;
            let mut movimentos = original.clone();
            movimentos.pesos.agrupar_por_movimentos = true;
            // Só o agrupamento, para comparar as duas medidas isoladas
            let so_agrupar = |r: &RegrasHorario| { let mut r = r.clone(); r.pesos.professor = 0.0; r.pesos.unidas = 0.0; r };
            let (ag_original, ag_movimentos) = (so_agrupar(&original), so_agrupar(&movimentos));
            let mut estado = original.initial_state();

            let mut quadros = quadros_de_teste(&original, 40);
            // Soluções válidas do Pencilmark e versões com poucas trocas (quase válidas)
            for semente in 1..=3 {
                fastrand::seed(semente);
                let pm = crate::horario::HorarioRegrasPencilmark::new(original.clone());
                let (vazio, n) = (pm.quadro_vazio(), pm.n_possibs());
                let mut exec = crate::pencilmark::ExecucaoPencilmark::new(pm, vazio, n, 1, Some(10));
                exec.executar(200_000);
                let Some(sol) = exec.solver.solucoes.first() else { continue };
                assert_eq!(original.fitness_rapido(&mut estado, sol), 0.0, "{nome}: solução do Pencilmark");
                assert_eq!(movimentos.fitness_rapido(&mut estado, sol), 0.0, "{nome}: solução do Pencilmark (movimentos)");
                let mut q = sol.clone();
                let uma_troca = 1.0 / q.len() as f64;
                for _ in 0..6 {
                    original.mutate(&mut estado, &mut q, uma_troca);
                    quadros.push(q.clone());
                }
            }

            let mut diferentes = 0;
            for q in &quadros {
                let (a, b) = (ag_original.fitness_rapido(&mut estado, q), ag_movimentos.fitness_rapido(&mut estado, q));
                assert_eq!(a == 0.0, b == 0.0, "{nome}: original {a}, movimentos {b}");
                assert!(b >= a, "{nome}: movimentos ({b}) penalizou mais que o original ({a})");
                diferentes += (a != b) as usize;
                // E o fitness completo zera junto, em qualquer combinação das duas medidas e de pesos
                let zero = original.fitness_rapido(&mut estado, q) == 0.0;
                for (mov_agrupar, mov_professor, peso_professor) in [(true, false, 50.0), (false, true, 50.0), (true, true, 50.0), (true, true, 300.0)] {
                    let mut r = original.clone();
                    r.pesos = PesosFitness { agrupar_por_movimentos: mov_agrupar, professor_por_movimentos: mov_professor, professor: peso_professor, conflito: peso_professor / 3.0, ..r.pesos };
                    let f = r.fitness_rapido(&mut estado, q);
                    assert_eq!(f == 0.0, zero, "{nome}: movimentos agrupar={mov_agrupar} professor={mov_professor}: {f}");
                    assert!(f <= 0.0);
                }
                // Professor por movimentos nunca penaliza mais que o original (mesmo peso)
                let mut r = original.clone();
                r.pesos.professor_por_movimentos = true;
                assert!(r.fitness_rapido(&mut estado, q) >= original.fitness_rapido(&mut estado, q));
            }
            assert!(diferentes > 0, "{nome}: as duas medidas deveriam diferir em algum quadro");
        }
    }

    /// Casos calculados à mão da medida por movimentos (uma turma, um dia de 8 tempos, uma disciplina
    /// agrupada "A" e disciplinas soltas para preencher).
    #[test]
    fn agrupar_por_movimentos_casos() {
        let caso = |g: i32, dividir: bool, dia: &str| -> (f64, f64) {
            let aulas_a = dia.matches('A').count() as i32;
            let tempos: Vec<i32> = (1..=dia.len() as i32).collect();
            // Cada "." é uma disciplina diferente de 1 aula, sem agrupamento
            let mut aulas = vec![format!(r#"{{ "id": "A", "turmas": ["T"], "recursos": [], "aulasSemana": {aulas_a}, "bloco": {g}, "emendar": {} }}"#, !dividir)];
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
            let mut regras = regras;
            regras.pesos = PesosFitness::ORIGINAL;
            let mut estado = regras.initial_state();
            let mut mov = regras.clone();
            mov.pesos.agrupar_por_movimentos = true;
            // Em unidades (peso 20)
            (-regras.fitness_rapido(&mut estado, &quadro) / 20.0, -mov.fitness_rapido(&mut estado, &quadro) / 20.0)
        };
        // (G, dividir, dia) -> (original, movimentos)
        assert_eq!(caso(2, false, "AA.."), (0.0, 0.0));
        assert_eq!(caso(2, false, "A.A."), (2.0, 1.0), "bloco de 2 partido: move 1 aula");
        assert_eq!(caso(2, false, "AAA.A..."), (2.0, 1.0), "3 + 1: move 1 aula");
        assert_eq!(caso(2, false, "A.A.A.A."), (4.0, 2.0), "1+1+1+1 com G=2: move 2");
        assert_eq!(caso(2, false, "AAAA...."), (0.0, 0.0), "4 seguidas valem sem dividir");
        assert_eq!(caso(2, true, "AAAA...."), (2.0, 2.0), "com dividir, um bloco de 2 tem que sair");
        assert_eq!(caso(2, true, "AA.AA..."), (0.0, 0.0));
        assert_eq!(caso(2, true, "AAA.A..."), (2.0, 1.0), "dividir, 3 + 1: a sobra do 3 completa o 1");
        assert_eq!(caso(4, false, "A.A.A.A."), (4.0, 3.0), "1+1+1+1 com G=4: move 3");
        assert_eq!(caso(4, false, "AA.AA..."), (4.0, 2.0), "2 + 2 com G=4: move 2");
        assert_eq!(caso(4, false, "AAA.A..."), (2.0, 1.0), "3 + 1 com G=4: move 1");
        assert_eq!(caso(4, false, "AA.A.A.."), (4.0, 2.0), "2 + 1 + 1 com G=4: move 2");
        assert_eq!(caso(4, false, "AAAA...."), (0.0, 0.0));
        assert_eq!(caso(2, true, "AAAA.A.A"), (4.0, 2.0), "dividir, 4 + 1 + 1: o bloco a mais completa os dois pedaços");
        assert_eq!(caso(2, true, "AAAAAA.."), (4.0, 4.0), "dividir, 6 seguidas: dois blocos têm que sair");
    }
}
