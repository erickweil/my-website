//! Regras do gerador de horários para o solver Pencilmark — port do antigo
//! `horario-pencilmark.ts` (`HorarioSolverPencilmark`, removido; ver o histórico do git).
//! Também são as regras usadas para validar o resultado dos dois solvers (`horario_resultado.rs`).
//!
//! Mantém o comportamento do TS: cada célula do quadro tem `n_possibs = disciplinas.len() + 1`
//! possibilidades (todas as disciplinas, de todas as turmas, e o horário vago), e as de outra turma
//! são descartadas em `pode_disciplina`.
//!
//! Dois modos:
//! - **Busca** ([`HorarioRegrasPencilmark::new`]): a busca exata não tem regras de qualidade, então
//!   trata duas delas como obrigatórias: o horário que o professor pediu para evitar é
//!   indisponível, e o horário vago só pode ficar nas pontas do turno (nunca entre duas aulas).
//! - **Validação** ([`HorarioRegrasPencilmark::so_obrigatorias`]): só as regras obrigatórias. É o
//!   que diz se um horário (de qualquer um dos dois métodos) é válido; o resto é qualidade.

use std::sync::Arc;

use crate::{
    horario::{DiaSemana, Horario, QUANTOS_DIAS, QuadroHorario, RegrasHorario},
    pencilmark::{Possib, RegrasQuadro},
};

// Por que uma disciplina não pode ficar numa célula (ver `motivo_impedimento`). Os recursos de
// ocupação única do formulário ("professores") incluem os ambientes, daí o texto.
pub const MOTIVO_OUTRA_TURMA: &str = "A disciplina é de outra turma";
pub const MOTIVO_AULAS_DEMAIS: &str = "A disciplina tem mais aulas no horário do que o previsto";
pub const MOTIVO_PROFESSOR: &str = "Professor ou ambiente indisponível neste horário, ou ocupado em outra turma";
pub const MOTIVO_BLOCO: &str = "As aulas da disciplina não formam blocos do tamanho definido";
pub const MOTIVO_CONJUNTA: &str = "A aula em conjunto não está no mesmo horário nas turmas que participam";
pub const MOTIVO_EVITAR: &str = "O professor pediu para evitar este horário";
pub const MOTIVO_SEM_FOLGA: &str = "A turma tem mais horários vagos do que a folga entre aulas e horários marcados";
pub const MOTIVO_JANELA: &str = "Horário vago entre duas aulas do mesmo turno";

/// `Clone` é barato (as regras ficam atrás de um `Arc`): a busca exaustiva em paralelo dá uma cópia
/// para cada tarefa.
#[derive(Clone)]
pub struct HorarioRegrasPencilmark {
    pub regras: Arc<RegrasHorario>,
    /// true = modo de busca: evitar e horário vago no meio do turno também são proibidos.
    pub estrito: bool,
    /// Por professor: 1 = pode ter aula (no modo estrito, sem os horários a evitar).
    disponivel: Arc<Vec<Horario>>,

    // Estado derivado do quadro, recalculado em `verificar_quadro`:
    /// Por professor: 1 = disponível, 0 = indisponível OU já ocupado em outra turma neste (dia, tempo)
    prof_matriz: Vec<Horario>,
    /// Por disciplina: quantas aulas já estão alocadas no quadro
    cont_aulas: Vec<i32>,
    /// Por turma: quantos horários vagos já estão no quadro
    cont_vagos: Vec<i32>,
}

impl HorarioRegrasPencilmark {
    /// Regras da busca exata (modo estrito).
    pub fn new(regras: RegrasHorario) -> Self {
        Self::com_modo(regras, true)
    }

    /// Só as regras obrigatórias: para validar um horário.
    pub fn so_obrigatorias(regras: RegrasHorario) -> Self {
        Self::com_modo(regras, false)
    }

    fn com_modo(regras: RegrasHorario, estrito: bool) -> Self {
        let disponivel: Vec<Horario> = regras.professores.iter().map(|p| {
            let mut h = p.horarios.clone();
            if estrito && p.pessoa {
                for (v, &e) in h.slots.iter_mut().zip(&p.evitar.slots) {
                    if e != 0 { *v = 0; }
                }
            }
            h
        }).collect();
        let cont_aulas = vec![0; regras.disciplinas.len()];
        let cont_vagos = vec![0; regras.turmas.len()];
        Self { prof_matriz: disponivel.clone(), disponivel: Arc::new(disponivel), regras: Arc::new(regras), estrito, cont_aulas, cont_vagos }
    }

