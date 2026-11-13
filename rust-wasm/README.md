https://surma.dev/things/rust-to-webassembly/


medium.com/@annasaaddev/building-a-next-js-app-that-runs-entirely-on-webassembly-wasm-9e40e917789d
https://oneuptime.com/blog/post/2026-02-01-rust-webassembly-wasm/view


https://news.ycombinator.com/item?id=47295837
https://notes.brooklynzelenka.com/Blog/Notes-on-Writing-Wasm

- Rodar os testes em modo release
```bash
cd rust-wasm
cargo test --release -- --nocapture
```
- Benchmark nativo dos solvers de horário (sem browser, mesma config dos workers WASM)
```bash
cd rust-wasm
cargo run --release --example bench_horario -- tests/instancias/media.json --segundos 10 --runs 3
cargo run --release --example bench_horario -- tests/instancias/faculdade-anonimizado.json --solver pencilmark
# opções: --seed N, --pop-mult N, --csv curva.csv, --solver ga|pencilmark, --base-iter N|none
```

As instâncias em `tests/instancias/` são geradas por `node tests/instancias/gerar.mjs` (determinístico).
Cada instância viável tem um `<nome>.solucao.json` com a solução usada para construí-la; o benchmark
confere que ela tem fitness 0 antes de rodar. `inviavel.json` não admite solução por construção.
`faculdade-anonimizado.json` é um quadro real com os nomes trocados (o original, `real*.json`, fica fora do git).
