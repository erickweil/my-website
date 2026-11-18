use std::{collections::HashMap};

// Tipo a ser serializado-deserializado para comunicação com o frontend
use serde::Deserialize;

use super::horario_divisao::{EntradaDivisao, RegraDivisao};

pub const QUANTOS_DIAS: usize = 7; // Domingo a Sábado
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum DiaSemana {
    Domingo = 0,
    Segunda = 1,
    Terca   = 2,
    Quarta  = 3,
    Quinta  = 4,
    Sexta   = 5,
    Sabado  = 6,
}

impl DiaSemana {
    /// Todos os dias, na ordem dos índices (domingo = 0).
    pub const TODOS: [DiaSemana; QUANTOS_DIAS] = [
        DiaSemana::Domingo,
        DiaSemana::Segunda,
        DiaSemana::Terca,
        DiaSemana::Quarta,
        DiaSemana::Quinta,
        DiaSemana::Sexta,
        DiaSemana::Sabado,
    ];

    #[inline(always)]
    pub fn to_index(&self) -> usize {
        *self as usize
    }

    /// Índice de 0 a 6. Usado só com índices calculados internamente: fora disso é bug.
    pub fn from_index(index: usize) -> Self {
        Self::TODOS[index]
    }

    /// Sigla usada no formulário e no resultado (`"dom"`, `"seg"`, …), a mesma do `TODOS_OS_DIAS` do TS.
    pub fn sigla(&self) -> &'static str {
        match self {
            DiaSemana::Domingo => "dom",
            DiaSemana::Segunda => "seg",
            DiaSemana::Terca => "ter",
            DiaSemana::Quarta => "qua",
            DiaSemana::Quinta => "qui",
            DiaSemana::Sexta => "sex",
            DiaSemana::Sabado => "sab",
        }
    }
}

impl TryFrom<&str> for DiaSemana {
    /// A sigla recebida, que não corresponde a nenhum dia.
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        let minusculo = value.to_lowercase();
        Self::TODOS.into_iter().find(|d| d.sigla() == minusculo).ok_or_else(|| value.to_string())
    }
}

// ── Erros da entrada ─────────────────────────────────────────────────────────────────────────

/// Problemas na entrada recebida da página. A página monta a entrada a partir do projeto e já a
/// valida, então isto só aparece se houver um defeito lá; ainda assim a mensagem (`Display`) é
/// mostrada ao usuário.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroEntrada {
    /// O objeto não tem o formato esperado (campo faltando, tipo errado…).
    FormatoInvalido(String),
    /// Nenhuma turma tem horário marcado, então não há tempos no quadro.
    SemTempos,
    /// Chave de dia desconhecida nos horários de uma turma ou de um recurso.
    DiaInvalido { dia: String, dono: String },
    TurmaNaoEncontrada { turma: String, aula: String },
    RecursoNaoEncontrado { recurso: String, aula: String },
    AulaSemTurma { aula: String },
}

impl std::fmt::Display for ErroEntrada {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FormatoInvalido(msg) => write!(f, "Dados inválidos: {msg}"),
            Self::SemTempos => write!(f, "Nenhuma turma tem horários marcados: marque ao menos um horário em alguma turma."),
            Self::DiaInvalido { dia, dono } => write!(f, "Dia \"{dia}\" inválido nos horários de \"{dono}\""),
            Self::TurmaNaoEncontrada { turma, aula } => write!(f, "A aula \"{aula}\" é de uma turma que não existe (\"{turma}\")"),
            Self::RecursoNaoEncontrado { recurso, aula } =>
                write!(f, "A aula \"{aula}\" usa um professor ou ambiente que não existe (\"{recurso}\")"),
            Self::AulaSemTurma { aula } => write!(f, "A aula \"{aula}\" não tem nenhuma turma"),
        }
    }
}

impl std::error::Error for ErroEntrada {}

