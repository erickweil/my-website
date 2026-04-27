use rustc_hash::FxHashMap;
use wasm_bindgen::prelude::*;
mod utils;
mod framebuffer;
pub use framebuffer::{Color, Framebuffer};

/// Direção de movimento do cabeçote.
#[wasm_bindgen]
#[repr(i32)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    None = 0,
    Left = 1,
    Right = 2,
    Up = 3,
    Down = 4,
}

#[wasm_bindgen]
#[repr(i32)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TuringMachineResult {
    Continue = 0,
    Halt = 1,
    TransitionNotFound = 2,
}

impl Direction {
    fn from_i32(value: i32) -> Self {
        match value {
            0 => Direction::None,
            1 => Direction::Left,
            2 => Direction::Right,
            3 => Direction::Up,
            4 => Direction::Down,
            _ => Direction::None,
        }
    }
}

#[derive(Clone, Copy)]
struct ProgramInstruction {
    /// Codepoint Unicode a escrever, 0 para vazio, -1 para manter o valor atual
    write: i32,
    /// Direção de movimento do cabeçote, ou None para não mover
    dir: Direction,
    /// Próximo estado, 0 para manter o estado atual, valor negativo para Halt
    next: i32,
}

// Constante do wildcard 
const CHAR_WILDCARD: i32 = -1;
const STATE_WILDCARD: i32 = 0;

/// Compacta dois i32 em um i64 para uso como chave de HashMap, evitando hash de tupla.
#[inline(always)]
fn pack(a: i32, b: i32) -> i64 {
    ((a as i64) << 32) | (b as u32 as i64)
}
/// Máquina de Turing 2D com fita esparsa.
#[wasm_bindgen]
pub struct TuringMachine2D {
    /// Fita esparsa: chave = (x, y) compactados em i64, valor = unicode char
    tape: FxHashMap<i64, i32>,
    tape_bounds: (i32, i32, i32, i32), // (min_x, max_x, min_y, max_y) para otimização de renderização
    /// Valor que será lido em células nunca escritas (pode ser usado para simular uma fita infinita pré-carregada)
    default_value: i32,
    head: (i32, i32),
    current_state: i32, // -1 = halt, 0..N-1 = estados
    step_count: u64,
    transitions: FxHashMap<i64, ProgramInstruction>, // (state, read) compactados em i64 -> instruction
}

#[wasm_bindgen]
impl TuringMachine2D {
    /// Cria uma nova máquina.
    #[wasm_bindgen(constructor)]
    pub fn new(program: Vec<i32>, start_x: i32, start_y: i32, start_state: i32, default_value: i32) -> Self {
        if program.len() % 5 != 0 {
            panic!("Programa deve ser múltiplo de 5 (state, read, write, dir, next)");
        }

        let mut transitions = FxHashMap::default();
        for chunk in program.chunks_exact(5) {
            transitions.insert(
                pack(chunk[0], chunk[1]),
                ProgramInstruction { 
                    write: chunk[2], 
                    dir: Direction::from_i32(chunk[3]), 
                    next: chunk[4] 
                }
            );
        }

        Self {
            tape: FxHashMap::default(),
            tape_bounds: (start_x, start_x, start_y, start_y),
            default_value: default_value,
            head: (start_x, start_y),
            current_state: start_state,
            step_count: 0,
            transitions: transitions,
        }
    }

    pub fn reset(&mut self, start_x: i32, start_y: i32, start_state: i32) {
        self.tape.clear();
        self.tape_bounds = (start_x, start_x, start_y, start_y);
        self.head = (start_x, start_y);
        self.current_state = start_state;
        self.step_count = 0;
    }

    fn expand_bounds(&mut self, pos: (i32, i32)) {
        if pos.0 < self.tape_bounds.0 { self.tape_bounds.0 = pos.0; }
        if pos.0 > self.tape_bounds.1 { self.tape_bounds.1 = pos.0; }
        if pos.1 < self.tape_bounds.2 { self.tape_bounds.2 = pos.1; }
        if pos.1 > self.tape_bounds.3 { self.tape_bounds.3 = pos.1; }
    }

