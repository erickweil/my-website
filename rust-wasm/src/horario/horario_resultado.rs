//! Validação de um quadro e montagem do resultado que a página recebe (aulas alocadas e problemas).
//!
//! Port de `obterRegrasVioladas` e `construirQuadro` (antigo `horario-solver.ts`). Os dois solvers
//! (Pencilmark e GA) entregam o resultado por aqui, então a página recebe sempre a mesma estrutura
//! e as mesmas mensagens, qualquer que seja o solver.
//!
//! A validação usa as regras do Pencilmark só com as obrigatórias
//! ([`HorarioRegrasPencilmark::so_obrigatorias`]): para cada célula preenchida, apaga o valor e
//! confere se ele está entre as possibilidades daquela célula. Um horário vago também é conferido
//! (a turma tem folga para ele?).

use serde::Serialize;

use crate::{
    horario::{DiaSemana, HorarioRegrasPencilmark, Ocorrencia, RegrasHorario},
    pencilmark::{Possib, RegrasQuadro},
};

pub const MSG_REGRAS_BASICAS: &str = "Regras básicas violadas (ex: número de aulas, alocação em horários possíveis, etc)";
pub const MSG_VAZIO: &str = "Este espaço não deveria estar vazio";
pub const MSG_REGRA_FALHOU: &str = "Algo de errado não está certo";
pub const MSG_MARCACAO_INVALIDA: &str = "Marcação não deveria estar aqui";
pub const MSG_INCOMPLETO: &str = "Incompleto";
pub const MSG_SEM_SOLUCAO: &str = "Não foi possível encontrar uma solução viável para este horário com as restrições dadas.";
pub const MSG_IMPOSSIVEL: &str = "Não existe horário que atenda a todas as restrições, contando os horários a evitar como indisponíveis e sem horário vago entre duas aulas do mesmo turno: todas as possibilidades foram testadas.";
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
        } else if k >= n_possibs {
            validacao.por_celula[i] = Some(MSG_MARCACAO_INVALIDA);
        } else if !possib.ler(k) {
            // Diz qual regra a aula quebra aqui (o estado das regras já está sem esta célula)
            let (turma, dia, tempo) = regras.regras.from_quadro_index(i);
            validacao.por_celula[i] = Some(regras.motivo_impedimento(&quadro, k, turma, dia, tempo).unwrap_or(MSG_MARCACAO_INVALIDA));
        }

        quadro[i] = valor;
    }

    validacao
}

// ── Estrutura entregue à página (`ResultadoDoSolver` em horario-regras.ts) ────────────────────

/// Uma aula num horário. Uma aula em conjunto aparece uma vez, não uma por turma.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Alocacao {
    /// Id da aula na entrada.
    pub aula: String,
    /// Sigla do dia (`"seg"`, `"ter"`, …).
    pub dia: &'static str,
    /// Número da aula no dia, a partir de 1.
    pub tempo: usize,
}

/// Uma célula do quadro de uma turma que quebra uma regra obrigatória, ou que ficou vazia.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Problema {
    /// Id da turma na entrada.
    pub turma: String,
    pub dia: &'static str,
    pub tempo: usize,
    /// Id da aula que está na célula, se há alguma.
    pub aula: Option<String>,
    pub mensagem: &'static str,
}