/// Erro de desserialização com o caminho do campo (ex.: `aulas[3].aulasSemana`).
pub fn erro_de_formato(caminho: &str, msg: &str) -> ErroEntrada {
    // O erro do serde_wasm_bindgen vira um `Error` do JS, cujo texto já começa com "Error: "
    let msg = msg.strip_prefix("Error: ").unwrap_or(msg);
    if caminho.is_empty() || caminho == "." {
        ErroEntrada::FormatoInvalido(msg.to_string())
    } else {
        ErroEntrada::FormatoInvalido(format!("campo {caminho}: {msg}"))
    }
}

/// Tempos marcados por dia (`"seg"`, `"ter"`…). O tempo é o número da aula no dia, a partir de 1.
pub type HorariosPorDia = HashMap<String, Vec<i32>>;

// ── Entrada do solver ────────────────────────────────────────────────────────────────────────
// O problema como a página o entrega (`EntradaDoSolver` em horario-regras.ts): tudo se referencia
// por id. Uma aula pode ter várias turmas (dada em conjunto) e vários recursos.

#[derive(Deserialize, Debug, Clone)]
pub struct EntradaTurma {
    pub id: String,
    /// Em quais tempos a turma tem aula.
    pub horarios: HorariosPorDia,
}

/// Uma disciplina sendo dada: para quais turmas, usando quais recursos, quantas vezes por semana.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntradaAula {
    pub id: String,
    /// Mais de uma = turmas juntas, sempre no mesmo horário.
    pub turmas: Vec<String>,
    /// Professores e ambiente: cada um só pode estar numa aula por horário.
    pub recursos: Vec<String>,
    pub aulas_semana: i32,
    /// Como as aulas se dividem em pedaços de aulas seguidas (ver `horario_divisao.rs`). Sem ela,
    /// a divisão é livre.
    #[serde(default)]
    pub divisao: EntradaDivisao,
}

/// Uma aula do quadro de horários: quando começa e termina, e o turno. Só as regras de qualidade
/// usam (ver `horario_qualidade.rs`).
#[derive(Deserialize, Debug, Clone)]
pub struct EntradaTempo {
    /// Minutos desde a meia-noite.
    pub inicio: i32,
    pub fim: i32,
    pub turno: String,
}

/// Algo de ocupação única: um professor ou um ambiente.
#[derive(Deserialize, Debug, Clone)]
pub struct EntradaRecurso {
    pub id: String,
    /// true = ambiente (sala, laboratório): só não pode ter duas aulas ao mesmo tempo. As regras
    /// de qualidade (evitar, jornada, descanso) valem só para professores.
    #[serde(default)]
    pub ambiente: bool,
    /// REGRA OBRIGATÓRIA: o recurso nunca tem aula fora destes tempos.
    pub disponibilidade: HorariosPorDia,
    /// Tempos disponíveis em que é melhor não ter aula. No algoritmo genético é regra de qualidade;
    /// na busca exata, o professor fica indisponível nesses tempos.
    #[serde(default)]
    pub evitar: HorariosPorDia,
}

#[derive(Deserialize, Debug, Clone)]
pub struct EntradaHorario {
    pub turmas: Vec<EntradaTurma>,
    pub aulas: Vec<EntradaAula>,
    pub recursos: Vec<EntradaRecurso>,
    /// As aulas do dia, na ordem (a 1ª é o tempo 1). Opcional: sem elas, as regras de qualidade
    /// que dependem de hora ficam desligadas.
    #[serde(default)]
    pub tempos: Vec<EntradaTempo>,
}

#[derive(Clone)]
pub struct Horario {
    // 2D: 7 dias x n tempos, armazenado como array linearizado
    pub slots: Vec<i32>
}

impl Horario {
    pub fn new(n_tempos: usize) -> Self {
        // na prática o máximo seria 18 tempos x 7 dias x 4 bytes por i32 = 504 bytes
        Self {
            slots: vec![0; QUANTOS_DIAS * n_tempos]
        }
    }

