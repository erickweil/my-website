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
    #[inline(always)]
    pub fn to_index(&self) -> usize {
        *self as usize
    }

    pub fn from_index(index: usize) -> Self {
        match index {
            0 => DiaSemana::Domingo,
            1 => DiaSemana::Segunda,
            2 => DiaSemana::Terca,
            3 => DiaSemana::Quarta,
            4 => DiaSemana::Quinta,
            5 => DiaSemana::Sexta,
            6 => DiaSemana::Sabado,
            _ => panic!("Índice inválido para DiaSemana: {}", index),            
        }
    }
}

impl From<&str> for DiaSemana {
    fn from(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "dom" => DiaSemana::Domingo,
            "seg" => DiaSemana::Segunda,
            "ter" => DiaSemana::Terca,
            "qua" => DiaSemana::Quarta,
            "qui" => DiaSemana::Quinta,
            "sex" => DiaSemana::Sexta,
            "sab" => DiaSemana::Sabado,
            _ => panic!("Valor inválido para DiaSemana: {}", value),
        }
    }
}

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
    pub agrupar: i32,
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
    pub disciplinas_unidas: Vec<FomularioHorarioDisciplinaUnida>,
    pub professores: Vec<FomularioHorarioProfessor>,
}

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

    pub fn from_formulario(tempos: HorariosPorDia, n_tempos: usize) -> Self {
        // Inicia com array de 0 (indisponível)
        let mut horario = Self::new(n_tempos);

        for (dia_str, tempos_vec) in tempos {
            let dia = DiaSemana::from(dia_str.as_str());
            for tempo in tempos_vec {
                if tempo >= 1 && tempo as usize <= n_tempos {
                    let idx = (tempo - 1) as usize;
                    //let slot_idx = dia.to_index() * n_tempos + idx;
                    let slot_idx = idx * QUANTOS_DIAS + dia.to_index();
                    horario.slots[slot_idx] = 1; // Marca como disponível
                }
            }
        }

        horario
    }

    /*pub fn get_horario_dia(&self, dia: DiaSemana) -> &[i32] {
        let start = dia.to_index() * self.n_tempos;
        &self.slots[start..(start + self.n_tempos)]
    }*/

    pub fn possui(&self, dia: DiaSemana, tempo: usize) -> bool {
        let idx = tempo * QUANTOS_DIAS + dia.to_index();
        self.slots[idx] == 1
    }
}

pub struct Turma {
    pub id: usize,
    pub nome: String,
    pub horarios: Horario,
}

pub struct Professor {
    pub id: usize,
    pub nome: String,
    // 1 = disponível, 0 = ocupado
    pub horarios: Horario,

    //  -1 = não dá aula
    //   0 = não está definido
    // > 0 = Índice da disciplina
    //_matriz:   Horario,
}

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

pub struct RegrasHorario {
    pub turmas: Vec<Turma>,
    pub disciplinas: Vec<Disciplina>,    
    pub professores: Vec<Professor>,
    pub n_tempos: usize,
}

impl RegrasHorario {
    pub fn new(formulario: FomularioHorario) -> Self {
        // Determina o número de tempos a partir dos dados das turmas e professores
        let n_tempos = formulario.turmas.iter()
            .map(|t|
                t.horarios.values()
                    .map(|tempos_vec|
                        tempos_vec.iter().max().unwrap_or(&0)
                    )
                    .max().unwrap_or(&0)
            )
            .max().unwrap_or(&0).clone() as usize;
        assert!(n_tempos > 0, "Número de tempos deve ser maior que zero");

        // Converte os formulários em estruturas internas
        let mut turmas = Vec::new();
        let mut disciplinas = Vec::new();
        let mut professores = Vec::new();

        for (i, turma_form) in formulario.turmas.into_iter().enumerate() {
            turmas.push(Turma { 
                id: i, 
                nome: turma_form.nome, 
                horarios: Horario::from_formulario(turma_form.horarios, n_tempos)
            });
        }
        
        for (i, disc_form) in formulario.disciplinas.into_iter().enumerate() {
            let turma_id = turmas.iter().position(|t| t.nome == disc_form.turma)
                .expect(&format!("Turma '{}' não encontrada para disciplina '{}'", disc_form.turma, disc_form.nome));

            disciplinas.push(Disciplina {
                id: i,
                nome: disc_form.nome,
                aulas: disc_form.aulas,
                agrupar: disc_form.agrupar,
                dividir: disc_form.dividir,
                turma_id: turma_id,
                disciplinas_unidas: Vec::new(),
                professores: Vec::new(),
            });
        }

        
        for (i, prof_form) in formulario.professores.into_iter().enumerate() {
            for disc_nome in prof_form.disciplinas {
                let disc_id = disciplinas.iter().position(|d| d.nome == disc_nome)
                    .expect(&format!("Disciplina '{}' não encontrada para professor '{}'", disc_nome, prof_form.nome));
                disciplinas[disc_id].professores.push(i);
            }

            professores.push(Professor { 
                id: i, 
                nome: prof_form.nome, 
                horarios: Horario::from_formulario(prof_form.horarios, n_tempos)
            });
        }

        for disc_unida in formulario.disciplinas_unidas {
            for disc_nome in &disc_unida.disciplinas {
                let disc_id = disciplinas.iter().position(|d| disc_nome == &d.nome)
                    .expect(&format!("Disciplina '{}' não encontrada para grupo '{}'", disc_nome, disc_unida.grupo));

                for dics_unida_nome in &disc_unida.disciplinas {
                    if dics_unida_nome == disc_nome {
                        continue; // Não adiciona a si mesma
                    }

                    let disc_unida_id = disciplinas.iter().position(|d| dics_unida_nome == &d.nome)
                        .expect(&format!("Disciplina '{}' não encontrada para o grupos de disciplinas unidas '{}'", dics_unida_nome, disc_unida.grupo));
                    
                    disciplinas[disc_id].disciplinas_unidas.push(disc_unida_id);
                }
            }
        }

        Self {
            turmas,
            disciplinas,
            professores,
            n_tempos,
        }
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
        let mut quadro = vec![-1; self.turmas.len() * QUANTOS_DIAS * self.n_tempos];

        for turma in &self.turmas {
            for dia_idx in 0..QUANTOS_DIAS {
                let dia = DiaSemana::from_index(dia_idx);
                for tempo in 0..self.n_tempos {
                    if turma.horarios.possui(dia, tempo) {
                        // Disponível para alocação
                        quadro[self.to_quadro_index(turma.id, dia, tempo)] = 0;
                    }
                }
            }
        }

        quadro
    }
}