    /// Número de possibilidades por célula (o `nPossibs` do TS): as disciplinas e o horário vago.
    pub fn n_possibs(&self) -> usize {
        self.regras.disciplinas.len() + 1
    }

    /// No trecho (turno de um dia da turma) da célula `i`, andando a partir dela para um lado: há
    /// uma aula depois de um horário vago? (`com_vago_antes = false`: há qualquer aula?) As
    /// células ainda não resolvidas são puladas.
    fn aula_alem(&self, quadro: &[i32], i: usize, para_frente: bool, com_vago_antes: bool) -> bool {
        let (k, pos) = self.regras.trecho_de[i];
        let celulas = &self.regras.trechos[k as usize].celulas;
        let vago = self.regras.vago();
        let mut viu_vago = !com_vago_antes;
        let mut olhar = |c: usize| -> bool {
            let v = quadro[c];
            if v == vago { viu_vago = true; false } else { v > 0 && viu_vago }
        };
        if para_frente {
            celulas[pos as usize + 1..].iter().any(|&c| olhar(c))
        } else {
            celulas[..pos as usize].iter().rev().any(|&c| olhar(c))
        }
    }

    /// Quadro inicial: 0 onde pode ter aula, -1 onde não haverá aula.
    pub fn quadro_vazio(&self) -> QuadroHorario {
        self.regras.get_quadro_vazio()
    }

    /// `getQuadroValor` do TS: fora dos limites retorna -1.
    #[inline]
    fn valor(&self, quadro: &[i32], turma_id: usize, dia: DiaSemana, tempo: isize) -> i32 {
        if turma_id >= self.regras.turmas.len() || tempo < 0 || tempo as usize >= self.regras.n_tempos {
            return -1;
        }
        quadro[self.regras.to_quadro_index(turma_id, dia, tempo as usize)]
    }

    /// A disciplina pode ser colocada nesta célula (que deve estar vazia no quadro)?
    #[inline]
    pub fn pode_disciplina(&self, quadro: &[i32], id_disc: usize, id_turma: usize, dia: DiaSemana, tempo: usize) -> bool {
        self.motivo_impedimento(quadro, id_disc, id_turma, dia, tempo).is_none()
    }

    /// `podeDisciplina` do TS, dizendo o porquê: `None` se a disciplina pode ser colocada nesta
    /// célula (que deve estar vazia no quadro), ou a regra que impede. O texto vai para o usuário.
    pub fn motivo_impedimento(&self, quadro: &[i32], id_disc: usize, id_turma: usize, dia: DiaSemana, tempo: usize) -> Option<&'static str> {
        if id_disc == self.regras.disciplinas.len() {
            return self.motivo_vago(quadro, id_turma, dia, tempo);
        }
        let disc = &self.regras.disciplinas[id_disc];

        // A disciplina deve ser desta turma
        if disc.turma_id != id_turma {
            return Some(MOTIVO_OUTRA_TURMA);
        }

        // Esgotou o número de aulas a serem escolhidas desta disciplina
        if self.cont_aulas[id_disc] >= disc.aulas {
            return Some(MOTIVO_AULAS_DEMAIS);
        }

        // Os professores devem estar disponíveis (e livres) neste tempo
        for &prof_id in &disc.professores {
            if self.prof_matriz[prof_id].get(dia, tempo) == 0 {
                let so_evitar = self.estrito && self.regras.professores[prof_id].horarios.get(dia, tempo) != 0
                    && self.disponivel[prof_id].get(dia, tempo) == 0;
                return Some(if so_evitar { MOTIVO_EVITAR } else { MOTIVO_PROFESSOR });
            }
        }

