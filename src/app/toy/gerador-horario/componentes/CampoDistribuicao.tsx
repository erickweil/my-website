import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Distribuicao } from "../modelo/modelo";
import { CampoNumero } from "./comuns";

/**
 * Agrupamento das aulas: quantas aulas seguidas formam um bloco (0 = sem agrupamento) e se dois
 * blocos podem ficar encostados no mesmo dia.
 */
export function CampoDistribuicao({ valor, onChange }: { valor: Distribuicao; onChange: (d: Distribuicao) => void }) {
    return (
        <div className="flex items-center gap-2">
            <CampoNumero
                aria-label="Agrupar"
                title="Aulas seguidas por bloco (2 = aulas duplas). 0 = sem agrupamento."
                className="h-8 w-16 shrink-0"
                max={12}
                valor={valor.tipo === "blocos" ? valor.tamanho : 0}
                // Bloco de 1 aula é o mesmo que não agrupar
                onChange={(n) => onChange(n < 2 ? { tipo: "livre" } : { tipo: "blocos", tamanho: n, emendar: valor.tipo === "blocos" && valor.emendar })}
            />
            <label
                className={cn("flex items-center gap-1.5 text-xs", valor.tipo === "blocos" ? "text-muted-foreground" : "text-muted-foreground/50")}
                title="Permite dois blocos seguidos no mesmo dia (por exemplo, 4 aulas seguidas de uma disciplina de aulas duplas)."
            >
                <Checkbox
                    disabled={valor.tipo !== "blocos"}
                    checked={valor.tipo === "blocos" && valor.emendar}
                    onCheckedChange={(v) => valor.tipo === "blocos" && onChange({ ...valor, emendar: v === true })}
                />
                emendar blocos
            </label>
        </div>
    );
}
