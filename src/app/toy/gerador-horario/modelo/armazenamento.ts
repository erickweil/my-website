/**
 * Leitura e gravação da área de trabalho (cadastros e projetos), sempre validada pelo esquema.
 * Por enquanto os dados ficam só no `localStorage` do navegador.
 */

import { z } from "zod";
import { areaDeTrabalhoVazia, esquemaAreaDeTrabalho, type AreaDeTrabalho } from "./modelo.ts";

export const CHAVE_AREA_DE_TRABALHO = "geradorHorario:areaDeTrabalho";

/** O mínimo de `Storage` que usamos, para os testes passarem um objeto simples. */
type Armazem = Pick<Storage, "getItem" | "setItem">;

export type Leitura =
    | { ok: true; area: AreaDeTrabalho }
    /** `erro` diz em que campo o conteúdo não bate com o esquema. */
    | { ok: false; erro: string };

/** Valida um JSON (do armazenamento ou de um arquivo importado). */
export function lerAreaDeTrabalho(json: string): Leitura {
    let dados: unknown;
    try {
        dados = JSON.parse(json);
    } catch {
        return { ok: false, erro: "O conteúdo não é um JSON válido." };
    }
    const r = esquemaAreaDeTrabalho.safeParse(dados);
    return r.success ? { ok: true, area: r.data } : { ok: false, erro: z.prettifyError(r.error) };
}

/** Área de trabalho salva; vazia se não há nada salvo. Conteúdo inválido devolve o erro, sem apagar nada. */
export function carregar(armazem: Armazem): Leitura {
    const json = armazem.getItem(CHAVE_AREA_DE_TRABALHO);
    return json === null ? { ok: true, area: areaDeTrabalhoVazia() } : lerAreaDeTrabalho(json);
}

export function salvar(armazem: Armazem, area: AreaDeTrabalho) {
    armazem.setItem(CHAVE_AREA_DE_TRABALHO, JSON.stringify(area));
}