        // As aulas devem ser agrupadas em blocos de G aulas consecutivas.
        // dividir → cada bloco tem exatamente G; senão → blocos com tamanho múltiplo de G.
        if disc.agrupar > 0 {
            let g = disc.agrupar as isize;
            let alvo = id_disc as i32 + 1;
            let t = tempo as isize;

            // Aulas consecutivas desta disciplina imediatamente à esquerda e à direita
            let mut left_run: isize = 0;
            while self.valor(quadro, id_turma, dia, t - left_run - 1) == alvo {
                left_run += 1;
            }
            let mut right_run: isize = 0;
            while self.valor(quadro, id_turma, dia, t + right_run + 1) == alvo {
                right_run += 1;
            }

            let current_run = left_run + 1 + right_run;

            // Com dividir, o bloco não pode passar de G (blocos não se tocam)
            if disc.dividir && current_run > g {
                return Some(MOTIVO_BLOCO);
            }

            // Bloco fechado dos dois lados (não pode mais crescer)? -1 (fora/sem aula) ou outra
            // disciplina = bloqueado; 0 = célula livre, ainda pode crescer.
            let left_blocked = self.valor(quadro, id_turma, dia, t - left_run - 1) != 0;
            let right_blocked = self.valor(quadro, id_turma, dia, t + right_run + 1) != 0;
            if left_blocked && right_blocked {
                let invalido = if disc.dividir { current_run != g } else { current_run % g != 0 };
                if invalido {
                    return Some(MOTIVO_BLOCO);
                }
            }
        }

        // Disciplinas unidas devem ser escolhidas juntas: nas turmas parceiras, o mesmo (dia, tempo)
        // deve estar vazio ou com a disciplina unida correspondente.
        for &unida_id in &disc.disciplinas_unidas {
            let unida_turma = self.regras.disciplinas[unida_id].turma_id;
            let v = self.valor(quadro, unida_turma, dia, tempo as isize);
            if v != 0 && v != unida_id as i32 + 1 {
                return Some(MOTIVO_CONJUNTA);
            }
        }

        if let Some(m) = self.motivo_conjunta_reversa(quadro, id_disc, id_turma, dia, tempo) {
            return Some(m);
        }

        // Modo estrito: a aula não pode ficar além de um horário vago que já tem aula do outro lado
        if self.estrito {
            let i = self.regras.to_quadro_index(id_turma, dia, tempo);
            if self.aula_alem(quadro, i, false, true) || self.aula_alem(quadro, i, true, true) {
                return Some(MOTIVO_JANELA);
            }
        }

        None
    }

    /// Checagem reversa: se uma disciplina já alocada em outra turma neste (dia, tempo) exige uma
    /// disciplina unida específica NESTA turma, só essa disciplina pode ser colocada aqui (nem o
    /// horário vago).
    fn motivo_conjunta_reversa(&self, quadro: &[i32], id_disc: usize, id_turma: usize, dia: DiaSemana, tempo: usize) -> Option<&'static str> {
        for outra in &self.regras.turmas {
            if outra.id == id_turma {
                continue;
            }
            let v = self.valor(quadro, outra.id, dia, tempo as isize);
            let Some(d) = self.regras.disciplina_em(v) else { continue };
            for &unida_da_outra in &self.regras.disciplinas[d].disciplinas_unidas {
                if self.regras.disciplinas[unida_da_outra].turma_id == id_turma && unida_da_outra != id_disc {
                    return Some(MOTIVO_CONJUNTA);
                }
            }
        }
        None
    }

    /// Por que esta célula não pode ficar vaga (ou `None` se pode).
    fn motivo_vago(&self, quadro: &[i32], id_turma: usize, dia: DiaSemana, tempo: usize) -> Option<&'static str> {
        if self.cont_vagos[id_turma] >= self.regras.turmas[id_turma].folga {
            return Some(MOTIVO_SEM_FOLGA);
        }
        if let Some(m) = self.motivo_conjunta_reversa(quadro, usize::MAX, id_turma, dia, tempo) {
            return Some(m);
        }
        // Modo estrito: vago só nas pontas do turno, nunca entre duas aulas
        if self.estrito {
            let i = self.regras.to_quadro_index(id_turma, dia, tempo);
            if self.aula_alem(quadro, i, false, false) && self.aula_alem(quadro, i, true, false) {
                return Some(MOTIVO_JANELA);
            }
        }
        None
    }
}

