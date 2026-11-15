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
//! [`ErroEntrada`]), para poder ser testada fora do navegador.

use wasm_bindgen::prelude::*;

use crate::{
    genetic::ga::{GAConfig, GeneticAlgorithm},
    horario::{
        config_ga_horario, validar, ErroEntrada, HorarioRegrasPencilmark, QuadroHorario, RegrasHorario, MSG_IMPOSSIVEL,
        ResultadoHorario, Validacao,
    },
    pencilmark::{BuscaExaustiva, ExecucaoPencilmark},
};

/// Limite de gerações do GA (o worker em TS rodava 1000 blocos de 500 gerações).
pub const MAX_GERACOES_GA: usize = 500_000;

/// Com um horário já válido, o GA continua para atender às regras de qualidade (horários a evitar)
/// e para depois deste número de gerações sem melhora.
pub const GERACOES_SEM_MELHORA_NA_QUALIDADE: usize = 1_000;

fn erro_js(e: ErroEntrada) -> JsError {
    JsError::new(&e.to_string())
}

fn resultado_js(r: ResultadoHorario) -> Result<JsValue, JsError> {
    r.to_js().map_err(|e| JsError::new(&e.to_string()))
}

// ── Pencilmark ───────────────────────────────────────────────────────────────────────────────

/// A busca do Pencilmark por trás do runner.
enum BuscaPencilmark {
    /// Explora a árvore inteira, dividindo o trabalho entre as threads quando há pool: acha um
    /// horário ou prova que não existe nenhum.
    Exaustiva(BuscaExaustiva<HorarioRegrasPencilmark>),
    /// Uma thread, com reinícios aleatórios (orçamento 2^n, 2^(n+1)…). Não prova impossibilidade.
    Reinicios(ExecucaoPencilmark<HorarioRegrasPencilmark>),
}

#[wasm_bindgen]
pub struct HorarioPencilmarkRunner {
    busca: BuscaPencilmark,
    /// Regras só para validar o quadro final
    validador: HorarioRegrasPencilmark,
    versao: u32,
    /// (preenchidos do melhor parcial, nº de soluções) na última vez que `versao` mudou
    visto: (usize, usize),
}

impl HorarioPencilmarkRunner {
    /// `base_iter`: `None` = busca exaustiva (em paralelo quando há pool de threads);
    /// `Some(n)` = uma thread com reinícios de orçamento 2^n, 2^(n+1)…
    pub fn de_regras(regras: RegrasHorario, base_iter: Option<u32>) -> Self {
        let regras = HorarioRegrasPencilmark::new(regras);
        let (quadro, n_possibs) = (regras.quadro_vazio(), regras.n_possibs());
        let validador = regras.clone();
        let busca = match base_iter {
            None => BuscaPencilmark::Exaustiva(BuscaExaustiva::new(regras, quadro, n_possibs, 1)),
            Some(_) => BuscaPencilmark::Reinicios(ExecucaoPencilmark::new(regras, quadro, n_possibs, 1, base_iter)),
        };
        Self { busca, validador, versao: 0, visto: (0, 0) }
    }

    fn terminou(&self) -> bool {
        match &self.busca {
            BuscaPencilmark::Exaustiva(b) => b.terminou(),
            BuscaPencilmark::Reinicios(e) => e.terminou(),
        }
    }

    /// (primeira solução, melhor quadro parcial, preenchidos do melhor parcial)
    fn quadros(&self) -> (Option<&Vec<i32>>, &Vec<i32>, usize) {
        match &self.busca {
            BuscaPencilmark::Exaustiva(b) => (b.solucoes.first(), &b.melhor, b.melhor_preenchidos),
            BuscaPencilmark::Reinicios(e) => (e.solver.solucoes.first(), &e.solver.melhor, e.solver.melhor_preenchidos),
        }
    }

    /// true quando a busca exaustiva terminou sem achar nada: está provado que não existe horário.
    pub fn provou_impossivel(&self) -> bool {
        matches!(&self.busca, BuscaPencilmark::Exaustiva(b) if b.impossivel())
    }

