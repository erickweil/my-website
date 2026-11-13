use std::{collections::HashMap};

// Tipo a ser serializado-deserializado para comunicação com o frontend
use serde::{Deserialize};

pub const QUANTOS_DIAS: usize = 7; // Domingo a Sábado
#[derive(Clone, Copy, PartialEq, Eq)]
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

// ── Erros do formulário ──────────────────────────────────────────────────────────────────────

/// Problemas no formulário recebido da UI. As mensagens (`Display`) são mostradas ao usuário.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroFormulario {
    /// O JSON não tem o formato esperado (campo faltando, tipo errado…).
    FormatoInvalido(String),
    /// Nenhuma turma tem horário disponível, então não há tempos no quadro.
    SemTempos,
    /// Chave de dia desconhecida nos horários de uma turma ou professor.
    DiaInvalido { dia: String, dono: String },
    TurmaNaoEncontrada { turma: String, disciplina: String },
    DisciplinaNaoEncontradaProfessor { disciplina: String, professor: String },
    DisciplinaNaoEncontradaGrupo { disciplina: String, grupo: String },
}

impl std::fmt::Display for ErroFormulario {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FormatoInvalido(msg) => write!(f, "Formulário inválido: {msg}"),
            Self::SemTempos => write!(f, "Nenhuma turma tem horários disponíveis: marque ao menos um tempo em alguma turma."),
            Self::DiaInvalido { dia, dono } => write!(f, "Dia \"{dia}\" inválido nos horários de \"{dono}\""),
            Self::TurmaNaoEncontrada { turma, disciplina } =>
                write!(f, "Turma \"{turma}\" não encontrada para disciplina \"{disciplina}\""),
            Self::DisciplinaNaoEncontradaProfessor { disciplina, professor } =>
                write!(f, "Disciplina \"{disciplina}\" não encontrada para professor \"{professor}\""),
            Self::DisciplinaNaoEncontradaGrupo { disciplina, grupo } =>
                write!(f, "Disciplina \"{disciplina}\" não encontrada para disciplina unida \"{grupo}\""),
        }
    }
}

impl std::error::Error for ErroFormulario {}

pub type HorariosPorDia = HashMap<String, Vec<i32>>;

#[derive(Deserialize, Debug, Clone)]
pub struct FomularioHorarioTurma {
    pub nome: String,
    pub horarios: HorariosPorDia,
}

#[derive(Deserialize, Debug, Clone)]
pub struct FomularioHorarioDisciplina {
    pub nome: String,
    pub turma: String,
    pub aulas: i32,
    // Formulários exportados pela UI podem omitir estes campos (no TS ficam `undefined`,
    // tratados como 0/false). Sem `default`, a desserialização falharia com "missing field".
    #[serde(default)]
    pub agrupar: i32,
    #[serde(default)]
    pub dividir: bool,
}

