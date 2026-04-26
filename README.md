Olá seja bem vindo!

A proposta deste projeto é agregar em uma única página web diversos utilitários, experimentos, simulações, etc...

✅ Online em: https://liewkcire.vercel.app/

-- -

```
Em construção:
┌──────────────────────────────────────────────────┐
│█▍2%                                              │ 
└──────────────────────────────────────────────────┘
```

## Instruções para executar localmente:

1. Clone o repositório e entre na pasta do projeto
```bash
git clone https://github.com/erickweil/my-website.git
cd my-website
```

2. Instale as dependências necessárias
- Node.js  https://www.freecodecamp.org/news/node-version-manager-nvm-install-guide/
- Rust  https://rust-lang.org/tools/install/
- wasm-pack  https://www.npmjs.com/package/wasm-pack

3. Faça a instalação das dependências do projeto
- Dependências do Node.js
```bash
npm install
```
- Dependências do Rust
```bash
cd rust-wasm
cargo build
```

4. Compile o código rust e então inicie o servidor de desenvolvimento
```bash
npm run prebuild
npm run dev
```