//! Solver Pencilmark genérico (port de `src/lib/pencilmark.ts`; o bitset fica em [`crate::bitflag`]).
//!
//! Para usar com um problema novo, implemente [`RegrasQuadro`] e chame [`solucionar_quadro`]
//! (bloqueante) ou use [`ExecucaoPencilmark`] para rodar em blocos de iterações.

mod solver;

pub use crate::bitflag::BitFlag;
pub use solver::*;

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    // ── Sudoku 9×9: problema clássico, fora do domínio de horários ─────────────────────────────

    struct Sudoku;

    impl RegrasQuadro for Sudoku {
        fn verificar_quadro(&mut self, _quadro: &[i32]) -> bool {
            true
        }

        fn verificar_celula(&mut self, quadro: &[i32], possib: &mut Possib) -> bool {
            let (lin, col) = (possib.index / 9, possib.index % 9);
            let (bl, bc) = (lin / 3 * 3, col / 3 * 3);
            for i in 0..9 {
                for v in [quadro[lin * 9 + i], quadro[i * 9 + col], quadro[(bl + i / 3) * 9 + bc + i % 3]] {
                    if v > 0 {
                        possib.desmarcar((v - 1) as usize);
                    }
                }
            }
            true
        }
    }

    fn sudoku_valido(q: &[i32]) -> bool {
        let grupo_ok = |idx: &dyn Fn(usize) -> usize| {
            let mut vistos = [false; 10];
            (0..9).all(|i| {
                let v = q[idx(i)] as usize;
                (1..=9).contains(&v) && !std::mem::replace(&mut vistos[v], true)
            })
        };
        (0..9).all(|k| {
            grupo_ok(&|i| k * 9 + i)
                && grupo_ok(&|i| i * 9 + k)
                && grupo_ok(&|i| (k / 3 * 3 + i / 3) * 9 + k % 3 * 3 + i % 3)
        })
    }

    const SUDOKU: &str = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";

    fn sudoku_inicial() -> Vec<i32> {
        SUDOKU.bytes().map(|b| (b - b'0') as i32).collect()
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn resolve_sudoku() {
        fastrand::seed(1);
        let inicial = sudoku_inicial();
        let r = solucionar_quadro(Sudoku, inicial.clone(), 9, 1, None);
        assert_eq!(r.solucoes.len(), 1);
        let s = &r.solucoes[0];
        assert!(sudoku_valido(s));
        assert!(inicial.iter().zip(s).all(|(&a, &b)| a == 0 || a == b), "respeita as dicas");
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn resolve_sudoku_com_reinicios() {
        fastrand::seed(2);
        let r = solucionar_quadro(Sudoku, sudoku_inicial(), 9, 1, Some(10));
        assert_eq!(r.solucoes.len(), 1);
        assert!(sudoku_valido(&r.solucoes[0]));
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn desmarcar_mantem_solucao_unica() {
        fastrand::seed(3);
        let mut quadro = solucionar_quadro(Sudoku, sudoku_inicial(), 9, 1, None).solucoes.remove(0);
        desmarcar_quadro(&mut quadro, 9, &mut Sudoku, None);
        assert!(quadro.iter().any(|&v| v == 0), "deveria ter desmarcado algo");

        let r = solucionar_quadro(Sudoku, quadro, 9, 2, None);
        assert_eq!(r.solucoes.len(), 1, "o quadro desmarcado deve ter solução única");
    }

    /// Pausar a busca a cada nó e retomar deve dar exatamente o mesmo resultado que rodar de uma vez.
    #[wasm_bindgen_test(unsupported = test)]
    fn pausar_e_retomar_nao_muda_resultado() {
        fastrand::seed(4);
        let direto = solucionar_quadro(Sudoku, sudoku_inicial(), 9, 1, Some(4));

        fastrand::seed(4);
        let mut exec = ExecucaoPencilmark::new(Sudoku, sudoku_inicial(), 9, 1, Some(4));
        let mut chamadas = 0;
        while !exec.executar(1) {
            chamadas += 1;
        }
        assert!(chamadas > 10, "deveria ter pausado várias vezes");
        assert_eq!(exec.solver.solucoes, direto.solucoes);
        assert_eq!(exec.solver.iter, direto.iter);
    }

    // ── Problema com MUITAS possibilidades por célula (bem acima de 64) ────────────────────────

    /// `n_celulas` células, valores todos diferentes, e só os `permitidos` últimos valores de
    /// `n_possibs` são aceitos. Com `n_celulas <= permitidos` tem solução; senão, é impossível.
    struct TodosDiferentes {
        n_possibs: usize,
        permitidos: usize,
    }

    impl RegrasQuadro for TodosDiferentes {
        fn verificar_quadro(&mut self, _quadro: &[i32]) -> bool {
            true
        }
        fn verificar_celula(&mut self, quadro: &[i32], possib: &mut Possib) -> bool {
            for k in 0..self.n_possibs - self.permitidos {
                possib.desmarcar(k);
            }
            for &v in quadro {
                if v > 0 {
                    possib.desmarcar((v - 1) as usize);
                }
            }
            true
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn funciona_com_200_possibilidades() {
        fastrand::seed(5);
        let r = solucionar_quadro(TodosDiferentes { n_possibs: 200, permitidos: 5 }, vec![0; 5], 200, 1, None);
        assert_eq!(r.solucoes.len(), 1);
        let mut s = r.solucoes[0].clone();
        s.sort_unstable();
        assert_eq!(s, vec![196, 197, 198, 199, 200], "usa exatamente os 5 maiores valores");
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn detecta_impossivel_e_restaura_o_quadro() {
        fastrand::seed(6);
        let inicial = vec![0, -1, 0, 0, 0, 0, 0];
        let mut exec = ExecucaoPencilmark::new(
            TodosDiferentes { n_possibs: 100, permitidos: 5 }, inicial.clone(), 100, 1, None,
        );
        assert!(exec.executar(u64::MAX));
        assert!(exec.solver.solucoes.is_empty(), "6 células, 5 valores: impossível");
        assert_eq!(exec.solver.quadro, inicial, "o backtracking deve desfazer todas as escolhas");
        // `melhor` guarda o quadro parcial mais preenchido
        assert!(exec.solver.melhor_preenchidos >= 5);
    }
}
