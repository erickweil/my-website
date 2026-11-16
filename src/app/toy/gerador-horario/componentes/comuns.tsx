import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { Professor } from "../modelo/modelo";

/** Ícone de ajuda: a explicação abre ao clicar. */
export function Ajuda({ children }: { children: React.ReactNode }) {
    return (
        <Popover>
            <PopoverTrigger type="button" aria-label="Ajuda" className="inline-flex align-middle text-muted-foreground hover:text-foreground">
                <CircleHelp className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 gap-2 text-sm font-normal">{children}</PopoverContent>
        </Popover>
    );
}

/** Cabeçalho de uma tela: título, ajuda opcional e ações à direita. */
export function Cabecalho({ titulo, ajuda, acoes }: { titulo: string; ajuda?: React.ReactNode; acoes?: React.ReactNode }) {
    return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
                {titulo}
                {ajuda && <Ajuda>{ajuda}</Ajuda>}
            </h2>
            {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
        </div>
    );
}

export function Vazio({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {children}
        </div>
    );
}

/** `<select>` nativo com a aparência dos campos. */
export function Selecao({ className, ...props }: React.ComponentProps<"select">) {
    return (
        <select
            className={cn(
                "h-9 min-w-0 rounded-3xl border border-border bg-input/30 px-3 text-sm outline-none",
                "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50",
                className,
            )}
            {...props}
        />
    );
}

/**
 * Campo de número inteiro. Enquanto o usuário digita vale o texto dele (o campo pode ficar vazio);
 * o valor só é repassado quando é um inteiro dentro dos limites.
 */
export function CampoNumero({
    valor,
    onChange,
    min = 0,
    max = 999,
    className,
    ...props
}: { valor: number; onChange: (n: number) => void; min?: number; max?: number } & Omit<React.ComponentProps<"input">, "onChange" | "value" | "min" | "max">) {
    const [texto, setTexto] = useState<string | null>(null);
    return (
        <Input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            className={cn("text-center", className)}
            value={texto ?? String(valor)}
            onChange={(e) => {
                setTexto(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
            }}
            onBlur={() => setTexto(null)}
            {...props}
        />
    );
}

/** Item de uma lista lateral (turmas, docentes). */
export function ItemDaLista({
    ativo,
    onClick,
    titulo,
    detalhe,
    alerta,
}: { ativo: boolean; onClick: () => void; titulo: React.ReactNode; detalhe?: React.ReactNode; alerta?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex shrink-0 items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left text-sm transition-colors md:w-full",
                ativo ? "border-primary bg-primary/10" : "border-border hover:bg-muted md:border-transparent",
            )}
        >
            <span className="min-w-0 truncate font-medium">{titulo}</span>
            {detalhe && (
                <span className={cn("shrink-0 text-xs tabular-nums", alerta ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {detalhe}
                </span>
            )}
        </button>
    );
}

export const rotuloDoProfessor = (p: Professor | undefined) => p?.nome || "(sem nome)";

/** Preto ou branco, o que ler melhor sobre a cor. */
export const corDoTexto = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? "#000" : "#fff";
};

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Lista lateral de itens: coluna no computador, fila rolável no celular. */
export function ListaLateral({ children }: { children: React.ReactNode }) {
    return <nav className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">{children}</nav>;
}

/** Rótulo pequeno em cima de um campo, só no celular (no computador a tabela tem cabeçalho). */
export function RotuloMovel({ children }: { children: React.ReactNode }) {
    return <span className="mb-0.5 block text-xs text-muted-foreground md:hidden">{children}</span>;
}