    /// Monta a matriz de disponibilidade. `dono` (nome da turma ou professor) só entra na mensagem de erro.
    pub fn from_formulario(tempos: &HorariosPorDia, n_tempos: usize, dono: &str) -> Result<Self, ErroEntrada> {
        // Inicia com array de 0 (indisponível)
        let mut horario = Self::new(n_tempos);

        for (dia_str, tempos_vec) in tempos {
            let dia = DiaSemana::try_from(dia_str.as_str())
                .map_err(|dia| ErroEntrada::DiaInvalido { dia, dono: dono.to_string() })?;
            for &tempo in tempos_vec {
                if tempo >= 1 && tempo as usize <= n_tempos {
                    let idx = (tempo - 1) as usize;
                    let slot_idx = idx * QUANTOS_DIAS + dia.to_index();
                    horario.slots[slot_idx] = 1; // Marca como disponível
                }
            }
        }

        Ok(horario)
    }

    /*pub fn get_horario_dia(&self, dia: DiaSemana) -> &[i32] {
        let start = dia.to_index() * self.n_tempos;
        &self.slots[start..(start + self.n_tempos)]
    }*/

    #[inline(always)]
    pub fn get(&self, dia: DiaSemana, tempo: usize) -> i32 {
        let idx = tempo * QUANTOS_DIAS + dia.to_index();
        self.slots[idx]
    }

    #[inline(always)]
    pub fn set(&mut self, dia: DiaSemana, tempo: usize, valor: i32) {
        let idx = tempo * QUANTOS_DIAS + dia.to_index();
        self.slots[idx] = valor;
    }

    #[inline(always)]
    pub fn desmarcar(&mut self, dia: DiaSemana, tempo: usize) {
        let idx = tempo * QUANTOS_DIAS + dia.to_index();
        self.slots[idx] -= 1;
    }
}

#[derive(Clone)]
pub struct Turma {
    pub id: usize,
    pub nome: String,
    pub horarios: Horario,
    /// Horários marcados que ficam vagos: tempos marcados menos aulas da turma (0 se faltam tempos).
    pub folga: i32,
}

/// Um turno de um dia de uma turma: as células em que ela tem aula, na ordem dos tempos. Os
/// horários vagos devem ficar nas pontas do trecho, não entre duas aulas.
#[derive(Clone, Debug)]
pub struct Trecho {
    pub turma: usize,
    pub dia: DiaSemana,
    /// Índices no quadro.
    pub celulas: Vec<usize>,
}

/// Um recurso de ocupação única: professor ou ambiente (o nome vem de quando só havia professores).
#[derive(Clone)]
pub struct Professor {
    pub id: usize,
    /// O id do recurso na entrada.
    pub nome: String,
    // 1 = disponível, 0 = ocupado
    pub horarios: Horario,
    /// 1 = horário a evitar (regra de qualidade, só do algoritmo genético).
    pub evitar: Horario,
    /// false = ambiente: sem regras de qualidade.
    pub pessoa: bool,
}

/// Uma aula do quadro de horários, em minutos desde a meia-noite.
#[derive(Clone, Copy, Debug)]
pub struct TempoDoQuadro {
    pub inicio: i32,
    pub fim: i32,
    /// Número do turno (tempos com o mesmo número são do mesmo turno).
    pub turno: u8,
}

/// Uma aula numa turma. Uma aula dada em conjunto vira uma disciplina por turma, "unidas" entre si
/// (mesmo horário); os recursos ficam só na primeira, para não entrarem em choque consigo mesmos.
#[derive(Clone)]
pub struct Disciplina {
    pub id: usize,
    /// O id da aula na entrada (repetido nas disciplinas de uma aula em conjunto).
    pub nome: String,
    /// Índice da aula em `RegrasHorario::aulas`.
    pub aula: usize,

    pub aulas: i32,
    /// Regras obrigatórias de divisão em pedaços (ver `horario_divisao.rs`).
    pub divisao: RegraDivisao,
    /// Regra de qualidade: no máximo um pedaço por dia.
    pub espalhar: bool,

    pub turma_id: usize,
    pub disciplinas_unidas: Vec<usize>,
    pub professores: Vec<usize>,

    // contador de aulas alocadas, para controle durante a geração do quadro
    //_aulas: i32,
}

