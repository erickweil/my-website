# my-website

Portfólio pessoal com utilitários, experimentos e simulações de computação — feitos para explorar conceitos de CS de forma interativa.

🌐 **Online em:** [liewkcire.vercel.app](https://liewkcire.vercel.app/)

---

## Projetos

| Projeto | Status |
|---|---|
| 💣 Sudoku Minado | ✅ Finalizado |
| 📅 Gerador de Horário Escolar | 🚧 MVP, Experimento. |
| ⚙️ Simulador de Máquina de Turing | ✅ Finalizado |
| 🧬 Algoritmos Genéticos | 🚧 Em construção |

---

## Stack

- **Framework:** [Next.js](https://nextjs.org/)
- **UI:** [shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS](https://tailwindcss.com/)
- **WASM:** Rust + [wasm-pack](https://rustwasm.github.io/wasm-pack/)
- **Deploy:** [Vercel](https://vercel.com/)

---

## Executando localmente

### Pré-requisitos

- [Node.js](https://github.com/nvm-sh/nvm#installing-and-updating) (recomendado via `nvm`)
- [Rust](https://rustup.rs/)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

### Passos

```bash
# 1. Clone o repositório
git clone https://github.com/erickweil/my-website.git
cd my-website

# 2. Instale as dependências Node
npm install

# 3. Compile o módulo WebAssembly (Rust → WASM)
npm run build:turing-wasm

# 4. Inicie o servidor de desenvolvimento
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

---

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE) para mais detalhes.
