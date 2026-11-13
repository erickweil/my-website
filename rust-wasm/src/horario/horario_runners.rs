//! Runners dos solvers de horário expostos ao JS (usados por `horario-wasm.worker.ts`).
//!
//! Os dois têm a mesma interface:
//! - `new(formulario)`: lança um `Error` do JS com mensagem legível se o formulário for inválido;
//! - `run(n) -> bool`: avança `n` passos (nós da busca / gerações) e diz se terminou;
//! - `versao() -> u32`: muda sempre que o melhor quadro muda, para o worker só postar progresso
//!   quando há algo novo;
//! - `get_resultado()`: o [`ResultadoHorario`] atual, pronto para a página.
//!
//! A lógica fica nos métodos sem `wasm_bindgen` (que recebem [`RegrasHorario`] e devolvem
//! [`ErroFormulario`]), para poder ser testada fora do navegador.

use wasm_bindgen::prelude::*;

use crate::{
    genetic::ga::GeneticAlgorithm,
    horario::{
        config_ga_horario, validar, ErroFormulario, HorarioRegrasPencilmark, QuadroHorario, RegrasHorario,
        ResultadoHorario, Validacao,
    },
    pencilmark::ExecucaoPencilmark,
};

/// Limite de gerações do GA (o worker em TS rodava 1000 blocos de 500 gerações).
pub const MAX_GERACOES_GA: usize = 500_000;

fn erro_js(e: ErroFormulario) -> JsError {
    JsError::new(&e.to_string())
}

fn resultado_js(r: ResultadoHorario) -> Result<JsValue, JsError> {
    r.to_js().map_err(|e| JsError::new(&e.to_string()))
}

// ── Pencilmark ───────────────────────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct HorarioPencilmarkRunner {
    exec: ExecucaoPencilmark<HorarioRegrasPencilmark>,
    versao: u32,
    /// (preenchidos do melhor parcial, nº de soluções) na última vez que `versao` mudou
    visto: (usize, usize),
}

impl HorarioPencilmarkRunner {
    /// `base_iter`: `None` = sem reinícios; `Some(n)` = reinicia com orçamento 2^n, 2^(n+1)…
    pub fn de_regras(regras: RegrasHorario, base_iter: Option<u32>) -> Self {
        let regras = HorarioRegrasPencilmark::new(regras);
        let (quadro, n_possibs) = (regras.quadro_vazio(), regras.n_possibs());
        Self { exec: ExecucaoPencilmark::new(regras, quadro, n_possibs, 1, base_iter), versao: 0, visto: (0, 0) }
    }

    pub fn resultado(&mut self) -> ResultadoHorario {
        let terminou = self.exec.terminou();
        let s = &mut self.exec.solver;
        let (iter, depth) = (s.iter as f64, s.profundidade());

        // Sem solução completa, mostra o quadro parcial mais preenchido
        let quadro = s.solucoes.first().cloned().or_else(|| (!s.melhor.is_empty()).then(|| s.melhor.clone()));
        let quadro = quadro.map(|q| {
            // Durante a busca, só marca o que falta; no fim, valida de verdade
            let v = if terminou { validar(&mut s.regras, &q) } else { Validacao::incompleto(&q) };
            (q, v)
        });
        ResultadoHorario::novo(&s.regras.regras, quadro.as_ref().map(|(q, v)| (q.as_slice(), v)), iter, depth, terminou)
    }
}

#[wasm_bindgen]
impl HorarioPencilmarkRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(formulario: JsValue, base_iter: Option<u32>) -> Result<HorarioPencilmarkRunner, JsError> {
        Ok(Self::de_regras(RegrasHorario::from_js(formulario).map_err(erro_js)?, base_iter))
    }

    /// Avança a busca em até `iteracoes` nós. Retorna true quando terminou.
    pub fn run(&mut self, iteracoes: u32) -> bool {
        let terminou = self.exec.executar(iteracoes as u64);
        let s = &self.exec.solver;
        let atual = (s.melhor_preenchidos, s.solucoes.len());
        if atual != self.visto {
            self.visto = atual;
            self.versao += 1;
        }
        terminou
    }

    pub fn versao(&self) -> u32 {
        self.versao
    }

    pub fn get_resultado(&mut self) -> Result<JsValue, JsError> {
        resultado_js(self.resultado())
    }
}

// ── Algoritmo genético ───────────────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct HorarioGARunner {
    ga: GeneticAlgorithm<RegrasHorario>,
    /// Regras do Pencilmark, usadas só para validar o melhor quadro
    validador: HorarioRegrasPencilmark,
    melhor: Option<(QuadroHorario, Validacao)>,
    melhor_fitness: Option<f64>,
    terminou: bool,
    versao: u32,
}

