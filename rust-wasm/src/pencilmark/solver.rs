//! Solver Pencilmark genérico — port de `src/lib/pencilmark.ts`.
//!
//! Imita a forma de resolver à mão: analisa o quadro marcando (pencil mark) as possibilidades de
//! cada célula vazia segundo as regras do problema, escolhe a célula com MENOS possibilidades e
//! testa cada uma delas, com backtracking quando nenhuma serve.
//!
//! Diferenças em relação ao TS (comportamento igual, estrutura diferente):
//! - A recursão de `_solucionarQuadro` virou uma **pilha explícita** de escolhas. Isso permite
//!   pausar a busca a qualquer momento (`buscar(orcamento)`) e retomá-la depois — necessário no WASM,
//!   onde uma chamada é síncrona e o worker precisa postar progresso entre blocos de iterações —
//!   e elimina o risco de estouro de pilha em quadros grandes.
//! - O laço de reinícios de `solucionarQuadro` (orçamento 2^baseIter, 2^(baseIter+1), …) também é
//!   retomável: ver [`ExecucaoPencilmark`].
//!
//! O solver não sabe nada sobre horários: qualquer problema que implemente [`RegrasQuadro`] serve.
//!
//! Convenção do quadro (igual ao TS): `0` = célula vazia (a decidir), `> 0` = valor escolhido
//! (possibilidade `k` é gravada como `k + 1`), qualquer outro valor (ex.: `-1`) = célula fixa/inativa.

use std::ops::{Deref, DerefMut};

use crate::bitflag::BitFlag;
use crate::random::{random_range, random_shuffle};

/// Possibilidades de uma célula: um [`BitFlag`] + o índice da célula no quadro.
#[derive(Clone, Debug)]
pub struct Possib {
    pub index: usize,
    pub flags: BitFlag,
}

impl Possib {
    pub fn new(index: usize, n_possibs: usize) -> Self {
        Self { index, flags: BitFlag::new(n_possibs) }
    }
}

impl Deref for Possib {
    type Target = BitFlag;
    fn deref(&self) -> &BitFlag { &self.flags }
}

impl DerefMut for Possib {
    fn deref_mut(&mut self) -> &mut BitFlag { &mut self.flags }
}

/// Regras do problema. Equivale ao `regrasFn(quadro, possibs | null)` do TS, separado em dois métodos.
pub trait RegrasQuadro {
    /// Chamado uma vez para o quadro todo (o `possibs === null` do TS): atualiza o estado derivado
    /// que as regras precisarem (contagens, ocupação…). Retorna false se o quadro já é inválido.
    fn verificar_quadro(&mut self, quadro: &[i32]) -> bool;

    /// Chamado para uma célula: recebe `possib` com todas as flags marcadas e `possib.index`
    /// definido, e deve DESMARCAR o que não é permitido. Retorna false se o quadro é inválido.
    fn verificar_celula(&mut self, quadro: &[i32], possib: &mut Possib) -> bool;
}

/// Permite passar `&mut regras` para o solver sem abrir mão da posse (usado em `desmarcar_quadro`).
impl<R: RegrasQuadro + ?Sized> RegrasQuadro for &mut R {
    fn verificar_quadro(&mut self, quadro: &[i32]) -> bool {
        (**self).verificar_quadro(quadro)
    }
    fn verificar_celula(&mut self, quadro: &[i32], possib: &mut Possib) -> bool {
        (**self).verificar_celula(quadro, possib)
    }
}

/// Resultado de `obterMelhorPossib` no TS (`true` | `false` | `Possib`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MelhorPossib {
    /// Não há célula vazia: o quadro está completo e válido (`true` no TS).
    Completo,
    /// Alguma regra falhou ou há célula vazia sem possibilidades (`false` no TS).
    Invalido,
    /// Há células vazias; a de menor entropia está em `cache_possib[depth*2+1]` (o `Possib` do TS).
    Celula,
}

