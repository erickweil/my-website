//! Runners dos solvers de horário expostos ao JS (usados por `horario-wasm.worker.ts`).
//!
//! Os três têm a mesma interface:
//! - `new(formulario)`: lança um `Error` do JS com mensagem legível se o formulário for inválido;
//! - `run(n) -> bool`: avança `n` passos (nós da busca / gerações / movimentos) e diz se terminou;
//! - `versao() -> u32`: muda sempre que o melhor quadro muda (mesmo que o custo seja o mesmo), para
//!   o worker só mandar o quadro quando há algo novo;
//! - `custo()` (busca local e genético): o custo do melhor quadro, 0 = nada a melhorar;
//! - `get_resultado()`: o [`ResultadoHorario`] atual, pronto para a página.
//!
//! A busca local e o genético não têm limite de tempo: rodam até custo 0 (todas as regras
//! obrigatórias e de qualidade atendidas) ou até o usuário interromper. A busca exata termina ao
//! achar um horário válido (ela não melhora a qualidade) ou ao provar que não existe nenhum.
//!
//! A lógica fica nos métodos sem `wasm_bindgen` (que recebem [`RegrasHorario`] e devolvem
//! [`ErroEntrada`]), para poder ser testada fora do navegador.

use wasm_bindgen::prelude::*;

use crate::{
    genetic::ga::{GAConfig, GeneticAlgorithm},
    horario::{
        config_ga_horario, validar, BuscaLocal, ErroEntrada, HorarioRegrasPencilmark, QuadroHorario, RegrasHorario, LISTA_PADRAO,
        MSG_IMPOSSIVEL, ResultadoHorario, Validacao,
    },
    pencilmark::{BuscaExaustiva, ExecucaoPencilmark},
};

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
        let validador = HorarioRegrasPencilmark::so_obrigatorias(regras.clone());
        let regras = HorarioRegrasPencilmark::new(regras);
        let (quadro, n_possibs) = (regras.quadro_vazio(), regras.n_possibs());
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
        let config = GAConfig { ilhas, ..config_ga_horario(&regras) };
        let validador = HorarioRegrasPencilmark::so_obrigatorias(regras.clone());
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

    /// Roda `geracoes` gerações. Retorna true quando terminou: o melhor quadro é válido e atende a
    /// todas as regras de qualidade (fitness 0). Sem isso, continua até ser interrompido; um quadro
    /// válido já é entregue como progresso (ver [`Self::valido`]).
    pub fn run(&mut self, geracoes: u32) -> bool {
        if self.terminou {
            return true;
        }
        self.ga.run(geracoes as usize);
        let info = self.ga.get_info();

        if let Some(genes) = info.best_genes
            && self.melhor.as_ref().is_none_or(|(q, _)| *q != genes)
        {
            // O melhor quadro mudou (melhor fitness, ou outro com o mesmo fitness): valida o novo melhor quadro (com as regras do Pencilmark)
            self.melhor_fitness = info.best_fitness;
            let v = validar(&mut self.validador, &genes);
            self.valido = !v.alguma();
            self.melhor = Some((genes, v));
            self.versao += 1;
        }
        if self.valido && self.melhor_fitness == Some(0.0) {
            self.terminou = true;
        }
        self.terminou
    }

    /// O custo do melhor quadro (o fitness com o sinal trocado; 0 = nada a melhorar), ou
    /// `undefined` antes da primeira geração.
    pub fn custo(&self) -> Option<f64> {
        self.melhor_fitness.map(|f| -f)
    }

    pub fn versao(&self) -> u32 {
        self.versao
    }

    /// true quando o melhor quadro já não quebra nenhuma regra obrigatória (o GA pode continuar
    /// rodando para melhorar a qualidade).
    pub fn valido(&self) -> bool {
        self.valido
    }

    pub fn get_resultado(&self) -> Result<JsValue, JsError> {
        resultado_js(self.resultado())
    }
}

// ── Busca local ──────────────────────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct HorarioBuscaLocalRunner {
    busca: BuscaLocal,
    /// As regras da entrada, para montar o resultado.
    regras: RegrasHorario,
    /// Regras do Pencilmark, usadas só para validar o melhor quadro
    validador: HorarioRegrasPencilmark,
    melhor: (QuadroHorario, Validacao),
    melhor_custo: f64,
    /// O melhor quadro não quebra nenhuma regra obrigatória.
    valido: bool,
    /// Movimentos feitos por cadeia, e quantos tinham sido feitos quando o melhor quadro melhorou.
    movimentos: u64,
    melhorou_em: u64,
    terminou: bool,
    versao: u32,
}

