/**
 * A navegação do gerador: menu lateral (computador, recolhível), barra do topo (projeto aberto,
 * projetos e tema) e barra de baixo (celular, com o horário em destaque e o resto no "Mais").
 */

import Link from "next/link";
import { useTheme } from "next-themes";
import { ArrowLeft, BookOpen, CalendarDays, Clock, DoorOpen, FolderOpen, GraduationCap, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, UserCheck, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjetoHorario } from "../modelo/modelo";
import { Selecao } from "./campos";

export type Tela = "projetos" | "cursos" | "ambientes" | "professores" | "quadro" | "turmas" | "docentes" | "horario";

interface Item {
    id: Tela;
    rotulo: string;
    icone: typeof Clock;
    /** Só faz sentido com um projeto aberto. */
    doProjeto?: boolean;
}

export const DO_PROJETO: Item[] = [
    { id: "quadro", rotulo: "Quadro", icone: Clock, doProjeto: true },
    { id: "turmas", rotulo: "Turmas", icone: GraduationCap, doProjeto: true },
    { id: "docentes", rotulo: "Docentes", icone: UserCheck, doProjeto: true },
    { id: "horario", rotulo: "Horário", icone: CalendarDays, doProjeto: true },
];
const CADASTROS: Item[] = [
    { id: "cursos", rotulo: "Cursos", icone: BookOpen },
    { id: "professores", rotulo: "Professores", icone: Users },
    { id: "ambientes", rotulo: "Ambientes", icone: DoorOpen },
];

export function MenuLateral({ recolhido, onRecolher, nomeDoProjeto, ...props }: PropsDoMenu & { recolhido: boolean; onRecolher: () => void; nomeDoProjeto?: string }) {
    return (
        <aside
            className={cn(
                "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-muted/30 transition-[width] md:flex print:hidden",
                recolhido ? "w-16" : "w-60",
            )}
        >
            <div className={cn("flex h-14 items-center gap-2 border-b border-border px-3", recolhido && "justify-center px-0")}>
                {!recolhido && (
                    <Link href="/" title="Voltar ao site" className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
                        <CalendarDays className="size-5 shrink-0 text-primary" />
                        <span className="truncate">Gerador de Horários</span>
                    </Link>
                )}
                <Button variant="ghost" size="icon-sm" title={recolhido ? "Abrir o menu" : "Recolher o menu"} aria-label={recolhido ? "Abrir o menu" : "Recolher o menu"} onClick={onRecolher}>
                    {recolhido ? <PanelLeftOpen /> : <PanelLeftClose />}
                </Button>
            </div>
            <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2" aria-label="Gerador de horários">
                <GrupoDoMenu titulo={nomeDoProjeto || "Projeto"} itens={DO_PROJETO} recolhido={recolhido} {...props} />
                <GrupoDoMenu titulo="Cadastros" itens={CADASTROS} recolhido={recolhido} {...props} />
            </nav>
        </aside>
    );
}

/** Barra do topo: o projeto aberto (trocar), o botão de projetos e o tema. */
export function BarraDoTopo({ projetos, projetoId, onTrocar, telaDeProjetos, onProjetos }: {
    projetos: ProjetoHorario[];
    projetoId: string | null;
    onTrocar: (id: string) => void;
    telaDeProjetos: boolean;
    onProjetos: () => void;
}) {
    return (
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur md:px-6 print:hidden">
            <Link href="/" title="Voltar ao site" aria-label="Voltar ao site" className="text-muted-foreground hover:text-foreground md:hidden">
                <ArrowLeft className="size-5" />
            </Link>
            {projetos.length > 0 ? (
                <Selecao aria-label="Projeto aberto" className="min-w-0 flex-1 font-medium sm:max-w-xs sm:flex-none" value={projetoId ?? ""} onChange={(e) => onTrocar(e.target.value)}>
                    {projetos.map((p) => (
                        <option key={p.id} value={p.id}>{p.nome || "(sem nome)"}</option>
                    ))}
                </Selecao>
            ) : (
                <span className="flex-1 font-semibold md:hidden">Gerador de Horários</span>
            )}
            <Button variant={telaDeProjetos ? "default" : "outline"} title="Criar, importar e exportar projetos" aria-label="Projetos" onClick={onProjetos}>
                <FolderOpen /> <span className="hidden sm:inline">Projetos</span>
            </Button>
            <div className="ml-auto">
                <BotaoDeTema />
            </div>
        </header>
    );
}

export interface PropsDoMenu {
    tela: Tela;
    ir: (t: Tela) => void;
    projetoAberto: boolean;
    errosPorTela: Partial<Record<Tela, number>>;
}

