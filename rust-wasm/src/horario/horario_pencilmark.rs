//! Regras do gerador de horários para o solver Pencilmark — port do antigo
//! `horario-pencilmark.ts` (`HorarioSolverPencilmark`, removido; ver o histórico do git).
//! Também são as regras usadas para validar o resultado dos dois solvers (`horario_resultado.rs`).
//!
//! Mantém o comportamento do TS: cada célula do quadro tem `n_possibs = disciplinas.len()`
//! possibilidades (todas as disciplinas, de todas as turmas), e as de outra turma são descartadas
//! em `pode_disciplina`.

use crate::{
    horario::{DiaSemana, Horario, QUANTOS_DIAS, QuadroHorario, RegrasHorario},
    pencilmark::{Possib, RegrasQuadro},
};

pub struct HorarioRegrasPencilmark {
    pub regras: RegrasHorario,

    // Estado derivado do quadro, recalculado em `verificar_quadro`:
    /// Por professor: 1 = disponível, 0 = indisponível OU já ocupado em outra turma neste (dia, tempo)
    prof_matriz: Vec<Horario>,
    /// Por disciplina: quantas aulas já estão alocadas no quadro
    cont_aulas: Vec<i32>,
}

impl HorarioRegrasPencilmark {
    pub fn new(regras: RegrasHorario) -> Self {
        let prof_matriz = regras.professores.iter().map(|p| p.horarios.clone()).collect();
        let cont_aulas = vec![0; regras.disciplinas.len()];
        Self { regras, prof_matriz, cont_aulas }
    }

