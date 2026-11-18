import { useState } from "react";
import { ArrowRight, ChevronDown, CircleAlert, CircleHelp, TriangleAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { Ambiente, Professor } from "../modelo/modelo";
import type { Pendencia } from "../modelo/diagnostico";

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

/** Item de uma lista lateral (turmas, docentes, quadros do horário). */
export function ItemDaLista({
    ativo,
    onClick,
    titulo,
    detalhe,
    alerta,
    marca,
}: {
    ativo: boolean;
    onClick: () => void;
    titulo: React.ReactNode;
    detalhe?: React.ReactNode;
    /** Detalhe em vermelho. */
    alerta?: boolean;
    /** Bolinha ao lado do nome: o item tem uma pendência (erro) ou um aviso. */
    marca?: "erro" | "aviso" | null;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={ativo ? "true" : undefined}
            className={cn(
                "flex shrink-0 items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left text-sm transition-colors md:w-full",
                ativo ? "border-primary bg-primary/10" : "border-border hover:bg-muted md:border-transparent",
            )}
        >
            <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{titulo}</span>
                {marca && (
                    <span
                        className={cn("size-2 shrink-0 rounded-full", marca === "erro" ? "bg-destructive" : "bg-amber-500")}
                        title={marca === "erro" ? "Tem pendências que impedem um horário completo" : "Tem avisos"}
                    />
                )}
            </span>
            {detalhe && (
                <span className={cn("shrink-0 text-xs tabular-nums", alerta ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {detalhe}
                </span>
            )}
        </button>
    );
}

/** A marca de um item de lista a partir das pendências dele. */
export const marcaDe = (pendencias: Pendencia[]): "erro" | "aviso" | null =>
    pendencias.some((p) => p.gravidade === "erro") ? "erro" : pendencias.length > 0 ? "aviso" : null;

/** Uma pendência: ícone pela gravidade e a mensagem; com `onIr`, um link para a tela em que se corrige. */
function LinhaDePendencia({ p, onIr }: { p: Pendencia; onIr?: (p: Pendencia) => void }) {
    const Icone = p.gravidade === "erro" ? CircleAlert : TriangleAlert;
    return (
        <li className="flex items-start gap-2">
            <Icone className={cn("mt-0.5 size-4 shrink-0", p.gravidade === "erro" ? "text-destructive" : "text-amber-600 dark:text-amber-400")} />
            <span className="flex-1">{p.mensagem}</span>
            {onIr && (
                <button type="button" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground underline hover:text-foreground" onClick={() => onIr(p)}>
                    {ROTULO_DA_TELA[p.tela]} <ArrowRight className="size-3" />
                </button>
            )}
        </li>
    );
}

export const ROTULO_DA_TELA: Record<Pendencia["tela"], string> = { quadro: "Quadro", turmas: "Turmas", aulas: "Aulas", docentes: "Docentes" };

const ordenar = (ps: Pendencia[]) => [...ps].sort((a, b) => (a.gravidade === b.gravidade ? 0 : a.gravidade === "erro" ? -1 : 1));

/** Avisos do que se corrige na tela atual (já filtrados por quem chama). Nada aparece se não houver. */
export function AvisosDaTela({ pendencias, className }: { pendencias: Pendencia[]; className?: string }) {
    if (pendencias.length === 0) return null;
    const temErro = pendencias.some((p) => p.gravidade === "erro");
    return (
        <div className={cn("rounded-2xl border px-4 py-2.5 text-sm", temErro ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5", className)}>
            <ListaComLimite itens={ordenar(pendencias)} limite={3} className="space-y-1">
                {(p) => <LinhaDePendencia key={p.mensagem} p={p} />}
            </ListaComLimite>
        </div>
    );
}

/**
 * Todas as pendências do projeto num cartão recolhido: uma linha de resumo que abre a lista, com o
 * link para a tela em que cada uma se corrige.
 */
export function CartaoDePendencias({ pendencias, onIr }: { pendencias: Pendencia[]; onIr: (p: Pendencia) => void }) {
    const [aberto, setAberto] = useState(false);
    if (pendencias.length === 0) return null;
    const erros = pendencias.filter((p) => p.gravidade === "erro").length;
    const avisos = pendencias.length - erros;
    const resumo = [
        erros > 0 && `${plural(erros, "pendência impede", "pendências impedem")} um horário completo`,
        avisos > 0 && plural(avisos, "aviso", "avisos"),
    ].filter(Boolean).join(" · ");
    return (
        <div className={cn("rounded-2xl border text-sm", erros > 0 ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5")}>
            <button type="button" aria-expanded={aberto} onClick={() => setAberto(!aberto)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
                {erros > 0 ? <CircleAlert className="size-4 shrink-0 text-destructive" /> : <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />}
                <span className="flex-1 font-medium">{resumo}</span>
                <span className="text-xs text-muted-foreground">{aberto ? "Esconder" : "Ver"}</span>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
            </button>
            {aberto && (
                <ul className="space-y-1 border-t border-border/70 px-4 py-2.5">
                    {ordenar(pendencias).map((p) => <LinhaDePendencia key={p.mensagem} p={p} onIr={onIr} />)}
                </ul>
            )}
        </div>
    );
}

export const rotuloDoProfessor = (p: Professor | undefined) => p?.nome || "(sem nome)";

/** "Lab. 2 · 30 lugares" (sem a capacidade quando ela não foi informada). */
export const rotuloDoAmbiente = (a: Ambiente) => `${a.nome || "(sem nome)"}${a.capacidade > 0 ? ` · ${a.capacidade} lugares` : ""}`;

/** Preto ou branco, o que tiver mais contraste com a cor (luminância relativa da WCAG). */
export const corDoTexto = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Contraste com o preto (l + 0,05) / 0,05 contra o branco 1,05 / (l + 0,05): empatam em l ≈ 0,179
    return l > 0.179 ? "#000" : "#fff";
};

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Lista que mostra só os primeiros `limite` itens, com um botão para ver o resto: para avisos que
 * podem ser muitos e não devem empurrar o resto da tela para baixo.
 */
export function ListaComLimite<T>({ itens, limite = 5, className, children }: {
    itens: T[];
    limite?: number;
    className?: string;
    children: (item: T, i: number) => React.ReactNode;
}) {
    const [aberta, setAberta] = useState(false);
    // Esconder só um ou dois não vale o botão
    const cabe = itens.length <= limite + 2;
    const visiveis = aberta || cabe ? itens : itens.slice(0, limite);
    return (
        <>
            <ul className={className}>{visiveis.map(children)}</ul>
            {!cabe && (
                <button type="button" className="mt-1 text-xs font-medium underline" onClick={() => setAberta(!aberta)}>
                    {aberta ? "Ver menos" : `Ver mais ${itens.length - limite}`}
                </button>
            )}
        </>
    );
}

/** Lista lateral de itens: coluna no computador, fila rolável no celular. */
export function ListaLateral({ children }: { children: React.ReactNode }) {
    return <nav className="flex min-w-0 gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">{children}</nav>;
}

/** Rótulo pequeno em cima de um campo, só no celular (no computador a tabela tem cabeçalho). */
export function RotuloMovel({ children }: { children: React.ReactNode }) {
    return <span className="mb-0.5 block text-xs text-muted-foreground md:hidden">{children}</span>;
}
