pub trait GAProblem {
    type Gene: Clone;

    /// Retorna o fitness máximo possível (se aplicável)
    fn max_fitness(&self) -> Option<f64> { None }

    /// Inicializa os genes para uma nova população
    fn random_genes(&self) -> Self::Gene;

    /// Quão "boa" é a solução atual?
    /// Valores mais altos indicam soluções melhores.
    fn fitness(&self, genes: &Self::Gene) -> f64;

    /// Mutação in-place usando a taxa especificada
    fn mutate(&self, genes: &mut Self::Gene, mutation_rate: f64);

    /// Crossover entre dois pais para criar dois filhos
    fn crossover(
        &self,
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