/// Retorno de [`PencilmarkSolver::buscar`]. `Verdadeiro`/`Falso` são o retorno de
/// `_solucionarQuadro(0)` no TS; `Pausado` é novo (o orçamento de iterações desta chamada acabou).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultadoBusca {
    /// Orçamento da chamada esgotado; chame `buscar` de novo para continuar de onde parou.
    Pausado,
    /// Obteve `max_solucoes` soluções, OU abortou por ter passado de `max_iter`.
    Verdadeiro,
    /// Percorreu todo o espaço de busca sem obter `max_solucoes` soluções.
    Falso,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EstadoBusca {
    /// Entrar num novo nó: equivale ao início de uma chamada de `_solucionarQuadro`.
    Entrar,
    /// Tentar a próxima possibilidade da escolha no topo da pilha (o laço `for` do TS).
    Avancar,
    /// A busca terminou (Verdadeiro/Falso); só volta a rodar após `reiniciar`.
    Parado,
}

/// Um nível da antiga recursão: qual possibilidade testar a seguir na célula escolhida.
/// A célula e suas possibilidades ficam em `cache_possib[nivel*2+1]`, como no TS.
#[derive(Debug, Clone, Copy)]
struct Escolha {
    /// Deslocamento aleatório: percorre as possibilidades em ordem circular a partir dele.
    offset: usize,
    /// Quantas possibilidades (marcadas ou não) já foram percorridas a partir do offset.
    i: usize,
}

pub struct PencilmarkSolver<R: RegrasQuadro> {
    pub regras: R,
    pub quadro: Vec<i32>,
    pub n_possibs: usize,
    pub max_solucoes: usize,
    pub max_iter: Option<u64>,

    pub solucoes: Vec<Vec<i32>>,
    pub iter: u64,

    /// Melhor solução encontrada até agora, mesmo que não seja completa (a mais preenchida).
    pub melhor: Vec<i32>,
    pub melhor_preenchidos: usize,

    /// Por nível: `[2n]` = rascunho, `[2n+1]` = célula de menor entropia. Reaproveitados entre nós.
    cache_possib: Vec<Possib>,
    pilha: Vec<Escolha>,
    estado: EstadoBusca,
}

impl<R: RegrasQuadro> PencilmarkSolver<R> {
    pub fn new(regras: R, quadro: Vec<i32>, n_possibs: usize, max_solucoes: usize, max_iter: Option<u64>) -> Self {
        let melhor_preenchidos = quadro.iter().filter(|&&v| v != 0).count();
        Self {
            regras,
            melhor: quadro.clone(),
            quadro,
            n_possibs,
            max_solucoes,
            max_iter,
            solucoes: Vec::new(),
            iter: 0,
            melhor_preenchidos,
            cache_possib: Vec::new(),
            pilha: Vec::new(),
            estado: EstadoBusca::Entrar,
        }
    }

    /// Troca o quadro e recomeça a busca do zero (mantém `iter`, `solucoes` e `melhor`, como o TS).
    pub fn reiniciar(&mut self, quadro: Vec<i32>) {
        self.quadro = quadro;
        self.pilha.clear();
        self.estado = EstadoBusca::Entrar;
    }

    /// Profundidade atual da busca (o `depth` do TS).
    pub fn profundidade(&self) -> usize {
        self.pilha.len()
    }

