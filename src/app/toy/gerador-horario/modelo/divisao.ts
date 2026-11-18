/**
 * Divisão das aulas de uma disciplina em pedaços: um pedaço é um trecho de aulas seguidas da
 * disciplina num dia (duas aulas duplas coladas formam um pedaço de 4).
 *
 * O projeto guarda a divisão como o usuário a escolheu (livre, blocos de N ou regras
 * personalizadas). O solver recebe sempre as regras, no estilo das restrições do XHSTT
 * (`EntradaDivisao` em rust-wasm/src/horario/horario_divisao.rs):
 *
 * - tamanho de cada pedaço (mín. e máx.) e quantidade de pedaços na semana (mín. e máx.);
 * - por tamanho: quantos pedaços de um tamanho (mín. e máx.);
 * - espalhar: de preferência um pedaço por dia (regra de qualidade).
 */

import type { EntradaDivisao } from "../horario-regras.ts";
import type { Divisao } from "./modelo.ts";

/** Aulas de 2 em 2, podendo emendar duas duplas, e de preferência um pedaço por dia. */
export const DIVISAO_PADRAO: Divisao = { pedacos: { tipo: "blocos", tamanho: 2, emendar: true }, espalhar: true };

export const DIVISAO_LIVRE: Divisao = { pedacos: { tipo: "livre" }, espalhar: false };

/**
 * As regras da divisão para uma disciplina de `aulas` aulas.
 *
 * Blocos de N: pedaços de N aulas; o que sobra da divisão por N vira um pedaço menor (5 aulas em
 * blocos de 2 = 2+2+1). Emendando, dois ou mais blocos podem formar um pedaço só (4 = 2+2), mas o
 * pedaço que sobra continua separado.
 */
export function regrasDaDivisao(divisao: Divisao, aulas: number): EntradaDivisao {
    const espalhar = divisao.espalhar && aulas > 1;
    const p = divisao.pedacos;
    if (p.tipo === "livre" || aulas <= 1) return { espalhar };
    if (p.tipo === "regras") {
        return {
            tamanhoMin: p.tamanhoMin,
            ...(p.tamanhoMax !== null && { tamanhoMax: p.tamanhoMax }),
            quantidadeMin: p.quantidadeMin,
            ...(p.quantidadeMax !== null && { quantidadeMax: p.quantidadeMax }),
            porTamanho: p.porTamanho.map((x) => ({ ...x })),
            espalhar,
        };
    }
    const g = Math.min(p.tamanho, aulas);
    const resto = aulas % g;
    const tamanhoMin = resto > 0 ? resto : g;
    const tamanhoMax = p.emendar ? aulas : g;
    const porTamanho: NonNullable<EntradaDivisao["porTamanho"]> = [];
    for (let t = tamanhoMin; t <= tamanhoMax; t++) {
        if (t === resto) porTamanho.push({ tamanho: t, min: 1, max: 1 });
        else if (t % g !== 0) porTamanho.push({ tamanho: t, min: 0, max: 0 });
    }
    return { tamanhoMin, tamanhoMax, ...(porTamanho.length > 0 && { porTamanho }), espalhar };
}

/**
 * As divisões de `aulas` aulas que atendem às regras: tamanhos dos pedaços, do maior para o menor,
 * as maiores primeiro, até `limite` delas. A mesma conta do solver (`RegraDivisao::divisoes`).
 */
export function divisoesAceitas(regras: EntradaDivisao, aulas: number, limite = 200): number[][] {
    const todas: number[][] = [];
    if (aulas <= 0) return todas;
    const tMin = Math.max(1, regras.tamanhoMin ?? 1);
    const tMax = Math.min(aulas, regras.tamanhoMax ?? aulas);
    const qMin = Math.max(1, regras.quantidadeMin ?? 1);
    const qMax = regras.quantidadeMax ?? aulas;
    const porTamanho = regras.porTamanho ?? [];
    const valida = (d: number[]) =>
        d.length >= qMin &&
        porTamanho.every(({ tamanho, min, max }) => {
            const n = d.filter((t) => t === tamanho).length;
            return n >= min && n <= max;
        });
    const atual: number[] = [];
    const enumerar = (falta: number, maior: number) => {
        if (todas.length >= limite) return;
        if (falta === 0) {
            if (valida(atual)) todas.push([...atual]);
            return;
        }
        if (atual.length >= qMax) return;
        for (let t = Math.min(maior, falta); t >= tMin; t--) {
            atual.push(t);
            enumerar(falta - t, t);
            atual.pop();
        }
    };
    enumerar(aulas, tMax);
    return todas;
}

/** "2+2 · 4", com no máximo `max` divisões ("… e mais 3"). */
export function textoDasDivisoes(divisoes: number[][], max = 4): string {
    const texto = divisoes.slice(0, max).map((d) => d.join("+")).join(" · ");
    return divisoes.length > max ? `${texto} · e mais ${divisoes.length - max}` : texto;
}

/** Nome curto da divisão escolhida. */
export function nomeDaDivisao(divisao: Divisao): string {
    const p = divisao.pedacos;
    if (p.tipo === "livre") return "Livre";
    if (p.tipo === "blocos") return `Blocos de ${p.tamanho}${p.emendar ? ", emendando" : ""}`;
    return "Personalizada";
}

/** As regras personalizadas equivalentes à divisão (para começar a personalizar a partir dela). */
export function personalizar(divisao: Divisao, aulas: number): Divisao {
    const r = regrasDaDivisao({ ...divisao, espalhar: false }, Math.max(aulas, 1));
    return {
        espalhar: divisao.espalhar,
        pedacos: {
            tipo: "regras",
            tamanhoMin: r.tamanhoMin ?? 1,
            tamanhoMax: r.tamanhoMax ?? null,
            quantidadeMin: r.quantidadeMin ?? 1,
            quantidadeMax: r.quantidadeMax ?? null,
            porTamanho: r.porTamanho ?? [],
        },
    };
}

export const mesmaDivisao = (a: Divisao, b: Divisao) => JSON.stringify(a) === JSON.stringify(b);

/** A `distribuicao` do formato v2 (blocos de N, emendando ou não) como divisão; sem espalhar, como era. */
export function divisaoDoFormatoV2(distribuicao: unknown): Divisao {
    const d = distribuicao as { tipo?: string; tamanho?: number; emendar?: boolean } | undefined;
    if (d?.tipo === "blocos" && typeof d.tamanho === "number" && d.tamanho >= 2) {
        return { pedacos: { tipo: "blocos", tamanho: d.tamanho, emendar: d.emendar === true }, espalhar: false };
    }
    return DIVISAO_LIVRE;
}
