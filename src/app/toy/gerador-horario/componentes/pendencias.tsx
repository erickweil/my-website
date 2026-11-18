/**
 * Como as pendências aparecem: vermelho para o que impede um horário completo, amarelo para avisos.
 * Toda tela usa estes componentes, para a mesma cor e o mesmo ícone significarem a mesma coisa.
 */

import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { diagnosticar, type Pendencia } from "../modelo/diagnostico";
import type { Cadastros, ProjetoHorario } from "../modelo/modelo";
import { ListaComLimite, plural } from "./comuns";

export type Marca = "erro" | "aviso" | null;

/**
 * As pendências do projeto (ver modelo/diagnostico.ts). Só são recalculadas quando mudam os dados
 * que o diagnóstico olha — não quando muda o horário gerado (fixar uma aula, uma atualização da
 * busca), que é o que acontece o tempo todo na tela do horário.
 */
export function usePendencias(projeto: ProjetoHorario | null, cadastros: Cadastros): Pendencia[] {
    const { quadro, turmas, ofertas, docentes } = projeto ?? {};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- de propósito: o horário gerado não entra
    return useMemo(() => (projeto ? diagnosticar(projeto, cadastros) : []), [quadro, turmas, ofertas, docentes, cadastros]);
}

/** A marca de um item (turma, professor…) a partir das pendências dele. */
export const marcaDe = (pendencias: Pendencia[]): Marca =>
    pendencias.some((p) => p.gravidade === "erro") ? "erro" : pendencias.length > 0 ? "aviso" : null;

/** Bolinha ao lado de um nome: o item tem uma pendência (vermelha) ou um aviso (amarela). */
export function MarcaDePendencia({ marca, className }: { marca: Marca; className?: string }) {
    if (!marca) return null;
    return (
        <span
            className={cn("size-2 shrink-0 rounded-full", marca === "erro" ? "bg-destructive" : "bg-amber-500", className)}
            title={marca === "erro" ? "Tem pendências que impedem um horário completo" : "Tem avisos"}
        />
    );
}

const ROTULO_DA_TELA: Record<Pendencia["tela"], string> = { quadro: "Quadro", turmas: "Turmas", aulas: "Aulas", docentes: "Docentes" };

const ordenar = (ps: Pendencia[]) => [...ps].sort((a, b) => (a.gravidade === b.gravidade ? 0 : a.gravidade === "erro" ? -1 : 1));

const corDoCartao = (temErro: boolean) => (temErro ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5");

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

/** Avisos do que se corrige na tela atual (já filtrados por quem chama). Nada aparece se não houver. */
export function AvisosDaTela({ pendencias, className }: { pendencias: Pendencia[]; className?: string }) {
    if (pendencias.length === 0) return null;
    return (
        <div className={cn("rounded-2xl border px-4 py-2.5 text-sm", corDoCartao(pendencias.some((p) => p.gravidade === "erro")), className)}>
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
        <div className={cn("rounded-2xl border text-sm", corDoCartao(erros > 0))}>
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
