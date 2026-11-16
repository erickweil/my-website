//! Busca exaustiva em paralelo: explora TODA a árvore de busca de um problema, dividindo o
//! trabalho entre as threads do rayon. Acha as soluções ou prova que não existe nenhuma.
//!
//! Vale para qualquer problema que implemente [`RegrasQuadro`] (mais `Clone + Send`, para cada
//! thread ter a sua cópia das regras).
//!
//! # Como funciona
//!
//! A busca é um conjunto de tarefas; cada tarefa é um [`PencilmarkSolver`] sequencial explorando
//! uma subárvore, com o seu próprio quadro. Uma tarefa roda uma fatia de [`BuscaExaustiva::nos_por_fatia`]
//! nós; se não terminou, ela se reparte ([`PencilmarkSolver::repartir`]): entrega as alternativas
//! ainda não tentadas do nível mais raso da sua pilha como tarefas novas e continua com o resto.
//! As threads ociosas pegam as tarefas novas (o rayon faz o roubo de trabalho). Assim subárvores
//! grandes vão sendo divididas sozinhas e as pequenas terminam sem custo extra.
//!
//! - Exaustiva e sem repetição: cada alternativa de cada nó é explorada exatamente uma vez.
//!   Quando não sobra tarefa e não há solução, está provado que o problema é impossível.
//! - As tarefas são subárvores inteiras (milhares de nós), não nós: o custo de coordenar as
//!   threads, que é alto no navegador, fica diluído.
//! - Retomável: [`BuscaExaustiva::executar`] roda até um limite de nós e devolve o controle, para
//!   quem chama mostrar progresso; as tarefas em andamento ficam guardadas para a próxima chamada.
//! - Sem pool de threads (ver [`crate::paralelo`]) roda o mesmo algoritmo em sequência.
//!
//! Com várias soluções possíveis, QUAL é encontrada primeiro depende das threads. O conjunto de
//! todas as soluções (com `max_solucoes` alto) e a resposta "impossível" não dependem.

use std::sync::{
    atomic::{AtomicBool, AtomicI64, Ordering},
    Mutex,
};

use super::solver::{PencilmarkSolver, RegrasQuadro, ResultadoBusca};
use crate::paralelo::pool_disponivel;

/// Uma subárvore em exploração.
struct Tarefa<R: RegrasQuadro> {
    solver: PencilmarkSolver<R>,
    /// Estado do gerador aleatório desta tarefa, guardado entre as fatias (a ordem em que os
    /// valores são tentados é aleatória, e a tarefa pode trocar de thread entre uma fatia e outra).
    semente: u64,
}

pub struct BuscaExaustiva<R: RegrasQuadro> {
    /// Subárvores ainda não exploradas até o fim.
    pendentes: Vec<Tarefa<R>>,
    n_possibs: usize,

    /// Soluções encontradas até agora (no máximo `max_solucoes`).
    pub solucoes: Vec<Vec<i32>>,
    /// A busca para ao juntar este número de soluções. Use `usize::MAX` para enumerar todas.
    pub max_solucoes: usize,
    /// Nós visitados, somando todas as threads.
    pub nos: u64,
    /// Tarefas criadas até agora (1 + as repartições).
    pub tarefas: u64,
    /// Quadro parcial mais preenchido visto até agora.
    pub melhor: Vec<i32>,
    pub melhor_preenchidos: usize,

    /// Nós que uma tarefa roda antes de se repartir. Menor = divide mais cedo (melhor balanceamento),
    /// maior = menos tarefas e menos cópias de quadro. Padrão: [`NOS_POR_FATIA`].
    pub nos_por_fatia: u64,
    /// 1 = sempre em sequência; outro valor = usa o pool do rayon, se houver. Padrão 0.
    pub threads: usize,
    /// Parou por ter juntado `max_solucoes`, descartando subárvores não exploradas.
    interrompida: bool,
}

/// Padrão de [`BuscaExaustiva::nos_por_fatia`].
pub const NOS_POR_FATIA: u64 = 2048;

/// O que as tarefas compartilham durante uma chamada de `executar`.
struct Chamada<R: RegrasQuadro> {
    /// Nós que ainda podem ser gastos nesta chamada.
    restante: AtomicI64,
    /// Já juntou `max_solucoes`: as tarefas param.
    parar: AtomicBool,
    nos_por_fatia: u64,
    max_solucoes: usize,
    n_possibs: usize,
    estado: Mutex<Estado<R>>,
}

