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

impl From<i32> for Direction {
    #[inline]
    fn from(value: i32) -> Self {
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
    /// Próximo estado, 0 para manter o estado atual, valor negativo para Halt.
    /// Sentinel i32::MIN indica slot vazio na tabela.
    next: i32,
}

impl ProgramInstruction {
    /// Slot vazio — sentinela que marca "sem transição aqui".
    const EMPTY: Self = Self {
        write: 0,
        dir: Direction::None,
        next: i32::MIN,
    };

    #[inline(always)]
    fn is_valid(self) -> bool {
        self.next != i32::MIN
    }
}

// Constante do wildcard
const CHAR_WILDCARD: i32 = -1;
const STATE_WILDCARD: usize = 0; // estado 0 é reservado para wildcard

/// Tabela de transições usando Vec contíguo, sem hash em tempo de execução.
///
/// Layout: `data[state_idx * stride + symbol_idx]`
///
/// - `state_idx` é o valor inteiro do estado (0 = wildcard, 1..N = normais).
/// - `symbol_idx` é a posição do codepoint no alfabeto ordenado `alphabet`.
///
/// O mapeamento codepoint → índice usa busca binária no alfabeto (tipicamente < 16
/// símbolos), o que é mais rápido que qualquer hash nessa escala.
struct TransitionTable {
    /// Vec plano de instruções. Slot vazio ↔ `instr.next == i32::MIN`.
    data: Vec<ProgramInstruction>,
    /// Número de símbolos no alfabeto (= largura de uma linha da tabela).
    stride: usize,
    /// Número de linhas (estados, incluindo o wildcard na linha 0).
    num_states: usize,
    /// Alfabeto ordenado de codepoints usados no programa (inclui wildcards se presentes).
    alphabet: Vec<i32>,
    /// Índice pré-computado de `CHAR_WILDCARD` no alfabeto, ou `None` se o programa
    /// não define nenhuma transição com símbolo wildcard.
    wildcard_sym_idx: Option<usize>,
}

impl TransitionTable {
    fn new(program: &[i32]) -> Self {
        // Primeira passagem: descobre o estado máximo e os símbolos usados como condição.
        let mut max_state: usize = 0;
        // BTreeSet mantém os símbolos ordenados — alfabeto contíguo na memória.
        let mut alphabet_set: std::collections::BTreeSet<i32> = std::collections::BTreeSet::new();

        for chunk in program.chunks_exact(5) {
            let state = chunk[0];
            let symbol = chunk[1]; // condição de leitura
            if state >= 0 {
                max_state = max_state.max(state as usize);
            }
            alphabet_set.insert(symbol);
        }

        let alphabet: Vec<i32> = alphabet_set.into_iter().collect(); // já ordenado
        let stride = alphabet.len().max(1);
        let num_states = max_state + 1;
        let wildcard_sym_idx = alphabet.binary_search(&CHAR_WILDCARD).ok();

        let mut data = vec![ProgramInstruction::EMPTY; num_states * stride];

        for chunk in program.chunks_exact(5) {
            let state = chunk[0];
            let symbol = chunk[1];
            // Estados negativos são de Halt — nunca são origem de transição.
            if state < 0 {
                continue;
            }
            let state_idx = state as usize;
            // Busca binária: O(log k), k = tamanho do alfabeto (tipicamente < 16).
            let sym_idx = match alphabet.binary_search(&symbol) {
                Ok(i) => i,
                Err(_) => continue,
            };
            data[state_idx * stride + sym_idx] = ProgramInstruction {
                write: chunk[2],
                dir: Direction::from(chunk[3]),
                next: chunk[4],
            };
        }

        Self {
            data,
            stride,
            num_states,
            alphabet,
            wildcard_sym_idx,
        }
    }

    /// Mapeia um codepoint para seu índice no alfabeto.
    #[inline(always)]
    fn symbol_to_idx(&self, sym: i32) -> Option<usize> {
        self.alphabet.binary_search(&sym).ok()
    }

    /// Lookup com fallback para wildcards, na ordem de prioridade:
    /// (state, sym) → (state, *) → (*, sym) → (*, *)
    #[inline(always)]
    fn get(&self, state: i32, sym: i32) -> Option<ProgramInstruction> {
        debug_assert!(state >= 0);
        let state_idx = state as usize;
        // Estado desconhecido (bug no programa) — evita panic em release.
        if state_idx >= self.num_states {
            return None;
        }

        let base = state_idx * self.stride;
        let sym_idx = self.symbol_to_idx(sym);

        // 1. (estado exato, símbolo exato)
        if let Some(si) = sym_idx {
            let instr = self.data[base + si];
            if instr.is_valid() {
                return Some(instr);
            }
        }
        // 2. (estado exato, símbolo wildcard)
        if let Some(wi) = self.wildcard_sym_idx {
            let instr = self.data[base + wi];
            if instr.is_valid() {
                return Some(instr);
            }
        }
        // 3. (estado wildcard, símbolo exato)
        if let Some(si) = sym_idx {
            let instr = self.data[STATE_WILDCARD * self.stride + si];
            if instr.is_valid() {
                return Some(instr);
            }
        }
        // 4. (estado wildcard, símbolo wildcard)
        if let Some(wi) = self.wildcard_sym_idx {
            let instr = self.data[STATE_WILDCARD * self.stride + wi];
            if instr.is_valid() {
                return Some(instr);
            }
        }

        None
    }
}

/// Compacta dois i32 em um i64 para uso como chave de HashMap (fita esparsa).
/// Usa o bit de sinal de `b` corretamente via cast para u32 antes de alargar.
#[inline(always)]
fn pack(a: i32, b: i32) -> i64 {
    ((a as i64) << 32) | (b as u32 as i64)
}

/// Limites conhecidos da fita — mantidos em sync com as escritas para permitir
/// renderização eficiente sem varrer todo o HashMap.
#[derive(Clone, Copy)]
struct TapeBounds {
    min_x: i32,
    max_x: i32,
    min_y: i32,
    max_y: i32,
}

impl TapeBounds {
    #[inline]
    fn new(x: i32, y: i32) -> Self {
        Self { min_x: x, max_x: x, min_y: y, max_y: y }
    }

