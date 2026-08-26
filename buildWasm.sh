#!/bin/bash
set -e

cd rust-wasm
# Install wasm-pack if it's not already installed
if ! command -v wasm-pack &> /dev/null; then
    echo "wasm-pack could not be found, installing..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi
wasm-pack build --release --target web --out-dir ../src/pkg

# List the generated files
echo "Generated WebAssembly files:"
ls -lhas ../src/pkg/
