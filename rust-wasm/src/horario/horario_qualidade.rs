//! Regras de QUALIDADE do horário: não invalidam um horário, só dizem qual horário válido é melhor.
//!
//! O algoritmo genético e a busca local as levam em conta (entram no fitness, ver
//! `horario_genetic.rs`, que é também o custo de `horario_busca_local.rs`); a busca exata
//! (Pencilmark) fica só com as regras obrigatórias. O resultado de qualquer método traz as
//! ocorrências medidas aqui, para a página mostrar.
//!
//! As regras:
//! - **Evitar**: aula num horário em que o professor está disponível, mas pediu para evitar.
//! - **Jornada**: mais de 10 horas entre o início da primeira aula e o fim da última aula do
//!   professor no mesmo dia (8 horas de trabalho + 2 de intervalo entre turnos). Pega, por exemplo,
//!   aula de manhã e à noite no mesmo dia. Pesa pelo tempo que passa das 10 horas.
//! - **Descanso**: menos de 11 horas entre o fim da última aula de um dia e o início da primeira
//!   aula do dia seguinte. Pesa pelo tempo que falta para as 11 horas.
//! - **Intervalo**: aulas seguidas da mesma disciplina que atravessam um intervalo deixando uma aula
//!   sozinha de um dos lados (2 ou mais de cada lado é aceitável). Na **troca de turno** pesa mais.
//! - **Janela**: horário vago da turma entre duas aulas do mesmo turno. Quando a turma tem mais
//!   horários marcados que aulas, os vagos devem ficar no começo ou no fim do turno. Conta um por
//!   horário vago.
//!
//! Jornada, descanso e intervalo dependem das horas das aulas (`EntradaHorario::tempos`); sem elas
//! ficam desligadas. Ambientes não têm jornada, descanso nem horários a evitar.
//!
//! Todas as penalidades de qualidade somadas valem menos que a menor penalidade obrigatória (ver
//! [`TabelasQualidade::escala`]): uma regra obrigatória nunca é trocada por qualidade.

use serde::Serialize;

use crate::horario::{DiaSemana, QUANTOS_DIAS, RegrasHorario};

/// Limite da jornada: da primeira à última aula do dia.
pub const JORNADA_MAXIMA_MIN: i32 = 10 * 60;
/// Descanso mínimo entre o fim de um dia e o começo do seguinte.
pub const DESCANSO_MINIMO_MIN: i32 = 11 * 60;

// Pesos relativos entre as regras de qualidade (a escala em relação às obrigatórias é calculada).
const PESO_JORNADA_POR_HORA: f64 = 4.0;
const PESO_DESCANSO_POR_HORA: f64 = 3.0;
const PESO_EVITAR: f64 = 2.0;
const PESO_TROCA_DE_TURNO: f64 = 2.0;
const PESO_INTERVALO: f64 = 1.0;
const PESO_JANELA: f64 = 3.0;

/// O que separa um tempo do seguinte.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Quebra {
    Nenhuma,
    Intervalo,
    TrocaDeTurno,
}

/// Quanto um quadro se afasta das regras de qualidade.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Qualidade {
    /// Aulas em horário a evitar (uma por professor da aula).
    pub evitar: u32,
    /// Minutos acima das 10 horas de jornada, somando professores e dias.
    pub jornada_min: u32,
    /// Minutos abaixo das 11 horas de descanso, somando professores e dias.
    pub descanso_min: u32,
    /// Grupos de aulas partidos por um intervalo com uma aula sozinha de um lado.
    pub intervalo: u32,
    /// O mesmo, numa troca de turno.
    pub troca_de_turno: u32,
    /// Horários vagos de turmas entre duas aulas do mesmo turno.
    pub janela: u32,
}

/// Uma ocorrência de regra de qualidade, para a página mostrar. Os ids são os da entrada.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Ocorrencia {
    /// `"evitar"`, `"jornada"`, `"descanso"`, `"intervalo"`, `"turno"` ou `"janela"`.
    pub regra: &'static str,
    /// O professor (evitar, jornada, descanso).
    pub recurso: Option<String>,
    /// A turma (evitar, intervalo, turno, janela) e a aula (evitar, intervalo, turno).
    pub turma: Option<String>,
    pub aula: Option<String>,
    /// O dia; no descanso, o primeiro dos dois.
    pub dia: &'static str,
    /// Jornada: minutos acima do limite. Descanso: minutos que faltam. Nas outras, 0.
    pub minutos: u32,
}