    /// Reparte uma busca PAUSADA (depois de `buscar` retornar `Pausado`): tira deste solver as
    /// alternativas ainda não tentadas do nível mais raso da pilha que tiver alguma, e devolve um
    /// quadro para cada uma (o quadro como estava naquele nível, com a alternativa aplicada).
    ///
    /// Quem chama cria um solver novo para cada quadro devolvido. Juntos, este solver e os novos
    /// exploram exatamente a mesma árvore que este exploraria sozinho, sem repetir nem pular nada:
    /// é o que permite dividir uma busca exaustiva entre threads.
    /// Devolve vazio se não há o que repartir (este solver já está no último ramo de cada nível).
    pub fn repartir(&mut self) -> Vec<Vec<i32>> {
        for nivel in 0..self.pilha.len() {
            let p = &self.cache_possib[nivel * 2 + 1];
            let n = p.n_flags();
            let escolha = self.pilha[nivel];
            let alternativas: Vec<usize> = (escolha.i..n).map(|j| (escolha.offset + j) % n).filter(|&k| p.ler(k)).collect();
            if alternativas.is_empty() {
                continue;
            }

            // O quadro como estava ao chegar neste nível: desfaz as escolhas dele para baixo
            let mut base = self.quadro.clone();
            for l in nivel..self.pilha.len() {
                base[self.cache_possib[l * 2 + 1].index] = 0;
            }
            let celula = p.index;
            // Este solver não tenta mais essas alternativas
            self.pilha[nivel].i = n;

            return alternativas
                .into_iter()
                .map(|k| {
                    let mut quadro = base.clone();
                    quadro[celula] = k as i32 + 1;
                    quadro
                })
                .collect();
        }
        Vec::new()
    }

    /// Analisa todas as células vazias e encontra a de menor entropia (`obterMelhorPossib` no TS).
    pub fn obter_melhor_possib(&mut self, depth: usize) -> MelhorPossib {
        while self.cache_possib.len() < depth * 2 + 2 {
            self.cache_possib.push(Possib::new(usize::MAX, self.n_possibs));
        }
        let (rascunho, resto) = self.cache_possib.split_at_mut(depth * 2 + 1);
        let p = &mut rascunho[depth * 2];
        let min_p = &mut resto[0];

        let random_index = if self.quadro.is_empty() { 0 } else { random_range(0, self.quadro.len()) };
        let mut min_cont: Option<usize> = None;
        let mut preenchidos = 0;

        // Atualizar cache
        if !self.regras.verificar_quadro(&self.quadro) {
            return MelhorPossib::Invalido;
        }

        for index in 0..self.quadro.len() {
            if self.quadro[index] != 0 {
                preenchidos += 1;
                continue;
            }

            p.resetar(true);
            p.index = index;
            if !self.regras.verificar_celula(&self.quadro, p) {
                return MelhorPossib::Invalido;
            }

            let cont = p.contar();
            if cont == 0 {
                // Célula vazia sem possibilidades: o quadro é inválido
                return MelhorPossib::Invalido;
            }

            match min_cont {
                Some(m) if cont > m => {}
                Some(m) if cont == m => {
                    // Mesma entropia: fica com a mais próxima do índice aleatório, para diversificar
                    if index.abs_diff(random_index) < min_p.index.abs_diff(random_index) {
                        min_p.receber(p);
                        min_p.index = p.index;
                    }
                }
                _ => {
                    min_cont = Some(cont);
                    min_p.receber(p);
                    min_p.index = p.index;
                }
            }
        }

        if preenchidos > self.melhor_preenchidos {
            self.melhor_preenchidos = preenchidos;
            self.melhor.clone_from(&self.quadro);
        }

        match min_cont {
            // Nenhuma célula vazia: o quadro está completo e válido
            None => MelhorPossib::Completo,
            Some(_) => MelhorPossib::Celula,
        }
    }

    /// Possibilidades da célula escolhida por `obter_melhor_possib(depth)` quando retornou `Celula`.
    pub fn possib_escolhida(&self, depth: usize) -> &Possib {
        &self.cache_possib[depth * 2 + 1]
    }

