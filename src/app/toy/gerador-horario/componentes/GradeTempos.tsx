import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { DIAS_SEMANA_MAP } from "../horario-regras";
import type { Dia, QuadroHorarios } from "../modelo/modelo";
import { fimDaFaixa } from "../modelo/operacoes";

export interface EstadoDaGrade {
    rotulo: string;
    /** Classes da célula neste estado. */
    classe: string;
}

/**
 * Grade dias × tempos do quadro de horários, em que cada célula está num de alguns estados
 * (tem aula / não tem; disponível / evitar / indisponível).
 *
 * Clicar e arrastar pinta várias células; clicar no dia ou no tempo pinta a coluna ou a linha.
 * Com `pincel`, pinta sempre com ele; sem, alterna entre os dois primeiros estados.
 */
export function GradeTempos({
    quadro,
    estados,
    estadoDe,
    pincel,
    onPintar,
}: {
    quadro: QuadroHorarios;
    estados: Record<string, EstadoDaGrade>;
    estadoDe: (dia: Dia, tempo: number) => string;
    pincel?: string;
    onPintar: (celulas: [Dia, number][], estado: string) => void;
}) {
    const [ligado, desligado] = Object.keys(estados);
    /** Estado que está sendo pintado enquanto o botão do mouse está apertado. */
    const arrastando = useRef<string | null>(null);
    useEffect(() => {
        const soltar = () => (arrastando.current = null);
        window.addEventListener("pointerup", soltar);
        return () => window.removeEventListener("pointerup", soltar);
    }, []);

    let tempo = 0;
    const linhas = quadro.faixas.map((faixa) => ({ faixa, tempo: faixa.tipo === "aula" ? ++tempo : 0 }));
    const tempos = linhas.filter((l) => l.tempo > 0).map((l) => l.tempo);

    /** Para um grupo de células: o pincel, ou "tudo ligado vira desligado, senão liga tudo". */
    const alvoDe = (celulas: [Dia, number][]) =>
        pincel ?? (celulas.every(([d, t]) => estadoDe(d, t) === ligado) ? desligado : ligado);
    const pintarGrupo = (celulas: [Dia, number][]) => onPintar(celulas, alvoDe(celulas));

    return (
        <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full table-fixed border-collapse select-none text-sm">
                <thead>
                    <tr className="bg-muted/50">
                        <th className="w-12 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground md:w-28">Aula</th>
                        {quadro.dias.map((dia) => (
                            <th key={dia} className="p-0">
                                <button
                                    type="button"
                                    title="Marcar ou desmarcar o dia inteiro"
                                    className="w-full px-1 py-1.5 font-medium hover:bg-muted"
                                    onClick={() => pintarGrupo(tempos.map((t) => [dia, t]))}
                                >
                                    <span className="hidden sm:inline">{DIAS_SEMANA_MAP[dia]}</span>
                                    <span className="sm:hidden">{DIAS_SEMANA_MAP[dia].slice(0, 3)}</span>
                                </button>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {linhas.map(({ faixa, tempo }, i) => {
                        if (faixa.tipo === "intervalo") {
                            return (
                                <tr key={faixa.id} className="bg-muted/30 text-xs text-muted-foreground">
                                    <td className="px-2 py-0.5">
                                        <span className="hidden md:inline">{faixa.inicio}</span>
                                    </td>
                                    <td colSpan={quadro.dias.length} className="py-0.5 text-center">
                                        {faixa.nome || "Intervalo"} · {faixa.duracaoMin} min
                                    </td>
                                </tr>
                            );
                        }
                        const anterior = linhas.slice(0, i).findLast((l) => l.faixa.tipo === "aula")?.faixa;
                        const mudouDeTurno = anterior?.tipo === "aula" && anterior.turno !== faixa.turno;
                        return (
                            <tr key={faixa.id} className={cn("border-t border-border", mudouDeTurno && "border-t-4")}>
                                <td className="p-0">
                                    <button
                                        type="button"
                                        title="Marcar ou desmarcar esta aula em todos os dias"
                                        className="h-8 w-full px-2 text-left whitespace-nowrap hover:bg-muted"
                                        onClick={() => pintarGrupo(quadro.dias.map((d) => [d, tempo]))}
                                    >
                                        <span className="font-medium">{tempo}ª</span>{" "}
                                        <span className="hidden text-xs text-muted-foreground md:inline">
                                            {faixa.inicio}–{fimDaFaixa(faixa)}
                                        </span>
                                    </button>
                                </td>
                                {quadro.dias.map((dia) => {
                                    const estado = estadoDe(dia, tempo);
                                    return (
                                        <td key={dia} className="border-l border-border p-0">
                                            <button
                                                type="button"
                                                aria-label={`${DIAS_SEMANA_MAP[dia]}, ${tempo}ª aula: ${estados[estado]?.rotulo}`}
                                                title={estados[estado]?.rotulo}
                                                className={cn("block h-8 w-full transition-colors", estados[estado]?.classe)}
                                                onPointerDown={(e) => {
                                                    if (e.button !== 0) return;
                                                    const alvo = alvoDe([[dia, tempo]]);
                                                    arrastando.current = alvo;
                                                    onPintar([[dia, tempo]], alvo);
                                                }}
                                                onPointerEnter={(e) => {
                                                    const alvo = arrastando.current;
                                                    if (alvo && e.buttons === 1 && estado !== alvo) onPintar([[dia, tempo]], alvo);
                                                }}
                                                // Teclado: Enter e espaço disparam o clique sem pointerdown
                                                onClick={(e) => {
                                                    if (e.detail === 0) pintarGrupo([[dia, tempo]]);
                                                }}
                                            />
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/** Legenda dos estados; com `onEscolher`, vira o seletor do pincel. */
export function LegendaDaGrade({
    estados,
    pincel,
    onEscolher,
}: { estados: Record<string, EstadoDaGrade>; pincel?: string; onEscolher?: (estado: string) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            {Object.entries(estados).map(([id, e]) => {
                const conteudo = (
                    <>
                        <span className={cn("inline-block size-3.5 rounded", e.classe)} /> {e.rotulo}
                    </>
                );
                return onEscolher ? (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onEscolher(id)}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium",
                            pincel === id ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {conteudo}
                    </button>
                ) : (
                    <span key={id} className="inline-flex items-center gap-1.5 text-muted-foreground">
                        {conteudo}
                    </span>
                );
            })}
        </div>
    );
}

/** Aplica uma pintura a uma lista de tempos por dia: põe ou tira as células. */
export function pintarHorarios(
    horarios: Partial<Record<Dia, number[]>>,
    celulas: [Dia, number][],
    marcar: boolean,
): Partial<Record<Dia, number[]>> {
    const novo = { ...horarios };
    for (const [dia, tempo] of celulas) {
        const sem = (novo[dia] ?? []).filter((t) => t !== tempo);
        novo[dia] = marcar ? [...sem, tempo].sort((a, b) => a - b) : sem;
    }
    return novo;
}
