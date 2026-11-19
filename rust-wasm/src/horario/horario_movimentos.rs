//! Operadores de movimento (vizinhanças) compartilhados entre a busca local e a mutação do
//! algoritmo genético.
//!
//! Todos os movimentos geram uma lista de trocas `(a, b)` dentro da mesma turma e apenas entre
//! células ativas (nunca `-1`), preservando sempre o multiconjunto de disciplinas de cada turma:
//! - **Troca simples**: duas células ativas da mesma turma.
//! - **Troca de bloco**: um grupo de aulas seguidas de disciplina agrupada trocado inteiro com
//!   outro trecho do mesmo tamanho na turma.
//! - **Propagação em aulas conjuntas**: ao mover uma aula em conjunto, repete a troca nas turmas
//!   parceiras.
//! - **Cadeia de Kempe**: troca dois horários (ou blocos) numa turma e, em cadeia, nas turmas que
//!   passariam a disputar recurso ou que dividem aula em conjunto.

use std::ops::Range;

use super::horario_tabelas::TabelasHorario;

/// Configuração dos operadores de movimento usados na busca local e na mutação do GA.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ConfigMovimentos {
    /// Probabilidade de, ao sortear uma aula de disciplina agrupada, mover o grupo inteiro de aulas
    /// seguidas em vez de só a aula.
    pub p_bloco: f64,
    /// Repetir a troca nas turmas parceiras de uma aula em conjunto.
    pub propagar_unidas: bool,
    /// Probabilidade de o movimento ser uma cadeia de Kempe.
    pub p_kempe: f64,
    /// Na cadeia de Kempe, quando a aula sorteada é de disciplina agrupada (com chance `p_bloco`),
    /// troca o grupo inteiro em vez de um horário só.
    pub kempe_de_blocos: bool,
}

impl ConfigMovimentos {
    /// Apenas troca simples de duas células dentro da turma (equivalente à mutação original do GA).
    pub const SIMPLES: Self = Self {
        p_bloco: 0.0,
        propagar_unidas: false,
        p_kempe: 0.0,
        kempe_de_blocos: false,
    };
}

impl Default for ConfigMovimentos {
    fn default() -> Self {
        Self {
            p_bloco: 0.5,
            propagar_unidas: true,
            p_kempe: 0.02,
            kempe_de_blocos: false,
        }
    }
}

/// Buffers reaproveitados a cada sorteio de movimento (zero alocação no hot path).
#[derive(Clone)]
pub(crate) struct RascunhoMovimentos {
    /// As trocas `(a, b)` do último movimento sorteado.
    pub trocas: Vec<(u32, u32)>,
    /// Rascunhos da cadeia de Kempe: turmas já visitadas e fila de visita.
    na_cadeia: Vec<bool>,
    fila: Vec<u32>,
}

impl RascunhoMovimentos {
    pub fn new(n_turmas: usize) -> Self {
        Self {
            trocas: Vec::new(),
            na_cadeia: vec![false; n_turmas],
            fila: Vec::new(),
        }
    }
}

/// Abstração zero-cost sobre a fonte de números aleatórios:
/// - a busca local usa `fastrand::Rng` próprio por cadeia;
/// - o motor genético semeia o `fastrand` thread-local por bloco/ilha.
pub(crate) trait Sorteio {
    fn usize(&mut self, range: Range<usize>) -> usize;
    fn f64(&mut self) -> f64;
}

impl Sorteio for fastrand::Rng {
    #[inline(always)]
    fn usize(&mut self, range: Range<usize>) -> usize {
        fastrand::Rng::usize(self, range)
    }

    #[inline(always)]
    fn f64(&mut self) -> f64 {
        fastrand::Rng::f64(self)
    }
}

/// Usa o gerador thread-local do `fastrand` (semeado pelo motor `ga.rs`).
pub(crate) struct RngThread;

impl Sorteio for RngThread {
    #[inline(always)]
    fn usize(&mut self, range: Range<usize>) -> usize {
        fastrand::usize(range)
    }

    #[inline(always)]
    fn f64(&mut self) -> f64 {
        fastrand::f64()
    }
}