    pub fn resultado(&mut self) -> ResultadoHorario {
        let terminou = self.terminou();
        let impossivel = self.provou_impossivel();
        // Nós visitados; e a profundidade da busca (com reinícios) ou as subárvores em aberto (exaustiva)
        let (iter, depth) = match &self.busca {
            BuscaPencilmark::Exaustiva(b) => (b.nos as f64, b.tarefas_pendentes()),
            BuscaPencilmark::Reinicios(e) => (e.solver.iter as f64, e.solver.profundidade()),
        };

        // Sem solução completa, mostra o quadro parcial mais preenchido
        let (solucao, melhor, _) = self.quadros();
        let quadro = solucao.cloned().or_else(|| (!melhor.is_empty()).then(|| melhor.clone()));
        let quadro = quadro.map(|q| {
            // Durante a busca, só marca o que falta; no fim, valida de verdade
            let v = if terminou { validar(&mut self.validador, &q) } else { Validacao::incompleto(&q) };
            (q, v)
        });
        let mut resultado = ResultadoHorario::novo(&self.validador.regras, quadro.as_ref().map(|(q, v)| (q.as_slice(), v)), iter, depth, terminou);
        if impossivel {
            resultado.mensagem = Some(MSG_IMPOSSIVEL);
        }
        resultado
    }
}

#[wasm_bindgen]
impl HorarioPencilmarkRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(formulario: JsValue, base_iter: Option<u32>) -> Result<HorarioPencilmarkRunner, JsError> {
        Ok(Self::de_regras(RegrasHorario::from_js(formulario).map_err(erro_js)?, base_iter))
    }

    /// Avança a busca em até `iteracoes` nós (somando todas as threads). Retorna true quando terminou.
    pub fn run(&mut self, iteracoes: u32) -> bool {
        let terminou = match &mut self.busca {
            BuscaPencilmark::Exaustiva(b) => b.executar(iteracoes as u64),
            BuscaPencilmark::Reinicios(e) => e.executar(iteracoes as u64),
        };
        let (solucao, _, preenchidos) = self.quadros();
        let atual = (preenchidos, solucao.is_some() as usize);
        if atual != self.visto {
            self.visto = atual;
            self.versao += 1;
        }
        terminou
    }

    pub fn versao(&self) -> u32 {
        self.versao
    }

    /// true se a busca está dividindo o trabalho entre várias threads (exaustiva, com pool criado).
    pub fn usando_threads(&self) -> bool {
        matches!(&self.busca, BuscaPencilmark::Exaustiva(b) if b.usando_threads())
    }

    /// true quando está provado que não existe horário que atenda às restrições.
    pub fn impossivel(&self) -> bool {
        self.provou_impossivel()
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
    /// O melhor quadro não quebra nenhuma regra obrigatória.
    valido: bool,
    terminou: bool,
    versao: u32,
}

impl HorarioGARunner {
    /// `ilhas`: 0 ou 1 = uma população só; N = modelo de ilhas, com N populações do tamanho padrão
    /// (ver `GAConfig.ilhas`). O horário sofre com ótimos locais, e as ilhas ajudam a escapar deles.
    pub fn de_regras(regras: RegrasHorario, ilhas: usize) -> Self {
        let config = GAConfig { ilhas, ..config_ga_horario(regras.tamanho_quadro()) };
        let validador = HorarioRegrasPencilmark::new(regras.clone());
        Self {
            ga: GeneticAlgorithm::new(regras, config),
            validador,
            melhor: None,
            melhor_fitness: None,
            valido: false,
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
    pub fn new(formulario: JsValue, ilhas: usize) -> Result<HorarioGARunner, JsError> {
        Ok(Self::de_regras(RegrasHorario::from_js(formulario).map_err(erro_js)?, ilhas))
    }

    /// Roda `geracoes` gerações. Retorna true quando terminou:
    /// - o melhor quadro é válido e atende a todas as regras de qualidade (fitness 0); ou
    /// - é válido e a qualidade não melhora há [`GERACOES_SEM_MELHORA_NA_QUALIDADE`] gerações; ou
    /// - atingiu [`MAX_GERACOES_GA`].
    ///
    /// Antes de terminar, um quadro válido já é entregue como progresso (ver [`Self::valido`]).
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
            self.valido = !v.alguma();
            self.melhor = Some((genes, v));
            self.versao += 1;
        }
        let qualidade_parada = self.melhor_fitness == Some(0.0) || info.stagnated_for >= GERACOES_SEM_MELHORA_NA_QUALIDADE;
        if (self.valido && qualidade_parada) || info.generation >= MAX_GERACOES_GA {
            self.terminou = true;
        }
        self.terminou
    }

    pub fn versao(&self) -> u32 {
        self.versao
    }

    /// true quando o melhor quadro já não quebra nenhuma regra obrigatória (o GA pode continuar
    /// rodando para melhorar a qualidade).
    pub fn valido(&self) -> bool {
        self.valido
    }

