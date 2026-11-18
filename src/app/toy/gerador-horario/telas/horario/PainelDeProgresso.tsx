import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ProgressoDoSolver, SolverHorario } from "../../horario-regras";
import type { HorarioGerado } from "../../modelo/modelo";
import { plural } from "../../componentes/comuns";

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

function duracao(ms: number): string {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${numero.format(ms / 1000)} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** O que `iter` e `depth` contam em cada método. */
const UNIDADES: Record<SolverHorario, { iter: string; depth: (n: string) => string }> = {
    local: { iter: "movimentos", depth: (n) => `sem melhora há ${n} movimentos` },
    genetic: { iter: "gerações", depth: (n) => `sem melhora há ${n} gerações` },
    pencilmark: { iter: "nós", depth: (n) => `${n} ramos em aberto` },
};

function Item({ rotulo, children, title }: { rotulo: string; children: ReactNode; title?: string }) {
    return (
        <div title={title}>
            <dt className="text-xs text-muted-foreground">{rotulo}</dt>
            <dd className="font-medium tabular-nums">{children}</dd>
        </div>
    );
}

/** Números da busca: tempo, ritmo, custo e quando o quadro mudou pela última vez. */
export function PainelDeProgresso({ progresso, gerando, horario }: {
    progresso: { solver: SolverHorario; valor: ProgressoDoSolver; msDaMudanca: number };
    gerando: boolean;
    /** O melhor quadro: o parcial durante a busca, o salvo depois. */
    horario: HorarioGerado | null;
}) {
    const { solver, valor: p, msDaMudanca } = progresso;
    const unidade = UNIDADES[solver];
    const porSegundo = p.ms > 0 ? (p.iter / p.ms) * 1000 : 0;
    const desdeAMudanca = p.ms - msDaMudanca;
    // Destaque por um instante quando o quadro acaba de mudar
    const recente = gerando && p.versao > 0 && desdeAMudanca < 800;
    const extras = [
        p.cadeias && plural(p.cadeias, "cadeia", "cadeias"),
        p.ilhas ? plural(p.ilhas, "ilha", "ilhas") : null,
        p.threads && plural(p.threads, "thread", "threads"),
    ].filter(Boolean);
    const violacoes = horario ? horario.problemas.filter((x) => x.turmaId).length : null;
    // O custo junta as duas partes; as de qualidade, somadas, valem menos que uma obrigatória, por isso
    // ele vai no title, com todas as casas
    const titulo = p.custo === undefined
        ? undefined
        : `Custo ${p.custo.toLocaleString("pt-BR", { maximumFractionDigits: 20 })} (0 = todas as regras atendidas). Cada violação de regra obrigatória vale ao menos 20; as observações de qualidade, todas somadas, valem menos que uma violação.`;

    return (
        <div className={cn("mt-3 border-t border-border pt-3", !gerando && "text-muted-foreground")}>
            {/* Celular: só uma linha; os números completos ficam para telas maiores */}
            <p className="text-xs text-muted-foreground tabular-nums sm:hidden">
                {duracao(p.ms)} · {compacto.format(p.iter)} {unidade.iter} · {p.versao === 0 ? "sem quadro ainda" : plural(p.versao, "atualização", "atualizações")}
            </p>
            <dl className="hidden gap-x-6 gap-y-2 sm:grid sm:grid-cols-3 lg:grid-cols-6">
                <Item rotulo={gerando ? "Tempo" : "Duração"}>{duracao(p.ms)}</Item>
                <Item rotulo={unidade.iter[0].toUpperCase() + unidade.iter.slice(1)} title={extras.join(", ")}>
                    {compacto.format(p.iter)} <span className="text-xs font-normal text-muted-foreground">({compacto.format(porSegundo)}/s)</span>
                </Item>
                {horario && violacoes !== null && (
                    <>
                        <Item rotulo="Regras obrigatórias" title={titulo}>
                            {horario.completo ? "atendidas" : plural(violacoes, "violação", "violações")}
                        </Item>
                        <Item rotulo="Qualidade" title={titulo}>
                            {plural(horario.qualidade.length, "observação", "observações")}
                        </Item>
                    </>
                )}
                <Item rotulo="Busca">{unidade.depth(compacto.format(p.depth))}</Item>
                <Item rotulo="Quadro">
                    <span className="flex items-center gap-1.5">
                        <span className={cn("size-2 shrink-0 rounded-full bg-muted-foreground/40 transition-colors", recente && "bg-sky-500 dark:bg-sky-400")} />
                        {p.versao === 0
                            ? "sem quadro ainda"
                            : `${plural(p.versao, "atualização", "atualizações")}, a última há ${duracao(desdeAMudanca)}`}
                    </span>
                </Item>
            </dl>
        </div>
    );
}
