/**
 * Campos de formulário com a aparência do resto da página.
 *
 * Os campos de número são de texto com teclado numérico (sem as setas do navegador, que no
 * Firefox ficam em cima do número nos campos estreitos). Enquanto o usuário digita vale o texto
 * dele; o valor só é repassado quando é válido (um inteiro dentro dos limites, ou um decimal).
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

type PropsDeNumero = Omit<React.ComponentProps<"input">, "onChange" | "value" | "min" | "max" | "type">;

/** Inteiro entre `min` e `max`. */
export function CampoNumero({ valor, onChange, min = 0, max = 999, ...props }: { valor: number; onChange: (n: number) => void; min?: number; max?: number } & PropsDeNumero) {
    return <CampoInteiro valor={valor} aceita={(n) => n !== null && n >= min && n <= max} onChange={(n) => onChange(n!)} {...props} />;
}

/** Inteiro de 1 a `max`, ou vazio para "sem limite". */
export function CampoOpcional({ valor, onChange, max = 30, ...props }: { valor: number | null; onChange: (n: number | null) => void; max?: number } & PropsDeNumero) {
    return <CampoInteiro valor={valor} aceita={(n) => n === null || (n >= 1 && n <= max)} onChange={onChange} placeholder="∞" title="Vazio = sem limite" {...props} />;
}

/**
 * Número decimal maior ou igual a 0, com vírgula (ou ponto). Mostra o valor com vírgula; enquanto o
 * usuário digita vale o texto dele, e o valor só é repassado quando é um número válido.
 */
export function CampoDecimal({ valor, onChange, className, ...props }: { valor: number; onChange: (n: number) => void } & PropsDeNumero) {
    const [texto, setTexto] = useState<string | null>(null);
    return (
        <Input
            type="text"
            inputMode="decimal"
            className={cn("text-right tabular-nums", className)}
            value={texto ?? String(valor).replace(".", ",")}
            onChange={(e) => {
                const t = e.target.value.replace(/[^\d.,]/g, "");
                setTexto(t);
                const n = Number(t.replace(",", "."));
                if (t !== "" && Number.isFinite(n) && n >= 0) onChange(n);
            }}
            onBlur={() => setTexto(null)}
            {...props}
        />
    );
}

function CampoInteiro({ valor, aceita, onChange, className, ...props }: {
    valor: number | null;
    /** Se o número digitado (null = campo vazio) vale. */
    aceita: (n: number | null) => boolean;
    onChange: (n: number | null) => void;
} & PropsDeNumero) {
    const [texto, setTexto] = useState<string | null>(null);
    return (
        <Input
            type="text"
            inputMode="numeric"
            className={cn("text-center tabular-nums", className)}
            value={texto ?? (valor === null ? "" : String(valor))}
            onChange={(e) => {
                const t = e.target.value.replace(/\D/g, "");
                setTexto(t);
                const n = t === "" ? null : Number(t);
                if (aceita(n)) onChange(n);
            }}
            onBlur={() => setTexto(null)}
            {...props}
        />
    );
}
