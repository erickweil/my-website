//! Começar a busca de um horário que já existe, e aulas fixadas.
//!
//! A página pode mandar, junto com o problema, o horário que está na tela (`inicial`): cada aula
//! num dia e tempo, algumas marcadas como fixas. A busca local parte desse quadro; o genético
//! começa com uma população de variações dele.
//!
//! Uma aula fixada é mais uma regra obrigatória: cada uma fora da célula em que foi fixada custa
//! [`PesosFitness::fixa`](super::PesosFitness::fixa) e conta como violação. Os dois algoritmos
//! funcionam como sempre, sem nenhum movimento proibido: as fixadas ficam no lugar porque é onde o
//! custo é menor, e podem sair dele no caminho se isso levar a um horário melhor.
//!
//! O horário pode ter sido gerado com regras um pouco diferentes (mudou uma disponibilidade, uma
//! aula a mais): o quadro é montado com o que ainda cabe — célula no horário da turma, ainda livre,
//! e sem passar do número de aulas da disciplina — e o que falta entra ao acaso nas células livres,
//! como no quadro sorteado. Uma aula fixa que não cabe mais deixa de ser fixa.

use serde::Deserialize;

use super::horario_regras::{DiaSemana, QuadroHorario, RegrasHorario, QUANTOS_DIAS};
use crate::random::random_range;

/// Uma aula do horário de onde a busca parte.
#[derive(Deserialize, Debug, Clone)]
pub struct EntradaAlocacao {
    /// O id da aula (todas as turmas dela, se for em conjunto).
    pub aula: String,
    pub dia: String,
    /// O tempo no dia, a partir de 1.
    pub tempo: usize,
    /// true = a aula deve ficar aqui (regra obrigatória, ver o início do arquivo).
    #[serde(default)]
    pub fixa: bool,
}

impl RegrasHorario {
    /// Monta [`Self::inicial`] e [`Self::fixas`] a partir das aulas do horário da página.
    pub(super) fn montar_inicial(&mut self, alocacoes: &[EntradaAlocacao]) {
        let mut quadro = self.get_quadro_vazio();
        let mut fixo = vec![false; quadro.len()];
        // Aulas já postas de cada disciplina
        let mut postas = vec![0; self.disciplinas.len()];
        for a in alocacoes {
            let (Some(aula), Ok(dia)) = (self.aulas.iter().position(|x| *x == a.aula), DiaSemana::try_from(a.dia.as_str())) else { continue };
            if a.tempo == 0 || a.tempo > self.n_tempos { continue; }
            for d in self.disciplinas.iter().filter(|d| d.aula == aula) {
                let c = self.to_quadro_index(d.turma_id, dia, a.tempo - 1);
                // Só numa célula do horário da turma, ainda livre, e sem passar das aulas da disciplina
                if quadro[c] != 0 || postas[d.id] >= d.aulas { continue; }
                quadro[c] = d.id as i32 + 1;
                postas[d.id] += 1;
                fixo[c] = a.fixa;
            }
        }

        // O que falta (aulas, em pedaços, e horários vagos) nas células livres, como no quadro sorteado
        self.completar_com_blocos(&mut quadro, &postas);

        self.fixas = fixo.iter().enumerate().filter(|&(_, &f)| f).map(|(c, _)| (c, quadro[c])).collect();
        self.inicial = Some(quadro);
    }

    /// O quadro de onde a busca parte: o horário da página, se veio um, ou um sorteado.
    pub fn quadro_inicial(&self) -> QuadroHorario {
        self.inicial.clone().unwrap_or_else(|| self.genes_com_blocos())
    }

