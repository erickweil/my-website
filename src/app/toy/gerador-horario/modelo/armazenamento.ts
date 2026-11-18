/**
 * Leitura e gravação da área de trabalho (cadastros e projetos), sempre validada pelo esquema.
 * Por enquanto os dados ficam só no `localStorage` do navegador.
 */

import { z } from "zod";
import { divisaoDoFormatoV2 } from "./divisao.ts";
import { VERSAO, areaDeTrabalhoVazia, esquemaAreaDeTrabalho, type AreaDeTrabalho } from "./modelo.ts";

export const CHAVE_AREA_DE_TRABALHO = "geradorHorario:areaDeTrabalho";

/** O mínimo de `Storage` que usamos, para os testes passarem um objeto simples. */
type Armazem = Pick<Storage, "getItem" | "setItem">;

export type Leitura =
    | { ok: true; area: AreaDeTrabalho }
    /** `erro` diz em que campo o conteúdo não bate com o esquema. */
    | { ok: false; erro: string };

/** Valida um JSON (do armazenamento ou de um arquivo importado); o formato anterior é convertido. */
export function lerAreaDeTrabalho(json: string): Leitura {
    let dados: unknown;
    try {
        dados = JSON.parse(json);
    } catch {
        return { ok: false, erro: "O conteúdo não é um JSON válido." };
    }
    const r = esquemaAreaDeTrabalho.safeParse(atualizarFormato(dados));
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

type Objeto = Record<string, unknown>;
const lista = (v: unknown): Objeto[] => (Array.isArray(v) ? v.filter((x): x is Objeto => typeof x === "object" && x !== null) : []);

/**
 * Converte o formato 2 para o atual: a `distribuicao` dos componentes e das ofertas (blocos de N,
 * emendando ou não) vira `divisao`. Outros conteúdos passam como estão, para o esquema dizer o
 * que há de errado.
 */
export function atualizarFormato(dados: unknown): unknown {
    const area = dados as Objeto | null;
    if (typeof area !== "object" || area === null || area.versao !== 2) return dados;
    const converter = (x: Objeto): Objeto => {
        if (!("distribuicao" in x)) return x;
        const { distribuicao, ...resto } = x;
        return { ...resto, divisao: divisaoDoFormatoV2(distribuicao) };
    };
    const cadastros = (area.cadastros ?? {}) as Objeto;
    return {
        ...area,
        versao: VERSAO,
        cadastros: {
            ...cadastros,
            cursos: lista(cadastros.cursos).map((c) => ({
                ...c,
                periodos: lista(c.periodos).map((p) => ({ ...p, componentes: lista(p.componentes).map(converter) })),
            })),
        },
        projetos: lista(area.projetos).map((p) => ({ ...p, ofertas: lista(p.ofertas).map(converter) })),
    };
}