    /// Número de possibilidades por célula (o `nPossibs` do TS).
    pub fn n_possibs(&self) -> usize {
        self.regras.disciplinas.len()
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

    /// `podeDisciplina` do TS.
    pub fn pode_disciplina(&self, quadro: &[i32], id_disc: usize, id_turma: usize, dia: DiaSemana, tempo: usize) -> bool {
        let disc = &self.regras.disciplinas[id_disc];

        // A disciplina deve ser desta turma
        if disc.turma_id != id_turma {
            return false;
        }

        // Esgotou o número de aulas a serem escolhidas desta disciplina
        if self.cont_aulas[id_disc] >= disc.aulas {
            return false;
        }

        // Os professores devem estar disponíveis (e livres) neste tempo
        for &prof_id in &disc.professores {
            if self.prof_matriz[prof_id].get(dia, tempo) == 0 {
                return false;
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
                return false;
            }

            // Bloco fechado dos dois lados (não pode mais crescer)? -1 (fora/sem aula) ou outra
            // disciplina = bloqueado; 0 = célula livre, ainda pode crescer.
            let left_blocked = self.valor(quadro, id_turma, dia, t - left_run - 1) != 0;
            let right_blocked = self.valor(quadro, id_turma, dia, t + right_run + 1) != 0;
            if left_blocked && right_blocked {
                let invalido = if disc.dividir { current_run != g } else { current_run % g != 0 };
                if invalido {
                    return false;
                }
            }
        }

        // Disciplinas unidas devem ser escolhidas juntas: nas turmas parceiras, o mesmo (dia, tempo)
        // deve estar vazio ou com a disciplina unida correspondente.
        for &unida_id in &disc.disciplinas_unidas {
            let unida_turma = self.regras.disciplinas[unida_id].turma_id;
            let v = self.valor(quadro, unida_turma, dia, tempo as isize);
            if v != 0 && v != unida_id as i32 + 1 {
                return false;
            }
        }

        // Checagem reversa: se uma disciplina já alocada em outra turma neste (dia, tempo) exige uma
        // disciplina unida específica NESTA turma, só essa disciplina pode ser colocada aqui.
        for outra in &self.regras.turmas {
            if outra.id == id_turma {
                continue;
            }
            let v = self.valor(quadro, outra.id, dia, tempo as isize);
            if v <= 0 {
                continue;
            }
            let disc_outra = &self.regras.disciplinas[(v - 1) as usize];
            for &unida_da_outra in &disc_outra.disciplinas_unidas {
                if self.regras.disciplinas[unida_da_outra].turma_id == id_turma && unida_da_outra != id_disc {
                    return false;
                }
            }
        }

        true
    }
}

impl RegrasQuadro for HorarioRegrasPencilmark {
    /// `verificaQuadro` do TS.
    fn verificar_quadro(&mut self, quadro: &[i32]) -> bool {
        // Reinicia contagem de aulas e ocupação dos professores a partir do quadro atual
        for (matriz, prof) in self.prof_matriz.iter_mut().zip(&self.regras.professores) {
            matriz.slots.copy_from_slice(&prof.horarios.slots);
        }
        self.cont_aulas.fill(0);

        let n_tempos = self.regras.n_tempos;
        for turma in &self.regras.turmas {
            for tempo in 0..n_tempos {
                for dia_idx in 0..QUANTOS_DIAS {
                    let dia = DiaSemana::from_index(dia_idx);
                    let id_disc = quadro[self.regras.to_quadro_index(turma.id, dia, tempo)] - 1;
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

        for id_disc in 0..self.regras.disciplinas.len() {
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
    use crate::horario::{FomularioHorario, FomularioHorarioDisciplina, FomularioHorarioProfessor, FomularioHorarioTurma};
    use crate::pencilmark::{solucionar_quadro, ExecucaoPencilmark};
    use std::collections::HashMap;
    use wasm_bindgen_test::*;

    fn carregar(nome: &str) -> RegrasHorario {
        let caminho = format!("{}/tests/instancias/{nome}.json", env!("CARGO_MANIFEST_DIR"));
        let texto = std::fs::read_to_string(&caminho).unwrap_or_else(|e| panic!("{caminho}: {e}"));
        let mut json: serde_json::Value = serde_json::from_str(&texto).unwrap();
        if let Some(f) = json.get_mut("formData") {
            json = f.take();
        }
        RegrasHorario::new(serde_json::from_value(json).unwrap()).unwrap()
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
        for &v in melhor.iter().filter(|&&v| v > 0) {
            cont[(v - 1) as usize] += 1;
        }
        for (d, c) in s.regras.regras.disciplinas.iter().zip(cont) {
            assert!(c <= d.aulas, "{} com {c} aulas (máx {})", d.nome, d.aulas);
        }
    }

    /// Instância pequena e inviável: o professor só tem 1 horário livre e 2 aulas para dar.
    /// Sem reinícios, a busca precisa esgotar e terminar sem solução.
    #[wasm_bindgen_test(unsupported = test)]
    fn instancia_inviavel_termina_sem_solucao() {
        let h = |t: &[i32]| HashMap::from([("seg".to_string(), t.to_vec())]);
        let disc = |nome: &str| FomularioHorarioDisciplina { nome: nome.into(), turma: "T".into(), aulas: 1, agrupar: 0, dividir: false };
        let regras = HorarioRegrasPencilmark::new(RegrasHorario::new(FomularioHorario {
            turmas: vec![FomularioHorarioTurma { nome: "T".into(), horarios: h(&[1, 2]) }],
            disciplinas: vec![disc("A"), disc("B")],
            disciplinas_unidas: vec![],
            professores: vec![FomularioHorarioProfessor {
                nome: "P".into(),
                disciplinas: vec!["A".into(), "B".into()],
                horarios: h(&[1]),
            }],
        }).unwrap());
        let (quadro, n) = (regras.quadro_vazio(), regras.n_possibs());
        let mut exec = ExecucaoPencilmark::new(regras, quadro.clone(), n, 1, None);
        assert!(exec.executar(u64::MAX));
        assert!(exec.solver.solucoes.is_empty());
        assert_eq!(exec.solver.quadro, quadro, "o backtracking deve desfazer todas as escolhas");
    }
}