impl HorarioGARunner {
    pub fn de_regras(regras: RegrasHorario) -> Self {
        let config = config_ga_horario(regras.tamanho_quadro());
        let validador = HorarioRegrasPencilmark::new(regras.clone());
        Self {
            ga: GeneticAlgorithm::new(regras, config),
            validador,
            melhor: None,
            melhor_fitness: None,
            terminou: false,
            versao: 0,
        }
    }

    pub fn resultado(&self) -> ResultadoHorario {
        let info = self.ga.get_info();
        ResultadoHorario::novo(
            &self.ga.problem,
            self.melhor.as_ref().map(|(q, v)| (q.as_slice(), v)),
            info.generation as f64,
            info.stagnated_for,
            self.terminou,
        )
    }
}

#[wasm_bindgen]
impl HorarioGARunner {
    #[wasm_bindgen(constructor)]
    pub fn new(formulario: JsValue) -> Result<HorarioGARunner, JsError> {
        Ok(Self::de_regras(RegrasHorario::from_js(formulario).map_err(erro_js)?))
    }

    /// Roda `geracoes` gerações. Retorna true quando terminou: o melhor quadro não tem nenhuma
    /// violação ou atingiu [`MAX_GERACOES_GA`].
    pub fn run(&mut self, geracoes: u32) -> bool {
        if self.terminou {
            return true;
        }
        self.ga.run(geracoes as usize);
        let info = self.ga.get_info();

        if info.best_fitness != self.melhor_fitness
            && let Some(genes) = info.best_genes
        {
            // Melhorou: valida o novo melhor quadro (com as regras do Pencilmark)
            self.melhor_fitness = info.best_fitness;
            let v = validar(&mut self.validador, &genes);
            self.terminou = !v.alguma();
            self.melhor = Some((genes, v));
            self.versao += 1;
        }
        if info.generation >= MAX_GERACOES_GA {
            self.terminou = true;
        }
        self.terminou
    }

    pub fn versao(&self) -> u32 {
        self.versao
    }

    pub fn get_resultado(&self) -> Result<JsValue, JsError> {
        resultado_js(self.resultado())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::horario::{FomularioHorario, MSG_SEM_SOLUCAO};
    use wasm_bindgen_test::*;

    fn carregar(nome: &str) -> RegrasHorario {
        let caminho = format!("{}/tests/instancias/{nome}.json", env!("CARGO_MANIFEST_DIR"));
        let mut json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(caminho).unwrap()).unwrap();
        if let Some(f) = json.get_mut("formData") {
            json = f.take();
        }
        let f: FomularioHorario = serde_json::from_value(json).unwrap();
        RegrasHorario::new(f).unwrap()
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn pencilmark_resolve_e_entrega_resultado_sem_violacoes() {
        fastrand::seed(1);
        let mut r = HorarioPencilmarkRunner::de_regras(carregar("faculdade-anonimizado"), None);
        let mut versoes = 0;
        let mut ultima = r.versao();
        while !r.run(50) {
            if r.versao() != ultima {
                ultima = r.versao();
                versoes += 1;
                // Progresso: quadro parcial, sem validação completa
                let p = r.resultado();
                assert!(!p.terminou && p.solucao.is_some());
            }
        }
        assert!(versoes > 0, "deveria ter reportado progresso");
        let fim = r.resultado();
        assert!(fim.terminou);
        assert!(!fim.alguma_violacao, "{:?}", fim.mensagem);
        assert_eq!(fim.solucao.unwrap().len(), 3);
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn pencilmark_inviavel_mostra_parcial_com_violacoes() {
        let regras = carregar("inviavel");
        let mut r = HorarioPencilmarkRunner::de_regras(regras, None);
        // Limita o esforço: se não terminar, ao menos o resultado parcial tem que ser coerente
        let mut passos = 0;
        while !r.run(5_000) && passos < 20 {
            passos += 1;
        }
        let res = r.resultado();
        assert!(res.alguma_violacao);
        if res.terminou {
            assert!(res.mensagem.is_some());
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn ga_resolve_instancia_pequena() {
        fastrand::seed(3);
        let mut r = HorarioGARunner::de_regras(carregar("pequena"));
        assert_eq!(r.resultado().mensagem, Some(MSG_SEM_SOLUCAO), "antes de rodar não há quadro");
        let mut blocos = 0;
        while !r.run(100) {
            blocos += 1;
            assert!(blocos < 2_000, "o GA deveria resolver a instância pequena");
        }
        let fim = r.resultado();
        assert!(fim.terminou && !fim.alguma_violacao, "{:?}", fim.mensagem);
        assert!(r.versao() > 0);
    }
}