    /// Aulas do melhor quadro em horário que algum professor pediu para evitar.
    pub fn aulas_a_evitar(&self) -> usize {
        self.melhor.as_ref().map_or(0, |(q, _)| self.ga.problem.aulas_a_evitar(q))
    }

    pub fn get_resultado(&self) -> Result<JsValue, JsError> {
        resultado_js(self.resultado())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::horario::{DiaSemana, EntradaHorario, MSG_SEM_SOLUCAO};
    use wasm_bindgen_test::*;

    fn caminho(nome: &str) -> String {
        format!("{}/tests/instancias/{nome}.json", env!("CARGO_MANIFEST_DIR"))
    }

    fn carregar(nome: &str) -> RegrasHorario {
        RegrasHorario::de_arquivo(&caminho(nome))
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
                assert!(!p.terminou && p.alocacoes.is_some());
            }
        }
        assert!(versoes > 0, "deveria ter reportado progresso");
        let fim = r.resultado();
        assert!(fim.terminou);
        assert!(!fim.alguma_violacao, "{:?}", fim.mensagem);
        assert_eq!(fim.alocacoes.unwrap().len(), 56, "60 aulas das turmas; as 4 da aula em conjunto saem uma vez");
        assert!(fim.problemas.is_empty());
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

    /// Quadro real com um professor lotado que perde um horário: não existe solução, e a busca
    /// exaustiva tem que provar isso (em paralelo e, com `threads = 1`, em sequência).
    #[wasm_bindgen_test(unsupported = test)]
    fn pencilmark_prova_que_o_quadro_e_impossivel() {
        let impossivel = || {
            let mut f: EntradaHorario = serde_json::from_str(&std::fs::read_to_string(caminho("faculdade-anonimizado")).unwrap()).unwrap();
            // "Professor D" tem 16 aulas e 16 horários: tira um
            let prof = f.recursos.iter_mut().find(|p| p.id == "Professor D").unwrap();
            prof.disponibilidade.get_mut("ter").unwrap().pop();
            RegrasHorario::new(f).unwrap()
        };
        for threads in [0, 1] {
            fastrand::seed(2);
            let mut r = HorarioPencilmarkRunner::de_regras(impossivel(), None);
            if let BuscaPencilmark::Exaustiva(b) = &mut r.busca {
                b.threads = threads;
                b.nos_por_fatia = 256;
            }
            assert!(!r.provou_impossivel());
            let mut chamadas = 0;
            while !r.run(2_000) {
                chamadas += 1;
                assert!(chamadas < 100_000, "a busca não termina");
                assert!(!r.provou_impossivel());
            }
            assert!(chamadas > 1, "deveria ter pausado");
            assert!(r.provou_impossivel());
            let res = r.resultado();
            assert!(res.terminou && res.alguma_violacao);
            assert_eq!(res.mensagem, Some(MSG_IMPOSSIVEL));
            assert!(res.alocacoes.is_some_and(|a| !a.is_empty()), "mostra o quadro parcial mais preenchido");
        }

        // Com reinícios a busca não é exaustiva: nunca afirma que é impossível
        fastrand::seed(2);
        let mut r = HorarioPencilmarkRunner::de_regras(impossivel(), Some(8));
        for _ in 0..20 { r.run(5_000); }
        assert!(!r.provou_impossivel());
    }

