use std::collections::HashMap;
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
    /// Codepoint Unicode a escrever, 0 para vazio
    write: i32,
    /// Direção de movimento do cabeçote
    dir: Direction,
    /// Próximo estado (-1 = halt explícito)
    next: i32,
}

/// Máquina de Turing 2D com fita esparsa.
#[wasm_bindgen]
pub struct TuringMachine2D {
    /// Fita esparsa: chave = (x, y), valor = unicode char
    tape: HashMap<(i32, i32), i32>,
    tape_bounds: (i32, i32, i32, i32), // (min_x, max_x, min_y, max_y) para otimização de renderização
    /// Valor que será lido em células nunca escritas (pode ser usado para simular uma fita infinita pré-carregada)
    default_value: i32,
    head: (i32, i32),
    current_state: i32, // -1 = halt, 0..N-1 = estados
    step_count: u32,
    transitions: HashMap<(i32, i32), ProgramInstruction>, // (state, read) -> instruction (write, dir, next)
}

#[wasm_bindgen]
impl TuringMachine2D {
    /// Cria uma nova máquina.
    #[wasm_bindgen(constructor)]
    pub fn new(program: Vec<i32>, start_x: i32, start_y: i32, start_state: i32, default_value: i32) -> Self {
        if program.len() % 5 != 0 {
            panic!("Programa deve ser múltiplo de 5 (state, read, write, dir, next)");
        }

        let mut transitions = HashMap::new();
        for chunk in program.chunks_exact(5) {
            transitions.insert(
                (
                    chunk[0], 
                    chunk[1]
                ), 
                ProgramInstruction { 
                    write: chunk[2], 
                    dir: Direction::from_i32(chunk[3]), 
                    next: chunk[4] 
                }
            );
        }

        Self {
            tape: HashMap::new(),
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

    /// Lê o char sob o cabeçote (0 se a célula estiver vazia).
    fn read(&self, pos: (i32, i32)) -> i32 {
        *self.tape.get(&pos).unwrap_or(&self.default_value)
    }

    /// Escreve um char na célula atual.
    fn write(&mut self, pos: (i32, i32), char: i32) {
        self.tape.insert(pos, char);
        // Atualiza os limites da fita
        if pos.0 < self.tape_bounds.0 { self.tape_bounds.0 = pos.0; }
        if pos.0 > self.tape_bounds.1 { self.tape_bounds.1 = pos.0; }
        if pos.1 < self.tape_bounds.2 { self.tape_bounds.2 = pos.1; }
        if pos.1 > self.tape_bounds.3 { self.tape_bounds.3 = pos.1; }
    }

    /// Executa um único ciclo. Retorna `true` se continua ou `false` em Halt.
    fn step(&mut self) -> TuringMachineResult {
        if self.current_state == -1 {
            return TuringMachineResult::Halt;
        }

        // Lê a transição para o estado atual e o char sob o cabeçote
        /*let instr = match self.transitions.get(&(self.current_state, self.read(self.head))).cloned() {
            Some(instr) => instr,
            // Se não encontrar uma transição específica para o char lido, tenta a transição wildcard (-1)
            None => match self.transitions.get(&(self.current_state, -1)).cloned() {
                Some(instr) => instr,
                None => return TuringMachineResult::TransitionNotFound,
            }
        };*/
        let read_char = self.read(self.head);
        let instr =     self.transitions.get(&(self.current_state, read_char))
            .or_else(|| self.transitions.get(&(self.current_state, -1)))   // Transição com read char *
            .or_else(|| self.transitions.get(&(-1, read_char))) // Transição com state *
            .or_else(|| self.transitions.get(&(-1, -1)))                   // Transição com state * e read char *
            .cloned();

        if let Some(instr) = instr {
            // 1. Escreve na fita (se instr.write == -1 precisa chamar para atualizar bounds)
            self.write(self.head, if instr.write == -1 { read_char } else { instr.write });

            // 2. Move o cabeçote
            match instr.dir {
                Direction::Left => self.head.0 -= 1,
                Direction::Right => self.head.0 += 1,
                Direction::Up => self.head.1 -= 1,
                Direction::Down => self.head.1 += 1,
                Direction::None => {}
            };

            // 3. Atualiza o estado
            self.current_state = instr.next;

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

    pub fn get_framebuffer_width(&self) -> i32 {
        self.tape_bounds.1 - self.tape_bounds.0 + 1        
    }
    pub fn get_framebuffer_height(&self) -> i32 {
        self.tape_bounds.3 - self.tape_bounds.2 + 1        
    }

    /// Recebe um um TypedArray do JavaScript e preenche com a fita esparsa. Cada célula é um caractere Unicode
    pub fn update_framebuffer(&self, data: &mut [i32], width: i32, height: i32) {
        data.fill(0); // Limpa o framebuffer
        for (&(x, y), &char) in &self.tape {
            let px = x - self.tape_bounds.0;
            let py = y - self.tape_bounds.2;
            if px >= width || py >= height || px < 0 || py < 0 {
                continue; // Ignora células fora dos limites do framebuffer
            }

            data[(py * width + px) as usize] = char;
        }
    }

    /// Pré-carrega células na fita.
    ///
    /// `data` é um array plano `[x0, y0, char, x1, y1, char, ...]`.
    pub fn preload_tape(&mut self, data: &[i32]) {
        for chunk in data.chunks_exact(3) {
            self.write((chunk[0], chunk[1]), chunk[2]);
        }
    }

    /// Conta quantas células contêm valores diferente de 0.
    pub fn count_ones(&self) -> u32 {
        self.tape.values().filter(|&&b| b != 0).count() as u32
    }

    pub fn get_step_count(&self) -> u32 {
        self.step_count
    }

    /// Retorna o estado atual.
    pub fn get_state(&self) -> i32 {
        self.current_state
    }

    /// Retorna a posição X do cabeçote.
    pub fn head_x(&self) -> i32 {
        self.head.0 - self.tape_bounds.0
    }

    /// Retorna a posição Y do cabeçote.
    pub fn head_y(&self) -> i32 {
        self.head.1 - self.tape_bounds.2
    }
}
