//! Como as aulas de uma disciplina se dividem na semana, no estilo das restrições do XHSTT.
//!
//! Um **pedaço** é um trecho seguido de aulas da mesma disciplina num dia da turma (duas aulas
//! duplas coladas formam um pedaço de 4). As regras OBRIGATÓRIAS:
//!
//! - **Tamanho** (SplitEvents): cada pedaço tem de `tam_min` a `tam_max` aulas.
//! - **Quantidade** (SplitEvents): a disciplina tem de `qtd_min` a `qtd_max` pedaços na semana.
//! - **Por tamanho** (DistributeSplitEvents): para um tamanho t, de mín. a máx. pedaços de t.
//!
//! A regra de "no máximo um pedaço por dia" (SpreadEvents) é de qualidade: ver `espalhar` em
//! `horario_qualidade.rs`.
//!
//! Desvio (unidades de violação, cada uma vale `PesosFitness::agrupar`): o tamanho conta as aulas
//! fora do limite (pedaço de 3 com máximo 2 → 1); as contagens, os pedaços fora do intervalo.
//! O desvio é 0 exatamente quando a divisão atende às regras.

use serde::Deserialize;

/// Maior tamanho de pedaço contado separadamente (os maiores contam como este).
pub const MAIOR_PEDACO: usize = 31;

/// Quantos pedaços de um tamanho a disciplina pode ter.
#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct EntradaPorTamanho {
    pub tamanho: i32,
    pub min: i32,
    pub max: i32,
}

/// As regras de divisão de uma aula, como a página manda. Tudo opcional: sem nada, a divisão é livre.
#[derive(Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntradaDivisao {
    /// Menor pedaço (padrão 1).
    #[serde(default)]
    pub tamanho_min: Option<i32>,
    /// Maior pedaço (padrão: todas as aulas da semana).
    #[serde(default)]
    pub tamanho_max: Option<i32>,
    #[serde(default)]
    pub quantidade_min: Option<i32>,
    #[serde(default)]
    pub quantidade_max: Option<i32>,
    #[serde(default)]
    pub por_tamanho: Vec<EntradaPorTamanho>,
    /// Regra de qualidade: no máximo um pedaço por dia.
    #[serde(default)]
    pub espalhar: bool,
}

/// As regras obrigatórias de divisão de uma disciplina, prontas para medir.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RegraDivisao {
    /// false = nenhuma regra restringe nada (divisão livre): o desvio é sempre 0.
    pub ativa: bool,
    pub tam_min: u8,
    pub tam_max: u8,
    pub qtd_min: u8,
    pub qtd_max: u8,
    /// (tamanho, mínimo, máximo).
    pub por_tamanho: Vec<(u8, u8, u8)>,
}

impl RegraDivisao {
    /// As regras de uma disciplina de `aulas` aulas, com os limites ajustados ao que faz sentido
    /// (tamanho entre 1 e `aulas`, quantidade entre 1 e `aulas`).
    pub fn new(e: &EntradaDivisao, aulas: i32) -> Self {
        let n = aulas.clamp(1, MAIOR_PEDACO as i32);
        let limitar = |v: i32| v.clamp(0, n) as u8;
        let tam_min = limitar(e.tamanho_min.unwrap_or(1).max(1));
        let tam_max = limitar(e.tamanho_max.unwrap_or(n)).max(tam_min);
        let qtd_min = limitar(e.quantidade_min.unwrap_or(1).max(1));
        let qtd_max = limitar(e.quantidade_max.unwrap_or(n)).max(qtd_min);
        let por_tamanho: Vec<(u8, u8, u8)> = e.por_tamanho.iter()
            .filter(|p| p.tamanho >= 1 && p.tamanho <= n)
            .map(|p| (p.tamanho as u8, limitar(p.min), limitar(p.max).max(limitar(p.min))))
            // Só os que restringem: mínimo 0 e máximo que nunca é atingido não mudam nada
            .filter(|&(t, min, max)| min > 0 || (max as i32) < n / t as i32)
            .collect();
        let ativa = aulas > 1 && (tam_min > 1 || (tam_max as i32) < n || qtd_min > 1 || (qtd_max as i32) < n || !por_tamanho.is_empty());
        Self { ativa, tam_min, tam_max, qtd_min, qtd_max, por_tamanho }
    }

    /// A disciplina pode ter pedaços de mais de uma aula que valem ser movidos inteiros (para os
    /// movimentos da busca local e a mutação do genético).
    pub fn agrupa(&self) -> bool {
        self.ativa && self.tam_max >= 2
    }

    /// Desvio de um pedaço pelo tamanho.
    #[inline(always)]
    pub fn desvio_do_pedaco(&self, tamanho: u8) -> i32 {
        if tamanho < self.tam_min {
            (self.tam_min - tamanho) as i32
        } else if tamanho > self.tam_max {
            (tamanho - self.tam_max) as i32
        } else {
            0
        }
    }

    /// Desvio da semana: quantidade de pedaços e pedaços por tamanho. `contagem[t]` = pedaços de
    /// tamanho t.
    #[inline]
    pub fn desvio_da_semana(&self, quantidade: u8, contagem: &[u8]) -> i32 {
        let fora = |v: u8, min: u8, max: u8| if v < min { (min - v) as i32 } else if v > max { (v - max) as i32 } else { 0 };
        let mut desvio = fora(quantidade, self.qtd_min, self.qtd_max);
        for &(t, min, max) in &self.por_tamanho {
            desvio += fora(contagem[t as usize], min, max);
        }
        desvio
    }

