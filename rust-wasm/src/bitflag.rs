//! Conjunto de flags (bitset) de tamanho definido em tempo de execução.
//!
//! Port de `src/lib/bitFlag.ts`, que tem `BitFlag32` (até 32 flags, um único número) e
//! `BitFlagArray` (mais que isso). Aqui é um tipo só com as duas representações:
//!
//! - até 64 flags: **um único `u64`** guardado direto na struct, sem alocação no heap;
//! - acima de 64: um bloco de `u64` no heap, com quantas palavras forem necessárias.
//!
//! A representação é escolhida em [`BitFlag::new`] e não muda depois. Quase tudo trabalha sobre
//! [`BitFlag::palavras`], que vê a palavra única como uma fatia de tamanho 1. Assim `ler`,
//! `marcar` e `desmarcar` têm um único caminho de código e só escolhem o ponteiro da fatia.
//! Medido no solver de horários: fazer `match` na representação dentro de cada `ler`/`marcar`
//! deixava o laço por disciplina de `verificar_celula` ~30% mais lento com mais de 64 flags.
//! `contar`, `vazio`, `resetar` e `receber` ainda fazem `match`, porque são chamados uma vez por
//! célula e o caso de uma palavra vira uma única instrução.
//!
//! Além do que o solver Pencilmark usa, o tipo serve para qualquer lugar que precise marcar
//! índices de 0..n (ex.: genes já usados num crossover de permutação).

use std::fmt;

const BITS: usize = u64::BITS as usize;

#[derive(Clone, PartialEq, Eq, Hash)]
enum Palavras {
    /// Até 64 flags: um único número.
    Uma(u64),
    /// Mais de 64 flags: `n_flags.div_ceil(64)` números.
    Varias(Box<[u64]>),
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct BitFlag {
    /// Número total de flags que a instância pode representar (0..n_flags).
    n_flags: usize,
    palavras: Palavras,
}

/// Máscara com os `n` bits mais baixos ligados (`n` de 1 a 64).
#[inline(always)]
fn mascara_baixa(n: usize) -> u64 {
    debug_assert!((1..=BITS).contains(&n));
    u64::MAX >> (BITS - n)
}

impl BitFlag {
    /// Cria um conjunto com `n_flags` flags, todas desmarcadas.
    /// Com até 64 flags não aloca nada no heap.
    pub fn new(n_flags: usize) -> Self {
        let palavras = if n_flags <= BITS {
            Palavras::Uma(0)
        } else {
            Palavras::Varias(vec![0; n_flags.div_ceil(BITS)].into_boxed_slice())
        };
        Self { n_flags, palavras }
    }

    /// Cria um conjunto com `n_flags` flags, todas marcadas.
    pub fn cheio(n_flags: usize) -> Self {
        let mut b = Self::new(n_flags);
        b.resetar(true);
        b
    }

    #[inline(always)]
    pub fn n_flags(&self) -> usize {
        self.n_flags
    }

    /// As palavras de 64 bits, vendo a palavra única como uma fatia de tamanho 1.
    /// Os bits acima de `n_flags` na última palavra são sempre 0.
    #[inline(always)]
    pub fn palavras(&self) -> &[u64] {
        match &self.palavras {
            Palavras::Uma(p) => std::slice::from_ref(p),
            Palavras::Varias(v) => v,
        }
    }

    #[inline(always)]
    fn palavras_mut(&mut self) -> &mut [u64] {
        match &mut self.palavras {
            Palavras::Uma(p) => std::slice::from_mut(p),
            Palavras::Varias(v) => v,
        }
    }

    /// Retorna o número de flags marcadas.
    #[inline]
    pub fn contar(&self) -> usize {
        match &self.palavras {
            Palavras::Uma(p) => p.count_ones() as usize,
            Palavras::Varias(v) => v.iter().map(|p| p.count_ones() as usize).sum(),
        }
    }

    /// Retorna true se nenhuma flag está marcada.
    #[inline]
    pub fn vazio(&self) -> bool {
        match &self.palavras {
            Palavras::Uma(p) => *p == 0,
            Palavras::Varias(v) => v.iter().all(|&p| p == 0),
        }
    }

    /// Copia o estado de outra instância com o mesmo número de flags.
    #[inline]
    pub fn receber(&mut self, outro: &BitFlag) {
        assert_eq!(self.n_flags, outro.n_flags, "As instâncias devem ter o mesmo número de flags para receber.");
        match (&mut self.palavras, &outro.palavras) {
            (Palavras::Uma(a), Palavras::Uma(b)) => *a = *b,
            (Palavras::Varias(a), Palavras::Varias(b)) => a.copy_from_slice(b),
            // Mesmo n_flags implica mesma representação
            _ => unreachable!(),
        }
    }

