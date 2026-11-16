//! Saber se dá para usar o pool de threads do rayon.
//!
//! - Nativo (testes, benchmarks): o pool global do rayon está sempre disponível.
//! - WASM: as threads são Web Workers criados por `initThreadPool` (wasm-bindgen-rayon), que o JS
//!   precisa chamar e aguardar. Antes disso — ou na thread principal do navegador, que não pode
//!   bloquear esperando outras threads — o código paralelo deve rodar em sequência. O JS avisa que
//!   o pool está pronto chamando [`marcar_pool_de_threads_pronto`] no mesmo worker que vai usá-lo.

use std::sync::atomic::{AtomicBool, Ordering};
use wasm_bindgen::prelude::*;

static POOL_PRONTO: AtomicBool = AtomicBool::new(cfg!(not(target_arch = "wasm32")));

/// true se código com rayon pode ser chamado a partir daqui.
#[inline]
pub fn pool_disponivel() -> bool {
    POOL_PRONTO.load(Ordering::Relaxed)
}

/// Chamado pelo JS depois de `await initThreadPool(n)`.
#[wasm_bindgen]
pub fn marcar_pool_de_threads_pronto() {
    POOL_PRONTO.store(true, Ordering::Relaxed);
}