    /// Equivale a `_solucionarQuadro(0)` do TS, mas retomável: processa no máximo `orcamento` nós
    /// (decrementando-o) e retorna `Pausado` se ele acabar antes de a busca terminar.
    pub fn buscar(&mut self, orcamento: &mut u64) -> ResultadoBusca {
        loop {
            match self.estado {
                EstadoBusca::Parado => return ResultadoBusca::Falso,

                EstadoBusca::Entrar => {
                    if *orcamento == 0 {
                        return ResultadoBusca::Pausado;
                    }
                    *orcamento -= 1;

                    self.iter += 1;
                    if self.iter % 2048 == 0 {
                        if let Some(max) = self.max_iter {
                            if self.iter > max {
                                // Abortar "com sucesso" (o TS retorna true até o topo); quem chamou reinicia.
                                self.estado = EstadoBusca::Parado;
                                return ResultadoBusca::Verdadeiro;
                            }
                        }
                    }

                    let depth = self.pilha.len();
                    match self.obter_melhor_possib(depth) {
                        MelhorPossib::Completo => {
                            self.solucoes.push(self.quadro.clone());
                            if self.solucoes.len() >= self.max_solucoes {
                                self.estado = EstadoBusca::Parado;
                                return ResultadoBusca::Verdadeiro;
                            }
                            // Ainda precisa de mais soluções: volta e continua procurando
                            self.estado = EstadoBusca::Avancar;
                        }
                        MelhorPossib::Invalido => self.estado = EstadoBusca::Avancar,
                        MelhorPossib::Celula => {
                            let n = self.cache_possib[depth * 2 + 1].n_flags();
                            // Percorre os k valores em ordem circular a partir de um offset aleatório
                            let offset = if n == 0 { 0 } else { random_range(0, n) };
                            self.pilha.push(Escolha { offset, i: 0 });
                            self.estado = EstadoBusca::Avancar;
                        }
                    }
                }

                EstadoBusca::Avancar => {
                    let nivel = match self.pilha.len() {
                        // Backtracking chegou ao topo sem mais opções: espaço de busca esgotado
                        0 => {
                            self.estado = EstadoBusca::Parado;
                            return ResultadoBusca::Falso;
                        }
                        n => n - 1,
                    };
                    let escolha = self.pilha.last_mut().expect("pilha não vazia");
                    let p = &self.cache_possib[nivel * 2 + 1];
                    let n = p.n_flags();

                    let mut proximo = None;
                    while escolha.i < n {
                        let k = (escolha.offset + escolha.i) % n;
                        escolha.i += 1;
                        if p.ler(k) {
                            proximo = Some(k);
                            break;
                        }
                    }

                    match proximo {
                        Some(k) => {
                            // Testa o valor k nesta célula e desce um nível
                            self.quadro[p.index] = k as i32 + 1;
                            self.estado = EstadoBusca::Entrar;
                        }
                        None => {
                            // Nenhuma escolha serviu nesta célula: desfaz e volta um nível (backtracking)
                            self.quadro[p.index] = 0;
                            self.pilha.pop();
                        }
                    }
                }
            }
        }
    }
}

/// Port de `PencilmarkSolver.solucionarQuadro` (o laço de reinícios), retomável.
///
/// - `base_iter = None`: uma única busca, sem limite de iterações.
/// - `base_iter = Some(b)`: reinicia a busca do quadro original com orçamento `2^b`, `2^(b+1)`, …
///   até `2^30`, e a partir de `2^31` sem limite — para não ficar preso num caminho ruim.
///
/// Fiel ao TS: `iter` NÃO é zerado entre reinícios e o limite só é verificado a cada 2048
/// iterações, então cada reinício roda até `iter` (acumulado) passar de `2^exp`.
pub struct ExecucaoPencilmark<R: RegrasQuadro> {
    pub solver: PencilmarkSolver<R>,
    quadro_inicial: Vec<i32>,
    base_iter: Option<u32>,
    exp: u32,
    terminou: bool,
}

impl<R: RegrasQuadro> ExecucaoPencilmark<R> {
    pub fn new(regras: R, quadro: Vec<i32>, n_possibs: usize, max_solucoes: usize, base_iter: Option<u32>) -> Self {
        // Como no TS, o solver nasce com quadro vazio (então `melhor` começa vazio)
        let mut solver = PencilmarkSolver::new(regras, Vec::new(), n_possibs, max_solucoes, None);
        let exp = base_iter.unwrap_or(0);
        solver.max_iter = Self::limite(base_iter, exp);
        solver.reiniciar(quadro.clone());
        Self { solver, quadro_inicial: quadro, base_iter, exp, terminou: false }
    }