    /// Marca (true) ou desmarca (false) todas as flags.
    #[inline]
    pub fn resetar(&mut self, valor: bool) {
        let n_flags = self.n_flags;
        match &mut self.palavras {
            Palavras::Uma(p) => {
                *p = if valor && n_flags > 0 { mascara_baixa(n_flags) } else { 0 };
            }
            Palavras::Varias(v) => {
                if !valor {
                    v.fill(0);
                    return;
                }
                v.fill(u64::MAX);
                // Remove o excesso de 1s do último bloco, para que contar() não conte bits além de n_flags
                let resto = n_flags % BITS;
                if resto != 0 && let Some(ultima) = v.last_mut() {
                    *ultima = mascara_baixa(resto);
                }
            }
        }
    }

    /// Ativa a flag `n` (0-indexada).
    #[inline(always)]
    pub fn marcar(&mut self, n: usize) {
        debug_assert!(n < self.n_flags, "flag {n} fora do intervalo 0..{}", self.n_flags);
        self.palavras_mut()[n / BITS] |= 1u64 << (n % BITS);
    }

    /// Desativa a flag `n` (0-indexada).
    #[inline(always)]
    pub fn desmarcar(&mut self, n: usize) {
        debug_assert!(n < self.n_flags, "flag {n} fora do intervalo 0..{}", self.n_flags);
        self.palavras_mut()[n / BITS] &= !(1u64 << (n % BITS));
    }

    /// Retorna se a flag `n` está marcada.
    #[inline(always)]
    pub fn ler(&self, n: usize) -> bool {
        debug_assert!(n < self.n_flags, "flag {n} fora do intervalo 0..{}", self.n_flags);
        (self.palavras()[n / BITS] >> (n % BITS)) & 1 != 0
    }

    /// Mantém só as flags que também estão marcadas em `outro` (interseção, `self &= outro`).
    #[inline]
    pub fn e_com(&mut self, outro: &BitFlag) {
        self.combinar(outro, |a, b| a & b);
    }

    /// Marca também as flags marcadas em `outro` (união, `self |= outro`).
    #[inline]
    pub fn ou_com(&mut self, outro: &BitFlag) {
        self.combinar(outro, |a, b| a | b);
    }

    /// Desmarca as flags que estão marcadas em `outro` (diferença, `self &= !outro`).
    #[inline]
    pub fn sem(&mut self, outro: &BitFlag) {
        self.combinar(outro, |a, b| a & !b);
    }

    /// Aplica `op` palavra a palavra. Nenhuma das operações acima liga bits além de `n_flags`,
    /// já que os dois lados têm esses bits zerados.
    #[inline(always)]
    fn combinar(&mut self, outro: &BitFlag, op: impl Fn(u64, u64) -> u64) {
        assert_eq!(self.n_flags, outro.n_flags, "As instâncias devem ter o mesmo número de flags.");
        for (a, &b) in self.palavras_mut().iter_mut().zip(outro.palavras()) {
            *a = op(*a, b);
        }
    }

    /// Índices das flags marcadas, em ordem crescente. Pula as palavras zeradas e acha cada bit
    /// com `trailing_zeros`, então custa proporcional ao número de palavras + flags marcadas.
    #[inline]
    pub fn marcados(&self) -> Marcados<'_> {
        let palavras = self.palavras();
        Marcados { atual: palavras[0], resto: &palavras[1..], base: 0 }
    }
}

/// Iterador retornado por [`BitFlag::marcados`].
pub struct Marcados<'a> {
    /// Bits da palavra atual ainda não visitados.
    atual: u64,
    resto: &'a [u64],
    /// Índice da flag correspondente ao bit 0 da palavra atual.
    base: usize,
}

impl Iterator for Marcados<'_> {
    type Item = usize;

    #[inline]
    fn next(&mut self) -> Option<usize> {
        while self.atual == 0 {
            let (&prox, resto) = self.resto.split_first()?;
            self.atual = prox;
            self.resto = resto;
            self.base += BITS;
        }
        let bit = self.atual.trailing_zeros() as usize;
        self.atual &= self.atual - 1; // apaga o bit mais baixo
        Some(self.base + bit)
    }
}

impl fmt::Debug for BitFlag {
    /// Mostra as flags marcadas, ex.: `BitFlag(9) {0, 4, 8}`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "BitFlag({}) ", self.n_flags)?;
        f.debug_set().entries(self.marcados()).finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    /// Tamanhos nas bordas das palavras, dos dois lados do limite de 64 e bem acima.
    const TAMANHOS: [usize; 13] = [1, 9, 31, 32, 33, 63, 64, 65, 100, 128, 129, 200, 1000];