    /// Uma variação do quadro inicial para a população do genético: algumas trocas entre células
    /// da mesma turma (de nenhuma a cerca de 3% das aulas, para a população ter desde cópias quase
    /// exatas até quadros bem diferentes).
    pub(super) fn variacao_do_inicial(&self, inicial: &[i32]) -> QuadroHorario {
        let mut quadro = inicial.to_vec();
        let por_turma = QUANTOS_DIAS * self.n_tempos;
        let trocas = random_range(0, (self.aulas_a_alocar() * 3 / 100).max(2) + 1);
        for _ in 0..trocas {
            let a = random_range(0, quadro.len());
            if quadro[a] == -1 { continue; }
            let inicio = a - a % por_turma;
            let b = inicio + random_range(0, por_turma);
            if quadro[b] == -1 { continue; }
            quadro.swap(a, b);
        }
        quadro
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::problems::GAProblem;

    /// Duas turmas de 4 tempos às segundas; a aula "b" é dada às duas em conjunto.
    fn regras(inicial: &str) -> RegrasHorario {
        RegrasHorario::from_json(&format!(
            r#"{{
                "turmas": [{{ "id": "T", "horarios": {{ "seg": [1, 2, 3, 4] }} }}, {{ "id": "U", "horarios": {{ "seg": [1, 2, 3, 4] }} }}],
                "aulas": [
                    {{ "id": "a", "turmas": ["T"], "recursos": [], "aulasSemana": 2 }},
                    {{ "id": "b", "turmas": ["T", "U"], "recursos": [], "aulasSemana": 1 }},
                    {{ "id": "c", "turmas": ["U"], "recursos": [], "aulasSemana": 2 }}
                ],
                "recursos": [],
                "inicial": {inicial}
            }}"#
        ))
        .unwrap()
    }

    fn celula(r: &RegrasHorario, turma: usize, tempo: usize) -> i32 {
        r.inicial.as_ref().unwrap()[r.to_quadro_index(turma, DiaSemana::Segunda, tempo - 1)]
    }

    #[test]
    fn sem_inicial_o_quadro_e_sorteado() {
        let r = regras("[]");
        assert!(r.inicial.is_none() && r.fixas.is_empty());
    }

    #[test]
    fn monta_o_que_cabe_e_completa_o_resto() {
        // "a" no tempo 4 (fixa) e uma terceira aula de "a", que não existe; "b" no tempo 1, nas duas turmas
        let r = regras(r#"[
            { "aula": "a", "dia": "seg", "tempo": 4, "fixa": true },
            { "aula": "a", "dia": "seg", "tempo": 3 },
            { "aula": "a", "dia": "seg", "tempo": 2 },
            { "aula": "b", "dia": "seg", "tempo": 1 },
            { "aula": "x", "dia": "seg", "tempo": 2 }
        ]"#);
        // Valores no quadro: a = 1 e b = 2 na turma T; b = 3 e c = 4 na turma U (a aula em
        // conjunto vira uma disciplina por turma)
        let (a, b, b_em_u, c_em_u) = (1, 2, 3, 4);
        assert_eq!(celula(&r, 0, 4), a);
        assert_eq!(celula(&r, 0, 3), a);
        // Já havia duas aulas de "a": a terceira não entra
        assert_ne!(celula(&r, 0, 2), a);
        assert_eq!(celula(&r, 0, 1), b);
        assert_eq!(celula(&r, 1, 1), b_em_u);
        // O que faltava na turma U (as duas aulas de "c" e um vago) completou o resto
        let mut u: Vec<i32> = (2..=4).map(|t| celula(&r, 1, t)).collect();
        u.sort();
        assert_eq!(u, [c_em_u, c_em_u, r.vago()]);
        assert_eq!(r.fixas, [(r.to_quadro_index(0, DiaSemana::Segunda, 3), a)]);
    }

    /// Uma instância de teste com o quadro de um sorteio como horário de partida e algumas aulas
    /// fixas: nem a busca local nem o genético as tiram do lugar.
    fn instancia_com_fixas() -> RegrasHorario {
        let caminho = format!("{}/tests/instancias/media.json", env!("CARGO_MANIFEST_DIR"));
        let mut entrada: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(caminho).unwrap()).unwrap();
        let sorteio = RegrasHorario::from_json(&entrada.to_string()).unwrap();
        let quadro = sorteio.genes_com_blocos();
        // Uma aula de cada 5 fica fixa
        let inicial: Vec<serde_json::Value> = quadro.iter().enumerate()
            .filter_map(|(c, &v)| sorteio.disciplina_em(v).map(|d| (c, d)))
            .filter(|&(_, d)| sorteio.disciplinas[d].disciplinas_unidas.iter().all(|&u| u > d))
            .enumerate()
            .map(|(i, (c, d))| {
                let (_, dia, tempo) = sorteio.from_quadro_index(c);
                serde_json::json!({ "aula": sorteio.aulas[sorteio.disciplinas[d].aula], "dia": dia.sigla(), "tempo": tempo + 1, "fixa": i % 5 == 0 })
            })
            .collect();
        entrada["inicial"] = serde_json::Value::Array(inicial);
        RegrasHorario::from_json(&entrada.to_string()).unwrap()
    }

    /// Cada aula fixada fora do lugar custa `pesos.fixa` no fitness (o mesmo custo da busca local).
    #[test]
    fn fixada_fora_do_lugar_custa_o_peso_dela() {
        let r = instancia_com_fixas();
        assert!(!r.fixas.is_empty());
        // Começa exatamente do quadro que veio, com todas as fixadas no lugar
        let inicial = r.quadro_inicial();
        assert_eq!(inicial, *r.inicial.as_ref().unwrap());
        let sem_fixas = RegrasHorario { fixas: Vec::new(), ..r.clone() };
        let mut state = r.initial_state();
        assert_eq!(r.fitness(&mut state, &inicial), sem_fixas.fitness(&mut state, &inicial));

        // Tira duas fixadas do lugar (trocando cada uma com uma célula de outro valor da mesma turma)
        let mut quadro = inicial.clone();
        let por_turma = QUANTOS_DIAS * r.n_tempos;
        let mut fora = 0;
        for &(c, v) in r.fixas.iter().take(2) {
            let inicio = c - c % por_turma;
            let outra = (inicio..inicio + por_turma).find(|&o| quadro[o] > 0 && quadro[o] != v && !r.fixas.iter().any(|&(f, _)| f == o)).unwrap();
            quadro.swap(c, outra);
            fora += 1;
        }
        let diferenca = sem_fixas.fitness(&mut state, &quadro) - r.fitness(&mut state, &quadro);
        assert_eq!(diferenca, fora as f64 * r.pesos.fixa);
    }

    /// A busca local não proíbe nenhum movimento: um horário só é válido com as fixadas no lugar.
    #[test]
    fn busca_local_so_e_valida_com_as_fixadas_no_lugar() {
        let r = instancia_com_fixas();
        let mut busca = super::super::BuscaLocal::new(&r, &r.quadro_inicial(), 1, super::super::LISTA_PADRAO);
        busca.executar(50_000);
        let fora = r.fixas.iter().filter(|&&(c, v)| busca.melhor()[c] != v).count() as i64;
        assert!(busca.violacoes_do_melhor() >= fora);
        if busca.valido() {
            assert_eq!(fora, 0);
        }
    }
}