/// Sorteia um movimento sobre `quadro` e deixa as trocas dele em `buf.trocas`.
/// Retorna `false` se o sorteio não produziu nenhuma troca.
#[inline]
pub(crate) fn sortear_movimento(
    t: &TabelasHorario,
    quadro: &[i32],
    cfg: ConfigMovimentos,
    buf: &mut RascunhoMovimentos,
    rng: &mut impl Sorteio,
) -> bool {
    buf.trocas.clear();
    if t.ativas.is_empty() {
        return false;
    }
    let n = t.n;
    let a = t.ativas[rng.usize(0..t.ativas.len())] as usize;
    let turma = a / t.por_turma;
    let (ini, fim) = t.ativas_de[turma];
    let b = t.ativas[rng.usize(ini as usize..fim as usize)] as usize;
    let va = quadro[a];

    // Movimentos entre turmas: os mesmos horários (posições na semana) em várias turmas
    if cfg.p_kempe > 0.0 && rng.f64() < cfg.p_kempe {
        let (pa, pb) = (a % t.por_turma, b % t.por_turma);
        if pa == pb {
            return false;
        }
        // Cadeia de Kempe a partir da turma sorteada. Com `kempe_de_blocos` e a aula sorteada
        // num grupo de aulas seguidas de disciplina agrupada, a cadeia troca o grupo inteiro
        // (uma janela de k horários) com a janela do mesmo tamanho que começa em `b`.
        let agrupada = t.disciplina(va).is_some_and(|d| t.agrupa[d]);
        let (ja, jb, k) = if cfg.kempe_de_blocos && agrupada && cfg.p_bloco > 0.0 && rng.f64() < cfg.p_bloco {
            let linha = a - a % n;
            let (mut x, mut y) = (a, a + 1);
            while x > linha && quadro[x - 1] == va { x -= 1; }
            while y < linha + n && quadro[y] == va { y += 1; }
            let k = y - x;
            if b % n + k > n || (b < y && x < b + k) {
                return false;
            }
            (x % t.por_turma, pb, k)
        } else {
            (pa, pb, 1)
        };
        let disputam = |x: i32, y: i32| -> bool {
            let (Some(dx), Some(dy)) = (t.disciplina(x), t.disciplina(y)) else { return false };
            let (rx, ry) = (t.rec_de[dx], t.rec_de[dy]);
            let ry = &t.rec[ry.0 as usize..ry.1 as usize];
            t.rec[rx.0 as usize..rx.1 as usize].iter().any(|r| ry.contains(r))
        };
        buf.na_cadeia.fill(false);
        buf.fila.clear();
        buf.na_cadeia[turma] = true;
        buf.fila.push(turma as u32);
        while let Some(u) = buf.fila.pop() {
            let base = u as usize * t.por_turma;
            // A turma não tem aula em algum horário das janelas: fica de fora
            if (0..k).any(|j| quadro[base + ja + j] == -1 || quadro[base + jb + j] == -1) {
                continue;
            }
            for j in 0..k {
                if quadro[base + ja + j] != quadro[base + jb + j] {
                    buf.trocas.push(((base + ja + j) as u32, (base + jb + j) as u32));
                }
            }
            for j in 0..k {
                let (x, y) = (quadro[base + ja + j], quadro[base + jb + j]);
                // x vai para jb e y para ja: entra quem tem aula com professor ou ambiente em comum lá
                for v in 0..t.n_turmas {
                    if buf.na_cadeia[v] { continue; }
                    let vb = v * t.por_turma;
                    if disputam(x, quadro[vb + jb + j]) || disputam(y, quadro[vb + ja + j]) {
                        buf.na_cadeia[v] = true;
                        buf.fila.push(v as u32);
                    }
                }
                // Aulas em conjunto: as parceiras vão junto
                for valor in [x, y] {
                    let Some(d) = t.disciplina(valor) else { continue };
                    let (ini, fim) = t.unidas_de[d];
                    for &(_, inicio) in &t.unidas[ini as usize..fim as usize] {
                        let v = inicio as usize / t.por_turma;
                        if !buf.na_cadeia[v] {
                            buf.na_cadeia[v] = true;
                            buf.fila.push(v as u32);
                        }
                    }
                }
            }
        }
        return !buf.trocas.is_empty();
    }

    let agrupada = t.disciplina(va).is_some_and(|d| t.agrupa[d]);
    if cfg.p_bloco > 0.0 && agrupada && rng.f64() < cfg.p_bloco {
        // O grupo de aulas seguidas que contém `a` troca com o trecho do mesmo tamanho que começa em `b`
        let linha = a - a % n;
        let (mut x, mut y) = (a, a + 1);
        while x > linha && quadro[x - 1] == va { x -= 1; }
        while y < linha + n && quadro[y] == va { y += 1; }
        let k = y - x;
        // O destino tem que caber no dia, dentro do horário da turma e sem sobrepor a origem
        if b % n + k > n || (b < y && x < b + k) || quadro[b..b + k].contains(&-1) {
            return false;
        }
        buf.trocas.extend((0..k).map(|j| ((x + j) as u32, (b + j) as u32)));
    } else {
        if quadro[b] == va {
            return false;
        }
        buf.trocas.push((a as u32, b as u32));
    }

    // Aula em conjunto: as turmas que participam fazem a mesma troca, para a aula mudar de
    // horário inteira
    if cfg.propagar_unidas && t.em_conjunto[turma] {
        for i in 0..buf.trocas.len() {
            let (a, b) = (buf.trocas[i].0 as usize, buf.trocas[i].1 as usize);
            let (pa, pb) = (a % t.por_turma, b % t.por_turma);
            for (c, de, para) in [(a, pa, pb), (b, pb, pa)] {
                let Some(d) = t.disciplina(quadro[c]) else { continue };
                let (ini, fim) = t.unidas_de[d];
                for &(esperado, inicio) in &t.unidas[ini as usize..fim as usize] {
                    let (origem, destino) = (inicio as usize + de, inicio as usize + para);
                    if quadro[origem] != esperado || quadro[destino] == -1 {
                        continue;
                    }
                    let (menor, maior) = (origem.min(destino) as u32, origem.max(destino) as u32);
                    if !buf.trocas.iter().any(|&(x, y)| (x.min(y), x.max(y)) == (menor, maior)) {
                        buf.trocas.push((origem as u32, destino as u32));
                    }
                }
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::horario::RegrasHorario;

    #[test]
    fn movimentos_preservam_invariantes_em_todas_as_configuracoes() {
        let regras = RegrasHorario::de_arquivo(&format!("{}/tests/instancias/media.json", env!("CARGO_MANIFEST_DIR")));
        let t = TabelasHorario::new(&regras);
        let configs = [
            ConfigMovimentos::SIMPLES,
            ConfigMovimentos::default(),
            ConfigMovimentos { p_bloco: 1.0, propagar_unidas: true, p_kempe: 0.0, kempe_de_blocos: false },
            ConfigMovimentos { p_bloco: 0.5, propagar_unidas: true, p_kempe: 1.0, kempe_de_blocos: false },
            ConfigMovimentos { p_bloco: 0.5, propagar_unidas: true, p_kempe: 1.0, kempe_de_blocos: true },
        ];
        for (idx, cfg) in configs.into_iter().enumerate() {
            fastrand::seed(100 + idx as u64);
            let inicial = regras.genes_com_blocos();
            let mut quadro = inicial.clone();
            let mut buf = RascunhoMovimentos::new(t.n_turmas);
            let mut rng = fastrand::Rng::with_seed(200 + idx as u64);
            let mut aplicados = 0;
            for _ in 0..5_000 {
                if sortear_movimento(&t, &quadro, cfg, &mut buf, &mut rng) {
                    aplicados += 1;
                    for &(a, b) in &buf.trocas {
                        assert_eq!(a as usize / t.por_turma, b as usize / t.por_turma, "troca entre turmas");
                        assert_ne!(quadro[a as usize], -1);
                        assert_ne!(quadro[b as usize], -1);
                        quadro.swap(a as usize, b as usize);
                    }
                }
            }
            assert!(aplicados > 500, "config {idx} deveria aplicar movimentos");
            for (c, (&v, &base)) in quadro.iter().zip(inicial.iter()).enumerate() {
                assert_eq!(v == -1, base == -1, "slot {c} mudou ativo/inativo");
            }
            for u in 0..t.n_turmas {
                let mut a = inicial[u * t.por_turma..(u + 1) * t.por_turma].to_vec();
                let mut b = quadro[u * t.por_turma..(u + 1) * t.por_turma].to_vec();
                a.sort_unstable();
                b.sort_unstable();
                assert_eq!(a, b, "multiconjunto da turma {u} mudou na config {idx}");
            }
        }
    }
}