    #[wasm_bindgen_test(unsupported = test)]
    fn representacao_depende_do_tamanho() {
        for n in [0, 1, 63, 64] {
            assert!(matches!(BitFlag::new(n).palavras, Palavras::Uma(_)), "n={n} deveria ser uma palavra");
        }
        for (n, palavras) in [(65, 2), (128, 2), (129, 3), (1000, 16)] {
            match BitFlag::new(n).palavras {
                Palavras::Varias(v) => assert_eq!(v.len(), palavras, "n={n}"),
                Palavras::Uma(_) => panic!("n={n} deveria usar várias palavras"),
            }
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn operacoes_basicas_em_varios_tamanhos() {
        for n in TAMANHOS {
            let mut b = BitFlag::new(n);
            assert_eq!(b.contar(), 0);
            assert!(b.vazio());

            b.resetar(true);
            assert_eq!(b.contar(), n, "resetar(true) com n={n}");
            assert!((0..n).all(|i| b.ler(i)));
            assert_eq!(b, BitFlag::cheio(n));

            b.desmarcar(0);
            b.desmarcar(n - 1);
            // com n=1, as duas desmarcações são a mesma flag
            assert_eq!(b.contar(), n.saturating_sub(2));
            assert!(!b.ler(0) && !b.ler(n - 1));

            b.resetar(false);
            assert_eq!(b.contar(), 0);
            b.marcar(n - 1);
            assert!(b.ler(n - 1));
            assert!(!b.vazio());
            assert_eq!(b.contar(), 1);

            let mut c = BitFlag::new(n);
            c.receber(&b);
            assert_eq!(c, b);
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn zero_flags() {
        let mut b = BitFlag::new(0);
        b.resetar(true);
        assert_eq!(b.contar(), 0);
        assert!(b.vazio());
        assert_eq!(b.marcados().count(), 0);
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn marcados_e_operacoes_em_lote() {
        for n in TAMANHOS {
            // a = múltiplos de 3, b = múltiplos de 2 (sempre incluindo a última flag)
            let mut a = BitFlag::new(n);
            let mut b = BitFlag::new(n);
            let mut esperado_a: Vec<usize> = (0..n).filter(|i| i % 3 == 0).collect();
            let mut esperado_b: Vec<usize> = (0..n).filter(|i| i % 2 == 0).collect();
            for v in [&mut esperado_a, &mut esperado_b] {
                if v.last() != Some(&(n - 1)) {
                    v.push(n - 1);
                }
            }
            esperado_a.iter().for_each(|&i| a.marcar(i));
            esperado_b.iter().for_each(|&i| b.marcar(i));

            assert_eq!(a.marcados().collect::<Vec<_>>(), esperado_a, "marcados n={n}");
            assert_eq!(a.contar(), esperado_a.len());

            let filtrar = |f: &dyn Fn(usize) -> bool| (0..n).filter(|&i| f(i)).collect::<Vec<_>>();
            let em = |v: &Vec<usize>, i: usize| v.binary_search(&i).is_ok();

            let mut e = a.clone();
            e.e_com(&b);
            assert_eq!(e.marcados().collect::<Vec<_>>(), filtrar(&|i| em(&esperado_a, i) && em(&esperado_b, i)), "e_com n={n}");

            let mut ou = a.clone();
            ou.ou_com(&b);
            assert_eq!(ou.marcados().collect::<Vec<_>>(), filtrar(&|i| em(&esperado_a, i) || em(&esperado_b, i)), "ou_com n={n}");

            let mut sem = a.clone();
            sem.sem(&b);
            assert_eq!(sem.marcados().collect::<Vec<_>>(), filtrar(&|i| em(&esperado_a, i) && !em(&esperado_b, i)), "sem n={n}");

            // O complemento de algo cheio não pode ter bits além de n_flags
            let mut vazio = BitFlag::new(n);
            vazio.sem(&BitFlag::cheio(n));
            assert!(vazio.vazio());
            let mut cheio = BitFlag::cheio(n);
            cheio.ou_com(&a);
            assert_eq!(cheio.contar(), n);
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn debug_mostra_os_marcados() {
        let mut b = BitFlag::new(9);
        [0, 4, 8].into_iter().for_each(|i| b.marcar(i));
        assert_eq!(format!("{b:?}"), "BitFlag(9) {0, 4, 8}");
    }
}