/// Tabelas derivadas das regras, montadas uma vez, para medir a qualidade de muitos quadros.
#[derive(Clone)]
pub struct TabelasQualidade {
    /// false = nenhuma regra de qualidade se aplica a esta entrada (a medição é pulada).
    pub ativa: bool,
    n_tempos: usize,
    /// Células em que a turma tem aula: (índice no quadro, dia, tempo).
    ativas: Vec<(u32, u8, u8)>,
    /// Um dia de uma turma, se ela tem aula nele: índice do 1º tempo no quadro.
    linhas: Vec<u32>,
    /// Por disciplina: intervalo em `recursos`.
    recursos_de: Vec<(u32, u32)>,
    recursos: Vec<u32>,
    /// Por recurso: é um professor? (ambiente não tem jornada nem preferências)
    pub(super) pessoa: Vec<bool>,
    /// Por recurso e (dia, tempo): disponível, mas a evitar.
    pub(super) evitar: Vec<bool>,
    /// Por tempo, em minutos desde a meia-noite. Vazios se a entrada não trouxe as horas.
    inicio: Vec<i32>,
    fim: Vec<i32>,
    /// Por tempo: o que o separa do tempo seguinte.
    quebra: Vec<Quebra>,
    pub(super) tem_evitar: bool,
    pub(super) tem_horas: bool,
    pub(super) tem_quebras: bool,
    /// Alguma turma tem horários vagos (folga).
    pub(super) tem_vagos: bool,
    /// Valor de um horário vago no quadro ([`RegrasHorario::vago`]).
    vago: i32,
    /// Fator que põe a soma de todas as penalidades de qualidade abaixo da menor penalidade
    /// obrigatória: essa menor penalidade dividida pelo pior caso possível mais um.
    escala: f64,
}

/// Buffers de trabalho da medição (para não alocar a cada quadro).
#[derive(Clone)]
pub struct BuffersQualidade {
    /// Por professor e dia: primeiro e último tempo com aula (`SEM_AULA` se não há).
    primeiro: Vec<u8>,
    ultimo: Vec<u8>,
}

const SEM_AULA: u8 = u8::MAX;

impl TabelasQualidade {
    /// `menor_obrigatoria`: a menor penalidade de uma regra obrigatória no fitness.
    pub fn new(r: &RegrasHorario, menor_obrigatoria: f64) -> Self {
        let n = r.n_tempos;
        let (mut ativas, mut linhas) = (Vec::new(), Vec::new());
        for turma in &r.turmas {
            for dia in DiaSemana::TODOS {
                let inicio = r.to_quadro_index(turma.id, dia, 0);
                let mut tem_aula = false;
                for tempo in 0..n {
                    if turma.horarios.get(dia, tempo) == 1 {
                        ativas.push(((inicio + tempo) as u32, dia.to_index() as u8, tempo as u8));
                        tem_aula = true;
                    }
                }
                if tem_aula {
                    linhas.push(inicio as u32);
                }
            }
        }

        let (mut recursos_de, mut recursos) = (Vec::new(), Vec::new());
        for d in &r.disciplinas {
            let ini = recursos.len() as u32;
            recursos.extend(d.professores.iter().map(|&p| p as u32));
            recursos_de.push((ini, recursos.len() as u32));
        }

        let pessoa: Vec<bool> = r.professores.iter().map(|p| p.pessoa).collect();
        let mut evitar = vec![false; r.professores.len() * QUANTOS_DIAS * n];
        for p in r.professores.iter().filter(|p| p.pessoa) {
            for dia in DiaSemana::TODOS {
                for tempo in 0..n {
                    // Só onde está disponível: fora disso já é regra obrigatória
                    evitar[(p.id * QUANTOS_DIAS + dia.to_index()) * n + tempo] = p.evitar.get(dia, tempo) != 0 && p.horarios.get(dia, tempo) != 0;
                }
            }
        }

        let tem_horas = r.tempos.len() >= n && n > 0;
        let (inicio, fim): (Vec<i32>, Vec<i32>) = if tem_horas { r.tempos[..n].iter().map(|t| (t.inicio, t.fim)).unzip() } else { (Vec::new(), Vec::new()) };
        let quebra: Vec<Quebra> = (0..n).map(|t| r.quebra_depois(t)).collect();
        let tem_evitar = evitar.iter().any(|&e| e);
        let tem_quebras = quebra.iter().any(|&q| q != Quebra::Nenhuma);

        // Pior caso de cada regra, para a escala
        let pessoas = pessoa.iter().filter(|&&p| p).count() as f64;
        let pares: i32 = r.disciplinas.iter().map(|d| d.aulas.max(0) * d.professores.len() as i32).sum();
        let pior = PESO_JORNADA_POR_HORA * pessoas * QUANTOS_DIAS as f64 * 24.0
            + PESO_DESCANSO_POR_HORA * pessoas * QUANTOS_DIAS as f64 * (DESCANSO_MINIMO_MIN as f64 / 60.0)
            + PESO_EVITAR * pares as f64
            + PESO_TROCA_DE_TURNO * ativas.len() as f64
            + PESO_JANELA * ativas.len() as f64;
        let tem_vagos = r.turmas.iter().any(|t| t.folga > 0);

        Self {
            ativa: tem_evitar || (tem_horas && pessoas > 0.0) || tem_quebras || tem_vagos,
            n_tempos: n,
            ativas,
            linhas,
            recursos_de,
            recursos,
            pessoa,
            evitar,
            inicio,
            fim,
            quebra,
            tem_evitar,
            tem_horas,
            tem_quebras,
            tem_vagos,
            vago: r.vago(),
            escala: menor_obrigatoria / (pior + 1.0),
        }
    }