pub type QuadroHorario = Vec<i32>;

#[derive(Clone)]
pub struct RegrasHorario {
    pub turmas: Vec<Turma>,
    pub disciplinas: Vec<Disciplina>,    
    pub professores: Vec<Professor>,
    /// Ids das aulas da entrada, na ordem.
    pub aulas: Vec<String>,
    /// As horas das aulas do dia; vazio se a entrada não trouxe.
    pub tempos: Vec<TempoDoQuadro>,
    pub n_tempos: usize,
    /// Os turnos de cada dia de cada turma (sem as horas na entrada, o dia inteiro é um trecho).
    pub trechos: Vec<Trecho>,
    /// Por célula do quadro: o trecho dela e a posição dentro dele (`u32::MAX` fora do horário da turma).
    pub trecho_de: Vec<(u32, u32)>,
    /// Pesos das regras no fitness do algoritmo genético (ver horario_genetic.rs).
    pub pesos: super::PesosFitness,
    /// Quais operadores o algoritmo genético usa (ver horario_genetic.rs).
    pub operadores: super::OperadoresGA,
}

impl RegrasHorario {
    /// Monta as regras a partir da entrada. É a ÚNICA interpretação da entrada: os dois solvers, a
    /// validação e a montagem do resultado partem daqui.
    pub fn new(entrada: EntradaHorario) -> Result<Self, ErroEntrada> {
        // Número de tempos = maior tempo marcado em alguma turma
        let n_tempos = entrada.turmas.iter()
            .flat_map(|t| t.horarios.values().flatten())
            .copied()
            .max()
            .unwrap_or(0)
            .max(0) as usize;
        if n_tempos == 0 {
            return Err(ErroEntrada::SemTempos);
        }

        let mut turmas = Vec::new();
        for (i, t) in entrada.turmas.into_iter().enumerate() {
            let horarios = Horario::from_formulario(&t.horarios, n_tempos, &t.id)?;
            turmas.push(Turma { id: i, nome: t.id, horarios, folga: 0 });
        }
        let turma_por_id: HashMap<&str, usize> = turmas.iter().map(|t| (t.nome.as_str(), t.id)).collect();

        let mut professores = Vec::new();
        for (i, r) in entrada.recursos.into_iter().enumerate() {
            let horarios = Horario::from_formulario(&r.disponibilidade, n_tempos, &r.id)?;
            let evitar = Horario::from_formulario(&r.evitar, n_tempos, &r.id)?;
            professores.push(Professor { id: i, nome: r.id, horarios, evitar, pessoa: !r.ambiente });
        }
        let recurso_por_id: HashMap<&str, usize> = professores.iter().map(|p| (p.nome.as_str(), p.id)).collect();

        let mut disciplinas: Vec<Disciplina> = Vec::new();
        let mut aulas = Vec::new();
        for (aula, a) in entrada.aulas.into_iter().enumerate() {
            if a.turmas.is_empty() {
                return Err(ErroEntrada::AulaSemTurma { aula: a.id });
            }
            let recursos = a.recursos.iter()
                .map(|r| recurso_por_id.get(r.as_str()).copied()
                    .ok_or_else(|| ErroEntrada::RecursoNaoEncontrado { recurso: r.clone(), aula: a.id.clone() }))
                .collect::<Result<Vec<_>, _>>()?;

            // Uma disciplina por turma, todas unidas entre si
            let primeira = disciplinas.len();
            let ids: Vec<usize> = (primeira..primeira + a.turmas.len()).collect();
            for (k, turma) in a.turmas.iter().enumerate() {
                let turma_id = *turma_por_id.get(turma.as_str())
                    .ok_or_else(|| ErroEntrada::TurmaNaoEncontrada { turma: turma.clone(), aula: a.id.clone() })?;
                disciplinas.push(Disciplina {
                    id: primeira + k,
                    nome: a.id.clone(),
                    aula,
                    aulas: a.aulas_semana.max(0),
                    divisao: RegraDivisao::new(&a.divisao, a.aulas_semana),
                    espalhar: a.divisao.espalhar && a.aulas_semana > 1,
                    turma_id,
                    disciplinas_unidas: ids.iter().copied().filter(|&d| d != primeira + k).collect(),
                    professores: if k == 0 { recursos.clone() } else { Vec::new() },
                });
            }
            aulas.push(a.id);
        }

        // Turnos numerados na ordem em que aparecem
        let mut turnos: Vec<&str> = Vec::new();
        let tempos: Vec<TempoDoQuadro> = entrada.tempos.iter().map(|t| {
            let turno = turnos.iter().position(|&x| x == t.turno).unwrap_or_else(|| { turnos.push(&t.turno); turnos.len() - 1 });
            TempoDoQuadro { inicio: t.inicio, fim: t.fim, turno: turno as u8 }
        }).collect();

        // Folga de cada turma: horários marcados que sobram depois de todas as aulas
        for turma in &mut turmas {
            let marcados = turma.horarios.slots.iter().filter(|&&v| v == 1).count() as i32;
            let aulas: i32 = disciplinas.iter().filter(|d| d.turma_id == turma.id).map(|d| d.aulas).sum();
            turma.folga = (marcados - aulas).max(0);
        }

        let mut regras = Self { turmas, disciplinas, professores, aulas, tempos, n_tempos, trechos: Vec::new(), trecho_de: Vec::new(), pesos: Default::default(), operadores: Default::default() };
        regras.montar_trechos();
        Ok(regras)
    }