#[derive(Deserialize, Debug, Clone)]
pub struct FomularioHorarioDisciplinaUnida {
    pub grupo: String,
    pub disciplinas: Vec<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct FomularioHorarioProfessor {
    pub nome: String,
    pub disciplinas: Vec<String>,
    pub horarios: HorariosPorDia,
}

#[derive(Deserialize, Debug, Clone)]
pub struct FomularioHorario {
    pub turmas: Vec<FomularioHorarioTurma>,
    pub disciplinas: Vec<FomularioHorarioDisciplina>,
    #[serde(default)]
    pub disciplinas_unidas: Vec<FomularioHorarioDisciplinaUnida>,
    pub professores: Vec<FomularioHorarioProfessor>,
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
    pub fn from_formulario(tempos: HorariosPorDia, n_tempos: usize, dono: &str) -> Result<Self, ErroFormulario> {
        // Inicia com array de 0 (indisponível)
        let mut horario = Self::new(n_tempos);

        for (dia_str, tempos_vec) in tempos {
            let dia = DiaSemana::try_from(dia_str.as_str())
                .map_err(|dia| ErroFormulario::DiaInvalido { dia, dono: dono.to_string() })?;
            for tempo in tempos_vec {
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
}

#[derive(Clone)]
pub struct Professor {
    pub id: usize,
    pub nome: String,
    // 1 = disponível, 0 = ocupado
    pub horarios: Horario,
}

#[derive(Clone)]
pub struct Disciplina {
    pub id: usize,
    pub nome: String,

    pub aulas: i32,
    pub agrupar: i32,
    pub dividir: bool,
    
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
    pub n_tempos: usize,
}

impl RegrasHorario {
    /// Lê o formulário da UI. É a ÚNICA interpretação do formulário: os dois solvers, a validação e
    /// a montagem do resultado partem daqui.
    pub fn new(formulario: FomularioHorario) -> Result<Self, ErroFormulario> {
        // Número de tempos = maior tempo marcado em alguma turma
        let n_tempos = formulario.turmas.iter()
            .flat_map(|t| t.horarios.values().flatten())
            .copied()
            .max()
            .unwrap_or(0)
            .max(0) as usize;
        if n_tempos == 0 {
            return Err(ErroFormulario::SemTempos);
        }

        let mut turmas = Vec::new();
        for (i, turma_form) in formulario.turmas.into_iter().enumerate() {
            let horarios = Horario::from_formulario(turma_form.horarios, n_tempos, &turma_form.nome)?;
            turmas.push(Turma { id: i, nome: turma_form.nome, horarios });
        }

        let mut disciplinas = Vec::new();
        for (i, disc_form) in formulario.disciplinas.into_iter().enumerate() {
            let turma_id = turmas.iter().position(|t| t.nome == disc_form.turma)
                .ok_or_else(|| ErroFormulario::TurmaNaoEncontrada {
                    turma: disc_form.turma.clone(),
                    disciplina: disc_form.nome.clone(),
                })?;

            disciplinas.push(Disciplina {
                id: i,
                nome: disc_form.nome,
                aulas: disc_form.aulas,
                agrupar: disc_form.agrupar,
                dividir: disc_form.dividir,
                turma_id,
                disciplinas_unidas: Vec::new(),
                professores: Vec::new(),
            });
        }

        // Com nomes repetidos vale a primeira disciplina, como no `find` do TS
        let buscar_disciplina = |disciplinas: &[Disciplina], nome: &str| disciplinas.iter().position(|d| d.nome == nome);

        let mut professores = Vec::new();
        for (i, prof_form) in formulario.professores.into_iter().enumerate() {
            for disc_nome in &prof_form.disciplinas {
                let disc_id = buscar_disciplina(&disciplinas, disc_nome)
                    .ok_or_else(|| ErroFormulario::DisciplinaNaoEncontradaProfessor {
                        disciplina: disc_nome.clone(),
                        professor: prof_form.nome.clone(),
                    })?;
                disciplinas[disc_id].professores.push(i);
            }

            let horarios = Horario::from_formulario(prof_form.horarios, n_tempos, &prof_form.nome)?;
            professores.push(Professor { id: i, nome: prof_form.nome, horarios });
        }

        for grupo in formulario.disciplinas_unidas {
            let ids = grupo.disciplinas.iter()
                .map(|nome| buscar_disciplina(&disciplinas, nome).ok_or_else(|| ErroFormulario::DisciplinaNaoEncontradaGrupo {
                    disciplina: nome.clone(),
                    grupo: grupo.grupo.clone(),
                }))
                .collect::<Result<Vec<_>, _>>()?;

            // Cada disciplina do grupo fica unida a todas as outras (pelo nome, como no TS)
            for (a, &disc_id) in ids.iter().enumerate() {
                for (b, &unida_id) in ids.iter().enumerate() {
                    if grupo.disciplinas[a] != grupo.disciplinas[b] {
                        disciplinas[disc_id].disciplinas_unidas.push(unida_id);
                    }
                }
            }
        }

        Ok(Self { turmas, disciplinas, professores, n_tempos })
    }

    /// Lê o formulário vindo do JS (o objeto `FormularioHorario` da página).
    pub fn from_js(formulario: wasm_bindgen::JsValue) -> Result<Self, ErroFormulario> {
        let formulario: FomularioHorario = serde_wasm_bindgen::from_value(formulario)
            .map_err(|e| {
                // O erro do serde_wasm_bindgen vira um `Error` do JS, cujo texto já começa com "Error: "
                let msg = e.to_string();
                ErroFormulario::FormatoInvalido(msg.strip_prefix("Error: ").unwrap_or(&msg).to_string())
            })?;
        Self::new(formulario)
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

    /// Trecho no formato exportado pela UI: disciplina sem `dividir`/`agrupar`, campos extras
    /// (`id`, `checkAgrupar`) e sem `disciplinas_unidas`.
    #[test]
    fn aceita_formulario_com_campos_omitidos() {
        let json = r#"{
            "turmas": [{ "nome": "T", "horarios": { "seg": [1, 2] }, "id": "abc" }],
            "disciplinas": [
                { "nome": "A", "turma": "T", "aulas": 1, "agrupar": 2, "checkAgrupar": false },
                { "nome": "B", "turma": "T", "aulas": 1 }
            ],
            "professores": [{ "nome": "P", "disciplinas": ["A", "B"], "horarios": { "seg": [1, 2] } }]
        }"#;
        let f: FomularioHorario = serde_json::from_str(json).expect("deveria aceitar campos omitidos");
        assert!(!f.disciplinas[0].dividir);
        assert_eq!(f.disciplinas[1].agrupar, 0);
        assert!(f.disciplinas_unidas.is_empty());
        let regras = RegrasHorario::new(f).unwrap();
        assert_eq!(regras.n_tempos, 2);
    }

    fn formulario(json: &str) -> FomularioHorario {
        serde_json::from_str(json).unwrap()
    }

    /// Formulário mínimo válido com um trecho trocado, para testar cada erro.
    fn com(trocar: &str, por: &str) -> FomularioHorario {
        let base = r#"{
            "turmas": [{ "nome": "T", "horarios": { "seg": [1, 2] } }],
            "disciplinas": [{ "nome": "A", "turma": "T", "aulas": 1 }, { "nome": "B", "turma": "T", "aulas": 1 }],
            "disciplinas_unidas": [{ "grupo": "G", "disciplinas": ["A", "B"] }],
            "professores": [{ "nome": "P", "disciplinas": ["A", "B"], "horarios": { "seg": [1, 2] } }]
        }"#;
        assert!(base.contains(trocar), "trecho '{trocar}' não está no formulário base");
        formulario(&base.replacen(trocar, por, 1))
    }

    #[test]
    fn erros_de_formulario_viram_result_com_mensagem() {
        let casos: [(&str, &str, ErroFormulario, &str); 5] = [
            (r#""turma": "T", "aulas": 1 }, { "nome": "B""#, r#""turma": "X", "aulas": 1 }, { "nome": "B""#,
                ErroFormulario::TurmaNaoEncontrada { turma: "X".into(), disciplina: "A".into() },
                r#"Turma "X" não encontrada para disciplina "A""#),
            (r#""disciplinas": ["A", "B"], "horarios""#, r#""disciplinas": ["A", "Z"], "horarios""#,
                ErroFormulario::DisciplinaNaoEncontradaProfessor { disciplina: "Z".into(), professor: "P".into() },
                r#"Disciplina "Z" não encontrada para professor "P""#),
            (r#""disciplinas": ["A", "B"] }"#, r#""disciplinas": ["A", "Y"] }"#,
                ErroFormulario::DisciplinaNaoEncontradaGrupo { disciplina: "Y".into(), grupo: "G".into() },
                r#"Disciplina "Y" não encontrada para disciplina unida "G""#),
            (r#"{ "seg": [1, 2] } }],"#, r#"{ "segunda": [1, 2] } }],"#,
                ErroFormulario::DiaInvalido { dia: "segunda".into(), dono: "T".into() },
                r#"Dia "segunda" inválido nos horários de "T""#),
            (r#"{ "seg": [1, 2] } }],"#, r#"{ "seg": [] } }],"#,
                ErroFormulario::SemTempos,
                "Nenhuma turma tem horários disponíveis: marque ao menos um tempo em alguma turma."),
        ];
        for (trocar, por, esperado, msg) in casos {
            let erro = RegrasHorario::new(com(trocar, por)).err().unwrap_or_else(|| panic!("deveria falhar: {por}"));
            assert_eq!(erro, esperado);
            assert_eq!(erro.to_string(), msg);
        }
    }

    #[test]
    fn dia_aceita_maiusculas_e_disciplinas_unidas_sao_simetricas() {
        let regras = RegrasHorario::new(com(r#"{ "seg": [1, 2] } }],"#, r#"{ "SEG": [1, 2] } }],"#)).unwrap();
        assert_eq!(regras.turmas[0].horarios.get(DiaSemana::Segunda, 1), 1);
        assert_eq!(regras.disciplinas[0].disciplinas_unidas, vec![1]);
        assert_eq!(regras.disciplinas[1].disciplinas_unidas, vec![0]);
    }
}
