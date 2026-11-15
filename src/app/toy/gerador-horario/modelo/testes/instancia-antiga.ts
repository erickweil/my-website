/** Só para testes: lê uma instância do solver (rust-wasm/tests/instancias/*.json). */

import { readFileSync } from "node:fs";
import type { FormularioHorario } from "../../horario-regras.ts";
import { extrairFormularioAntigo, projetoDoFormatoAntigo } from "../formato-antigo.ts";

const RAIZ = new URL("../../../../../../rust-wasm/tests/instancias/", import.meta.url);

export function lerInstanciaAntiga(nome: string): FormularioHorario {
    return extrairFormularioAntigo(JSON.parse(readFileSync(new URL(`${nome}.json`, RAIZ), "utf8")))!.formulario;
}

export const projetoDaInstanciaAntiga = (f: FormularioHorario) => projetoDoFormatoAntigo(f, "instância");
