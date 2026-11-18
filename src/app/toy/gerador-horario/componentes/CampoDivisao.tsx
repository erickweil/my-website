import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Divisao } from "../modelo/modelo";
import { divisoesAceitas, nomeDaDivisao, personalizar, regrasDaDivisao, textoDasDivisoes } from "../modelo/divisao";
import { CampoNumero } from "./comuns";

type Pedacos = Divisao["pedacos"];
type Regras = Extract<Pedacos, { tipo: "regras" }>;

/**
 * Como as aulas da disciplina se dividem em pedaços (trechos de aulas seguidas no mesmo dia). O
 * campo mostra a escolha e as divisões que ela aceita; ao clicar, abre o editor: livre, blocos de
 * N (emendando ou não) ou regras personalizadas, e a preferência de um pedaço por dia.
 */
export function CampoDivisao({ valor, aulasSemana, onChange }: { valor: Divisao; aulasSemana: number; onChange: (d: Divisao) => void }) {
    const divisoes = divisoesAceitas(regrasDaDivisao(valor, aulasSemana), aulasSemana);
    const nenhuma = aulasSemana > 0 && divisoes.length === 0;
    return (
        <Popover>
            <PopoverTrigger
                type="button"
                title={nenhuma ? "Nenhuma divisão das aulas atende a estas regras" : `Aceita: ${textoDasDivisoes(divisoes, 12)}`}
                className={cn(
                    "flex min-h-8 w-full items-center gap-1 rounded-3xl border bg-input/30 px-2.5 py-1 text-left hover:border-foreground/30",
                    nenhuma ? "border-destructive" : "border-border",
                )}
            >
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                        {nomeDaDivisao(valor)}
                        {valor.espalhar && <span className="text-muted-foreground"> · 1/dia</span>}
                    </span>
                    {aulasSemana > 1 && (
                        <span className={cn("block truncate text-xs", nenhuma ? "text-destructive" : "text-muted-foreground")}>
                            {nenhuma ? "nenhuma divisão possível" : textoDasDivisoes(divisoes, 3)}
                        </span>
                    )}
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[22rem] max-w-[calc(100vw-2rem)] gap-3 p-3 text-sm">
                <EditorDeDivisao valor={valor} aulasSemana={aulasSemana} divisoes={divisoes} onChange={onChange} />
            </PopoverContent>
        </Popover>
    );
}

const MODOS: { tipo: Pedacos["tipo"]; rotulo: string }[] = [
    { tipo: "livre", rotulo: "Livre" },
    { tipo: "blocos", rotulo: "Blocos" },
    { tipo: "regras", rotulo: "Personalizada" },
];

