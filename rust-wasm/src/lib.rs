use rustc_hash::FxHashMap;
use std::collections::VecDeque;
use wasm_bindgen::prelude::*;
mod utils;
mod framebuffer;
pub use framebuffer::{Color};

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
    /// Cores pré-geradas para cada símbolo do alfabeto, na mesma ordem. Índice corresponde ao `symbol_idx`.
    alphabet_colors: Vec<Color>,
    /// Índice pré-computado de `CHAR_WILDCARD` no alfabeto, ou `None` se o programa
    /// não define nenhuma transição com símbolo wildcard.
    wildcard_sym_idx: Option<usize>,
}

impl TransitionTable {
    fn new(program: &[i32], input_data: Option<&[i32]>) -> Self {
        // Primeira passagem: descobre o estado máximo e os símbolos usados como condição.
        let mut max_state: usize = 0;
        // BTreeSet mantém os símbolos ordenados — alfabeto contíguo na memória.
        let mut alphabet_set: std::collections::BTreeSet<i32> = std::collections::BTreeSet::new();

        for chunk in program.chunks_exact(5) {
            let state = chunk[0];
            let symbol_read = chunk[1]; // condição de leitura
            let symbol_write = chunk[2]; // valor a ser escrito na fita
            if state >= 0 {
                max_state = max_state.max(state as usize);
            }
            alphabet_set.insert(symbol_read);
            alphabet_set.insert(symbol_write);
        }
        for chunk in input_data.unwrap_or(&[]).chunks_exact(3) {
            let symbol = chunk[2]; // valor a ser lido na fita
            alphabet_set.insert(symbol);
        }

        let alphabet: Vec<i32> = alphabet_set.into_iter().collect(); // já ordenado
        let stride = alphabet.len().max(1);
        let num_states = max_state + 1;
        let wildcard_sym_idx = alphabet.binary_search(&CHAR_WILDCARD).ok();

        let alphabet_colors: Vec<Color> = alphabet.iter().map(|&sym| gen_symbol_color(sym)).collect();

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
            alphabet_colors,
            wildcard_sym_idx,
        }
    }

    /// Mapeia um codepoint para seu índice no alfabeto.
    #[inline(always)]
    fn symbol_to_idx(&self, sym: i32) -> Option<usize> {
        self.alphabet.binary_search(&sym).ok()
    }

    #[inline(always)]
    fn symbol_to_color(&self, sym: i32) -> Option<Color> {
        self.symbol_to_idx(sym).map(|idx| self.alphabet_colors[idx])
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

/// Retorna `true` se o programa contiver apenas movimentos horizontais (Left/Right/None),
/// portanto pode ser executado sobre uma fita 1D linear.
fn program_is_1d(program: &[i32]) -> bool {
    program
        .chunks_exact(5)
        .all(|chunk| !matches!(Direction::from(chunk[3]), Direction::Up | Direction::Down))
}

/// Fita da máquina de Turing.
///
/// A variante é escolhida **uma única vez** na construção com base no programa e nunca muda:
/// - [`Tape::Linear`] para programas 1D (apenas Left/Right): `VecDeque` contíguo com
///   extensão lazy nos dois extremos — acesso O(1) e excelente cache locality.
/// - [`Tape::Sparse`] para programas 2D: `FxHashMap` esparso, igual à implementação anterior.
enum Tape {
    /// Fita 1D. `origin` é a coordenada x da célula armazenada em `cells[0]`.
    Linear {
        cells: VecDeque<i32>,
        /// Coordenada x correspondente a `cells[0]`.
        origin: i32,
        default_value: i32,
    },
    /// Fita 2D esparsa: chave = (x, y) compactados em i64, valor = codepoint Unicode.
    Sparse {
        cells: FxHashMap<i64, i32>,
        default_value: i32,
    },
}

impl Tape {
    fn new_linear(default_value: i32) -> Self {
        Tape::Linear { cells: VecDeque::new(), origin: 0, default_value }
    }

    fn new_sparse(default_value: i32) -> Self {
        Tape::Sparse { cells: FxHashMap::default(), default_value }
    }

    #[inline(always)]
    fn default_value(&self) -> i32 {
        match self {
            Tape::Linear { default_value, .. } | Tape::Sparse { default_value, .. } => *default_value,
        }
    }

    /// Lê a célula em (x, y). Retorna `default_value` para células nunca escritas.
    #[inline(always)]
    fn get(&self, x: i32, y: i32) -> i32 {
        match self {
            Tape::Linear { cells, origin, default_value } => {
                let idx = x.wrapping_sub(*origin);
                if idx >= 0 && (idx as usize) < cells.len() {
                    cells[idx as usize]
                } else {
                    *default_value
                }
            }
            Tape::Sparse { cells, default_value } => {
                *cells.get(&pack(x, y)).unwrap_or(default_value)
            }
        }
    }

    /// Escreve `value` na célula (x, y), estendendo o deque se necessário.
    #[inline(always)]
    fn set(&mut self, x: i32, y: i32, value: i32) {
        match self {
            Tape::Linear { cells, origin, default_value } => {
                let idx = x.wrapping_sub(*origin);
                if idx < 0 {
                    // Estende à esquerda: insere (-idx) elementos no início.
                    let extend = (-idx) as usize;
                    cells.reserve(extend);
                    for _ in 0..extend {
                        cells.push_front(*default_value);
                    }
                    *origin = x;
                    cells[0] = value;
                } else {
                    let idx = idx as usize;
                    if idx >= cells.len() {
                        // Estende à direita preenchendo com default_value.
                        cells.resize(idx + 1, *default_value);
                    }
                    cells[idx] = value;
                }
            }
            Tape::Sparse { cells, .. } => {
                cells.insert(pack(x, y), value);
            }
        }
    }

    fn initialize_tape(input_data: &[i32], head: (i32, i32), default_value: i32, is_1d: bool) -> (Tape, TapeBounds) {
        let mut tape = if is_1d {
            Tape::new_linear(default_value)
        } else {
            Tape::new_sparse(default_value)
        };
        let mut bounds = TapeBounds::new(head.0, head.1);
        for chunk in input_data.chunks_exact(3) {
            let x = chunk[0];
            let y = chunk[1];
            let value = chunk[2];
            tape.set(x, y, value);
            bounds.expand(x, y);
        }
        (tape, bounds)
    }
}

#[inline(always)]
fn gen_symbol_color(symbol_code: i32) -> Color {
    match symbol_code {
        0 => return Color::rgba(255, 255, 255, 0), // transparente para símbolo vazio
        48 => return Color::rgba(240, 240, 240, 255), // '0'
        49 => return Color::rgba(50, 255, 50, 255), // '1'
        50 => return Color::rgba(50, 50, 255, 255), // '2'
        51 => return Color::rgba(255, 50, 50, 255), // '3'
        52 => return Color::rgba(255, 255, 50, 255), // '4'
        53 => return Color::rgba(255, 50, 255, 255), // '5'
        54 => return Color::rgba(50, 255, 255, 255), // '6'
        55 => return Color::rgba(255, 128, 0, 255), // '7'
        56 => return Color::rgba(128, 0, 255, 255), // '8'
        57 => return Color::rgba(0, 255, 128, 255), // '9'
        _ => {
            // para outros símbolos, gera uma cor baseada no código unicode
            let hue = (symbol_code.wrapping_mul(71)) % 360; // usando um número primo para distribuir as cores
            let sat = (symbol_code.wrapping_mul(149)) % 50 + 50; // saturação entre 50% e 100%
            let light = (symbol_code.wrapping_mul(163)) % 30 + 40; // luminosidade entre 40% e 70%
            return Color::from_hsl(hue as f32, sat as f32 / 100.0, light as f32 / 100.0)
        }
    }
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

    /// Retorna a intersecção entre os bounds da fita e a viewport `[offset, offset+size)`,
    /// ou `None` se a intersecção for vazia (nada a renderizar).
    #[inline]
    fn clip_to_viewport(self, offset_left: i32, offset_top: i32, width: i32, height: i32)
        -> Option<(i32, i32, i32, i32)>
    {
        let min_x = self.min_x.max(offset_left);
        let max_x = self.max_x.min(offset_left + width - 1);
        let min_y = self.min_y.max(offset_top);
        let max_y = self.max_y.min(offset_top + height - 1);
        if min_x > max_x || min_y > max_y { 
            None 
        } else { 
            Some((min_x, max_x, min_y, max_y)) 
        }
    }
}

/// Máquina de Turing 2D com fita esparsa (2D) ou linear (1D).
#[wasm_bindgen]
pub struct TuringMachine2D {
    /// Fita da máquina: Linear para programas 1D, Sparse para 2D.
    /// A variante é fixada na construção e não muda durante a execução.
    tape: Tape,
    tape_bounds: TapeBounds,
    head: (i32, i32),
    current_state: i32, // valor negativo = halt, 0 = wildcard, 1..N = estados normais
    step_count: u64,

    input_data: Option<Vec<i32>>,
    transitions: TransitionTable,
}

#[wasm_bindgen]
impl TuringMachine2D {
    /// Cria uma nova máquina.
    #[wasm_bindgen(constructor)]
    pub fn new(program: Vec<i32>, input_data: Option<Vec<i32>>, start_x: i32, start_y: i32, start_state: i32, default_value: i32) -> Self {
        if !program.len().is_multiple_of(5) {
            panic!("Programa deve ser múltiplo de 5 (state, read, write, dir, next)");
        }

        let is_1d = program_is_1d(&program);

        // Preenche a fita com os dados de input
        let (tape, tape_bounds) = Tape::initialize_tape(
            input_data.as_deref().unwrap_or(&[]),
            (start_x, start_y),
            default_value,
            is_1d,
        );
        let transitions = TransitionTable::new(&program, input_data.as_deref());

        Self {
            tape,
            tape_bounds,
            head: (start_x, start_y),
            current_state: start_state,
            step_count: 0,
            input_data,
            transitions,
        }
    }

    pub fn reset(&mut self, start_x: i32, start_y: i32, start_state: i32) {
        self.head = (start_x, start_y);
        self.current_state = start_state;
        self.step_count = 0;

        let is_1d = matches!(self.tape, Tape::Linear { .. });
        let default_value = self.tape.default_value();
        let (tape, tape_bounds) = Tape::initialize_tape(
            self.input_data.as_deref().unwrap_or(&[]),
            (start_x, start_y),
            default_value,
            is_1d,
        );
        self.tape = tape;
        self.tape_bounds = tape_bounds;
    }

    /// Executa um único ciclo. Retorna `true` se continua ou `false` em Halt.
    fn step(&mut self) -> TuringMachineResult {
        if self.current_state < 0 {
            return TuringMachineResult::Halt;
        }

        // Lê o char sob o cabeçote (células nunca escritas retornam default_value).
        let read_char = self.tape.get(self.head.0, self.head.1);

        // Lookup O(1) na tabela plana: índice direto com fallback para wildcards.
        let Some(instr) = self.transitions.get(self.current_state, read_char) else {
            return TuringMachineResult::TransitionNotFound;
        };

        // 1. Escreve na fita
        if instr.write != CHAR_WILDCARD {
            self.tape.set(self.head.0, self.head.1, instr.write);
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
        
        let Some((min_x, max_x, min_y, max_y)) =
            self.tape_bounds.clip_to_viewport(offset_left, offset_top, width, height)
        else { return };

        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let idx = ((y - offset_top) * width + (x - offset_left)) as usize; 
                data[idx] = self.tape.get(x, y);
            }
        }
    }

    /// Aqui irá preencher cada célula com uma cor
    pub fn update_colorbuffer(&self, data: &mut [u8], offset_left: i32, offset_top: i32, width: i32, height: i32, canvas_width: i32, canvas_height: i32) {
        let expected = (canvas_width * canvas_height * 4) as usize; // RGBA
        if data.len() < expected {
            return; // buffer insuficiente – caller deve realocar antes de chamar novamente
        }

        let Some((min_x, max_x, min_y, max_y)) =
            self.tape_bounds.clip_to_viewport(offset_left, offset_top, width, height)
        else { return };

        let default_color = Color::rgba(255, 255, 255, 0);
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let cell = self.tape.get(x, y);
                let color = self.transitions.symbol_to_color(cell).unwrap_or(default_color);
                let idx = (((y - offset_top) * canvas_width + (x - offset_left)) * 4) as usize;
                data[idx] = color.r;
                data[idx + 1] = color.g;
                data[idx + 2] = color.b;
                data[idx + 3] = color.a;
            }
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
