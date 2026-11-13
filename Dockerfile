# ---------- Stage 1: compila o módulo Rust -> WebAssembly ----------
FROM rust:1-bookworm AS wasm

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl -sSfL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
# Threads no WASM (rayon) exigem recompilar a std com atomics, o que só o nightly faz
# (-Z build-std). Usa o nightly mais recente disponível no momento do build.
RUN rustup toolchain install nightly --profile minimal \
        --component rust-src --target wasm32-unknown-unknown

WORKDIR /build
COPY rust-wasm ./rust-wasm
# Mesmo comando do buildWasm.sh: gera os artefatos em /build/src/pkg.
# As flags de atomics/memória compartilhada estão em rust-wasm/.cargo/config.toml.
RUN cd rust-wasm && rustup run nightly wasm-pack build . --release --target web --out-dir ../src/pkg \
        -- -Z build-std=panic_abort,std

# ---------- Stage 2: dependências Node ----------
FROM node:26-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Stage 3: build do Next.js ----------
FROM node:26-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Artefatos WASM (src/pkg é gitignored, vem do stage 1)
COPY --from=wasm /build/src/pkg ./src/pkg
RUN npm run build

# ---------- Stage 4: dependências de produção apenas ----------
FROM node:26-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- Stage 5: runtime ----------
FROM node:26-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

USER nextjs
EXPOSE 3000
CMD ["npx", "next", "start"]