function EditorDeDivisao({ valor, aulasSemana, divisoes, onChange }: { valor: Divisao; aulasSemana: number; divisoes: number[][]; onChange: (d: Divisao) => void }) {
    const p = valor.pedacos;
    const mudarPedacos = (pedacos: Pedacos) => onChange({ ...valor, pedacos });
    const escolherModo = (tipo: Pedacos["tipo"]) => {
        if (tipo === p.tipo) return;
        if (tipo === "livre") mudarPedacos({ tipo: "livre" });
        else if (tipo === "blocos") mudarPedacos({ tipo: "blocos", tamanho: 2, emendar: true });
        // Personalizar parte das regras equivalentes à escolha atual
        else onChange(personalizar(valor, aulasSemana));
    };

    return (
        <>
            <div>
                <p className="font-medium">Divisão das {aulasSemana === 1 ? "aulas" : `${aulasSemana} aulas`}</p>
                <p className="text-xs text-muted-foreground">Um pedaço é um trecho de aulas seguidas da disciplina no mesmo dia.</p>
            </div>

            <div className="grid grid-cols-3 gap-1 rounded-3xl bg-muted p-1" role="radiogroup" aria-label="Tipo de divisão">
                {MODOS.map((m) => (
                    <button
                        key={m.tipo}
                        type="button"
                        role="radio"
                        aria-checked={p.tipo === m.tipo}
                        onClick={() => escolherModo(m.tipo)}
                        className={cn("rounded-3xl px-2 py-1 text-xs font-medium transition-colors", p.tipo === m.tipo ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                    >
                        {m.rotulo}
                    </button>
                ))}
            </div>

            {p.tipo === "livre" && <p className="text-xs text-muted-foreground">As aulas podem ficar soltas ou seguidas, em qualquer combinação.</p>}

            {p.tipo === "blocos" && (
                <div className="space-y-2">
                    <label className="flex items-center gap-2">
                        Blocos de
                        <CampoNumero aria-label="Aulas por bloco" className="h-8 w-16" min={2} max={12} valor={p.tamanho} onChange={(tamanho) => mudarPedacos({ ...p, tamanho })} />
                        aulas seguidas
                    </label>
                    <label className="flex items-center gap-2">
                        <Checkbox checked={p.emendar} onCheckedChange={(v) => mudarPedacos({ ...p, emendar: v === true })} />
                        Pode emendar blocos ({p.tamanho}+{p.tamanho} vira {2 * p.tamanho})
                    </label>
                    <p className="text-xs text-muted-foreground">
                        O que sobra fica num pedaço menor (5 aulas em blocos de 2: 2+2+1).
                    </p>
                </div>
            )}

            {p.tipo === "regras" && <EditorDeRegras regras={p} onChange={mudarPedacos} />}

            <label className="flex items-start gap-2">
                <Checkbox className="mt-0.5" checked={valor.espalhar} onCheckedChange={(v) => onChange({ ...valor, espalhar: v === true })} />
                <span>
                    De preferência um pedaço por dia
                    <span className="block text-xs text-muted-foreground">Preferência: o horário pode não atender, se não houver como.</span>
                </span>
            </label>

            {aulasSemana > 1 && (
                divisoes.length === 0 ? (
                    <p className="rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        Nenhuma divisão de {aulasSemana} aulas atende a estas regras.
                    </p>
                ) : (
                    <p className="rounded-2xl bg-muted px-3 py-2 text-xs">
                        <span className="text-muted-foreground">Aceita: </span>
                        {textoDasDivisoes(divisoes, 8)}
                    </p>
                )
            )}
        </>
    );
}

/** Tamanho e quantidade dos pedaços, e limites por tamanho. */
function EditorDeRegras({ regras, onChange }: { regras: Regras; onChange: (r: Regras) => void }) {
    const mudar = (campos: Partial<Regras>) => onChange({ ...regras, ...campos });
    const porTamanho = regras.porTamanho;
    const mudarLimite = (i: number, campos: Partial<Regras["porTamanho"][number]>) =>
        mudar({ porTamanho: porTamanho.map((x, j) => (j === i ? { ...x, ...campos } : x)) });
    return (
        <div className="space-y-2">
            <Intervalo
                rotulo="Tamanho de cada pedaço"
                min={regras.tamanhoMin}
                max={regras.tamanhoMax}
                onChange={(tamanhoMin, tamanhoMax) => mudar({ tamanhoMin, tamanhoMax })}
            />
            <Intervalo
                rotulo="Pedaços na semana"
                min={regras.quantidadeMin}
                max={regras.quantidadeMax}
                onChange={(quantidadeMin, quantidadeMax) => mudar({ quantidadeMin, quantidadeMax })}
            />
            <div>
                <p className="mb-1">Por tamanho</p>
                {porTamanho.length === 0 && <p className="text-xs text-muted-foreground">Sem limite para nenhum tamanho.</p>}
                {porTamanho.map((x, i) => (
                    <div key={i} className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
                        pedaços de
                        <CampoNumero aria-label="Tamanho do pedaço" className="h-7 w-12" min={1} max={30} valor={x.tamanho} onChange={(tamanho) => mudarLimite(i, { tamanho })} />
                        aulas: de
                        <CampoNumero aria-label="Mínimo de pedaços" className="h-7 w-12" min={0} max={30} valor={x.min} onChange={(min) => mudarLimite(i, { min })} />
                        a
                        <CampoNumero aria-label="Máximo de pedaços" className="h-7 w-12" min={0} max={30} valor={x.max} onChange={(max) => mudarLimite(i, { max })} />
                        <button type="button" title="Tirar o limite" className="text-muted-foreground hover:text-destructive" onClick={() => mudar({ porTamanho: porTamanho.filter((_, j) => j !== i) })}>
                            <X className="size-3.5" />
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium underline"
                    onClick={() => mudar({ porTamanho: [...porTamanho, { tamanho: 1, min: 0, max: 1 }] })}
                >
                    <Plus className="size-3" /> limite para um tamanho
                </button>
            </div>
        </div>
    );
}

/** "Rótulo: de [mín] a [máx]", com o máximo podendo ficar vazio (sem limite). */
function Intervalo({ rotulo, min, max, onChange }: { rotulo: string; min: number; max: number | null; onChange: (min: number, max: number | null) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 flex-1">{rotulo}</span>
            de
            <CampoNumero aria-label={`${rotulo}: mínimo`} className="h-7 w-12" min={1} max={30} valor={min} onChange={(n) => onChange(n, max)} />
            a
            <CampoOpcional aria-label={`${rotulo}: máximo`} valor={max} onChange={(n) => onChange(min, n)} />
        </div>
    );
}

/** Número inteiro positivo ou vazio (= sem limite). */
function CampoOpcional({ valor, onChange, ...props }: { valor: number | null; onChange: (n: number | null) => void } & Omit<React.ComponentProps<"input">, "onChange" | "value">) {
    const [texto, setTexto] = useState<string | null>(null);
    return (
        <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            placeholder="∞"
            title="Vazio = sem limite"
            className="h-7 w-12 text-center"
            value={texto ?? (valor === null ? "" : String(valor))}
            onChange={(e) => {
                setTexto(e.target.value);
                if (e.target.value === "") onChange(null);
                else {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1 && n <= 30) onChange(n);
                }
            }}
            onBlur={() => setTexto(null)}
            {...props}
        />
    );
}