    /// Desvio total, a partir dos tamanhos de todos os pedaços da disciplina.
    pub fn desvio(&self, pedacos: impl IntoIterator<Item = u8>) -> i32 {
        if !self.ativa {
            return 0;
        }
        let mut contagem = [0u8; MAIOR_PEDACO + 1];
        let (mut quantidade, mut desvio) = (0u8, 0i32);
        for t in pedacos {
            let t = t.min(MAIOR_PEDACO as u8);
            desvio += self.desvio_do_pedaco(t);
            contagem[t as usize] = contagem[t as usize].saturating_add(1);
            quantidade = quantidade.saturating_add(1);
        }
        desvio + self.desvio_da_semana(quantidade, &contagem)
    }

    /// As divisões de `aulas` aulas que atendem às regras (tamanhos dos pedaços, do maior para o
    /// menor), até `limite` delas.
    pub fn divisoes(&self, aulas: i32, limite: usize) -> Vec<Vec<u8>> {
        let mut todas = Vec::new();
        if aulas <= 0 {
            return todas;
        }
        let n = aulas.min(MAIOR_PEDACO as i32) as u8;
        let mut atual = Vec::new();
        self.enumerar(n, n.min(self.tam_max.max(1)), &mut atual, &mut todas, limite);
        todas
    }

    fn enumerar(&self, falta: u8, maior: u8, atual: &mut Vec<u8>, todas: &mut Vec<Vec<u8>>, limite: usize) {
        if todas.len() >= limite {
            return;
        }
        if falta == 0 {
            if self.desvio(atual.iter().copied()) == 0 || !self.ativa {
                todas.push(atual.clone());
            }
            return;
        }
        if atual.len() >= self.qtd_max as usize && self.ativa {
            return;
        }
        let menor = if self.ativa { self.tam_min } else { 1 };
        for t in (menor..=maior.min(falta)).rev() {
            atual.push(t);
            self.enumerar(falta - t, t, atual, todas, limite);
            atual.pop();
        }
    }

    /// Uma divisão válida sorteada, ou `None` se nenhuma atende às regras.
    pub fn sortear_divisao(&self, aulas: i32) -> Option<Vec<u8>> {
        let todas = self.divisoes(aulas, 64);
        (!todas.is_empty()).then(|| todas[fastrand::usize(..todas.len())].clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn regra(json: &str, aulas: i32) -> RegraDivisao {
        RegraDivisao::new(&serde_json::from_str(json).unwrap(), aulas)
    }

    #[test]
    fn exemplos_de_divisao() {
        // 2 aulas, 1+1 ou 2: livre
        let r = regra("{}", 2);
        assert!(!r.ativa);
        assert_eq!(r.divisoes(2, 10), vec![vec![2], vec![1, 1]]);
        // 4 aulas, 2+2 ou 4
        let r = regra(r#"{ "tamanhoMin": 2 }"#, 4);
        assert_eq!(r.divisoes(4, 10), vec![vec![4], vec![2, 2]]);
        assert_eq!(r.desvio([2, 1, 1]), 2);
        // 3 aulas, 2+1 ou 3
        let r = regra(r#"{ "quantidadeMax": 2 }"#, 3);
        assert_eq!(r.divisoes(3, 10), vec![vec![3], vec![2, 1]]);
        assert_eq!(r.desvio([1, 1, 1]), 1);
        // 5 aulas, 3+2 ou 2+2+1: o 3+1+1 sai pelo "no máximo um pedaço de 1"
        let r = regra(r#"{ "tamanhoMax": 3, "quantidadeMin": 2, "quantidadeMax": 3, "porTamanho": [{ "tamanho": 1, "min": 0, "max": 1 }] }"#, 5);
        assert_eq!(r.divisoes(5, 10), vec![vec![3, 2], vec![2, 2, 1]]);
        assert_eq!(r.desvio([3, 1, 1]), 1);
    }

    #[test]
    fn regras_que_nao_restringem_ficam_inativas() {
        assert!(!regra(r#"{ "tamanhoMax": 9, "quantidadeMax": 9, "porTamanho": [{ "tamanho": 3, "min": 0, "max": 5 }] }"#, 4).ativa);
        assert!(!regra(r#"{ "tamanhoMin": 2 }"#, 1).ativa, "uma aula só não tem o que dividir");
        assert!(regra(r#"{ "porTamanho": [{ "tamanho": 3, "min": 0, "max": 0 }] }"#, 4).ativa);
    }

    #[test]
    fn sem_divisao_possivel() {
        let r = regra(r#"{ "tamanhoMin": 2, "tamanhoMax": 2 }"#, 3);
        assert!(r.divisoes(3, 10).is_empty());
        assert!(r.sortear_divisao(3).is_none());
    }

    #[test]
    fn recusa_campos_desconhecidos() {
        assert!(serde_json::from_str::<EntradaDivisao>(r#"{ "bloco": 2 }"#).is_err());
    }
}
