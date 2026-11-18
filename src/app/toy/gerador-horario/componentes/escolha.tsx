/**
 * Botões de escolha: pílulas que ligam e desligam (dias da semana, períodos do curso) e abas em
 * destaque para trocar o que a tela mostra (horários ou aulas da turma, visão do horário).
 */

import { cn } from "@/lib/utils";

/** Pílula que liga e desliga, ou marca a opção escolhida de uma fila. */
export function Pilula({ ativa, onClick, children, className }: { ativa: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
    return (
        <button
            type="button"
            aria-pressed={ativa}
            onClick={onClick}
            className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                ativa ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                className,
            )}
        >
            {children}
        </button>
    );
}

export interface Aba<T extends string> {
    id: T;
    rotulo: string;
    /** Número ao lado do rótulo (quantos itens a aba tem). */
    contagem?: number;
    /** Destaca a contagem em vermelho (ex.: uma turma sem nenhuma aula). */
    alerta?: boolean;
}

/** Abas em destaque: um controle segmentado, com a escolhida preenchida. */
export function Abas<T extends string>({ abas, atual, onEscolher, rotulo, className }: {
    abas: Aba<T>[];
    atual: T;
    onEscolher: (id: T) => void;
    /** Nome do grupo, para leitores de tela. */
    rotulo: string;
    className?: string;
}) {
    return (
        <div role="tablist" aria-label={rotulo} className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1", className)}>
            {abas.map((a) => {
                const escolhida = a.id === atual;
                return (
                    <button
                        key={a.id}
                        type="button"
                        role="tab"
                        aria-selected={escolhida}
                        onClick={() => onEscolher(a.id)}
                        className={cn(
                            "inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                            escolhida ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground",
                        )}
                    >
                        {a.rotulo}
                        {a.contagem !== undefined && (
                            <span
                                className={cn(
                                    "min-w-5 rounded-full px-1.5 text-xs font-semibold tabular-nums",
                                    a.alerta ? "bg-destructive text-white" : escolhida ? "bg-primary-foreground text-primary" : "bg-background",
                                )}
                            >
                                {a.contagem}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