    pub fn buffers(&self) -> BuffersQualidade {
        let n = self.pessoa.len() * QUANTOS_DIAS;
        BuffersQualidade { primeiro: vec![SEM_AULA; n], ultimo: vec![SEM_AULA; n] }
    }

    /// Penalidade no fitness: sempre menor que a menor penalidade obrigatória.
    pub fn custo(&self, q: &Qualidade) -> f64 {
        self.escala
            * (PESO_JORNADA_POR_HORA * q.jornada_min as f64 / 60.0
                + PESO_DESCANSO_POR_HORA * q.descanso_min as f64 / 60.0
                + PESO_EVITAR * q.evitar as f64
                + PESO_INTERVALO * q.intervalo as f64
                + PESO_TROCA_DE_TURNO * q.troca_de_turno as f64
                + PESO_JANELA * q.janela as f64)
    }

    /// Mede a qualidade do quadro. Com `detalhe`, também lista cada ocorrência (mais lento: só
    /// para montar o resultado).
    pub fn medir(&self, r: &RegrasHorario, quadro: &[i32], buf: &mut BuffersQualidade, mut detalhe: Option<&mut Vec<Ocorrencia>>) -> Qualidade {
        let mut q = Qualidade::default();
        let n = self.n_tempos;

        // Evitar, e o primeiro e o último tempo de cada professor em cada dia
        if self.tem_evitar || self.tem_horas {
            buf.primeiro.fill(SEM_AULA);
            buf.ultimo.fill(SEM_AULA);
            for &(i, dia, tempo) in &self.ativas {
                let d = quadro[i as usize] - 1;
                if d < 0 || d + 1 >= self.vago { continue; } // não resolvido ou vago
                let (ini, fim) = self.recursos_de[d as usize];
                for &p in &self.recursos[ini as usize..fim as usize] {
                    let p = p as usize;
                    if !self.pessoa[p] { continue; }
                    let k = p * QUANTOS_DIAS + dia as usize;
                    if self.evitar[k * n + tempo as usize] {
                        q.evitar += 1;
                        if let Some(lista) = detalhe.as_deref_mut() {
                            let disc = &r.disciplinas[d as usize];
                            lista.push(Ocorrencia {
                                regra: "evitar",
                                recurso: Some(r.professores[p].nome.clone()),
                                turma: Some(r.turmas[disc.turma_id].nome.clone()),
                                aula: Some(disc.nome.clone()),
                                dia: DiaSemana::from_index(dia as usize).sigla(),
                                minutos: 0,
                            });
                        }
                    }
                    if buf.primeiro[k] == SEM_AULA || tempo < buf.primeiro[k] { buf.primeiro[k] = tempo; }
                    if buf.ultimo[k] == SEM_AULA || tempo > buf.ultimo[k] { buf.ultimo[k] = tempo; }
                }
            }
        }

        // Jornada do dia e descanso até o dia seguinte
        if self.tem_horas {
            for p in (0..self.pessoa.len()).filter(|&p| self.pessoa[p]) {
                for dia in 0..QUANTOS_DIAS {
                    let k = p * QUANTOS_DIAS + dia;
                    if buf.primeiro[k] == SEM_AULA { continue; }
                    let mut ocorrencia = |regra, minutos: u32| {
                        if let Some(lista) = detalhe.as_deref_mut() {
                            lista.push(Ocorrencia {
                                regra,
                                recurso: Some(r.professores[p].nome.clone()),
                                turma: None,
                                aula: None,
                                dia: DiaSemana::from_index(dia).sigla(),
                                minutos,
                            });
                        }
                    };

                    let excesso = self.excesso_de_jornada(buf.primeiro[k], buf.ultimo[k]);
                    if excesso > 0 {
                        q.jornada_min += excesso;
                        ocorrencia("jornada", excesso);
                    }
                    // O dia seguinte na semana (sábado não emenda com domingo)
                    if dia + 1 < QUANTOS_DIAS && buf.primeiro[k + 1] != SEM_AULA {
                        let falta = self.falta_de_descanso(buf.ultimo[k], buf.primeiro[k + 1]);
                        if falta > 0 {
                            q.descanso_min += falta;
                            ocorrencia("descanso", falta);
                        }
                    }
                }
            }
        }

        // Grupos de aulas da mesma disciplina partidos por um intervalo, com uma aula sozinha
        if self.tem_quebras {
            for &linha in &self.linhas {
                let linha = linha as usize;
                self.grupos_partidos(quadro, linha, |v, turno| {
                    if turno { q.troca_de_turno += 1 } else { q.intervalo += 1 }
                    if let Some(lista) = detalhe.as_deref_mut() {
                        let disc = &r.disciplinas[(v - 1) as usize];
                        let (_, dia, _) = r.from_quadro_index(linha);
                        lista.push(Ocorrencia {
                            regra: if turno { "turno" } else { "intervalo" },
                            recurso: None,
                            turma: Some(r.turmas[disc.turma_id].nome.clone()),
                            aula: Some(disc.nome.clone()),
                            dia: dia.sigla(),
                            minutos: 0,
                        });
                    }
                });
            }
        }

        // Horários vagos entre duas aulas do mesmo turno
        if self.tem_vagos {
            for trecho in &r.trechos {
                if r.turmas[trecho.turma].folga == 0 { continue; }
                let n = self.janelas_do_trecho(quadro, &trecho.celulas);
                if n > 0 {
                    q.janela += n;
                    if let Some(lista) = detalhe.as_deref_mut() {
                        for _ in 0..n {
                            lista.push(Ocorrencia {
                                regra: "janela",
                                recurso: None,
                                turma: Some(r.turmas[trecho.turma].nome.clone()),
                                aula: None,
                                dia: trecho.dia.sigla(),
                                minutos: 0,
                            });
                        }
                    }
                }
            }
        }

        q
    }