    /// O quadro real viável continua sendo resolvido pela busca exaustiva, nos dois modos.
    #[wasm_bindgen_test(unsupported = test)]
    fn pencilmark_exaustivo_resolve_o_quadro_real() {
        for threads in [0, 1] {
            for semente in 1..=4 {
                fastrand::seed(semente);
                let mut r = HorarioPencilmarkRunner::de_regras(carregar("faculdade-anonimizado"), None);
                if let BuscaPencilmark::Exaustiva(b) = &mut r.busca { b.threads = threads; }
                while !r.run(20_000) {}
                let res = r.resultado();
                assert!(res.terminou && !res.alguma_violacao && !r.provou_impossivel(), "threads={threads} semente={semente}: {:?}", res.mensagem);
            }
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn ga_resolve_instancia_pequena() {
        fastrand::seed(3);
        let mut r = HorarioGARunner::de_regras(carregar("pequena"), 0);
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

    #[wasm_bindgen_test(unsupported = test)]
    fn ga_com_ilhas_multiplica_a_populacao_e_entrega_resultado() {
        fastrand::seed(4);
        let regras = carregar("pequena");
        let tamanho = regras.tamanho_quadro();
        let mut r = HorarioGARunner::de_regras(regras, 4);
        // Em chamadas pequenas, como o worker faz: a época de ilhas atravessa várias chamadas
        for _ in 0..12 {
            if r.run(25) {
                break;
            }
        }
        assert_eq!(r.ga.config.ilhas, 4);
        assert_eq!(r.ga.config.population_size, tamanho * 4, "população por ilha é a padrão");
        assert!(r.versao() > 0, "deveria ter um melhor quadro");
        let res = r.resultado();
        assert!(res.alocacoes.is_some());
        // Com alguma violação ainda não terminou; sem violação, terminou
        assert_eq!(res.terminou, !res.alguma_violacao);
    }

    /// Um professor com horários a evitar: a busca exata ignora (e continua resolvendo); o GA entrega
    /// um horário válido e segue até não sobrar aula em horário a evitar.
    #[wasm_bindgen_test(unsupported = test)]
    fn evitar_e_regra_de_qualidade_so_do_ga() {
        // Turma com 4 tempos na segunda e na terça; P dá 4 aulas e prefere não dar aula na terça
        let entrada = r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] } }],
            "aulas": [
                { "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 4 },
                { "id": "B", "turmas": ["T"], "recursos": ["Q"], "aulasSemana": 4 }
            ],
            "recursos": [
                { "id": "P", "disponibilidade": { "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] }, "evitar": { "ter": [1, 2, 3, 4] } },
                { "id": "Q", "disponibilidade": { "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] } }
            ]
        }"#;
        let regras = || RegrasHorario::from_json(entrada).unwrap();

        // Qualquer quadro válido tem fitness acima de menos a menor penalidade obrigatória
        let r = regras();
        let mut estado = crate::genetic::problems::GAProblem::initial_state(&r);
        let mut pior = r.get_quadro_vazio();
        for (tempo, d) in [2, 2, 2, 2].into_iter().enumerate() { pior[r.to_quadro_index(0, DiaSemana::Segunda, tempo)] = d; }
        for (tempo, d) in [1, 1, 1, 1].into_iter().enumerate() { pior[r.to_quadro_index(0, DiaSemana::Terca, tempo)] = d; }
        assert_eq!(r.aulas_a_evitar(&pior), 4);
        let f = r.fitness_rapido(&mut estado, &pior);
        assert!(f < 0.0 && f > -20.0, "as 4 aulas a evitar valem menos que uma violação obrigatória: {f}");

        fastrand::seed(5);
        let mut pm = HorarioPencilmarkRunner::de_regras(regras(), None);
        while !pm.run(1_000) {}
        assert!(!pm.resultado().alguma_violacao, "a busca exata ignora os horários a evitar");

        fastrand::seed(5);
        let mut ga = HorarioGARunner::de_regras(regras(), 0);
        let mut blocos = 0;
        while !ga.run(50) {
            blocos += 1;
            assert!(blocos < 2_000, "o GA deveria terminar");
        }
        assert!(ga.valido() && !ga.resultado().alguma_violacao);
        assert_eq!(ga.aulas_a_evitar(), 0, "há horário válido sem nenhuma aula na terça para P");
        assert_eq!(ga.melhor_fitness, Some(0.0));
    }

    /// Quando não dá para atender a todos os pedidos, o GA não fica rodando para sempre: para com
    /// um horário válido depois de um tempo sem melhorar.
    #[wasm_bindgen_test(unsupported = test)]
    fn ga_para_com_horario_valido_quando_a_qualidade_nao_fecha() {
        // P dá as 4 aulas da turma e quer evitar a segunda inteira: 2 aulas caem lá de qualquer jeito
        let regras = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2], "ter": [1, 2] } }],
            "aulas": [{ "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 4 }],
            "recursos": [{ "id": "P", "disponibilidade": { "seg": [1, 2], "ter": [1, 2] }, "evitar": { "seg": [1, 2] } }]
        }"#).unwrap();
        fastrand::seed(6);
        let mut ga = HorarioGARunner::de_regras(regras, 0);
        let mut geracoes = 0;
        while !ga.run(100) {
            geracoes += 100;
            assert!(ga.valido(), "o primeiro quadro já é válido");
            assert!(geracoes <= GERACOES_SEM_MELHORA_NA_QUALIDADE + 200, "deveria ter parado por falta de melhora");
        }
        assert!(!ga.resultado().alguma_violacao);
        assert_eq!(ga.aulas_a_evitar(), 2);
    }
}
