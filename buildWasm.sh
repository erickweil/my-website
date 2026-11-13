#!/bin/bash
set -e

cd rust-wasm
# Install wasm-pack if it's not already installed
if ! command -v wasm-pack &> /dev/null; then
    echo "wasm-pack could not be found, installing..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi
# Threads (rayon) exigem o nightly com rust-src e -Z build-std; as flags de atomics estão em
# .cargo/config.toml. O Dockerfile faz o mesmo.
rustup toolchain install nightly --profile minimal --component rust-src --target wasm32-unknown-unknown
rustup run nightly wasm-pack build . --release --target web --out-dir ../src/pkg -- -Z build-std=panic_abort,std

# List the generated files
echo "Generated WebAssembly files:"
ls -lhas ../src/pkg/