function GrupoDoMenu({ titulo, itens, recolhido, tela, ir, projetoAberto, errosPorTela }: PropsDoMenu & { titulo?: string; itens: Item[]; recolhido: boolean }) {
    return (
        <div className="flex flex-col gap-0.5">
            {titulo && !recolhido && <p className="truncate px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase" title={titulo}>{titulo}</p>}
            {titulo && recolhido && <div className="mx-3 mb-1 border-t border-border" />}
            {itens.map(({ id, rotulo, icone: Icone, doProjeto }) => {
                const erros = errosPorTela[id] ?? 0;
                return (
                    <button
                        key={id}
                        type="button"
                        disabled={doProjeto && !projetoAberto}
                        onClick={() => ir(id)}
                        title={recolhido ? rotulo : undefined}
                        aria-label={recolhido ? rotulo : undefined}
                        aria-current={tela === id ? "page" : undefined}
                        className={cn(
                            "relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
                            recolhido && "justify-center px-0",
                            tela === id ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted hover:text-foreground",
                        )}
                    >
                        <Icone className="size-4 shrink-0" />
                        {!recolhido && <span className="flex-1 truncate text-left">{rotulo}</span>}
                        {erros > 0 &&
                            (recolhido ? (
                                <span className="absolute top-1.5 right-3 size-2 rounded-full bg-destructive" />
                            ) : (
                                <span className="rounded-full bg-destructive px-1.5 text-xs font-semibold text-white" title="Pendências que impedem um horário completo">
                                    {erros}
                                </span>
                            ))}
                    </button>
                );
            })}
        </div>
    );
}

export function BarraDoCelular({ tela, ir, projetoAberto, errosPorTela, maisAberto, setMaisAberto }: PropsDoMenu & { maisAberto: boolean; setMaisAberto: (v: boolean) => void }) {
    const [quadro, turmas, docentes, horario] = DO_PROJETO;
    const noMais = CADASTROS;
    const mais = noMais.some((i) => i.id === tela);
    return (
        <div className="md:hidden print:hidden">
            {maisAberto && (
                <>
                    <button type="button" aria-label="Fechar o menu" className="fixed inset-0 z-40 bg-black/30" onClick={() => setMaisAberto(false)} />
                    <div className="fixed inset-x-2 bottom-[4.5rem] z-50 rounded-2xl border border-border bg-background p-2 shadow-lg">
                        <p className="px-3 pt-1 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Cadastros</p>
                        {noMais.map(({ id, rotulo, icone: Icone }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => ir(id)}
                                className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium", tela === id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                            >
                                <Icone className="size-5" /> {rotulo}
                            </button>
                        ))}
                    </div>
                </>
            )}
            <nav className="fixed inset-x-0 bottom-0 z-40 flex items-end border-t border-border bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="Gerador de horários">
                <BotaoDaBarra item={quadro} tela={tela} ir={ir} projetoAberto={projetoAberto} errosPorTela={errosPorTela} />
                <BotaoDaBarra item={turmas} tela={tela} ir={ir} projetoAberto={projetoAberto} errosPorTela={errosPorTela} />
                {/* O horário, em destaque no meio */}
                <button
                    type="button"
                    disabled={!projetoAberto}
                    onClick={() => ir("horario")}
                    aria-current={tela === "horario" ? "page" : undefined}
                    className="flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1.5 text-[0.7rem] font-medium disabled:opacity-40"
                >
                    <span
                        className={cn(
                            "-mt-5 flex size-12 items-center justify-center rounded-full border-4 border-background shadow-md",
                            tela === "horario" ? "bg-primary text-primary-foreground" : "bg-primary/90 text-primary-foreground",
                        )}
                    >
                        <horario.icone className="size-5" />
                    </span>
                    <span className={tela === "horario" ? "text-primary" : "text-muted-foreground"}>{horario.rotulo}</span>
                </button>
                <BotaoDaBarra item={docentes} tela={tela} ir={ir} projetoAberto={projetoAberto} errosPorTela={errosPorTela} />
                <button
                    type="button"
                    onClick={() => setMaisAberto(!maisAberto)}
                    aria-expanded={maisAberto}
                    className={cn("flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-[0.7rem] font-medium", mais || maisAberto ? "text-primary" : "text-muted-foreground")}
                >
                    {maisAberto ? <X className="size-5" /> : <Menu className="size-5" />}
                    Mais
                </button>
            </nav>
        </div>
    );
}

function BotaoDaBarra({ item, tela, ir, projetoAberto, errosPorTela }: PropsDoMenu & { item: Item }) {
    return (
        <button
            type="button"
            disabled={item.doProjeto && !projetoAberto}
            onClick={() => ir(item.id)}
            aria-current={tela === item.id ? "page" : undefined}
            className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-[0.7rem] font-medium transition-colors disabled:opacity-40",
                tela === item.id ? "text-primary" : "text-muted-foreground",
            )}
        >
            <span className="relative">
                <item.icone className="size-5" />
                {(errosPorTela[item.id] ?? 0) > 0 && <span className="absolute -top-1 -right-1.5 size-2 rounded-full bg-destructive" />}
            </span>
            {item.rotulo}
        </button>
    );
}

function BotaoDeTema() {
    const { resolvedTheme, setTheme } = useTheme();
    const escuro = resolvedTheme === "dark";
    return (
        <Button variant="ghost" size="icon-sm" title={escuro ? "Tema claro" : "Tema escuro"} aria-label={escuro ? "Tema claro" : "Tema escuro"} onClick={() => setTheme(escuro ? "light" : "dark")}>
            {escuro ? <Sun /> : <Moon />}
        </Button>
    );
}