struct Estado<R: RegrasQuadro> {
    solucoes: Vec<Vec<i32>>,
    nos: u64,
    tarefas: u64,
    melhor: Vec<i32>,
    melhor_preenchidos: usize,
    /// Tarefas suspensas porque o limite de nós da chamada acabou.
    suspensas: Vec<Tarefa<R>>,
}

enum Fatia<R: RegrasQuadro> {
    /// A subárvore foi explorada até o fim (ou a busca toda deve parar).
    Terminou,
    /// O limite de nós da chamada acabou: guardar a tarefa para depois.
    Suspender,
    /// A tarefa continua, e estas são as tarefas novas que saíram dela.
    Continua(Vec<Tarefa<R>>),
}

/// Embaralha uma semente (splitmix64), para as tarefas filhas terem sequências independentes.
fn misturar(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

impl<R: RegrasQuadro + Clone + Send> Chamada<R> {
    /// Roda uma fatia de uma tarefa.
    fn fatia(&self, t: &mut Tarefa<R>) -> Fatia<R> {
        if self.parar.load(Ordering::Relaxed) {
            return Fatia::Terminou;
        }
        // Reserva nós do limite da chamada
        let antes = self.restante.fetch_sub(self.nos_por_fatia as i64, Ordering::Relaxed);
        if antes <= 0 {
            self.restante.fetch_add(self.nos_por_fatia as i64, Ordering::Relaxed);
            return Fatia::Suspender;
        }
        let reservados = (antes as u64).min(self.nos_por_fatia);
        let mut orcamento = reservados;

        fastrand::seed(t.semente);
        let resultado = t.solver.buscar(&mut orcamento);
        t.semente = fastrand::get_seed();

        // Reparte fora do lock: copia quadros e regras
        let filhos: Vec<Tarefa<R>> = if resultado == ResultadoBusca::Pausado {
            t.solver.repartir().into_iter().enumerate().map(|(k, quadro)| Tarefa {
                solver: PencilmarkSolver::new(t.solver.regras.clone(), quadro, self.n_possibs, self.max_solucoes, None),
                semente: misturar(t.semente ^ k as u64),
            }).collect()
        } else {
            Vec::new()
        };

        let mut e = self.estado.lock().unwrap();
        e.nos += reservados - orcamento;
        e.tarefas += filhos.len() as u64;
        if t.solver.melhor_preenchidos > e.melhor_preenchidos {
            e.melhor_preenchidos = t.solver.melhor_preenchidos;
            e.melhor.clone_from(&t.solver.melhor);
        }
        for solucao in t.solver.solucoes.drain(..) {
            if e.solucoes.len() < self.max_solucoes {
                e.solucoes.push(solucao);
            }
        }
        if e.solucoes.len() >= self.max_solucoes {
            self.parar.store(true, Ordering::Relaxed);
            return Fatia::Terminou;
        }
        drop(e);

        match resultado {
            ResultadoBusca::Pausado => Fatia::Continua(filhos),
            // Falso: esgotou a subárvore. Verdadeiro: esta tarefa sozinha juntou `max_solucoes`
            // (e então a busca já parou no trecho acima); não acontece de outra forma, sem max_iter.
            ResultadoBusca::Falso | ResultadoBusca::Verdadeiro => Fatia::Terminou,
        }
    }

    /// Roda uma tarefa até terminar ou ser suspensa, criando no rayon as tarefas que saem dela.
    fn rodar_no_pool<'s>(&'s self, escopo: &rayon::Scope<'s>, mut t: Tarefa<R>)
    where
        R: 's,
    {
        loop {
            match self.fatia(&mut t) {
                Fatia::Terminou => return,
                Fatia::Suspender => {
                    self.estado.lock().unwrap().suspensas.push(t);
                    return;
                }
                Fatia::Continua(filhos) => {
                    for filho in filhos {
                        escopo.spawn(move |escopo| self.rodar_no_pool(escopo, filho));
                    }
                }
            }
        }
    }

    /// O mesmo, em sequência: as tarefas novas vão para uma pilha e rodam depois desta.
    fn rodar_em_sequencia(&self, iniciais: Vec<Tarefa<R>>) {
        let mut pilha = iniciais;
        while let Some(mut t) = pilha.pop() {
            loop {
                match self.fatia(&mut t) {
                    Fatia::Terminou => break,
                    Fatia::Suspender => {
                        let mut e = self.estado.lock().unwrap();
                        e.suspensas.push(t);
                        e.suspensas.append(&mut pilha);
                        return;
                    }
                    Fatia::Continua(filhos) => pilha.extend(filhos),
                }
            }
        }
    }
}

impl<R: RegrasQuadro + Clone + Send> BuscaExaustiva<R> {
    /// `quadro`: 0 nas células a decidir (ver a convenção em [`PencilmarkSolver`]).
    /// `max_solucoes`: 1 para achar uma solução; `usize::MAX` para enumerar todas.
    pub fn new(regras: R, quadro: Vec<i32>, n_possibs: usize, max_solucoes: usize) -> Self {
        Self::de_solver(PencilmarkSolver::new(regras, quadro, n_possibs, max_solucoes.max(1), None), max_solucoes)
    }

    /// Continua em paralelo uma busca que já vinha rodando em sequência (sem reinícios).
    /// As soluções que o solver já tinha e os nós que já visitou são aproveitados.
    pub fn de_solver(mut solver: PencilmarkSolver<R>, max_solucoes: usize) -> Self {
        // Cada tarefa para sozinha se juntar `max_solucoes` (aí a busca toda já pode parar);
        // abaixo disso ela segue até esgotar a sua subárvore
        solver.max_solucoes = max_solucoes.max(1);
        solver.max_iter = None;
        let solucoes = std::mem::take(&mut solver.solucoes);
        Self {
            n_possibs: solver.n_possibs,
            nos: solver.iter,
            melhor: solver.melhor.clone(),
            melhor_preenchidos: solver.melhor_preenchidos,
            solucoes,
            max_solucoes: max_solucoes.max(1),
            tarefas: 1,
            nos_por_fatia: NOS_POR_FATIA,
            threads: 0,
            interrompida: false,
            pendentes: vec![Tarefa { solver, semente: fastrand::u64(..) }],
        }
    }

    /// true quando achou `max_solucoes` soluções ou explorou a árvore inteira.
    pub fn terminou(&self) -> bool {
        self.pendentes.is_empty() || self.solucoes.len() >= self.max_solucoes
    }

    /// true quando a árvore inteira foi explorada (com ou sem soluções). Fica false se a busca
    /// parou antes por ter juntado `max_solucoes` soluções.
    pub fn esgotou(&self) -> bool {
        self.pendentes.is_empty() && !self.interrompida
    }

    /// true quando está PROVADO que não existe solução: a árvore inteira foi explorada e nada foi achado.
    pub fn impossivel(&self) -> bool {
        self.esgotou() && self.solucoes.is_empty()
    }

    /// Subárvores ainda em aberto.
    pub fn tarefas_pendentes(&self) -> usize {
        self.pendentes.len()
    }

    /// Está rodando em várias threads?
    pub fn usando_threads(&self) -> bool {
        self.threads != 1 && pool_disponivel() && rayon::current_num_threads() > 1
    }

    /// Avança a busca em até ~`max_nos` nós (somando todas as threads). Retorna true quando terminou.
    pub fn executar(&mut self, max_nos: u64) -> bool {
        if self.terminou() {
            return true;
        }
        let chamada = Chamada {
            restante: AtomicI64::new(max_nos.min(i64::MAX as u64) as i64),
            parar: AtomicBool::new(false),
            nos_por_fatia: self.nos_por_fatia.max(1),
            max_solucoes: self.max_solucoes,
            n_possibs: self.n_possibs,
            estado: Mutex::new(Estado {
                solucoes: std::mem::take(&mut self.solucoes),
                nos: self.nos,
                tarefas: self.tarefas,
                melhor: std::mem::take(&mut self.melhor),
                melhor_preenchidos: self.melhor_preenchidos,
                suspensas: Vec::new(),
            }),
        };
        let iniciais = std::mem::take(&mut self.pendentes);

        if self.usando_threads() {
            let chamada = &chamada;
            rayon::scope(|escopo| {
                for t in iniciais {
                    escopo.spawn(move |escopo| chamada.rodar_no_pool(escopo, t));
                }
            });
        } else {
            chamada.rodar_em_sequencia(iniciais);
        }

        let interrompida = chamada.parar.load(Ordering::Relaxed);
        let e = chamada.estado.into_inner().unwrap();
        self.solucoes = e.solucoes;
        self.nos = e.nos;
        self.tarefas = e.tarefas;
        self.melhor = e.melhor;
        self.melhor_preenchidos = e.melhor_preenchidos;
        self.pendentes = e.suspensas;
        self.interrompida |= interrompida;
        self.terminou()
    }
}
