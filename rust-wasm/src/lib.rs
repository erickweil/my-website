use wasm_bindgen::prelude::*;
mod utils;
mod framebuffer;

pub mod turing;
pub mod genetic;

// https://oneuptime.com/blog/post/2026-02-01-rust-webassembly-wasm/view
// Call this once when your module loads
#[wasm_bindgen(start)]
pub fn wasm_main() {
    utils::set_panic_hook();

    console_log!("WASM: Inicializado!");
}
