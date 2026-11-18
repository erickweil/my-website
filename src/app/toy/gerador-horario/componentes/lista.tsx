/**
 * O padrão "lista + detalhe" das telas com muitos itens (turmas, docentes, cursos, quadros do
 * horário): no computador, a lista fica numa coluna à esquerda que acompanha a rolagem; no celular,
 * vira uma fila que rola de lado em cima do detalhe. O botão de adicionar fica no fim da lista.
 */

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarcaDePendencia, type Marca } from "./pendencias";

export function ListaComDetalhe({ lista, children }: { lista: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="grid gap-4 md:grid-cols-[14rem_1fr] md:gap-6 print:block">
            <nav className="-mx-3 flex min-w-0 gap-1.5 overflow-x-auto px-3 pb-1 md:sticky md:top-18 md:mx-0 md:max-h-[calc(100vh-6rem)] md:flex-col md:gap-0.5 md:self-start md:overflow-y-auto md:px-0 md:pr-1 md:pb-0 print:hidden">
                {lista}
            </nav>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

/** Título de um grupo de itens (as turmas de um curso). */
export function GrupoDaLista({ titulo }: { titulo: string }) {
    return (
        <p className="shrink-0 self-center truncate px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase md:self-auto md:px-3 md:pt-3 md:pb-1 md:first:pt-0" title={titulo}>
            {titulo}
        </p>
    );
}

export function ItemDaLista({ ativo, onClick, titulo, detalhe, alerta, marca }: {
    ativo: boolean;
    onClick: () => void;
    titulo: React.ReactNode;
    /** Texto curto à direita (uma contagem). */
    detalhe?: React.ReactNode;
    /** Detalhe em vermelho. */
    alerta?: boolean;
    marca?: Marca;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={ativo ? "true" : undefined}
            className={cn(
                "flex shrink-0 items-center justify-between gap-3 rounded-xl border px-3 py-1.5 text-left text-sm transition-colors md:w-full md:py-2",
                ativo ? "border-primary bg-primary/10" : "border-border hover:bg-muted md:border-transparent",
            )}
        >
            <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{titulo}</span>
                <MarcaDePendencia marca={marca ?? null} />
            </span>
            {detalhe !== undefined && (
                <span className={cn("shrink-0 text-xs tabular-nums", alerta ? "font-medium text-destructive" : "text-muted-foreground")}>{detalhe}</span>
            )}
        </button>
    );
}

/**
 * "+ Turma" no fim da lista. Aceita as props de um botão, para servir também de gatilho de um
 * popover (`<PopoverTrigger render={<BotaoAdicionar>…</BotaoAdicionar>} />`).
 */
export function BotaoAdicionar({ children, className, ...props }: React.ComponentProps<"button">) {
    return (
        <button
            type="button"
            className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-50 md:mt-1 md:w-full md:py-2",
                className,
            )}
            {...props}
        >
            <Plus className="size-4 shrink-0" />
            {children}
        </button>
    );
}