    /// Executa um único ciclo. Retorna `true` se continua ou `false` em Halt.
    fn step(&mut self) -> TuringMachineResult {
        if self.current_state < 0 {
            return TuringMachineResult::Halt;
        }

        // Lê a transição para o estado atual e o char sob o cabeçote
        let read_char = *self.tape.get(&pack(self.head.0, self.head.1)).unwrap_or(&self.default_value);
        let instr = self.transitions.get(&pack(self.current_state, read_char))
            .or_else(|| self.transitions.get(&pack(self.current_state, CHAR_WILDCARD))) // Transição com read char *
            .or_else(|| self.transitions.get(&pack(STATE_WILDCARD, read_char)))         // Transição com state *
            .or_else(|| self.transitions.get(&pack(STATE_WILDCARD, CHAR_WILDCARD)))     // Transição com state * e read char *
            .cloned();

        if let Some(instr) = instr {
            // 1. Escreve na fita
            if instr.write != CHAR_WILDCARD {
                self.tape.insert(pack(self.head.0, self.head.1), instr.write);
            }

            // 2. Move o cabeçote
            match instr.dir {
                Direction::Left => self.head.0 -= 1,
                Direction::Right => self.head.0 += 1,
                Direction::Up => self.head.1 -= 1,
                Direction::Down => self.head.1 += 1,
                Direction::None => {}
            };
            if instr.dir != Direction::None {
                self.expand_bounds(self.head);
            }

            // 3. Atualiza o estado
            if instr.next != STATE_WILDCARD {
                self.current_state = instr.next;
            }
            self.step_count += 1;

            return TuringMachineResult::Continue
        } else {
            return TuringMachineResult::TransitionNotFound
        }
    }

    /// Executa até `max_steps` ciclos ou até Halt. Retorna false se parou por Halt, true se atingiu o limite.
    pub fn run(&mut self, max_steps: u32) -> TuringMachineResult {
        for _steps in 0..max_steps {
            match self.step() {
                TuringMachineResult::Continue => continue,
                result => return result,
            }
        }

        TuringMachineResult::Continue
    }

    pub fn get_tape_bounds(&self, result: &mut [i32]) {
        result[0] = self.tape_bounds.0;
        result[1] = self.tape_bounds.1;
        result[2] = self.tape_bounds.2;
        result[3] = self.tape_bounds.3;
    }

    /// Recebe um um TypedArray do JavaScript e preenche com a fita esparsa. Cada célula é um caractere Unicode
    /// A área a ser preenchida é definida por `offsetLeft`, `offsetTop`, `width` e `height`
    pub fn update_framebuffer(&self, data: &mut [i32], offset_left: i32, offset_top: i32, width: i32, height: i32) {
        let expected = (width * height) as usize;
        if data.len() < expected {
            return; // buffer insuficiente – caller deve realocar antes de chamar novamente
        }
        // Agora atravessa cada posição desse buffer e pega na fita os valores (caso existam)
        let bounds = self.tape_bounds;
        for y in 0..height {
            for x in 0..width {
                let tape_x = x + offset_left;
                let tape_y = y + offset_top;
                let char = if tape_x >= bounds.0 && tape_x <= bounds.1 && tape_y >= bounds.2 && tape_y <= bounds.3 {
                    *self.tape.get(&pack(tape_x, tape_y)).unwrap_or(&0)
                } else {
                    0
                }; 
                data[(y * width + x) as usize] = char;
            }
        }
    }

    /// Pré-carrega células na fita.
    ///
    /// `data` é um array plano `[x0, y0, char, x1, y1, char, ...]`.
    pub fn preload_tape(&mut self, data: &[i32]) {
        for chunk in data.chunks_exact(3) {
            let pos = (chunk[0], chunk[1]);
            self.tape.insert(pack(pos.0, pos.1), chunk[2]);
            self.expand_bounds(pos);
        }
    }

    pub fn get_step_count(&self) -> f64 {
        self.step_count as f64
    }

    /// Retorna o estado atual.
    pub fn get_state(&self) -> i32 {
        self.current_state
    }

    /// Retorna a posição X do cabeçote.
    pub fn head_x(&self) -> i32 {
        self.head.0
    }

    /// Retorna a posição Y do cabeçote.
    pub fn head_y(&self) -> i32 {
        self.head.1
    }
}
