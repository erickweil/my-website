use wasm_bindgen::prelude::*;
mod utils;
mod framebuffer;
mod random;

pub mod turing;
pub mod genetic;
pub mod horario;
pub mod pencilmark;
pub mod bitflag;
pub mod threads_teste;

// `initThreadPool(n)` no JS: cria o pool do rayon com n Web Workers. Precisa ser chamado (e
// aguardado) depois do `init()` do módulo e antes de qualquer código que use rayon.
#[cfg(target_arch = "wasm32")]
pub use wasm_bindgen_rayon::init_thread_pool;

// https://oneuptime.com/blog/post/2026-02-01-rust-webassembly-wasm/view
// Call this once when your module loads
#[wasm_bindgen(start)]
pub fn wasm_main() {
    utils::set_panic_hook();

    console_log!("WASM: Inicializado!");
}
