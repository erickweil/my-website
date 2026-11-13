//! Validação de um quadro e montagem do resultado no formato que a página renderiza.
//!
//! Port de `obterRegrasVioladas` e `construirQuadro` (antigo `horario-solver.ts`). Os dois solvers
//! (Pencilmark e GA) entregam o resultado por aqui, então a página recebe sempre a mesma estrutura
//! e as mesmas mensagens, qualquer que seja o solver.
//!
//! A validação usa as regras do Pencilmark ([`HorarioRegrasPencilmark`]): para cada célula
//! preenchida, apaga o valor e confere se ele está entre as possibilidades daquela célula.

use serde::Serialize;

use crate::{
    horario::{DiaSemana, HorarioRegrasPencilmark, RegrasHorario},
    pencilmark::{Possib, RegrasQuadro},
};

pub const MSG_REGRAS_BASICAS: &str = "Regras básicas violadas (ex: número de aulas, alocação em horários possíveis, etc)";
pub const MSG_VAZIO: &str = "Este espaço não deveria estar vazio";
pub const MSG_REGRA_FALHOU: &str = "Algo de errado não está certo";
pub const MSG_MARCACAO_INVALIDA: &str = "Marcação não deveria estar aqui";
pub const MSG_INCOMPLETO: &str = "Incompleto";
pub const MSG_SEM_SOLUCAO: &str = "Não foi possível encontrar uma solução viável para este horário com as restrições dadas.";
pub const MSG_COM_VIOLACOES: &str = "Não foi possível gerar um horário completo com as configurações fornecidas.";

/// Violações encontradas num quadro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Validacao {
    /// Uma entrada por célula do quadro: `Some(motivo)` se a célula viola alguma regra.
    pub por_celula: Vec<Option<&'static str>>,
    /// Problema no quadro como um todo (ex.: disciplina com aulas demais).
    pub geral: Option<&'static str>,
}

impl Validacao {
    pub fn alguma(&self) -> bool {
        self.geral.is_some() || self.por_celula.iter().any(Option::is_some)
    }

    /// Para mostrar um quadro parcial durante a busca: só marca as células ainda vazias como
    /// "Incompleto", sem rodar as regras (o Pencilmark nunca preenche uma célula inválida).
    pub fn incompleto(quadro: &[i32]) -> Self {
        Self {
            por_celula: quadro.iter().map(|&v| (v == 0).then_some(MSG_INCOMPLETO)).collect(),
            geral: None,
        }
    }
}

/// `obterRegrasVioladas` do TS.
pub fn validar(regras: &mut HorarioRegrasPencilmark, quadro: &[i32]) -> Validacao {
    let n_possibs = regras.n_possibs();
    let mut quadro = quadro.to_vec();
    let mut validacao = Validacao { por_celula: vec![None; quadro.len()], geral: None };

    if !regras.verificar_quadro(&quadro) {
        validacao.geral = Some(MSG_REGRAS_BASICAS);
    }

    let mut possib = Possib::new(0, n_possibs);
    for i in 0..quadro.len() {
        let valor = quadro[i];
        if valor < 0 {
            continue; // sem aula nesse espaço: não tem regra a violar
        }
        if valor == 0 {
            validacao.por_celula[i] = Some(MSG_VAZIO);
            continue;
        }

        // Tira a marcação e vê se ela está entre as possibilidades da célula. As regras dependem
        // do quadro todo (contagens, ocupação dos professores), então o estado é recalculado.
        quadro[i] = 0;
        regras.verificar_quadro(&quadro);

        possib.resetar(true);
        possib.index = i;
        let k = (valor - 1) as usize;
        if !regras.verificar_celula(&quadro, &mut possib) {
            validacao.por_celula[i] = Some(MSG_REGRA_FALHOU);
        } else if k >= n_possibs || !possib.ler(k) {
            validacao.por_celula[i] = Some(MSG_MARCACAO_INVALIDA);
        }

        quadro[i] = valor;
    }

    validacao
}