    // As regras, uma a uma, sobre um pedaço do quadro. `medir` soma todas; a busca local
    // (`horario_busca_local.rs`) recalcula só os pedaços em que um movimento mexeu.

    /// Jornada: minutos acima das 10 horas num dia que vai do tempo `primeiro` ao tempo `ultimo`.
    #[inline]
    pub(super) fn excesso_de_jornada(&self, primeiro: u8, ultimo: u8) -> u32 {
        (self.fim[ultimo as usize] - self.inicio[primeiro as usize] - JORNADA_MAXIMA_MIN).max(0) as u32
    }

    /// Descanso: minutos que faltam para as 11 horas entre a última aula de um dia (`ultimo`) e a
    /// primeira do dia seguinte (`primeiro_seguinte`).
    #[inline]
    pub(super) fn falta_de_descanso(&self, ultimo: u8, primeiro_seguinte: u8) -> u32 {
        let descanso = 24 * 60 - self.fim[ultimo as usize] + self.inicio[primeiro_seguinte as usize];
        (DESCANSO_MINIMO_MIN - descanso).max(0) as u32
    }

    /// Intervalo e troca de turno numa linha do quadro (um dia de uma turma, que começa no índice
    /// `linha`): chama `achou(valor da disciplina, é troca de turno)` para cada grupo de aulas
    /// seguidas partido por uma quebra com uma aula sozinha de um dos lados.
    pub(super) fn grupos_partidos(&self, quadro: &[i32], linha: usize, mut achou: impl FnMut(i32, bool)) {
        let n = self.n_tempos;
        let mut a = 0;
        while a < n {
            let v = quadro[linha + a];
            let mut b = a + 1;
            if v <= 0 || v == self.vago {
                a = b;
                continue;
            }
            while b < n && quadro[linha + b] == v {
                b += 1;
            }
            // Grupo nos tempos a..b; `inicio_do_trecho` = onde começa o trecho entre quebras
            let mut inicio_do_trecho = a;
            for k in a..b - 1 {
                if self.quebra[k] == Quebra::Nenhuma { continue; }
                let antes = k + 1 - inicio_do_trecho;
                let proxima = (k + 1..b - 1).find(|&j| self.quebra[j] != Quebra::Nenhuma).map_or(b, |j| j + 1);
                let depois = proxima - (k + 1);
                if antes == 1 || depois == 1 {
                    achou(v, self.quebra[k] == Quebra::TrocaDeTurno);
                }
                inicio_do_trecho = k + 1;
            }
            a = b;
        }
    }

