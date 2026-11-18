import type { NextConfig } from "next";
import path from "node:path";

// O WASM é compilado com threads (rayon + memória compartilhada), que só funciona em páginas
// "cross-origin isolated": sem estes cabeçalhos o navegador não expõe SharedArrayBuffer e o WASM
// não carrega. Com `require-corp`, a página só pode embutir recursos de outra origem que permitam
// isso (CORP/CORS); por isso o Sudoku Minado, que não usa WASM e tem um iframe do YouTube, fica de fora.
const ISOLAMENTO = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // O servidor de desenvolvimento também é acessado pelo domínio (via nginx-proxy)
  allowedDevOrigins: ["erick.fslab.dev"],
  // O indicador do modo dev fica em cima da barra de navegação do celular
  devIndicators: false,
  async headers() {
    return [
      { source: "/", headers: ISOLAMENTO },
      // Todas as rotas (inclusive /_next/static, de onde vêm os workers e o .wasm), menos o Sudoku Minado
      { source: "/:path((?!toy/sudoku-minado(?:/|$)).+)", headers: ISOLAMENTO },
    ];
  },
  webpack(config, { isServer, webpack }) {
    // https://github.com/mpadge/wasm-next/blob/main/next.config.js
    // Use the client static directory in the server bundle and prod mode
    // Fixes `Error occurred prerendering page "/"`
    // config.output.webassemblyModuleFilename =
    //   isServer && !dev
    //     ? '../static/pkg/[modulehash].wasm'
    //     : 'static/pkg/[modulehash].wasm'

    // Since Webpack 5 doesn't enable WebAssembly by default, we should do it manually
    config.experiments = { ...config.experiments, asyncWebAssembly: true }

    // No servidor, troca o worker auxiliar do wasm-bindgen-rayon (que usa `self` ao ser importado)
    // por um substituto vazio; detalhes em src/lib/wasmRayonServidor.js.
    if (isServer) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /wasm-bindgen-rayon-[^/\\]+[/\\]src[/\\]workerHelpers\.js$/,
        path.resolve(__dirname, "src/lib/wasmRayonServidor.js"),
      ));
    }

    // https://nextjs.org/docs/app/building-your-application/optimizing/memory-usage#disable-webpack-cache
    // This just stops building altogether:
    // if (config.cache && !dev) {
    //     config.cache = Object.freeze({
    //         type: 'memory',
    //     })
    // }

    // Deubbing (vercel/next.js/issues/27650)
    //config.infrastructureLogging = { debug: /PackFileCache/ }

    return config
  },
};

export default nextConfig;