impl RegrasQuadro for HorarioRegrasPencilmark {
    /// `verificaQuadro` do TS.
    fn verificar_quadro(&mut self, quadro: &[i32]) -> bool {
        // Reinicia contagem de aulas e ocupação dos professores a partir do quadro atual
        for (matriz, disp) in self.prof_matriz.iter_mut().zip(self.disponivel.iter()) {
            matriz.slots.copy_from_slice(&disp.slots);
        }
        self.cont_aulas.fill(0);
        self.cont_vagos.fill(0);
        let vago = self.regras.vago();

        let n_tempos = self.regras.n_tempos;
        for turma in &self.regras.turmas {
            for tempo in 0..n_tempos {
                for dia_idx in 0..QUANTOS_DIAS {
                    let dia = DiaSemana::from_index(dia_idx);
                    let valor = quadro[self.regras.to_quadro_index(turma.id, dia, tempo)];
                    if valor == vago {
                        self.cont_vagos[turma.id] += 1;
                        continue;
                    }
                    let id_disc = valor - 1;
                    if id_disc < 0 {
                        continue; // sem aula nesse espaço
                    }
                    let disc = &self.regras.disciplinas[id_disc as usize];
                    self.cont_aulas[id_disc as usize] += 1;

                    // Marca os professores como ocupados
                    for &prof_id in &disc.professores {
                        self.prof_matriz[prof_id].set(dia, tempo, 0);
                    }
                }
            }
        }

        // Consistência dos agrupamentos já definidos no quadro. Necessário pois o solver pode alocar
        // uma disciplina isolada e só perceber depois (ao fechar os vizinhos) que o bloco não pode
        // atingir o tamanho G.
        for disc in &self.regras.disciplinas {
            if disc.agrupar <= 0 {
                continue;
            }
            let g = disc.agrupar;
            let alvo = disc.id as i32 + 1;

            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                let mut run_start: Option<usize> = None;

                for tempo in 0..=n_tempos {
                    // Sentinela no fim do dia: força o fechamento do último bloco
                    let v = if tempo < n_tempos { quadro[self.regras.to_quadro_index(disc.turma_id, dia, tempo)] } else { -1 };

                    if v == alvo {
                        run_start.get_or_insert(tempo);
                    } else if let Some(inicio) = run_start.take() {
                        let run_length = (tempo - inicio) as i32;

                        // v != 0: fora dos limites, sem aula ou outra disciplina → bloqueado
                        let right_blocked = v != 0;
                        let left_v = if inicio > 0 { quadro[self.regras.to_quadro_index(disc.turma_id, dia, inicio - 1)] } else { -1 };
                        let left_blocked = left_v != 0;

                        if left_blocked && right_blocked {
                            // dividir → exatamente G (blocos não se tocam); senão → múltiplo de G
                            let invalido = if disc.dividir { run_length != g } else { run_length % g != 0 };
                            if invalido {
                                return false;
                            }
                        }
                    }
                }
            }
        }