    fn limite(base_iter: Option<u32>, exp: u32) -> Option<u64> {
        match base_iter {
            Some(_) if exp < 31 => Some(1u64 << exp),
            _ => None,
        }
    }

    pub fn terminou(&self) -> bool {
        self.terminou
    }

    /// Avança a execução em no máximo ~`orcamento` nós. Retorna true quando terminou
    /// (achou `max_solucoes` soluções ou provou que não há mais).
    pub fn executar(&mut self, orcamento: u64) -> bool {
        let mut restante = orcamento;
        while !self.terminou {
            match self.solver.buscar(&mut restante) {
                ResultadoBusca::Pausado => return false,
                // Chegou no fim do espaço de busca
                ResultadoBusca::Falso => self.terminou = true,
                ResultadoBusca::Verdadeiro => {
                    if self.base_iter.is_none() || self.solver.solucoes.len() >= self.solver.max_solucoes {
                        self.terminou = true;
                    } else {
                        // Abortou por max_iter: reinicia com o dobro do orçamento
                        self.exp += 1;
                        if self.exp >= 32 {
                            self.terminou = true;
                        } else {
                            self.solver.max_iter = Self::limite(self.base_iter, self.exp);
                            self.solver.reiniciar(self.quadro_inicial.clone());
                        }
                    }
                }
            }
        }
        true
    }
}

/// Resultado de [`solucionar_quadro`] (o objeto `{ iter, solucoes, melhor }` do TS).
pub struct ResultadoSolucao {
    pub iter: u64,
    pub solucoes: Vec<Vec<i32>>,
    pub melhor: Vec<i32>,
}

/// Versão bloqueante de `PencilmarkSolver.solucionarQuadro`: roda até o fim.
pub fn solucionar_quadro<R: RegrasQuadro>(
    regras: R,
    quadro: Vec<i32>,
    n_possibs: usize,
    max_solucoes: usize,
    base_iter: Option<u32>,
) -> ResultadoSolucao {
    let mut exec = ExecucaoPencilmark::new(regras, quadro, n_possibs, max_solucoes, base_iter);
    exec.executar(u64::MAX);
    let s = exec.solver;
    ResultadoSolucao { iter: s.iter, solucoes: s.solucoes, melhor: s.melhor }
}

/// Port de `PencilmarkSolver.desmarcarQuadro`.
///
/// Começa com um quadro resolvido e vai desmarcando células, em ordem aleatória, enquanto o quadro
/// continuar tendo solução única. Para cada célula removida, resolve com `max_solucoes = 2` para
/// verificar a unicidade; se houver mais de uma solução (ou nenhuma), restaura o valor original.
pub fn desmarcar_quadro<R: RegrasQuadro>(
    quadro: &mut [i32],
    n_possibs: usize,
    regras: &mut R,
    mut progresso: Option<&mut dyn FnMut(u64, usize)>,
) {
    let mut indices: Vec<usize> = (0..quadro.len()).collect();
    random_shuffle(&mut indices);

    for (iter, index) in indices.into_iter().enumerate() {
        let original = quadro[index];
        quadro[index] = 0;

        if let Some(cb) = progresso.as_mut() {
            cb(iter as u64, index);
        }

        let mut solver = PencilmarkSolver::new(&mut *regras, quadro.to_vec(), n_possibs, 2, None);
        let quantos = match solver.obter_melhor_possib(0) {
            MelhorPossib::Celula => solver.possib_escolhida(0).contar(),
            _ => 0,
        };
        if quantos == 0 {
            crate::console_log!("INCONSISTENTE: Quadro inválido ao remover célula {} (valor original: {})", index, original);
        }

        if quantos == 1 {
            // Agora verifica se a solução é única
            let mut sem_limite = u64::MAX;
            solver.buscar(&mut sem_limite);
            if solver.solucoes.is_empty() {
                crate::console_log!("INCONSISTENTE: Quadro inválido ao remover célula {} (valor original: {})", index, original);
            }
            if solver.solucoes.len() == 1 {
                // A solução continua única, pode manter a célula vazia
                continue;
            }
        }

        quadro[index] = original;
    }
}
