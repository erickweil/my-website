"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
    ArrowLeft,
    BookOpen,
    CalendarDays,
    Clock,
    DoorOpen,
    FolderOpen,
    GraduationCap,
    Menu,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Sun,
    UserCheck,
    Users,
    X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { diagnosticar, type Pendencia } from "./modelo/diagnostico";
import type { Id } from "./modelo/modelo";
import { Selecao, Vazio } from "./componentes/comuns";
import { TelaAmbientes } from "./telas/TelaAmbientes";
import { TelaCursos } from "./telas/TelaCursos";
import { TelaDocentes } from "./telas/TelaDocentes";
import { TelaHorario } from "./telas/TelaHorario";
import { TelaProfessores } from "./telas/TelaProfessores";
import { TelaProjetos } from "./telas/TelaProjetos";
import { TelaQuadro } from "./telas/TelaQuadro";
import { TelaTurmas, type AbaDaTurma } from "./telas/TelaTurmas";
import { useAreaDeTrabalho } from "./useAreaDeTrabalho";

type Tela = "projetos" | "cursos" | "ambientes" | "professores" | "quadro" | "turmas" | "docentes" | "horario";

interface Item {
    id: Tela;
    rotulo: string;
    icone: typeof Clock;
    /** Só faz sentido com um projeto aberto. */
    doProjeto?: boolean;
}

