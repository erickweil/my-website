//! Solver Pencilmark genérico (port de `src/lib/pencilmark.ts`; o bitset fica em [`crate::bitflag`]).
//!
//! Para usar com um problema novo, implemente [`RegrasQuadro`] e chame [`solucionar_quadro`]
//! (bloqueante), use [`ExecucaoPencilmark`] para rodar em blocos de iterações, ou [`BuscaExaustiva`]
//! para explorar TODA a árvore de busca dividindo o trabalho entre threads (acha soluções ou prova
//! que não existe nenhuma).

mod exaustivo;
mod solver;

pub use crate::bitflag::BitFlag;
pub use exaustivo::*;
pub use solver::*;

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    // ── Sudoku 9×9: problema clássico, fora do domínio de horários ─────────────────────────────

    #[derive(Clone)]
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
    #[derive(Clone)]
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

    // ── Busca exaustiva em paralelo, com problemas que não são de horário ──────────────────────

    /// N rainhas: a célula `i` é a linha `i`, o valor é a coluna da rainha.
    #[derive(Clone)]
    struct Rainhas;

    impl RegrasQuadro for Rainhas {
        fn verificar_quadro(&mut self, _quadro: &[i32]) -> bool {
            true
        }
        fn verificar_celula(&mut self, quadro: &[i32], possib: &mut Possib) -> bool {
            let n = quadro.len() as i32;
            let linha = possib.index as i32;
            for (outra, &v) in quadro.iter().enumerate() {
                if v <= 0 { continue; }
                let (outra, coluna) = (outra as i32, v - 1);
                // Mesma coluna e as duas diagonais
                for c in [coluna, coluna + (linha - outra), coluna - (linha - outra)] {
                    if (0..n).contains(&c) {
                        possib.desmarcar(c as usize);
                    }
                }
            }
            true
        }
    }

    fn rainhas_valida(q: &[i32]) -> bool {
        (0..q.len()).all(|a| (0..a).all(|b| {
            let (ca, cb) = (q[a], q[b]);
            ca > 0 && cb > 0 && ca != cb && (ca - cb).abs() != (a - b) as i32
        }))
    }

    /// Quadrado latino n x n: cada valor uma vez por linha e por coluna.
    #[derive(Clone)]
    struct Latino(usize);

    impl RegrasQuadro for Latino {
        fn verificar_quadro(&mut self, _quadro: &[i32]) -> bool {
            true
        }
        fn verificar_celula(&mut self, quadro: &[i32], possib: &mut Possib) -> bool {
            let n = self.0;
            let (lin, col) = (possib.index / n, possib.index % n);
            for i in 0..n {
                for v in [quadro[lin * n + i], quadro[i * n + col]] {
                    if v > 0 {
                        possib.desmarcar((v - 1) as usize);
                    }
                }
            }
            true
        }
    }

    /// Roda a busca exaustiva até o fim, em chamadas de `por_chamada` nós, e devolve as soluções ordenadas.
    fn enumerar<R: RegrasQuadro + Clone + Send>(regras: R, quadro: Vec<i32>, n_possibs: usize, threads: usize, nos_por_fatia: u64, por_chamada: u64) -> (Vec<Vec<i32>>, BuscaExaustiva<R>) {
        let mut busca = BuscaExaustiva::new(regras, quadro, n_possibs, usize::MAX);
        busca.threads = threads;
        busca.nos_por_fatia = nos_por_fatia;
        let mut chamadas = 0;
        while !busca.executar(por_chamada) {
            chamadas += 1;
            assert!(chamadas < 1_000_000, "a busca não termina");
        }
        assert!(busca.esgotou());
        let mut solucoes = busca.solucoes.clone();
        solucoes.sort();
        (solucoes, busca)
    }

    /// Contagens conhecidas, em sequência e em paralelo, com fatias minúsculas (repartindo o tempo
    /// todo) e grandes, de uma vez e em chamadas pequenas: sempre o mesmo conjunto de soluções,
    /// sem repetir nem perder nenhuma.
    #[test]
    fn busca_exaustiva_enumera_todas_as_solucoes() {
        assert!(crate::paralelo::pool_disponivel() && rayon::current_num_threads() > 1, "o teste precisa de várias threads");
        fastrand::seed(21);
        for (n, esperado) in [(6usize, 4usize), (8, 92), (9, 352)] {
            let (referencia, _) = enumerar(Rainhas, vec![0; n], n, 1, 1_000_000, u64::MAX);
            assert_eq!(referencia.len(), esperado, "{n} rainhas");
            assert!(referencia.iter().all(|s| rainhas_valida(s)));
            assert!(referencia.windows(2).all(|w| w[0] != w[1]), "solução repetida");

            for (threads, nos_por_fatia, por_chamada) in [(0, 8, u64::MAX), (0, 500, u64::MAX), (0, 16, 300), (1, 8, u64::MAX), (1, 16, 100)] {
                let (solucoes, busca) = enumerar(Rainhas, vec![0; n], n, threads, nos_por_fatia, por_chamada);
                assert!(solucoes == referencia, "{n} rainhas, threads={threads}, fatia={nos_por_fatia}: {} soluções", solucoes.len());
                assert!(busca.nos > esperado as u64);
                if nos_por_fatia < 100 && n >= 8 {
                    assert!(busca.tarefas > 10, "deveria ter repartido: {} tarefas", busca.tarefas);
                }
            }
        }

        // Quadrado latino 4x4: 576 soluções
        let (latinos, _) = enumerar(Latino(4), vec![0; 16], 4, 0, 32, u64::MAX);
        assert_eq!(latinos.len(), 576);
        assert!(latinos.windows(2).all(|w| w[0] != w[1]));
        // Com células já preenchidas (primeira linha 1 2 3 4): 24 soluções
        let mut quadro = vec![0; 16];
        quadro[..4].copy_from_slice(&[1, 2, 3, 4]);
        assert_eq!(enumerar(Latino(4), quadro, 4, 0, 16, 200).0.len(), 24);
    }

    #[test]
    fn busca_exaustiva_prova_que_e_impossivel() {
        fastrand::seed(22);
        // 7 células todas diferentes e só 6 valores permitidos: impossível, e a árvore é grande
        for (threads, nos_por_fatia) in [(1, 64), (0, 64), (0, 1_000_000)] {
            let mut busca = BuscaExaustiva::new(TodosDiferentes { n_possibs: 40, permitidos: 6 }, vec![0; 7], 40, 1);
            busca.threads = threads;
            busca.nos_por_fatia = nos_por_fatia;
            assert!(!busca.impossivel(), "antes de rodar não há prova");
            let mut chamadas = 0;
            while !busca.executar(500) {
                chamadas += 1;
                assert!(!busca.impossivel() && !busca.esgotou());
            }
            assert!(chamadas > 1, "deveria ter pausado");
            assert!(busca.impossivel() && busca.esgotou() && busca.solucoes.is_empty());
            // A árvore tem que ter sido percorrida de fato
            assert!(busca.nos > 1000, "{} nós", busca.nos);
            // Com 6 preenchidas a 7ª fica sem opção, e o quadro é descartado antes de ser registrado
            assert_eq!(busca.melhor_preenchidos, 5, "melhor quadro parcial registrado");
        }
        // 3 rainhas num tabuleiro 3x3: impossível
        let (nenhuma, busca) = enumerar(Rainhas, vec![0; 3], 3, 0, 4, u64::MAX);
        assert!(nenhuma.is_empty() && busca.impossivel());
    }

    #[test]
    fn busca_exaustiva_para_na_primeira_solucao() {
        fastrand::seed(23);
        for threads in [0, 1] {
            let mut busca = BuscaExaustiva::new(Rainhas, vec![0; 10], 10, 1);
            busca.threads = threads;
            busca.nos_por_fatia = 16;
            while !busca.executar(2000) {}
            assert_eq!(busca.solucoes.len(), 1);
            assert!(rainhas_valida(&busca.solucoes[0]));
            assert!(busca.terminou() && !busca.impossivel());
            assert!(!busca.esgotou(), "parou na primeira solução: a árvore não foi toda explorada");
        }
        // Sudoku de solução única: acha e, enumerando tudo, confirma que é a única
        let (solucoes, _) = enumerar(Sudoku, sudoku_inicial(), 9, 0, 64, u64::MAX);
        assert_eq!(solucoes.len(), 1);
        assert!(sudoku_valido(&solucoes[0]));
    }

    /// Uma busca sequencial em andamento pode ser continuada em paralelo sem perder nem repetir nada.
    #[test]
    fn busca_exaustiva_continua_uma_busca_sequencial() {
        fastrand::seed(24);
        let mut solver = PencilmarkSolver::new(Rainhas, vec![0; 8], 8, usize::MAX, None);
        let mut orcamento = 300;
        assert_eq!(solver.buscar(&mut orcamento), ResultadoBusca::Pausado);
        let ja_achadas = solver.solucoes.len();
        let mut busca = BuscaExaustiva::de_solver(solver, usize::MAX);
        busca.nos_por_fatia = 16;
        assert_eq!(busca.nos, 300);
        assert_eq!(busca.solucoes.len(), ja_achadas);
        while !busca.executar(1000) {}
        let mut solucoes = busca.solucoes.clone();
        solucoes.sort();
        solucoes.dedup();
        assert_eq!(solucoes.len(), 92);
        assert_eq!(busca.solucoes.len(), 92, "solução repetida");
    }
}
