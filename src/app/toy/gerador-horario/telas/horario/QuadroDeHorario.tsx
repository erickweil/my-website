import { memo } from "react";
import { CircleAlert, Pin, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DIAS_SEMANA_MAP } from "../../horario-regras";
import type { DadosDoProjeto, Dia } from "../../modelo/modelo";
import { NOME_DO_TURNO, aulasPorTurno, fimDaFaixa } from "../../modelo/operacoes";
import { corDoTexto } from "../../componentes/comuns";
import { chave, type Celula, type Quadro } from "./quadros";

/**
 * Um quadro dias × aulas. Na célula: vermelho = regra obrigatória, amarelo = regra de qualidade,
 * ponto azul = a aula mudou de lugar na última atualização da busca, alfinete = aula fixada.
 *
 * Com `onFixar`, clicar numa aula fixa ou desafixa; clicar no dia, no número da aula, no turno ou
 * no título faz o mesmo com o grupo inteiro (como nas grades de disponibilidade: se todas já estão
 * fixadas, desafixa; senão, fixa todas). Ver `fixar` em TelaHorario.
 */
export const QuadroDeHorario = memo(DesenhoDoQuadro, (antes, depois) =>
    // Só redesenha se o conteúdo mudou: com 19 turmas na tela, fixar uma aula redesenha um quadro, não
    // todos. `onFixar` pode ser uma versão antiga da função: ela lê o projeto mais recente ao ser chamada.
    antes.quadro.assinatura === depois.quadro.assinatura && antes.projeto.quadro === depois.projeto.quadro && !antes.onFixar === !depois.onFixar,
);

type AoFixar = (celulas: Celula[]) => void;

function DesenhoDoQuadro({ projeto, quadro, onFixar }: { projeto: DadosDoProjeto; quadro: Quadro; onFixar?: AoFixar }) {
    const { dias } = projeto.quadro;
    const celulasEm = (posicoes: [Dia, number][]) => posicoes.flatMap(([d, t]) => quadro.celulas.get(chave(d, t)) ?? []);
    /** Há algo para mostrar neste tempo: uma aula, um problema ou, numa turma, um horário que devia ter aula. */
    const temAlgo = (t: number) => dias.some((d) => quadro.celulas.has(chave(d, t)) || (quadro.vazioEhFalha && quadro.ativo(d, t)));
    // Turno inteiro sem nada não aparece; nos outros, todas as aulas do turno
    const turnos = aulasPorTurno(projeto.quadro).filter((t) => t.linhas.some((l) => l.tipo === "aula" && temAlgo(l.tempo)));
    const temposDo = (turno: (typeof turnos)[number]) => turno.linhas.flatMap((l) => (l.tipo === "aula" ? [l.tempo] : []));
    const todas = turnos.flatMap((tr) => dias.flatMap((d) => temposDo(tr).map((t): [Dia, number] => [d, t])));
    return (
        <section className="break-inside-avoid space-y-2">
            <h3 className="text-lg font-medium">
                <Fixador onFixar={onFixar} celulas={celulasEm(todas)} className="-mx-1 px-1">{quadro.titulo}</Fixador>
            </h3>
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
                                    <th key={d} className="p-0.5 font-medium">
                                        <Fixador onFixar={onFixar} celulas={celulasEm(turnos.flatMap((tr) => temposDo(tr).map((t): [Dia, number] => [d, t])))} className="block w-full px-1 py-1">
                                            <span className="hidden sm:inline">{DIAS_SEMANA_MAP[d]}</span>
                                            <span className="sm:hidden">{DIAS_SEMANA_MAP[d].slice(0, 3)}</span>
                                        </Fixador>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        {turnos.map((turno) => (
                            <tbody key={turno.turno}>
                                <tr className="border-t border-border bg-muted/50">
                                    <th colSpan={dias.length + 1} className="px-1 py-0.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                        <Fixador onFixar={onFixar} celulas={celulasEm(dias.flatMap((d) => temposDo(turno).map((t): [Dia, number] => [d, t])))} className="px-1 py-0.5 tracking-wide uppercase">
                                            {NOME_DO_TURNO[turno.turno]}
                                        </Fixador>
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
                                            <td className="px-1 py-1 whitespace-nowrap" title={`${f.inicio}–${fimDaFaixa(f)}`}>
                                                <Fixador onFixar={onFixar} celulas={celulasEm(dias.map((d): [Dia, number] => [d, t]))} className="px-1 py-0.5 text-left">
                                                    <span className="font-medium">{l.numero}ª</span>{" "}
                                                    <span className="hidden text-xs text-muted-foreground md:inline">{f.inicio}–{fimDaFaixa(f)}</span>
                                                </Fixador>
                                            </td>
                                            {dias.map((d) => {
                                                const celula = quadro.celulas.get(chave(d, t));
                                                const ativo = quadro.ativo(d, t);
                                                const [principal, ...resto] = celula?.linhas ?? [];
                                                return (
                                                    <td
                                                        key={d}
                                                        onClick={onFixar && celula && temOQueFixar([celula]) ? () => onFixar([celula]) : undefined}
                                                        title={
                                                            celula &&
                                                            [
                                                                ...(celula.detalhes ?? []),
                                                                celula.problema && `Regra obrigatória: ${celula.problema}`,
                                                                ...(celula.avisos ?? []).map((a) => `Qualidade: ${a}`),
                                                                celula.mudou && "Mudou de lugar na última atualização.",
                                                                celula.fixadas.length > 0 && "Fixada: para o gerador, é uma regra obrigatória que a aula fique aqui.",
                                                            ]
                                                                .filter(Boolean)
                                                                .join("\n\n")
                                                        }
                                                        className={cn(
                                                            "relative h-12 border-l border-border px-0.5 py-0.5 text-center text-[0.65rem] leading-tight hyphens-auto sm:px-1 sm:text-xs",
                                                            !ativo && "bg-muted/40",
                                                            onFixar && celula && temOQueFixar([celula]) && "cursor-pointer",
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
                                                        {!!celula?.fixadas.length && <Pin className="absolute right-0.5 bottom-0.5 size-3 opacity-60" aria-label="Fixada" />}
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

const temOQueFixar = (celulas: Celula[]) => celulas.some((c) => c.aulas.length > 0 || c.fixadas.length > 0);

/** Cabeçalho que fixa um grupo de aulas: um botão quando há o que fixar. */
function Fixador({ celulas, onFixar, className, children }: { celulas: Celula[]; onFixar?: AoFixar; className?: string; children: React.ReactNode }) {
    if (!onFixar || !temOQueFixar(celulas)) return <span className={className}>{children}</span>;
    return (
        <button type="button" title="Fixar ou desafixar estas aulas" className={cn("rounded-md hover:bg-muted hover:text-foreground", className)} onClick={() => onFixar(celulas)}>
            {children}
        </button>
    );
}