/// As aulas do quadro e os problemas dele, na ordem das turmas, dias e tempos.
pub fn montar_alocacoes(regras: &RegrasHorario, quadro: &[i32], validacao: &Validacao) -> (Vec<Alocacao>, Vec<Problema>) {
    let (mut alocacoes, mut problemas) = (Vec::new(), Vec::new());
    // Aula em conjunto: cada turma tem a sua célula; a alocação sai só uma vez por horário
    let por_aula = crate::horario::QUANTOS_DIAS * regras.n_tempos;
    let mut vista = vec![false; regras.aulas.len() * por_aula];
    for turma in &regras.turmas {
        for dia in DiaSemana::TODOS {
            for tempo in 0..regras.n_tempos {
                let i = regras.to_quadro_index(turma.id, dia, tempo);
                let disciplina = (quadro[i] > 0).then(|| regras.disciplinas.get((quadro[i] - 1) as usize)).flatten();
                if let Some(d) = disciplina {
                    let k = d.aula * por_aula + dia.to_index() * regras.n_tempos + tempo;
                    if !std::mem::replace(&mut vista[k], true) {
                        alocacoes.push(Alocacao { aula: d.nome.clone(), dia: dia.sigla(), tempo: tempo + 1 });
                    }
                }
                if let Some(mensagem) = validacao.por_celula[i] {
                    problemas.push(Problema { turma: turma.nome.clone(), dia: dia.sigla(), tempo: tempo + 1, aula: disciplina.map(|d| d.nome.clone()), mensagem });
                }
            }
        }
    }
    (alocacoes, problemas)
}

