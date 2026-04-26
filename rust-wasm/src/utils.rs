use wasm_bindgen::prelude::*;
use console_error_panic_hook;

// You can also log to the browser console directly
#[wasm_bindgen]
extern "C" {
    pub fn alert(s: &str);

    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
    
    #[wasm_bindgen(js_namespace = console)]
    pub fn error(s: &str);
}

// A helper macro for console logging from Rust
#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => (crate::utils::log(&format_args!($($t)*).to_string()))
}

pub fn set_panic_hook() {
    // When the `console_error_panic_hook` feature is enabled, we can call the
    // `set_panic_hook` function at least once during initialization, and then
    // we will get better error messages if our code ever panics.
    //
    // For more details see
    // https://github.com/rustwasm/console_error_panic_hook#readme
    console_error_panic_hook::set_once();
}

// https://oneuptime.com/blog/post/2026-02-01-rust-webassembly-wasm/view
// Call this once when your module loads
#[wasm_bindgen(start)]
pub fn main() {
    set_panic_hook();
    console_log!("WASM: Inicializado!");
}