    /// Divide o horário de cada turma em trechos: um por dia e turno.
    fn montar_trechos(&mut self) {
        let turno = |tempo: usize| self.tempos.get(tempo).map_or(0, |t| t.turno);
        let mut trechos: Vec<Trecho> = Vec::new();
        let mut trecho_de = vec![(u32::MAX, u32::MAX); self.tamanho_quadro()];
        for turma in &self.turmas {
            for dia in DiaSemana::TODOS {
                let mut atual: Option<(u8, usize)> = None; // (turno, índice do trecho)
                for tempo in 0..self.n_tempos {
                    if turma.horarios.get(dia, tempo) != 1 { continue; }
                    let t = turno(tempo);
                    let k = match atual {
                        Some((tt, k)) if tt == t => k,
                        _ => {
                            trechos.push(Trecho { turma: turma.id, dia, celulas: Vec::new() });
                            atual = Some((t, trechos.len() - 1));
                            trechos.len() - 1
                        }
                    };
                    let i = self.to_quadro_index(turma.id, dia, tempo);
                    trecho_de[i] = (k as u32, trechos[k].celulas.len() as u32);
                    trechos[k].celulas.push(i);
                }
            }
        }
        self.trechos = trechos;
        self.trecho_de = trecho_de;
    }

    /// Valor de um horário vago no quadro (marcado, mas sem aula, porque a turma tem folga). As
    /// disciplinas valem de 1 a `disciplinas.len()`; 0 é célula ainda não resolvida e -1 é fora do
    /// horário da turma.
    #[inline(always)]
    pub fn vago(&self) -> i32 {
        self.disciplinas.len() as i32 + 1
    }

    /// A disciplina numa célula do quadro, se há uma (não vale para vago, não resolvido ou fora).
    #[inline(always)]
    pub fn disciplina_em(&self, valor: i32) -> Option<usize> {
        (valor > 0 && valor < self.vago()).then(|| (valor - 1) as usize)
    }

    /// Lê a entrada vinda do JS (o objeto `EntradaDoSolver` da página).
    pub fn from_js(entrada: wasm_bindgen::JsValue) -> Result<Self, ErroEntrada> {
        let de = serde_wasm_bindgen::Deserializer::from(entrada);
        let entrada: EntradaHorario = serde_path_to_error::deserialize(de)
            .map_err(|e| erro_de_formato(&e.path().to_string(), &e.inner().to_string()))?;
        Self::new(entrada)
    }