/// O que os runners entregam ao worker, tanto no progresso quanto no fim.
#[derive(Serialize, Debug, Clone)]
pub struct ResultadoHorario {
    /// As aulas do quadro; ausente quando o solver não chegou a nenhum quadro.
    pub alocacoes: Option<Vec<Alocacao>>,
    /// Células que quebram alguma regra obrigatória, ou que ficaram vazias.
    pub problemas: Vec<Problema>,
    /// true se o quadro quebra alguma regra obrigatória ou tem célula não resolvida. As regras de
    /// qualidade (horários a evitar) não entram aqui.
    pub alguma_violacao: bool,
    /// Mensagem para o usuário quando há violação ou não há solução.
    pub mensagem: Option<&'static str>,
    /// Num quadro sem violação: onde ele deixa a desejar nas regras de qualidade (que a busca
    /// local e o algoritmo genético tentam atender). Vazio se há violação ou não há quadro.
    pub qualidade: Vec<Ocorrencia>,
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
                let (alocacoes, problemas) = montar_alocacoes(regras, quadro, validacao);
                Self {
                    mensagem: alguma_violacao.then(|| validacao.geral.unwrap_or(MSG_COM_VIOLACOES)),
                    qualidade: if alguma_violacao { Vec::new() } else { regras.qualidade(quadro).1 },
                    alocacoes: Some(alocacoes),
                    problemas,
                    alguma_violacao,
                    iter,
                    depth,
                    terminou,
                }
            }
            _ => Self { alocacoes: None, problemas: Vec::new(), qualidade: Vec::new(), alguma_violacao: true, mensagem: Some(MSG_SEM_SOLUCAO), iter, depth, terminou },
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
    use crate::horario::QuadroHorario;
    use crate::pencilmark::solucionar_quadro;
    use wasm_bindgen_test::*;

    /// Turma "T" com seg 1..=3; A tem 2 aulas, B tem 1; professor P dá as duas.
    fn regras_pequenas() -> RegrasHorario {
        RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2, 3] } }],
            "aulas": [
                { "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 2 },
                { "id": "B", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 1 }
            ],
            "recursos": [{ "id": "P", "disponibilidade": { "seg": [1, 2, 3] } }]
        }"#).unwrap()
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
        let v = validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras.clone()), &quadro);
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

        let v = validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras.clone()), &quadro);
        // `verificar_quadro` só checa agrupamentos; o excesso de aulas aparece por célula:
        // tirando qualquer aula de A, ainda sobram 2 (o máximo), então nenhuma delas cabe ali.
        assert_eq!(v.geral, None);
        for t in 0..3 {
            assert_eq!(v.por_celula[idx_seg(&regras, t)], Some(crate::horario::MOTIVO_AULAS_DEMAIS), "tempo {t}");
        }

        let r = ResultadoHorario::novo(&regras, Some((&quadro, &v)), 1.0, 0, true);
        assert!(r.alguma_violacao);
        assert_eq!(r.mensagem, Some(MSG_COM_VIOLACOES));
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn celula_vazia_e_quadro_ausente() {
        let regras = regras_pequenas();
        let quadro = regras.get_quadro_vazio();
        let v = validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras.clone()), &quadro);
        assert_eq!(v.por_celula[idx_seg(&regras, 0)], Some(MSG_VAZIO));
        assert_eq!(v.geral, None);
        let r = ResultadoHorario::novo(&regras, Some((&quadro, &v)), 0.0, 0, false);
        assert_eq!(r.mensagem, Some(MSG_COM_VIOLACOES));

        let r = ResultadoHorario::novo(&regras, None, 5.0, 0, true);
        assert!(r.alocacoes.is_none() && r.problemas.is_empty() && r.alguma_violacao);
        assert_eq!(r.mensagem, Some(MSG_SEM_SOLUCAO));
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn alocacoes_e_problemas_do_quadro() {
        let regras = regras_pequenas();
        let mut quadro = regras.get_quadro_vazio();
        quadro[idx_seg(&regras, 0)] = 1; // A
        quadro[idx_seg(&regras, 1)] = 2; // B
        // tempo 2 fica vazio (0)
        let (alocacoes, problemas) = montar_alocacoes(&regras, &quadro, &Validacao::incompleto(&quadro));
        let aula = |aula: &str, tempo| Alocacao { aula: aula.into(), dia: "seg", tempo };
        assert_eq!(alocacoes, [aula("A", 1), aula("B", 2)]);
        assert_eq!(problemas, [Problema { turma: "T".into(), dia: "seg", tempo: 3, aula: None, mensagem: MSG_INCOMPLETO }]);
    }

    /// Uma aula dada a duas turmas aparece uma vez por horário; se as turmas estiverem em horários
    /// diferentes (regra quebrada), aparecem os dois, e o problema aponta a turma e a aula.
    #[wasm_bindgen_test(unsupported = test)]
    fn aula_em_conjunto_sai_uma_vez() {
        let regras = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2] } }, { "id": "U", "horarios": { "seg": [1, 2] } }],
            "aulas": [
                { "id": "junta", "turmas": ["T", "U"], "recursos": [], "aulasSemana": 1 },
                { "id": "t", "turmas": ["T"], "recursos": [], "aulasSemana": 1 },
                { "id": "u", "turmas": ["U"], "recursos": [], "aulasSemana": 1 }
            ],
            "recursos": []
        }"#).unwrap();
        let i = |turma, tempo| regras.to_quadro_index(turma, DiaSemana::Segunda, tempo);
        let aula = |aula: &str, tempo| Alocacao { aula: aula.into(), dia: "seg", tempo };
        // Disciplinas: 1 = junta em T, 2 = junta em U, 3 = t, 4 = u
        let mut quadro = regras.get_quadro_vazio();
        (quadro[i(0, 0)], quadro[i(0, 1)], quadro[i(1, 0)], quadro[i(1, 1)]) = (1, 3, 2, 4);
        let v = validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras.clone()), &quadro);
        let (alocacoes, problemas) = montar_alocacoes(&regras, &quadro, &v);
        assert_eq!(alocacoes, [aula("junta", 1), aula("t", 2), aula("u", 2)]);
        assert!(problemas.is_empty(), "{problemas:?}");

        // U com a aula conjunta no 2º tempo: fora do horário de T
        (quadro[i(1, 0)], quadro[i(1, 1)]) = (4, 2);
        let v = validar(&mut HorarioRegrasPencilmark::so_obrigatorias(regras.clone()), &quadro);
        let (alocacoes, problemas) = montar_alocacoes(&regras, &quadro, &v);
        assert_eq!(alocacoes, [aula("junta", 1), aula("t", 2), aula("u", 1), aula("junta", 2)]);
        assert!(problemas.iter().any(|p| p.turma == "U" && p.aula.as_deref() == Some("junta") && p.mensagem == crate::horario::MOTIVO_CONJUNTA), "{problemas:?}");
    }
}