// ── Estrutura entregue à página (`TurmaHorarioResult[]` em horario-regras.ts) ─────────────────

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct TempoResultado {
    /// Nome da disciplina, `"???"` para célula não resolvida, `null` para sem aula.
    pub descricao: Option<String>,
    /// Motivo da violação, se houver.
    pub violacao: Option<&'static str>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct DiaResultado {
    /// Sigla do dia (`"seg"`, `"ter"`, …).
    pub dia: &'static str,
    pub tempos: Vec<TempoResultado>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct TurmaResultado {
    pub turma: String,
    /// Os 7 dias, de domingo a sábado. A página mostra só os dias ativos.
    pub horario: Vec<DiaResultado>,
}

/// `construirQuadro` do TS.
pub fn montar_quadro(regras: &RegrasHorario, quadro: &[i32], validacao: &Validacao) -> Vec<TurmaResultado> {
    regras.turmas.iter().map(|turma| TurmaResultado {
        turma: turma.nome.clone(),
        horario: DiaSemana::TODOS.iter().map(|&dia| DiaResultado {
            dia: dia.sigla(),
            tempos: (0..regras.n_tempos).map(|tempo| {
                let i = regras.to_quadro_index(turma.id, dia, tempo);
                let descricao = match quadro[i] {
                    0 => Some("???".to_string()),
                    v if v < 0 => None,
                    v => Some(regras.disciplinas.get((v - 1) as usize)
                        .map_or_else(|| "Disciplina Desconhecida".to_string(), |d| d.nome.clone())),
                };
                TempoResultado { descricao, violacao: validacao.por_celula[i] }
            }).collect(),
        }).collect(),
    }).collect()
}

/// O que os runners entregam ao worker, tanto no progresso quanto no fim.
#[derive(Serialize, Debug, Clone)]
pub struct ResultadoHorario {
    /// Quadro para mostrar; ausente quando o solver não chegou a nenhum quadro.
    pub solucao: Option<Vec<TurmaResultado>>,
    /// true se o quadro tem alguma violação ou célula não resolvida.
    pub alguma_violacao: bool,
    /// Mensagem para o usuário quando há violação ou não há solução.
    pub mensagem: Option<&'static str>,
    /// Pencilmark: nós visitados. GA: geração. (f64 porque u64 não cabe num Number do JS)
    pub iter: f64,
    /// Pencilmark: profundidade da busca. GA: gerações sem melhora.
    pub depth: usize,
    /// true quando o solver parou (achou solução, esgotou a busca ou atingiu o limite).
    pub terminou: bool,
}

impl ResultadoHorario {
    /// Monta o resultado de um quadro já validado (ou `None` se não há quadro).
    pub fn novo(regras: &RegrasHorario, quadro: Option<(&[i32], &Validacao)>, iter: f64, depth: usize, terminou: bool) -> Self {
        match quadro {
            Some((quadro, validacao)) if !quadro.is_empty() => {
                let alguma_violacao = validacao.alguma();
                Self {
                    mensagem: alguma_violacao.then(|| validacao.geral.unwrap_or(MSG_COM_VIOLACOES)),
                    solucao: Some(montar_quadro(regras, quadro, validacao)),
                    alguma_violacao,
                    iter,
                    depth,
                    terminou,
                }
            }
            _ => Self { solucao: None, alguma_violacao: true, mensagem: Some(MSG_SEM_SOLUCAO), iter, depth, terminou },
        }
    }

    /// Converte para JS. `null` (e não `undefined`) para os `None`, que é o que a página espera.
    pub fn to_js(&self) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
        self.serialize(&serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::horario::{FomularioHorario, FomularioHorarioDisciplina, FomularioHorarioProfessor, FomularioHorarioTurma};
    use crate::horario::QuadroHorario;
    use crate::pencilmark::solucionar_quadro;
    use std::collections::HashMap;
    use wasm_bindgen_test::*;

    /// Turma "T" com seg 1..=3; A tem 2 aulas, B tem 1; professor P dá as duas.
    fn regras_pequenas() -> RegrasHorario {
        let h = |t: &[i32]| HashMap::from([("seg".to_string(), t.to_vec())]);
        let disc = |nome: &str, aulas| FomularioHorarioDisciplina { nome: nome.into(), turma: "T".into(), aulas, agrupar: 0, dividir: false };
        RegrasHorario::new(FomularioHorario {
            turmas: vec![FomularioHorarioTurma { nome: "T".into(), horarios: h(&[1, 2, 3]) }],
            disciplinas: vec![disc("A", 2), disc("B", 1)],
            disciplinas_unidas: vec![],
            professores: vec![FomularioHorarioProfessor { nome: "P".into(), disciplinas: vec!["A".into(), "B".into()], horarios: h(&[1, 2, 3]) }],
        }).unwrap()
    }

    fn resolver(regras: &RegrasHorario) -> QuadroHorario {
        let pm = HorarioRegrasPencilmark::new(regras.clone());
        let (quadro, n) = (pm.quadro_vazio(), pm.n_possibs());
        solucionar_quadro(pm, quadro, n, 1, None).solucoes.remove(0)
    }

    fn idx_seg(regras: &RegrasHorario, tempo: usize) -> usize {
        regras.to_quadro_index(0, DiaSemana::Segunda, tempo)
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn solucao_valida_nao_tem_violacoes() {
        fastrand::seed(1);
        let regras = regras_pequenas();
        let quadro = resolver(&regras);
        let v = validar(&mut HorarioRegrasPencilmark::new(regras.clone()), &quadro);
        assert!(!v.alguma(), "{v:?}");

        let r = ResultadoHorario::novo(&regras, Some((&quadro, &v)), 1.0, 0, true);
        assert!(!r.alguma_violacao);
        assert_eq!(r.mensagem, None);
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn aponta_a_celula_errada() {
        fastrand::seed(2);
        let regras = regras_pequenas();
        let mut quadro = resolver(&regras);
        // Troca a única aula de B por A: A fica com 3 aulas (o máximo é 2)
        let i_b = (0..3).map(|t| idx_seg(&regras, t)).find(|&i| quadro[i] == 2).unwrap();
        quadro[i_b] = 1;

        let v = validar(&mut HorarioRegrasPencilmark::new(regras.clone()), &quadro);
        // `verificar_quadro` só checa agrupamentos; o excesso de aulas aparece por célula:
        // tirando qualquer aula de A, ainda sobram 2 (o máximo), então nenhuma delas cabe ali.
        assert_eq!(v.geral, None);
        for t in 0..3 {
            assert_eq!(v.por_celula[idx_seg(&regras, t)], Some(MSG_MARCACAO_INVALIDA), "tempo {t}");
        }

        let r = ResultadoHorario::novo(&regras, Some((&quadro, &v)), 1.0, 0, true);
        assert!(r.alguma_violacao);
        assert_eq!(r.mensagem, Some(MSG_COM_VIOLACOES));
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn celula_vazia_e_quadro_ausente() {
        let regras = regras_pequenas();
        let quadro = regras.get_quadro_vazio();
        let v = validar(&mut HorarioRegrasPencilmark::new(regras.clone()), &quadro);
        assert_eq!(v.por_celula[idx_seg(&regras, 0)], Some(MSG_VAZIO));
        assert_eq!(v.geral, None);
        let r = ResultadoHorario::novo(&regras, Some((&quadro, &v)), 0.0, 0, false);
        assert_eq!(r.mensagem, Some(MSG_COM_VIOLACOES));

        let r = ResultadoHorario::novo(&regras, None, 5.0, 0, true);
        assert!(r.solucao.is_none() && r.alguma_violacao);
        assert_eq!(r.mensagem, Some(MSG_SEM_SOLUCAO));
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn formato_do_quadro_montado() {
        let regras = regras_pequenas();
        let mut quadro = regras.get_quadro_vazio();
        quadro[idx_seg(&regras, 0)] = 1; // A
        quadro[idx_seg(&regras, 1)] = 2; // B
        // tempo 2 fica vazio (0)
        let r = montar_quadro(&regras, &quadro, &Validacao::incompleto(&quadro));

        assert_eq!(r.len(), 1);
        assert_eq!(r[0].turma, "T");
        let siglas: Vec<_> = r[0].horario.iter().map(|d| d.dia).collect();
        assert_eq!(siglas, ["dom", "seg", "ter", "qua", "qui", "sex", "sab"]);

        let seg = &r[0].horario[1].tempos;
        let desc: Vec<_> = seg.iter().map(|t| t.descricao.as_deref()).collect();
        assert_eq!(desc, [Some("A"), Some("B"), Some("???")]);
        assert_eq!(seg[2].violacao, Some(MSG_INCOMPLETO));
        assert_eq!(seg[0].violacao, None);
        // Domingo: turma sem aula
        assert!(r[0].horario[0].tempos.iter().all(|t| t.descricao.is_none() && t.violacao.is_none()));
    }
}
