/** Só para testes: o quadro real de faculdade (anonimizado) no formato da versão anterior, e a mesma instância como entrada do solver. */

import { readFileSync } from "node:fs";
import type { EntradaDoSolver } from "../../horario-regras.ts";
import { extrairFormularioAntigo, projetoDoFormatoAntigo, type FormularioAntigo } from "../formato-antigo.ts";

const ler = (url: URL) => JSON.parse(readFileSync(url, "utf8"));

export const lerFaculdadeNoFormatoAntigo = (): FormularioAntigo =>
    extrairFormularioAntigo(ler(new URL("./faculdade-formato-antigo.json", import.meta.url)))!.formulario;

/** A instância que os testes e benchmarks do Rust usam (rust-wasm/tests/instancias). */
export const lerInstanciaDoSolver = (nome: string): EntradaDoSolver =>
    ler(new URL(`../../../../../../rust-wasm/tests/instancias/${nome}.json`, import.meta.url));

export const projetoDaFaculdade = () => projetoDoFormatoAntigo(lerFaculdadeNoFormatoAntigo(), "instância");