    /// Lê a entrada de um JSON (testes e benchmarks).
    pub fn from_json(json: &str) -> Result<Self, ErroEntrada> {
        let mut de = serde_json::Deserializer::from_str(json);
        let entrada: EntradaHorario = serde_path_to_error::deserialize(&mut de)
            .map_err(|e| erro_de_formato(&e.path().to_string(), &e.inner().to_string()))?;
        Self::new(entrada)
    }

    /// Lê uma instância de um arquivo JSON. Para testes e benchmarks: encerra com a mensagem do
    /// erro se o arquivo não puder ser lido ou não for uma entrada válida.
    pub fn de_arquivo(caminho: &str) -> Self {
        let texto = std::fs::read_to_string(caminho).unwrap_or_else(|e| panic!("não foi possível ler '{caminho}': {e}"));
        Self::from_json(&texto).unwrap_or_else(|e| panic!("entrada inválida em '{caminho}': {e}"))
    }

    /// Quantas células do quadro recebem aula: a soma das aulas por semana de cada turma (uma aula
    /// em conjunto conta uma vez por turma). Os horários vagos não entram.
    pub fn aulas_a_alocar(&self) -> usize {
        self.disciplinas.iter().map(|d| d.aulas.max(0) as usize).sum()
    }

    /// Número de células do quadro (turmas × dias × tempos).
    pub fn tamanho_quadro(&self) -> usize {
        self.turmas.len() * QUANTOS_DIAS * self.n_tempos
    }

    pub fn to_quadro_index(&self, turma_id: usize, dia: DiaSemana, tempo: usize) -> usize {
        // Índice linearizado para acesso ao quadro
        (turma_id * QUANTOS_DIAS * self.n_tempos) + (dia.to_index() * self.n_tempos) + tempo
    }

    pub fn from_quadro_index(&self, index: usize) -> (usize, DiaSemana, usize) {
        let turma_id = (index / self.n_tempos) / QUANTOS_DIAS;
        let dia_idx = (index / self.n_tempos) % QUANTOS_DIAS;
        let tempo = index % self.n_tempos;

        (turma_id, DiaSemana::from_index(dia_idx), tempo)
    }

    pub fn get_quadro_vazio(&self) -> QuadroHorario {
        // -1 onde não terá nada
        let mut quadro = vec![-1; self.tamanho_quadro()];

        for turma in &self.turmas {
            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                for tempo in 0..self.n_tempos {
                    if turma.horarios.get(dia, tempo) == 1 {
                        // Disponível para alocação
                        quadro[self.to_quadro_index(turma.id, dia, tempo)] = 0;
                    }
                }
            }
        }