        true
    }

    /// `verificaCelula` do TS.
    fn verificar_celula(&mut self, quadro: &[i32], possibs: &mut Possib) -> bool {
        let index = possibs.index;
        let (id_turma, dia, tempo) = self.regras.from_quadro_index(index);

        // Já escolhido: só aquela opção. -1 = nenhuma escolha (sem aula), 0 = a escolher.
        let valor = quadro[index];
        if valor != 0 {
            possibs.resetar(false);
            if valor > 0 {
                possibs.marcar((valor - 1) as usize);
            }
            return true;
        }

        // A turma deve poder ter aula nesse horário
        if self.regras.turmas[id_turma].horarios.get(dia, tempo) == 0 {
            possibs.resetar(false);
            return false;
        }

        for id_disc in 0..self.n_possibs() {
            if possibs.ler(id_disc) && !self.pode_disciplina(quadro, id_disc, id_turma, dia, tempo) {
                possibs.desmarcar(id_disc);
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::problems::GAProblem;
    use crate::pencilmark::{solucionar_quadro, ExecucaoPencilmark};
    use wasm_bindgen_test::*;

    fn carregar(nome: &str) -> RegrasHorario {
        RegrasHorario::de_arquivo(&format!("{}/tests/instancias/{nome}.json", env!("CARGO_MANIFEST_DIR")))
    }

    /// Checagem cruzada entre as duas implementações de regras em Rust: toda solução completa do
    /// Pencilmark tem que ter fitness 0 no GA (e respeitar a estrutura do quadro).
    fn assert_fitness_zero_no_ga(regras: &RegrasHorario, quadro: &QuadroHorario) {
        let vazio = regras.get_quadro_vazio();
        assert!(quadro.iter().zip(&vazio).all(|(&q, &v)| (q == -1) == (v == -1)), "estrutura do quadro");
        assert!(!quadro.contains(&0), "solução não pode ter célula vazia");
        let mut state = regras.initial_state();
        assert_eq!(regras.fitness(&mut state, quadro), 0.0, "solução do Pencilmark tem violações no GA");
    }

    /// Quadro real de uma faculdade (3 turmas, agrupamentos, dividir e disciplinas unidas), com os
    /// nomes anonimizados. O Pencilmark resolve em milissegundos.
    #[wasm_bindgen_test(unsupported = test)]
    fn resolve_quadro_real_e_ga_concorda() {
        for seed in 1..=5 {
            fastrand::seed(seed);
            let regras = HorarioRegrasPencilmark::new(carregar("faculdade-anonimizado"));
            let (quadro, n) = (regras.quadro_vazio(), regras.n_possibs());
            for base_iter in [None, Some(10)] {
                let r = solucionar_quadro(&mut HorarioRegrasPencilmark::new(carregar("faculdade-anonimizado")), quadro.clone(), n, 1, base_iter);
                let sol = r.solucoes.first().unwrap_or_else(|| panic!("seed {seed}, base_iter {base_iter:?}: deveria resolver"));
                assert_fitness_zero_no_ga(&regras.regras, sol);
            }
        }
    }

    /// Nas instâncias sintéticas o Pencilmark (assim como o original em TS) costuma não terminar;
    /// mas o melhor quadro parcial nunca pode violar as regras que ele já checa.
    #[wasm_bindgen_test(unsupported = test)]
    fn quadro_parcial_da_instancia_media_e_consistente() {
        fastrand::seed(1);
        let regras = HorarioRegrasPencilmark::new(carregar("media"));
        let (quadro, n) = (regras.quadro_vazio(), regras.n_possibs());
        let mut exec = ExecucaoPencilmark::new(regras, quadro, n, 1, Some(10));
        exec.executar(20_000);

        let s = &mut exec.solver;
        let melhor = s.melhor.clone();
        assert!(!melhor.is_empty());
        assert!(s.regras.verificar_quadro(&melhor), "o melhor parcial deveria ser consistente");
        // Nenhuma disciplina com mais aulas que o permitido
        let mut cont = vec![0; s.regras.regras.disciplinas.len()];
        for d in melhor.iter().filter_map(|&v| s.regras.regras.disciplina_em(v)) {
            cont[d] += 1;
        }
        for (d, c) in s.regras.regras.disciplinas.iter().zip(cont) {
            assert!(c <= d.aulas, "{} com {c} aulas (máx {})", d.nome, d.aulas);
        }
    }

    /// Instância pequena e inviável: o professor só tem 1 horário livre e 2 aulas para dar.
    /// Sem reinícios, a busca precisa esgotar e terminar sem solução.
    #[wasm_bindgen_test(unsupported = test)]
    fn instancia_inviavel_termina_sem_solucao() {
        let regras = HorarioRegrasPencilmark::new(RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2] } }],
            "aulas": [
                { "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 1 },
                { "id": "B", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 1 }
            ],
            "recursos": [{ "id": "P", "disponibilidade": { "seg": [1] } }]
        }"#).unwrap());
        let (quadro, n) = (regras.quadro_vazio(), regras.n_possibs());
        let mut exec = ExecucaoPencilmark::new(regras, quadro.clone(), n, 1, None);
        assert!(exec.executar(u64::MAX));
        assert!(exec.solver.solucoes.is_empty());
        assert_eq!(exec.solver.quadro, quadro, "o backtracking deve desfazer todas as escolhas");
    }
}
