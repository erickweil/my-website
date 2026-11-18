import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DIAS_SEMANA_MAP } from "../../horario-regras";
import type { ProjetoHorario } from "../../modelo/modelo";
import { NOME_DO_TURNO, aulasPorTurno, fimDaFaixa } from "../../modelo/operacoes";
import { corDoTexto } from "../../componentes/comuns";
import { chave, type Quadro } from "./quadros";

/**
 * Um quadro dias × aulas. Na célula: vermelho = regra obrigatória, amarelo = regra de qualidade,
 * ponto azul = a aula mudou de lugar na última atualização da busca.
 */
export function QuadroDeHorario({ projeto, quadro }: { projeto: ProjetoHorario; quadro: Quadro }) {
    const { dias } = projeto.quadro;
    /** Há algo para mostrar neste tempo: uma aula, um problema ou, numa turma, um horário que devia ter aula. */
    const temAlgo = (t: number) => dias.some((d) => quadro.celulas.has(chave(d, t)) || (quadro.vazioEhFalha && quadro.ativo(d, t)));
    // Turno inteiro sem nada não aparece; nos outros, todas as aulas do turno
    const turnos = aulasPorTurno(projeto.quadro).filter((t) => t.linhas.some((l) => l.tipo === "aula" && temAlgo(l.tempo)));
    return (
        <section className="break-inside-avoid space-y-2">
            <h3 className="text-lg font-medium">{quadro.titulo}</h3>
            {turnos.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    {quadro.vazioEhFalha ? "Esta turma não tem horários no quadro." : "Nenhuma aula alocada no horário."}
                </p>
            ) : (
                <div className="overflow-x-auto rounded-2xl border border-border [print-color-adjust:exact]">
                    <table className="w-full table-fixed border-collapse text-sm">
                        <thead>
                            <tr className="bg-muted/50">
                                <th className="w-9 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground md:w-28">
                                    <span className="hidden md:inline">Aula</span>
                                </th>
                                {dias.map((d) => (
                                    <th key={d} className="px-1 py-1.5 font-medium">
                                        <span className="hidden sm:inline">{DIAS_SEMANA_MAP[d]}</span>
                                        <span className="sm:hidden">{DIAS_SEMANA_MAP[d].slice(0, 3)}</span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        {turnos.map((turno) => (
                            <tbody key={turno.turno}>
                                <tr className="border-t border-border bg-muted/50">
                                    <th colSpan={dias.length + 1} className="px-2 py-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                        {NOME_DO_TURNO[turno.turno]}
                                    </th>
                                </tr>
                                {turno.linhas.map((l) => {
                                    const f = l.faixa;
                                    if (l.tipo === "intervalo") {
                                        return (
                                            <tr key={f.id} className="bg-muted/30 text-xs text-muted-foreground">
                                                <td className="px-2 py-0.5">
                                                    <span className="hidden md:inline">{f.inicio}</span>
                                                </td>
                                                <td colSpan={dias.length} className="py-0.5 text-center">{f.tipo === "intervalo" ? f.nome || "Intervalo" : ""}</td>
                                            </tr>
                                        );
                                    }
                                    const t = l.tempo;
                                    return (
                                        <tr key={f.id} className="border-t border-border">
                                            <td className="px-2 py-1 whitespace-nowrap" title={`${f.inicio}–${fimDaFaixa(f)}`}>
                                                <span className="font-medium">{l.numero}ª</span>{" "}
                                                <span className="hidden text-xs text-muted-foreground md:inline">{f.inicio}–{fimDaFaixa(f)}</span>
                                            </td>
                                            {dias.map((d) => {
                                                const celula = quadro.celulas.get(chave(d, t));
                                                const ativo = quadro.ativo(d, t);
                                                const [principal, ...resto] = celula?.linhas ?? [];
                                                return (
                                                    <td
                                                        key={d}
                                                        title={
                                                            celula &&
                                                            [
                                                                ...(celula.detalhes ?? []),
                                                                celula.problema && `Regra obrigatória: ${celula.problema}`,
                                                                ...(celula.avisos ?? []).map((a) => `Qualidade: ${a}`),
                                                                celula.mudou && "Mudou de lugar na última atualização.",
                                                            ]
                                                                .filter(Boolean)
                                                                .join("\n\n")
                                                        }
                                                        className={cn(
                                                            "relative h-12 border-l border-border px-0.5 py-0.5 text-center text-[0.65rem] leading-tight hyphens-auto sm:px-1 sm:text-xs",
                                                            !ativo && "bg-muted/40",
                                                            // Vermelho: regra obrigatória. Amarelo: regra de qualidade (preferência)
                                                            celula?.problema && "outline-3 -outline-offset-3 outline-destructive",
                                                            !celula?.problema && celula?.avisos?.length && "outline-3 -outline-offset-3 outline-amber-400",
                                                            // Sem professor não há cor: o tracejado mostra que é aula, não horário livre
                                                            celula?.semProfessor && "bg-muted",
                                                            celula?.semProfessor && !celula.problema && !celula.avisos?.length && "outline-1 -outline-offset-4 outline-dashed outline-muted-foreground/60",
                                                        )}
                                                        style={principal && celula?.cor ? { backgroundColor: celula.cor, color: corDoTexto(celula.cor) } : undefined}
                                                    >
                                                        {principal ? (
                                                            <>
                                                                <p className={cn("font-medium break-words text-balance", resto.length > 0 ? "line-clamp-2" : "line-clamp-3")}>{principal}</p>
                                                                {resto.length > 0 && <p className="truncate">{resto.join(" · ")}</p>}
                                                            </>
                                                        ) : ativo && quadro.vazioEhFalha ? (
                                                            <span className="text-destructive">vazio</span>
                                                        ) : null}
                                                        {celula?.problema ? (
                                                            <CircleAlert className="absolute top-0.5 right-0.5 size-3.5 rounded-full bg-white text-destructive" />
                                                        ) : celula?.avisos?.length ? (
                                                            <TriangleAlert className="absolute top-0.5 right-0.5 size-3.5 rounded-sm bg-white p-px text-amber-600" />
                                                        ) : null}
                                                        {celula?.mudou && (
                                                            <span className="absolute top-1 left-1 size-2 rounded-full bg-sky-500 ring-2 ring-white" aria-label="Mudou de lugar" />
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        ))}
                    </table>
                </div>
            )}
        </section>
    );
}