        quadro
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Entrada mínima válida com um trecho trocado, para testar cada erro.
    fn com(trocar: &str, por: &str) -> Result<RegrasHorario, ErroEntrada> {
        let base = r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2] } }, { "id": "U", "horarios": { "seg": [1, 2] } }],
            "aulas": [
                { "id": "a", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 2, "divisao": { "tamanhoMin": 2, "espalhar": true } },
                { "id": "b", "turmas": ["T", "U"], "recursos": ["P", "sala"], "aulasSemana": 1 }
            ],
            "recursos": [
                { "id": "P", "disponibilidade": { "seg": [1, 2] }, "evitar": { "seg": [2] } },
                { "id": "sala", "disponibilidade": { "seg": [1, 2] } }
            ]
        }"#;
        assert!(base.contains(trocar), "trecho '{trocar}' não está na entrada base");
        RegrasHorario::from_json(&base.replacen(trocar, por, 1))
    }

    #[test]
    fn aula_vira_uma_disciplina_por_turma() {
        let r = com("", "").unwrap();
        assert_eq!(r.n_tempos, 2);
        assert_eq!(r.aulas, ["a", "b"]);
        let d: Vec<_> = r.disciplinas.iter().map(|d| (d.aula, d.turma_id, d.aulas, d.divisao.ativa, d.espalhar)).collect();
        assert_eq!(d, [(0, 0, 2, true, true), (1, 0, 1, false, false), (1, 1, 1, false, false)]);
        assert_eq!((r.disciplinas[0].divisao.tam_min, r.disciplinas[0].divisao.tam_max), (2, 2));
        // A aula em conjunto: as duas disciplinas unidas, e os recursos só na primeira
        assert_eq!(r.disciplinas[1].disciplinas_unidas, [2]);
        assert_eq!(r.disciplinas[2].disciplinas_unidas, [1]);
        assert_eq!(r.disciplinas[1].professores, [0, 1]);
        assert!(r.disciplinas[2].professores.is_empty());
        // Evitar é opcional e fica à parte da disponibilidade
        assert_eq!(r.professores[0].evitar.get(DiaSemana::Segunda, 1), 1);
        assert_eq!(r.professores[0].horarios.get(DiaSemana::Segunda, 1), 1);
        assert_eq!(r.professores[1].evitar.get(DiaSemana::Segunda, 1), 0);
    }

    #[test]
    fn erros_da_entrada_viram_result_com_mensagem() {
        let casos: [(&str, &str, ErroEntrada, &str); 5] = [
            (r#""turmas": ["T"], "recursos": ["P"]"#, r#""turmas": ["X"], "recursos": ["P"]"#,
                ErroEntrada::TurmaNaoEncontrada { turma: "X".into(), aula: "a".into() },
                r#"A aula "a" é de uma turma que não existe ("X")"#),
            (r#""turmas": ["T"], "recursos": ["P"]"#, r#""turmas": ["T"], "recursos": ["Z"]"#,
                ErroEntrada::RecursoNaoEncontrado { recurso: "Z".into(), aula: "a".into() },
                r#"A aula "a" usa um professor ou ambiente que não existe ("Z")"#),
            (r#""turmas": ["T"], "recursos": ["P"]"#, r#""turmas": [], "recursos": ["P"]"#,
                ErroEntrada::AulaSemTurma { aula: "a".into() },
                r#"A aula "a" não tem nenhuma turma"#),
            (r#"{ "id": "T", "horarios": { "seg": [1, 2] } }"#, r#"{ "id": "T", "horarios": { "segunda": [1, 2] } }"#,
                ErroEntrada::DiaInvalido { dia: "segunda".into(), dono: "T".into() },
                r#"Dia "segunda" inválido nos horários de "T""#),
            (r#""evitar": { "seg": [2] }"#, r#""evitar": { "xyz": [2] }"#,
                ErroEntrada::DiaInvalido { dia: "xyz".into(), dono: "P".into() },
                r#"Dia "xyz" inválido nos horários de "P""#),
        ];
        for (trocar, por, esperado, msg) in casos {
            let erro = com(trocar, por).err().unwrap_or_else(|| panic!("deveria falhar: {por}"));
            assert_eq!(erro, esperado);
            assert_eq!(erro.to_string(), msg);
        }

        // Campo com o tipo errado: a mensagem diz qual campo
        let erro = com(r#""aulasSemana": 2"#, r#""aulasSemana": "duas""#).err().unwrap().to_string();
        assert!(erro.starts_with(r#"Dados inválidos: campo aulas[0].aulasSemana: invalid type: string "duas", expected i32"#), "{erro}");

        // O formato antigo do agrupamento não é mais aceito
        let erro = com(r#""aulasSemana": 1 }"#, r#""aulasSemana": 1, "bloco": 2 }"#).err().unwrap().to_string();
        assert!(erro.contains("unknown field `bloco`"), "{erro}");
    }

    #[test]
    fn sem_tempos_e_dia_em_maiusculas() {
        let vazia = r#"{ "turmas": [{ "id": "T", "horarios": { "seg": [] } }], "aulas": [], "recursos": [] }"#;
        assert_eq!(RegrasHorario::from_json(vazia).err(), Some(ErroEntrada::SemTempos));
        let r = com(r#"{ "id": "T", "horarios": { "seg": [1, 2] } }"#, r#"{ "id": "T", "horarios": { "SEG": [1, 2] } }"#).unwrap();
        assert_eq!(r.turmas[0].horarios.get(DiaSemana::Segunda, 1), 1);
    }
}