const DO_PROJETO: Item[] = [
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
const PROJETOS: Item = { id: "projetos", rotulo: "Projetos", icone: FolderOpen };

const CHAVE_MENU_RECOLHIDO = "geradorHorario:menuRecolhido";

/** Em qual tela se corrige cada pendência (as de aulas ficam na aba de aulas da turma). */
const TELA_DA_PENDENCIA: Record<Pendencia["tela"], Tela> = { quadro: "quadro", turmas: "turmas", aulas: "turmas", docentes: "docentes" };

export default function GeradorHorario() {
    const estado = useAreaDeTrabalho();
    const { area, projeto, mudarArea } = estado;
    // Quem nunca criou nada cai na lista de projetos; quem já tem, no horário do último aberto
    const [tela, setTela] = useState<Tela>(projeto ? "horario" : "projetos");
    const [turmaAberta, setTurmaAberta] = useState<Id | null>(null);
    const [abaDaTurma, setAbaDaTurma] = useState<AbaDaTurma>("horarios");
    const [professorFoco, setProfessorFoco] = useState<Id | null>(null);
    const [recolhido, setRecolhido] = useState(() => localStorage.getItem(CHAVE_MENU_RECOLHIDO) === "1");
    const [maisAberto, setMaisAberto] = useState(false);
    useEffect(() => localStorage.setItem(CHAVE_MENU_RECOLHIDO, recolhido ? "1" : "0"), [recolhido]);

    if (estado.erroDeLeitura) {
        return (
            <main className="mx-auto max-w-2xl px-4 py-10">
                <Alert variant="destructive">
                    <AlertTitle>Os dados salvos neste navegador não puderam ser lidos</AlertTitle>
                    <AlertDescription>
                        <pre className="my-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{estado.erroDeLeitura}</pre>
                        <p>Nada foi apagado. Recarregue a página para tentar de novo, ou comece do zero (substitui o que está salvo).</p>
                        <Button className="mt-3" variant="destructive" onClick={estado.descartarSalvo}>
                            Começar do zero
                        </Button>
                    </AlertDescription>
                </Alert>
            </main>
        );
    }

    const contexto = { area, mudarArea };
    /** Pendências que impedem o horário, por tela, para a marca no menu. */
    const errosPorTela: Partial<Record<Tela, number>> = {};
    if (projeto) {
        for (const p of diagnosticar(projeto, area.cadastros)) {
            const t = TELA_DA_PENDENCIA[p.tela];
            if (p.gravidade === "erro") errosPorTela[t] = (errosPorTela[t] ?? 0) + 1;
        }
    }
    const ir = (t: Tela) => {
        setTela(t);
        setMaisAberto(false);
        window.scrollTo({ top: 0 });
    };
    /** Abre a tela em que uma pendência se corrige, já na turma ou no professor dela. */
    const irPara = (p: Pendencia) => {
        if (p.turmaId) setTurmaAberta(p.turmaId);
        if (p.tela === "aulas") setAbaDaTurma("aulas");
        else if (p.tela === "turmas") setAbaDaTurma("horarios");
        setProfessorFoco(p.professorId ?? null);
        ir(TELA_DA_PENDENCIA[p.tela]);
    };
    const doProjeto = projeto && { ...contexto, projeto, mudarProjeto: estado.mudarProjeto, salvarHorario: estado.salvarHorario };
    const abrir = (id: Id, destino: Tela = "horario") => {
        estado.abrirProjeto(id);
        setTurmaAberta(null);
        ir(destino);
    };

    const props = { tela, ir, projetoAberto: !!projeto, errosPorTela };

    return (
        <div className="min-h-screen md:flex print:block">
            {/* Computador: menu lateral, que pode ser recolhido até ficar só com os ícones */}
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
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        title={recolhido ? "Abrir o menu" : "Recolher o menu"}
                        aria-label={recolhido ? "Abrir o menu" : "Recolher o menu"}
                        onClick={() => setRecolhido(!recolhido)}
                    >
                        {recolhido ? <PanelLeftOpen /> : <PanelLeftClose />}
                    </Button>
                </div>
                <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2" aria-label="Gerador de horários">
                    <GrupoDoMenu titulo={projeto ? projeto.nome || "Projeto" : "Projeto"} itens={DO_PROJETO} recolhido={recolhido} {...props} />
                    <GrupoDoMenu titulo="Cadastros" itens={CADASTROS} recolhido={recolhido} {...props} />
                    <div className="mt-auto">
                        <GrupoDoMenu itens={[PROJETOS]} recolhido={recolhido} {...props} />
                    </div>
                </nav>
            </aside>

            <div className="min-w-0 flex-1">
                <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur md:px-6 print:hidden">
                    <Link href="/" title="Voltar ao site" aria-label="Voltar ao site" className="text-muted-foreground hover:text-foreground md:hidden">
                        <ArrowLeft className="size-5" />
                    </Link>
                    {area.projetos.length > 0 ? (
                        <Selecao
                            aria-label="Projeto aberto"
                            className="min-w-0 flex-1 font-medium sm:max-w-xs sm:flex-none"
                            value={projeto?.id ?? ""}
                            onChange={(e) => abrir(e.target.value, tela === "projetos" ? "horario" : tela)}
                        >
                            {area.projetos.map((p) => (
                                <option key={p.id} value={p.id}>{p.nome || "(sem nome)"}</option>
                            ))}
                        </Selecao>
                    ) : (
                        <span className="flex-1 font-semibold md:hidden">Gerador de Horários</span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                        <BotaoDeTema />
                    </div>
                </header>

                <main className="mx-auto max-w-6xl px-3 pt-4 pb-28 md:px-6 md:py-6 print:max-w-none print:p-0">
                    {tela === "projetos" && (
                        <TelaProjetos
                            {...contexto}
                            projetoAbertoId={projeto?.id ?? null}
                            abrir={abrir}
                        />
                    )}
                    {tela === "professores" && <TelaProfessores {...contexto} />}
                    {tela === "cursos" && <TelaCursos {...contexto} />}
                    {tela === "ambientes" && <TelaAmbientes {...contexto} />}
                    {DO_PROJETO.some((i) => i.id === tela) && !doProjeto && <Vazio>Crie ou abra um projeto em “Projetos”.</Vazio>}
                    {doProjeto && tela === "quadro" && <TelaQuadro {...doProjeto} />}
                    {doProjeto && tela === "turmas" && (
                        <TelaTurmas {...doProjeto} turmaAberta={turmaAberta} abrirTurma={setTurmaAberta} aba={abaDaTurma} mudarAba={setAbaDaTurma} />
                    )}
                    {doProjeto && tela === "docentes" && <TelaDocentes key={professorFoco} professorInicial={professorFoco} {...doProjeto} />}
                    {doProjeto && tela === "horario" && <TelaHorario key={doProjeto.projeto.id} {...doProjeto} irPara={irPara} />}
                </main>
            </div>

            {/* Celular: barra embaixo, com o horário no meio e o resto no "Mais" */}
            <BarraDoCelular {...props} maisAberto={maisAberto} setMaisAberto={setMaisAberto} />
        </div>
    );
}

interface PropsDoMenu {
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

function BarraDoCelular({ tela, ir, projetoAberto, errosPorTela, maisAberto, setMaisAberto }: PropsDoMenu & { maisAberto: boolean; setMaisAberto: (v: boolean) => void }) {
    const [quadro, turmas, docentes, horario] = DO_PROJETO;
    const noMais = [...CADASTROS, PROJETOS];
    const mais = noMais.some((i) => i.id === tela);
    return (
        <div className="md:hidden print:hidden">
            {maisAberto && (
                <>
                    <button type="button" aria-label="Fechar o menu" className="fixed inset-0 z-40 bg-black/30" onClick={() => setMaisAberto(false)} />
                    <div className="fixed inset-x-2 bottom-[4.5rem] z-50 rounded-2xl border border-border bg-background p-2 shadow-lg">
                        <p className="px-3 pt-1 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Cadastros e projetos</p>
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