    /// Janela: horários vagos entre a primeira e a última aula de um trecho (as células de um turno
    /// de um dia de uma turma).
    pub(super) fn janelas_do_trecho(&self, quadro: &[i32], celulas: &[usize]) -> u32 {
        let aula = |&c: &usize| quadro[c] > 0 && quadro[c] != self.vago;
        let (Some(primeira), Some(ultima)) = (celulas.iter().position(aula), celulas.iter().rposition(aula)) else { return 0 };
        celulas[primeira..ultima].iter().filter(|&&c| quadro[c] == self.vago).count() as u32
    }
}

impl RegrasHorario {
    /// O que separa o tempo `tempo` do seguinte: troca de turno, intervalo (há um vão entre o fim
    /// de um e o começo do outro) ou nada. Sem as horas na entrada, nada.
    pub fn quebra_depois(&self, tempo: usize) -> Quebra {
        match (self.tempos.get(tempo), self.tempos.get(tempo + 1)) {
            (Some(a), Some(b)) if tempo + 1 < self.n_tempos => {
                if a.turno != b.turno { Quebra::TrocaDeTurno } else if b.inicio > a.fim { Quebra::Intervalo } else { Quebra::Nenhuma }
            }
            _ => Quebra::Nenhuma,
        }
    }

    /// A qualidade de um quadro e as ocorrências, uma a uma. Para o resultado e os testes; o
    /// fitness do algoritmo genético usa [`TabelasQualidade::medir`] com tabelas já montadas.
    pub fn qualidade(&self, quadro: &[i32]) -> (Qualidade, Vec<Ocorrencia>) {
        let tabelas = TabelasQualidade::new(self, 1.0);
        let mut ocorrencias = Vec::new();
        let q = tabelas.medir(self, quadro, &mut tabelas.buffers(), Some(&mut ocorrencias));
        (q, ocorrencias)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::problems::GAProblem;
    use crate::horario::HorarioGARunner;

    /// Quadro com manhã (5 aulas a partir das 7:00, intervalo depois da 3ª) e noite (4 aulas a
    /// partir das 19:00, intervalo depois da 2ª, terminando 22:35). Tempos (a partir de 0):
    /// 0-4 manhã, 5-8 noite. Uma turma com aula em todos os tempos, de segunda a quarta.
    /// Disciplinas: 1 = "A" (professor P, na sala S), 2 = "B" (sem ninguém).
    fn regras(evitar: &str) -> RegrasHorario {
        let tempos = [(420, 470, "m"), (470, 520, "m"), (520, 570, "m"), (590, 640, "m"), (640, 690, "m"), (1140, 1190, "n"), (1190, 1240, "n"), (1255, 1305, "n"), (1305, 1355, "n")]
            .map(|(i, f, t)| format!(r#"{{ "inicio": {i}, "fim": {f}, "turno": "{t}" }}"#))
            .join(", ");
        let todos = "[1, 2, 3, 4, 5, 6, 7, 8, 9]";
        RegrasHorario::from_json(&format!(r#"{{
            "turmas": [{{ "id": "T", "horarios": {{ "seg": {todos}, "ter": {todos}, "qua": {todos} }} }}],
            "aulas": [
                {{ "id": "A", "turmas": ["T"], "recursos": ["P", "S"], "aulasSemana": 9 }},
                {{ "id": "B", "turmas": ["T"], "recursos": [], "aulasSemana": 18 }}
            ],
            "recursos": [
                {{ "id": "P", "disponibilidade": {{ "seg": {todos}, "ter": {todos}, "qua": {todos} }}, "evitar": {evitar} }},
                {{ "id": "S", "ambiente": true, "disponibilidade": {{ "seg": {todos}, "ter": {todos}, "qua": {todos} }} }}
            ],
            "tempos": [{tempos}]
        }}"#)).unwrap()
    }

    /// Quadro só com "A" nas células dadas (dia, tempo a partir de 0); o resto fica por preencher,
    /// para as medidas serem só as de "A".
    fn quadro(r: &RegrasHorario, aulas_de_a: &[(DiaSemana, usize)]) -> Vec<i32> {
        let mut q = r.get_quadro_vazio();
        for &(dia, tempo) in aulas_de_a {
            q[r.to_quadro_index(0, dia, tempo)] = 1;
        }
        q
    }

    use DiaSemana::{Quarta, Segunda, Terca};

    #[test]
    fn quebras_saem_das_horas() {
        let r = regras("{}");
        let quebras: Vec<Quebra> = (0..9).map(|t| r.quebra_depois(t)).collect();
        use Quebra::*;
        assert_eq!(quebras, [Nenhuma, Nenhuma, Intervalo, Nenhuma, TrocaDeTurno, Nenhuma, Intervalo, Nenhuma, Nenhuma]);
    }

    #[test]
    fn descanso_de_11_horas_entre_um_dia_e_o_outro() {
        let r = regras("{}");
        // Última aula da noite (termina 22:35) e primeira da manhã seguinte (7:00): 8h25 de descanso
        let (q, o) = r.qualidade(&quadro(&r, &[(Segunda, 8), (Terca, 0)]));
        assert_eq!(q, Qualidade { descanso_min: 155, ..Default::default() }, "faltam 2h35 para as 11 horas");
        assert_eq!(o, [Ocorrencia { regra: "descanso", recurso: Some("P".into()), turma: None, aula: None, dia: "seg", minutos: 155 }]);

        // Quanto maior o intervalo, menor a penalidade; a partir de 11 horas, nenhuma
        let falta = |noite, manha| r.qualidade(&quadro(&r, &[(Segunda, noite), (Terca, manha)])).0.descanso_min;
        assert_eq!(falta(8, 1), 105, "22:35 → 7:50");
        assert_eq!(falta(7, 0), 105, "21:45 → 7:00");
        assert_eq!(falta(5, 0), 0, "19:50 → 7:00 são 11h10");
        assert_eq!(falta(8, 3), 0, "22:35 → 9:50 são 11h15");
        // Vale a primeira aula do dia seguinte, e dias não seguidos não contam
        assert_eq!(r.qualidade(&quadro(&r, &[(Segunda, 8), (Terca, 0), (Terca, 3)])).0.descanso_min, 155);
        assert_eq!(r.qualidade(&quadro(&r, &[(Segunda, 8), (Quarta, 0)])).0, Qualidade::default());
    }

    #[test]
    fn jornada_de_no_maximo_10_horas_no_dia() {
        let r = regras("{}");
        // Manhã e noite no mesmo dia: das 7:00 às 22:35 são 15h35
        let (q, o) = r.qualidade(&quadro(&r, &[(Segunda, 0), (Segunda, 8)]));
        assert_eq!(q, Qualidade { jornada_min: 335, ..Default::default() });
        assert_eq!(o[0].regra, "jornada");
        assert_eq!((o[0].recurso.as_deref(), o[0].dia, o[0].minutos), (Some("P"), "seg", 335));
        // Quanto mais afastadas, pior
        assert_eq!(r.qualidade(&quadro(&r, &[(Segunda, 4), (Segunda, 5)])).0.jornada_min, 0, "10:40 às 19:50 são 9h10");
        assert_eq!(r.qualidade(&quadro(&r, &[(Segunda, 3), (Segunda, 5)])).0.jornada_min, 0, "9:50 às 19:50 são 10h");
        assert_eq!(r.qualidade(&quadro(&r, &[(Segunda, 2), (Segunda, 5)])).0.jornada_min, 70, "8:40 às 19:50");
        // A manhã inteira não é problema
        assert_eq!(r.qualidade(&quadro(&r, &[(Segunda, 0), (Segunda, 1), (Segunda, 2), (Segunda, 3), (Segunda, 4)])).0, Qualidade::default());
    }

    #[test]
    fn grupo_partido_pelo_intervalo_com_uma_aula_sozinha() {
        let r = regras("{}");
        let medir = |tempos: &[usize]| {
            let q = r.qualidade(&quadro(&r, &tempos.iter().map(|&t| (Segunda, t)).collect::<Vec<_>>())).0;
            (q.intervalo, q.troca_de_turno)
        };
        // O intervalo da manhã fica entre os tempos 2 e 3
        assert_eq!(medir(&[2, 3]), (1, 0), "1 antes e 1 depois");
        assert_eq!(medir(&[1, 2, 3]), (1, 0), "2 antes e 1 depois");
        assert_eq!(medir(&[2, 3, 4]), (1, 0), "1 antes e 2 depois");
        assert_eq!(medir(&[1, 2, 3, 4]), (0, 0), "2 antes e 2 depois: aceitável");
        assert_eq!(medir(&[0, 1, 2, 3, 4]), (0, 0), "3 antes e 2 depois");
        assert_eq!(medir(&[0, 1, 2]), (0, 0), "não atravessa");
        assert_eq!(medir(&[2, 4]), (0, 0), "não são seguidas");
        // Troca de turno entre os tempos 4 e 5; intervalo da noite entre 6 e 7
        assert_eq!(medir(&[4, 5]), (0, 1));
        assert_eq!(medir(&[3, 4, 5, 6]), (0, 0), "2 de cada lado, mesmo na troca de turno");
        assert_eq!(medir(&[4, 5, 6, 7]), (1, 1), "sozinha antes da troca de turno e sozinha depois do intervalo");

        let o = r.qualidade(&quadro(&r, &[(Terca, 4), (Terca, 5)])).1;
        assert_eq!(o, [Ocorrencia { regra: "turno", recurso: None, turma: Some("T".into()), aula: Some("A".into()), dia: "ter", minutos: 0 }]);
    }

    #[test]
    fn evitar_so_para_professor_e_onde_esta_disponivel() {
        let r = regras(r#"{ "seg": [1, 2], "dom": [1] }"#);
        let (q, o) = r.qualidade(&quadro(&r, &[(Segunda, 0), (Segunda, 1), (Segunda, 2)]));
        assert_eq!(q.evitar, 2);
        assert!(o.iter().filter(|x| x.regra == "evitar").all(|x| x.recurso.as_deref() == Some("P") && x.aula.as_deref() == Some("A") && x.dia == "seg"));
        // A sala S tem as mesmas aulas e não gera ocorrência nenhuma (nem de jornada)
        let o = r.qualidade(&quadro(&r, &[(Terca, 0), (Terca, 8)])).1;
        assert!(o.iter().all(|x| x.recurso.as_deref() != Some("S")), "{o:?}");
    }

    #[test]
    fn sem_as_horas_so_o_evitar_vale() {
        let mut r = regras(r#"{ "seg": [1] }"#);
        r.tempos.clear();
        let (q, _) = r.qualidade(&quadro(&r, &[(Segunda, 0), (Segunda, 8), (Terca, 0), (Terca, 2), (Terca, 3)]));
        assert_eq!(q, Qualidade { evitar: 1, ..Default::default() });
        assert_eq!(r.quebra_depois(2), Quebra::Nenhuma);
    }

    /// Janela é vago ENTRE aulas do mesmo turno: nas pontas da manhã ou da noite não conta, e a
    /// troca de turno separa os trechos.
    #[test]
    fn janela_e_vago_entre_aulas_do_mesmo_turno() {
        let r = regras("{}");
        let mut r = r;
        r.turmas[0].folga = 27; // as aulas do quadro de teste não importam aqui
        let vago = r.vago();
        // Segunda: "." = vago, "A" = aula; tempos 0-4 manhã, 5-8 noite
        let janelas = |dia: &str| {
            let mut q = r.get_quadro_vazio();
            for (t, c) in dia.chars().enumerate() {
                q[r.to_quadro_index(0, Segunda, t)] = if c == 'A' { 1 } else { vago };
            }
            let (q, o) = r.qualidade(&q);
            assert!(o.iter().filter(|x| x.regra == "janela").all(|x| x.turma.as_deref() == Some("T") && x.dia == "seg"));
            q.janela
        };
        assert_eq!(janelas("AAA....AA"), 0, "fim da manhã e começo da noite");
        assert_eq!(janelas("..AAA.AA."), 0);
        assert_eq!(janelas("A.AAAAAAA"), 1);
        assert_eq!(janelas("A..A.AAAA"), 2, "dois vagos entre aulas da manhã; o do fim da manhã não conta");
        assert_eq!(janelas("AAAAAA..A"), 2, "na noite");
        assert_eq!(janelas("AAAA.A..."), 0, "a troca de turno não é janela: o vago fecha a manhã");
        assert_eq!(janelas("........."), 0);
        assert_eq!(r.trechos.iter().filter(|t| t.dia == Segunda).count(), 2, "manhã e noite");
    }

    /// Por pior que seja a qualidade, ela pesa menos que uma única violação obrigatória (peso 20).
    #[test]
    fn qualidade_nunca_alcanca_uma_regra_obrigatoria() {
        let r = regras(r#"{ "seg": [1, 2, 3, 4, 5, 6, 7, 8, 9], "ter": [1, 2, 3, 4, 5, 6, 7, 8, 9], "qua": [1, 2, 3, 4, 5, 6, 7, 8, 9] }"#);
        // "A" em ziguezague: manhã e noite todo dia, tudo a evitar, sozinha em todas as quebras
        let ruim: Vec<_> = [Segunda, Terca, Quarta].into_iter().flat_map(|d| [0, 2, 4, 5, 6, 8].map(|t| (d, t))).collect();
        let q = quadro(&r, &ruim);
        let medida = r.qualidade(&q).0;
        assert!(medida.evitar > 0 && medida.jornada_min > 0 && medida.descanso_min > 0 && medida.troca_de_turno > 0, "{medida:?}");

        let mut estado = r.initial_state();
        let com = r.fitness_rapido(&mut estado, &q);
        let mut sem_qualidade = r.clone();
        sem_qualidade.tempos.clear();
        sem_qualidade.professores[0].evitar.slots.fill(0);
        let mut estado = sem_qualidade.initial_state();
        let sem = sem_qualidade.fitness_rapido(&mut estado, &q);
        assert!(com < sem, "a qualidade tem que pesar alguma coisa");
        assert!(sem - com < 20.0, "e menos que a menor penalidade obrigatória: {}", sem - com);
    }

    /// P dá 2 aulas a uma turma que tem aula de manhã e à noite: o GA termina com as duas no mesmo
    /// turno e no mesmo dia, sem jornada estourada nem descanso curto. A busca exata nem olha isso.
    #[test]
    fn ga_junta_as_aulas_do_professor_no_mesmo_turno() {
        let tempos = r#"[{ "inicio": 420, "fim": 470, "turno": "m" }, { "inicio": 470, "fim": 520, "turno": "m" }, { "inicio": 1255, "fim": 1305, "turno": "n" }, { "inicio": 1305, "fim": 1355, "turno": "n" }]"#;
        let regras = RegrasHorario::from_json(&format!(r#"{{
            "turmas": [{{ "id": "T", "horarios": {{ "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] }} }}],
            "aulas": [
                {{ "id": "A", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 2 }},
                {{ "id": "B", "turmas": ["T"], "recursos": ["Q"], "aulasSemana": 6 }}
            ],
            "recursos": [
                {{ "id": "P", "disponibilidade": {{ "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] }} }},
                {{ "id": "Q", "ambiente": true, "disponibilidade": {{ "seg": [1, 2, 3, 4], "ter": [1, 2, 3, 4] }} }}
            ],
            "tempos": {tempos}
        }}"#)).unwrap();
        fastrand::seed(7);
        let mut ga = HorarioGARunner::de_regras(regras, 0);
        let mut blocos = 0;
        while !ga.run(50) {
            blocos += 1;
            assert!(blocos < 2_000, "o GA deveria terminar");
        }
        let fim = ga.resultado();
        assert!(!fim.alguma_violacao);
        // "B" (6 aulas) inevitavelmente fica partida em algum ponto; o que importa é o professor
        let do_professor: Vec<_> = fim.qualidade.iter().filter(|o| o.recurso.is_some()).collect();
        assert!(do_professor.is_empty(), "{do_professor:?}");
    }
}