impl HorarioBuscaLocalRunner {
    /// `cadeias`: buscas independentes a partir do mesmo quadro inicial (0 ou 1 = uma só). Com pool
    /// de threads, cada uma roda numa thread.
    pub fn de_regras(regras: RegrasHorario, cadeias: usize) -> Self {
        let inicial = regras.genes_com_blocos();
        let mut validador = HorarioRegrasPencilmark::so_obrigatorias(regras.clone());
        let busca = BuscaLocal::new(&regras, &inicial, cadeias.max(1), LISTA_PADRAO);
        let validacao = validar(&mut validador, &inicial);
        Self {
            melhor_custo: busca.melhor_custo(),
            valido: !validacao.alguma(),
            melhor: (inicial, validacao),
            busca,
            regras,
            validador,
            movimentos: 0,
            melhorou_em: 0,
            terminou: false,
            versao: 0,
        }
    }

    pub fn resultado(&self) -> ResultadoHorario {
        ResultadoHorario::novo(
            &self.regras,
            Some((self.melhor.0.as_slice(), &self.melhor.1)),
            self.busca.iteracoes as f64,
            (self.movimentos - self.melhorou_em) as usize,
            self.terminou,
        )
    }

}

#[wasm_bindgen]
impl HorarioBuscaLocalRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(formulario: JsValue, cadeias: usize) -> Result<HorarioBuscaLocalRunner, JsError> {
        Ok(Self::de_regras(RegrasHorario::from_js(formulario).map_err(erro_js)?, cadeias))
    }

    /// Faz `movimentos` movimentos em cada cadeia. Retorna true quando terminou: o melhor quadro é
    /// válido e atende a todas as regras de qualidade (custo 0). Sem isso, continua até ser
    /// interrompida; um quadro válido já é entregue como progresso (ver [`Self::valido`]).
    pub fn run(&mut self, movimentos: u32) -> bool {
        if self.terminou {
            return true;
        }
        let resolvido = self.busca.executar(movimentos as u64);
        self.movimentos += movimentos as u64;

        // O melhor quadro mudou: com custo menor, ou outro de mesmo custo (de outra cadeia)
        if self.busca.melhor() != self.melhor.0.as_slice() {
            let custo = self.busca.melhor_custo();
            if custo < self.melhor_custo {
                self.melhorou_em = self.movimentos;
            }
            self.melhor_custo = custo;
            let quadro = self.busca.melhor().to_vec();
            let v = validar(&mut self.validador, &quadro);
            self.valido = !v.alguma();
            self.melhor = (quadro, v);
            self.versao += 1;
        }
        self.terminou = resolvido;
        self.terminou
    }

    /// O custo do melhor quadro: o fitness do genético com o sinal trocado (0 = nada a melhorar).
    pub fn custo(&self) -> f64 {
        self.melhor_custo
    }

    pub fn versao(&self) -> u32 {
        self.versao
    }

    /// true quando o melhor quadro já não quebra nenhuma regra obrigatória (a busca pode continuar
    /// rodando para melhorar a qualidade).
    pub fn valido(&self) -> bool {
        self.valido
    }

    /// Número de cadeias da busca.
    pub fn cadeias(&self) -> usize {
        self.busca.cadeias()
    }

    /// true se as cadeias estão rodando em threads diferentes.
    pub fn usando_threads(&self) -> bool {
        self.busca.usando_threads()
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
        let aulas = regras.aulas_a_alocar();
        let mut r = HorarioGARunner::de_regras(regras, 4);
        // Em chamadas pequenas, como o worker faz: a época de ilhas atravessa várias chamadas
        for _ in 0..12 {
            if r.run(25) {
                break;
            }
        }
        assert_eq!(r.ga.config.ilhas, 4);
        assert_eq!(r.ga.config.population_size, aulas * crate::horario::POPULACAO_POR_AULA, "população por ilha é a padrão");
        assert!(r.versao() > 0, "deveria ter um melhor quadro");
        let res = r.resultado();
        assert!(res.alocacoes.is_some());
        // Só termina com o quadro sem violação (e com todas as regras de qualidade atendidas)
        assert!(!res.terminou || !res.alguma_violacao);
    }

    /// Um professor com horários a evitar: a busca exata os trata como indisponíveis; o GA entrega
    /// um horário válido e segue até não sobrar aula em horário a evitar.
    #[wasm_bindgen_test(unsupported = test)]
    fn evitar_e_indisponivel_na_busca_exata_e_qualidade_no_ga() {
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
        assert_eq!(r.qualidade(&pior).0.evitar, 4);
        let f = r.fitness_rapido(&mut estado, &pior);
        assert!(f < 0.0 && f > -20.0, "as 4 aulas a evitar valem menos que uma violação obrigatória: {f}");
        // Para a validação, aula em horário a evitar não é violação
        assert!(!validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras()), &pior).alguma());

        for semente in 1..=5 {
            fastrand::seed(semente);
            let mut pm = HorarioPencilmarkRunner::de_regras(regras(), None);
            while !pm.run(1_000) {}
            let res = pm.resultado();
            assert!(!res.alguma_violacao, "{:?}", res.mensagem);
            assert!(res.qualidade.is_empty(), "a busca exata não põe aula de P na terça: {:?}", res.qualidade);
        }

        fastrand::seed(5);
        let mut ga = HorarioGARunner::de_regras(regras(), 0);
        let mut blocos = 0;
        while !ga.run(50) {
            blocos += 1;
            assert!(blocos < 2_000, "o GA deveria terminar");
        }
        assert!(ga.valido() && !ga.resultado().alguma_violacao);
        assert!(ga.resultado().qualidade.is_empty(), "há horário válido sem nenhuma aula na terça para P");
        assert_eq!(ga.melhor_fitness, Some(0.0));
    }

    /// Se os horários a evitar não deixam espaço para as aulas, a busca exata prova que não há
    /// horário (com eles indisponíveis); o GA ainda entrega um horário válido, com as ocorrências.
    #[wasm_bindgen_test(unsupported = test)]
    fn evitar_que_nao_fecha_e_impossivel_na_busca_exata() {
        let regras = || RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2], "ter": [1, 2] } }],
            "aulas": [{ "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 4 }],
            "recursos": [{ "id": "P", "disponibilidade": { "seg": [1, 2], "ter": [1, 2] }, "evitar": { "seg": [1] } }]
        }"#).unwrap();
        fastrand::seed(1);
        let mut pm = HorarioPencilmarkRunner::de_regras(regras(), None);
        while !pm.run(1_000) {}
        assert!(pm.provou_impossivel());
        assert_eq!(pm.resultado().mensagem, Some(MSG_IMPOSSIVEL));

        let mut ga = HorarioGARunner::de_regras(regras(), 0);
        rodar_ate_valido(&mut ga);
        assert_eq!(ga.resultado().qualidade.iter().filter(|o| o.regra == "evitar").count(), 1);
        assert!(!ga.run(100), "com uma regra de qualidade que não fecha, o GA não termina sozinho");
    }

    /// Turma com mais horários que aulas: os dois métodos entregam um horário válido, com os horários
    /// vagos nas pontas dos turnos.
    #[wasm_bindgen_test(unsupported = test)]
    fn horarios_vagos_ficam_nas_pontas_do_turno() {
        // 2 dias de 5 tempos (10 horários) e 7 aulas: 3 vagos
        let entrada = r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2, 3, 4, 5], "ter": [1, 2, 3, 4, 5] } }],
            "aulas": [
                { "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 2, "bloco": 2 },
                { "id": "B", "turmas": ["T"], "recursos": ["Q"], "aulasSemana": 3 },
                { "id": "C", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 2 }
            ],
            "recursos": [
                { "id": "P", "disponibilidade": { "seg": [1, 2, 3, 4, 5], "ter": [1, 2, 3, 4, 5] } },
                { "id": "Q", "disponibilidade": { "seg": [2, 3, 4], "ter": [2, 3, 4] } }
            ]
        }"#;
        let regras = || RegrasHorario::from_json(entrada).unwrap();
        assert_eq!(regras().turmas[0].folga, 3);
        let conferir = |res: &ResultadoHorario| {
            assert!(!res.alguma_violacao, "{:?} {:?}", res.mensagem, res.problemas);
            assert_eq!(res.alocacoes.as_ref().unwrap().len(), 7);
            assert!(res.qualidade.iter().all(|o| o.regra != "janela"), "{:?}", res.qualidade);
            // As aulas de cada dia são seguidas
            for dia in ["seg", "ter"] {
                let mut tempos: Vec<usize> = res.alocacoes.as_ref().unwrap().iter().filter(|a| a.dia == dia).map(|a| a.tempo).collect();
                tempos.sort();
                assert!(tempos.windows(2).all(|w| w[1] == w[0] + 1), "{dia}: {tempos:?}");
            }
        };
        for semente in 1..=8 {
            fastrand::seed(semente);
            let mut pm = HorarioPencilmarkRunner::de_regras(regras(), None);
            while !pm.run(1_000) {}
            conferir(&pm.resultado());

            fastrand::seed(semente);
            let mut ga = HorarioGARunner::de_regras(regras(), 0);
            let mut blocos = 0;
            while !ga.run(50) {
                blocos += 1;
                assert!(blocos < 2_000, "o GA deveria terminar");
            }
            conferir(&ga.resultado());
        }
    }

    /// Quando o único jeito é deixar um vago no meio do turno: a busca exata não aceita (prova que
    /// não há horário), e o GA entrega o horário válido com a janela apontada.
    #[wasm_bindgen_test(unsupported = test)]
    fn vago_no_meio_do_turno_so_no_genetico() {
        let regras = || RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2, 3] } }],
            "aulas": [
                { "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 1 },
                { "id": "B", "turmas": ["T"], "recursos": ["Q"], "aulasSemana": 1 }
            ],
            "recursos": [
                { "id": "P", "disponibilidade": { "seg": [1] } },
                { "id": "Q", "disponibilidade": { "seg": [3] } }
            ]
        }"#).unwrap();
        fastrand::seed(1);
        let mut pm = HorarioPencilmarkRunner::de_regras(regras(), None);
        while !pm.run(1_000) {}
        assert!(pm.provou_impossivel());

        let mut ga = HorarioGARunner::de_regras(regras(), 0);
        rodar_ate_valido(&mut ga);
        let res = ga.resultado();
        assert!(!res.alguma_violacao, "{:?}", res.problemas);
        assert_eq!(res.qualidade.iter().map(|o| (o.regra, o.turma.as_deref(), o.dia)).collect::<Vec<_>>(), [("janela", Some("T"), "seg")]);
    }

    /// Vagos além da folga da turma são violação, apontada na célula.
    #[wasm_bindgen_test(unsupported = test)]
    fn vagos_alem_da_folga_sao_violacao() {
        let regras = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2, 3] } }],
            "aulas": [{ "id": "A", "turmas": ["T"], "recursos": [], "aulasSemana": 2 }],
            "recursos": []
        }"#).unwrap();
        let (vago, i) = (regras.vago(), |t| regras.to_quadro_index(0, DiaSemana::Segunda, t));
        let mut q = regras.get_quadro_vazio();
        (q[i(0)], q[i(1)], q[i(2)]) = (1, 1, vago);
        assert!(!validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras.clone()), &q).alguma());
        (q[i(0)], q[i(1)], q[i(2)]) = (1, vago, vago);
        let v = validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras.clone()), &q);
        assert_eq!(v.por_celula[i(1)], Some(crate::horario::MOTIVO_SEM_FOLGA));
        // E um vago no meio do turno não é violação, só qualidade
        (q[i(0)], q[i(1)], q[i(2)]) = (1, vago, 1);
        assert!(!validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras.clone()), &q).alguma());
        assert_eq!(regras.qualidade(&q).0.janela, 1);
    }

    /// Roda o GA até ter um horário válido (com limite, para o teste não travar).
    fn rodar_ate_valido(ga: &mut HorarioGARunner) {
        let mut blocos = 0;
        while !ga.run(100) && !ga.valido() {
            blocos += 1;
            assert!(blocos < 2_000, "o GA deveria chegar a um horário válido");
        }
    }

    /// Quando não dá para atender a todos os pedidos, o GA entrega o horário válido e continua
    /// tentando melhorar até ser interrompido (não para sozinho por falta de melhora).
    #[wasm_bindgen_test(unsupported = test)]
    fn ga_continua_com_horario_valido_quando_a_qualidade_nao_fecha() {
        // P dá as 4 aulas da turma e quer evitar a segunda inteira: 2 aulas caem lá de qualquer jeito
        let regras = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2], "ter": [1, 2] } }],
            "aulas": [{ "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 4 }],
            "recursos": [{ "id": "P", "disponibilidade": { "seg": [1, 2], "ter": [1, 2] }, "evitar": { "seg": [1, 2] } }]
        }"#).unwrap();
        fastrand::seed(6);
        let mut ga = HorarioGARunner::de_regras(regras, 0);
        for _ in 0..30 {
            assert!(!ga.run(100), "não termina sem custo 0");
            assert!(ga.valido(), "o primeiro quadro já é válido");
        }
        let res = ga.resultado();
        assert!(!res.alguma_violacao && !res.terminou);
        assert!(ga.custo().is_some_and(|c| c > 0.0));
        assert_eq!(res.qualidade.iter().filter(|o| o.regra == "evitar" && o.recurso.as_deref() == Some("P")).count(), 2);
    }

    /// A busca local também: com uma regra de qualidade que não fecha, segue rodando com o
    /// horário válido.
    #[wasm_bindgen_test(unsupported = test)]
    fn busca_local_continua_quando_a_qualidade_nao_fecha() {
        let regras = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2], "ter": [1, 2] } }],
            "aulas": [{ "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 4 }],
            "recursos": [{ "id": "P", "disponibilidade": { "seg": [1, 2], "ter": [1, 2] }, "evitar": { "seg": [1, 2] } }]
        }"#).unwrap();
        fastrand::seed(6);
        let mut r = HorarioBuscaLocalRunner::de_regras(regras, 1);
        for _ in 0..20 {
            assert!(!r.run(20_000), "não termina sem custo 0");
        }
        assert!(r.valido() && r.custo() > 0.0 && !r.resultado().terminou);
    }

    /// A busca local resolve as instâncias que o genético e a busca exata não resolviam (10 e 25
    /// turmas), e o que ela entrega passa pela mesma validação dos outros métodos.
    #[wasm_bindgen_test(unsupported = test)]
    fn busca_local_resolve_as_instancias_de_teste() {
        for (nome, cadeias) in [("faculdade-anonimizado", 1), ("pequena", 2), ("media", 1), ("grande", 2)] {
            fastrand::seed(1);
            let mut r = HorarioBuscaLocalRunner::de_regras(carregar(nome), cadeias);
            let mut chamadas = 0;
            while !r.valido() && !r.run(20_000) {
                chamadas += 1;
                assert!(chamadas < 5_000, "{nome}: a busca local deveria chegar a um horário válido (custo {})", r.custo());
            }
            let res = r.resultado();
            assert!(!res.alguma_violacao, "{nome}: {:?}", res.mensagem);
            assert!(res.problemas.is_empty());
            assert!(r.versao() > 0, "{nome}: deveria ter reportado progresso");
        }
    }

    /// Como o genético: entrega o horário válido e segue até atender às regras de qualidade.
    #[wasm_bindgen_test(unsupported = test)]
    fn busca_local_atende_as_regras_de_qualidade() {
        let regras = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] } }],
            "aulas": [
                { "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 4 },
                { "id": "B", "turmas": ["T"], "recursos": ["Q"], "aulasSemana": 4 }
            ],
            "recursos": [
                { "id": "P", "disponibilidade": { "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] }, "evitar": { "ter": [1, 2, 3, 4] } },
                { "id": "Q", "disponibilidade": { "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] } }
            ]
        }"#).unwrap();
        fastrand::seed(2);
        let mut r = HorarioBuscaLocalRunner::de_regras(regras, 1);
        let mut chamadas = 0;
        while !r.run(1_000) {
            chamadas += 1;
            assert!(chamadas < 1_000, "a busca local deveria terminar");
        }
        let res = r.resultado();
        assert!(res.terminou && !res.alguma_violacao);
        assert!(res.qualidade.is_empty(), "há horário válido sem nenhuma aula na terça para P: {:?}", res.qualidade);
        assert_eq!(r.custo(), 0.0);
    }

    /// Sem horário possível, entrega o melhor quadro com as violações e não diz que terminou.
    #[wasm_bindgen_test(unsupported = test)]
    fn busca_local_inviavel_mostra_o_melhor_quadro_com_violacoes() {
        fastrand::seed(1);
        let mut r = HorarioBuscaLocalRunner::de_regras(carregar("inviavel"), 1);
        for _ in 0..50 {
            assert!(!r.run(20_000), "sem horário válido a busca não termina");
        }
        let res = r.resultado();
        assert!(!r.valido() && res.alguma_violacao && !res.terminou);
        assert!(res.alocacoes.is_some_and(|a| !a.is_empty()));
        assert!(!res.problemas.is_empty(), "as células com violação vêm marcadas");
    }
}
