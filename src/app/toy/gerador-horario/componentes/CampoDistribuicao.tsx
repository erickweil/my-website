import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Distribuicao } from "../modelo/modelo";
import { CampoNumero } from "./comuns";

/**
 * Agrupamento das aulas: quantas aulas seguidas formam um bloco (0 = sem agrupamento) e se dois
 * blocos podem ficar encostados no mesmo dia. Ao passar a agrupar, "emendar blocos" vem marcado.
 * Com o bloco do tamanho de todas as aulas da semana (`aulasSemana`) só existe um bloco, e emendar
 * não se aplica: a opção fica desativada.
 */
export function CampoDistribuicao({ valor, aulasSemana, onChange }: { valor: Distribuicao; aulasSemana: number; onChange: (d: Distribuicao) => void }) {
    const umBloco = valor.tipo === "blocos" && valor.tamanho >= aulasSemana;
    const podeEmendar = valor.tipo === "blocos" && !umBloco;
    return (
        <div className="flex items-center gap-2">
            <CampoNumero
                aria-label="Agrupar"
                title="Aulas seguidas por bloco (2 = aulas duplas). 0 = sem agrupamento."
                className="h-8 w-16 shrink-0"
                max={12}
                valor={valor.tipo === "blocos" ? valor.tamanho : 0}
                // Bloco de 1 aula é o mesmo que não agrupar
                onChange={(n) => onChange(n < 2 ? { tipo: "livre" } : { tipo: "blocos", tamanho: n, emendar: valor.tipo === "blocos" ? valor.emendar : true })}
            />
            <label
                className={cn("flex items-center gap-1.5 text-xs", podeEmendar ? "text-muted-foreground" : "text-muted-foreground/50")}
                title={
                    umBloco
                        ? "Todas as aulas da semana formam um bloco só: não há dois blocos para emendar."
                        : "Permite dois blocos seguidos no mesmo dia (por exemplo, 4 aulas seguidas de uma disciplina de aulas duplas)."
                }
            >
                <Checkbox
                    disabled={!podeEmendar}
                    checked={podeEmendar && valor.tipo === "blocos" && valor.emendar}
                    onCheckedChange={(v) => valor.tipo === "blocos" && onChange({ ...valor, emendar: v === true })}
                />
                emendar blocos
            </label>
        </div>
    );
}
