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
- Benchmark nativo da busca local (tempo até um horário válido e qualidade no fim)
```bash
cd rust-wasm
cargo run --release --example bench_busca_local -- tests/instancias/grande.json --sementes 8
# de onde parte: --de quadro.json (um quadro pronto) ou --ga N (o melhor do genético depois de N segundos)
# opções: --segundos N, --lista N, --cadeias N, --classica (lista do late acceptance como no artigo)
```
- Benchmark nativo dos operadores e parâmetros do algoritmo genético (ver `estudos/ga/` e `docs/estudo-ga.md`)
```bash
cd rust-wasm
RUSTFLAGS="-C target-cpu=native" cargo run --release --example bench_operadores_horario -- tests/instancias/media.json --sementes 10 --orcamento 5 --ilhas 8 --variantes originais,padrao
# opções: --sementes N, --orcamento M (milhões de avaliações), --segundos S, --ilhas N, --variantes ..., --csv, --cabecalho
```
- Reproduzir fora do navegador um projeto da página (exporte a área de trabalho em "Projetos")
```bash
node rust-wasm/tests/instancias/de-projeto.mjs ~/Downloads/horarios.json rust-wasm/tests/instancias/real-tecnico.json
cd rust-wasm && cargo run --release --example bench_busca_local -- tests/instancias/real-tecnico.json
```

As instâncias em `tests/instancias/` estão no formato da entrada do solver (`EntradaHorario`: turmas,
aulas e recursos, ligados por id). As sintéticas são geradas por `node tests/instancias/gerar.mjs`
(determinístico); cada instância viável tem um `<nome>.solucao.json` com a solução usada para construí-la,
e o benchmark confere que ela tem fitness 0 antes de rodar. `inviavel.json` não admite solução por construção.
`faculdade-anonimizado.json` é um quadro real com os nomes trocados (o original, `real*.json`, fica fora do git).
