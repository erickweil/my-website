import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Divisao } from "../modelo/modelo";
import { divisoesAceitas, personalizar, regrasDaDivisao, textoDasDivisoes } from "../modelo/divisao";
import { Ajuda } from "./comuns";
import { CampoNumero, CampoOpcional } from "./campos";

type Regras = Extract<Divisao["pedacos"], { tipo: "regras" }>;

/**
 * Como as aulas da disciplina se dividem em pedaços (trechos de aulas seguidas no mesmo dia). O
 * campo mostra só as divisões que a escolha permite (e "espalhar", se marcado); ao clicar, abre os
 * limites e a preferência de espalhar os pedaços pela semana.
 */
export function CampoDivisao({ valor, aulasSemana, onChange }: { valor: Divisao; aulasSemana: number; onChange: (d: Divisao) => void }) {
    const divisoes = divisoesAceitas(regrasDaDivisao(valor, aulasSemana), aulasSemana);
    const nenhuma = aulasSemana > 0 && divisoes.length === 0;
    return (
        <Popover>
            <PopoverTrigger
                type="button"
                title={nenhuma ? "Nenhuma divisão atende a estes limites" : `Permite: ${textoDasDivisoes(divisoes, 12)}`}
                className={cn(
                    "flex h-8 w-full items-center gap-1 rounded-3xl border bg-input/30 px-2.5 text-left text-sm hover:border-foreground/30",
                    nenhuma ? "border-destructive text-destructive" : "border-border",
                )}
            >
                <span className="min-w-0 flex-1 truncate tabular-nums">
                    {aulasSemana === 0 ? "—" : nenhuma ? "nenhuma possível" : textoDasDivisoes(divisoes, 3).replace(/ · e mais (\d+)$/, " +$1")}
                    {valor.espalhar && aulasSemana > 1 && <span className="text-muted-foreground"> · espalhar</span>}
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-3 text-sm">
                <EditorDeDivisao valor={valor} aulasSemana={aulasSemana} divisoes={divisoes} onChange={onChange} />
            </PopoverContent>
        </Popover>
    );
}

function EditorDeDivisao({ valor, aulasSemana, divisoes, onChange }: { valor: Divisao; aulasSemana: number; divisoes: number[][]; onChange: (d: Divisao) => void }) {
    // Livre e blocos de N viram os limites equivalentes; o que for mexido fica salvo como limites
    const regras = (valor.pedacos.tipo === "regras" ? valor : personalizar(valor, aulasSemana)).pedacos as Regras;
    const mudar = (campos: Partial<Regras>) => onChange({ ...valor, pedacos: { ...regras, ...campos } });
    const [porTamanhoAberto, setPorTamanhoAberto] = useState(regras.porTamanho.length > 0);

    return (
        <>
            <p className="flex items-center gap-1.5 font-medium">
                {aulasSemana} {aulasSemana === 1 ? "aula" : "aulas"} por semana
                <Ajuda>Um pedaço é um trecho de aulas seguidas da disciplina no mesmo dia.</Ajuda>
            </p>

            <Intervalo rotulo="Blocos de" sufixo="aulas" min={regras.tamanhoMin} max={regras.tamanhoMax} onChange={(tamanhoMin, tamanhoMax) => mudar({ tamanhoMin, tamanhoMax })} />
            <Intervalo rotulo="Dividir em" sufixo="partes" min={regras.quantidadeMin} max={regras.quantidadeMax} onChange={(quantidadeMin, quantidadeMax) => mudar({ quantidadeMin, quantidadeMax })} />

            {porTamanhoAberto ? (
                <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                    {regras.porTamanho.map((x, i) => {
                        const mudarLimite = (campos: Partial<Regras["porTamanho"][number]>) =>
                            mudar({ porTamanho: regras.porTamanho.map((y, j) => (j === i ? { ...y, ...campos } : y)) });
                        return (
                            <div key={i} className="flex flex-wrap items-center gap-1.5">
                                de
                                <CampoNumero aria-label="Mínimo de pedaços" className="h-7 w-11" min={0} max={30} valor={x.min} onChange={(min) => mudarLimite({ min })} />
                                a
                                <CampoNumero aria-label="Máximo de pedaços" className="h-7 w-11" min={0} max={30} valor={x.max} onChange={(max) => mudarLimite({ max })} />
                                pedaços de
                                <CampoNumero aria-label="Tamanho do pedaço" className="h-7 w-11" min={1} max={30} valor={x.tamanho} onChange={(tamanho) => mudarLimite({ tamanho })} />
                                <button type="button" title="Tirar o limite" className="hover:text-destructive" onClick={() => mudar({ porTamanho: regras.porTamanho.filter((_, j) => j !== i) })}>
                                    <X className="size-3.5" />
                                </button>
                            </div>
                        );
                    })}
                    <button type="button" className="inline-flex items-center gap-1 underline hover:text-foreground" onClick={() => mudar({ porTamanho: [...regras.porTamanho, { tamanho: 1, min: 0, max: 1 }] })}>
                        <Plus className="size-3" /> limite por tamanho
                    </button>
                </div>
            ) : (
                <button type="button" className="self-start text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setPorTamanhoAberto(true)}>
                    Limitar por tamanho…
                </button>
            )}

            {aulasSemana > 1 && (
                <label className="flex items-center gap-2 border-t border-border pt-2" title="Preferência: o horário tenta pôr cada pedaço num dia diferente">
                    <Checkbox checked={valor.espalhar} onCheckedChange={(v) => onChange({ ...valor, espalhar: v === true })} />
                    Espalhar na semana
                </label>
            )}

            {aulasSemana > 1 &&
                (divisoes.length === 0 ? (
                    <p className="rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive">Nenhuma divisão atende a estes limites.</p>
                ) : (
                    <p className="rounded-2xl bg-muted px-3 py-2 text-xs tabular-nums">
                        <span className="text-muted-foreground">Permite: </span>
                        {textoDasDivisoes(divisoes, 10)}
                    </p>
                ))}
        </>
    );
}

/** "Blocos de [mín] a [máx] aulas", com o máximo podendo ficar vazio (sem limite). */
function Intervalo({ rotulo, sufixo, min, max, onChange }: { rotulo: string; sufixo: string; min: number; max: number | null; onChange: (min: number, max: number | null) => void }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="w-20 shrink-0">{rotulo}</span>
            <CampoNumero aria-label={`${rotulo}: mínimo`} className="h-8 w-12" min={1} max={30} valor={min} onChange={(n) => onChange(n, max)} />
            a
            <CampoOpcional aria-label={`${rotulo}: máximo`} className="h-8 w-12" valor={max} onChange={(n) => onChange(min, n)} />
            <span className="text-muted-foreground">{sufixo}</span>
        </div>
    );
}
