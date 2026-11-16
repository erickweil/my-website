use serde::{Serialize};

// Gene deve ser Serialize + Deserialize para ser enviado ao JS
// O motor roda blocos da população em threads diferentes (rayon). Por isso o problema é
// compartilhado entre threads (`Sync`: os métodos recebem `&self`), os genes passam de uma thread
// para outra, e cada bloco tem o seu próprio `State` (buffers de trabalho), criado por
// `initial_state`. Tipos comuns (Vec, números, structs sem `Rc`/`RefCell`) já cumprem isso.
pub trait GAProblem: Sync {
    type Gene: Clone + std::fmt::Debug + Serialize + Send + Sync;
    type State: Clone + Send;

    /// Retorna o estado inicial do problema, se aplicável
    fn initial_state(&self) -> Self::State;

    /// Retorna o fitness máximo possível (se aplicável)
    fn max_fitness(&self) -> Option<f64> { None }

    /// Inicializa os genes para uma nova população
    fn random_genes(&self) -> Self::Gene;

    /// Quão "boa" é a solução atual?
    /// Valores mais altos indicam soluções melhores.
    fn fitness(&self, state: &mut Self::State, genes: &Self::Gene,) -> f64;

    /// Mutação in-place usando a taxa especificada
    fn mutate(&self, state: &mut Self::State, genes: &mut Self::Gene, mutation_rate: f64);

    /// Crossover entre dois pais para criar dois filhos
    fn crossover(
        &self,
        state: &mut Self::State,
        child_a: &mut Self::Gene,
        child_b: &mut Self::Gene,
        parent_a: &Self::Gene,
        parent_b: &Self::Gene
    );

    /// Função de hash para detectar indivíduos idênticos
    /// Retorna None se não for possível
    fn hash(&self, _genes: &Self::Gene) -> Option<u64> { None }
}

#[derive(Clone, Debug)]
pub struct Individual<G> {
    pub genes: G,
    /// Lazy evaluation: o fitness e hash é calculado apenas quando necessário
    pub fitness: Option<f64>,
    pub hash: Option<u64>,
}