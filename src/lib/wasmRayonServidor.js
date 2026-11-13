// Substituto do `workerHelpers.js` do wasm-bindgen-rayon no build do SERVIDOR (ver next.config.ts).
//
// O original executa `self.addEventListener(...)` assim que é importado, e `self` não existe no
// Node: o pré-render das páginas que importam o WASM quebrava com "self is not defined". O servidor
// nunca executa o WASM (só gera o HTML), então basta um módulo com a mesma exportação.
export async function startWorkers() {
    throw new Error("O pool de threads do WASM só existe no navegador.");
}