    #[inline]
    fn expand(&mut self, x: i32, y: i32) {
        if x < self.min_x { self.min_x = x; }
        if x > self.max_x { self.max_x = x; }
        if y < self.min_y { self.min_y = y; }
        if y > self.max_y { self.max_y = y; }
    }

    #[inline]
    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.min_x && x <= self.max_x && y >= self.min_y && y <= self.max_y
    }
}

/// Máquina de Turing 2D com fita esparsa.
#[wasm_bindgen]
pub struct TuringMachine2D {
    /// Fita esparsa: chave = (x, y) compactados em i64, valor = unicode char
    tape: FxHashMap<i64, i32>,
    tape_bounds: TapeBounds,
    /// Valor que será lido em células nunca escritas (pode ser usado para simular uma fita infinita pré-carregada)
    default_value: i32,
    head: (i32, i32),
    current_state: i32, // valor negativo = halt, 0 = wildcard, 1..N = estados normais
    step_count: u64,
    transitions: TransitionTable,
}

#[wasm_bindgen]
impl TuringMachine2D {
    /// Cria uma nova máquina.
    #[wasm_bindgen(constructor)]
    pub fn new(program: Vec<i32>, start_x: i32, start_y: i32, start_state: i32, default_value: i32) -> Self {
        if !program.len().is_multiple_of(5) {
            panic!("Programa deve ser múltiplo de 5 (state, read, write, dir, next)");
        }

        let transitions = TransitionTable::new(&program);

        Self {
            tape: FxHashMap::default(),
            tape_bounds: TapeBounds::new(start_x, start_y),
            default_value,
            head: (start_x, start_y),
            current_state: start_state,
            step_count: 0,
            transitions,
        }
    }

    pub fn reset(&mut self, start_x: i32, start_y: i32, start_state: i32) {
        self.tape.clear();
        self.tape_bounds = TapeBounds::new(start_x, start_y);
        self.head = (start_x, start_y);
        self.current_state = start_state;
        self.step_count = 0;
    }

    /// Executa um único ciclo. Retorna `true` se continua ou `false` em Halt.
    fn step(&mut self) -> TuringMachineResult {
        if self.current_state < 0 {
            return TuringMachineResult::Halt;
        }

        // Lê o char sob o cabeçote (fita esparsa; células nunca escritas retornam default_value).
        let head_key = pack(self.head.0, self.head.1);
        let read_char = *self.tape.get(&head_key).unwrap_or(&self.default_value);

        // Lookup O(1) na tabela plana: índice direto com fallback para wildcards.
        let Some(instr) = self.transitions.get(self.current_state, read_char) else {
            return TuringMachineResult::TransitionNotFound;
        };

        // 1. Escreve na fita
        if instr.write != CHAR_WILDCARD {
            self.tape.insert(head_key, instr.write);
        }

        // 2. Move o cabeçote
        match instr.dir {
            Direction::Left  => self.head.0 -= 1,
            Direction::Right => self.head.0 += 1,
            Direction::Up    => self.head.1 -= 1,
            Direction::Down  => self.head.1 += 1,
            Direction::None  => {}
        }
        if instr.dir != Direction::None {
            self.tape_bounds.expand(self.head.0, self.head.1);
        }

        // 3. Atualiza o estado (STATE_WILDCARD = 0 = "manter estado atual")
        if instr.next != STATE_WILDCARD as i32 {
            self.current_state = instr.next;
        }
        self.step_count += 1;

        TuringMachineResult::Continue
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
        result[0] = self.tape_bounds.min_x;
        result[1] = self.tape_bounds.max_x;
        result[2] = self.tape_bounds.min_y;
        result[3] = self.tape_bounds.max_y;
    }

    /// Recebe um um TypedArray do JavaScript e preenche com a fita esparsa. Cada célula é um caractere Unicode
    /// A área a ser preenchida é definida por `offsetLeft`, `offsetTop`, `width` e `height`
    pub fn update_framebuffer(&self, data: &mut [i32], offset_left: i32, offset_top: i32, width: i32, height: i32) {
        let expected = (width * height) as usize;
        if data.len() < expected {
            return; // buffer insuficiente – caller deve realocar antes de chamar novamente
        }
        // Percorre cada posição da janela e consulta a fita esparsa.
        let bounds = self.tape_bounds;
        for y in 0..height {
            for x in 0..width {
                let tape_x = x + offset_left;
                let tape_y = y + offset_top;
                let cell = if bounds.contains(tape_x, tape_y) {
                    *self.tape.get(&pack(tape_x, tape_y)).unwrap_or(&0)
                } else {
                    0
                };
                data[(y * width + x) as usize] = cell;
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
            self.tape_bounds.expand(pos.0, pos.1);
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
