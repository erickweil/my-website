"use client";

import { useState } from "react";
import { BookOpen, CalendarDays, Clock, DoorOpen, FolderOpen, GraduationCap, LayoutGrid, UserCheck, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { diagnosticar, type Pendencia } from "./modelo/diagnostico";
import type { Id } from "./modelo/modelo";
import { Selecao, Vazio } from "./componentes/comuns";
import { TelaAmbientes } from "./telas/TelaAmbientes";
import { TelaAulas } from "./telas/TelaAulas";
import { TelaCursos } from "./telas/TelaCursos";
import { TelaDocentes } from "./telas/TelaDocentes";
import { TelaHorario } from "./telas/TelaHorario";
import { TelaProfessores } from "./telas/TelaProfessores";
import { TelaProjetos } from "./telas/TelaProjetos";
import { TelaQuadro } from "./telas/TelaQuadro";
import { TelaTurmas } from "./telas/TelaTurmas";
import { useAreaDeTrabalho } from "./useAreaDeTrabalho";

type Tela = "projetos" | "cursos" | "ambientes" | "professores" | "quadro" | "turmas" | "aulas" | "docentes" | "horario";

const MENU: { grupo: string; itens: { id: Tela; rotulo: string; curto?: string; icone: typeof Clock; doProjeto?: boolean }[] }[] = [
    {
        grupo: "Cadastros",
        itens: [
            { id: "cursos", rotulo: "Cursos", icone: BookOpen },
            { id: "professores", rotulo: "Professores", curto: "Profs.", icone: Users },
            { id: "ambientes", rotulo: "Ambientes", curto: "Salas", icone: DoorOpen },
        ],
    },
    {
        grupo: "Projeto",
        itens: [
            { id: "quadro", rotulo: "Quadro de horários", curto: "Quadro", icone: Clock, doProjeto: true },
            { id: "turmas", rotulo: "Turmas", icone: GraduationCap, doProjeto: true },
            { id: "aulas", rotulo: "Aulas", icone: LayoutGrid, doProjeto: true },
            { id: "docentes", rotulo: "Docentes", icone: UserCheck, doProjeto: true },
            { id: "horario", rotulo: "Horário", icone: CalendarDays, doProjeto: true },
        ],
    },
];

export default function GeradorHorario() {
    const estado = useAreaDeTrabalho();
    const { area, projeto, mudarArea } = estado;
    const [tela, setTela] = useState<Tela>(projeto ? "horario" : "projetos");
    /** Turma aberta na tela de aulas (para "ver aulas da turma" levar direto a ela). */
    const [turmaDasAulas, setTurmaDasAulas] = useState<Id | null>(null);
    /** Turma ou professor a abrir nas telas de turmas e docentes, ao vir de uma pendência. */
    const [foco, setFoco] = useState<{ turmaId: Id | null; professorId: Id | null }>({ turmaId: null, professorId: null });

    if (estado.erroDeLeitura) {
        return (
            <main className="mx-auto max-w-2xl px-4 py-10">
                <Alert variant="destructive">
                    <AlertTitle>Os dados salvos neste navegador não puderam ser lidos</AlertTitle>
                    <AlertDescription>
                        <pre className="my-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{estado.erroDeLeitura}</pre>
                        <p>Nada foi apagado. Você pode recarregar a página para tentar de novo, ou começar do zero (o que substitui o conteúdo salvo).</p>
                        <Button className="mt-3" variant="destructive" onClick={estado.descartarSalvo}>
                            Começar do zero
                        </Button>
                    </AlertDescription>
                </Alert>
            </main>
        );
    }

    const contexto = { area, mudarArea };
    const ehCadastro = tela === "cursos" || tela === "professores" || tela === "ambientes";
    /** Erros do projeto por tela, para o contador no menu. */
    const errosPorTela: Record<string, number> = {};
    if (projeto) {
        for (const p of diagnosticar(projeto, area.cadastros)) {
            if (p.gravidade === "erro") errosPorTela[p.tela] = (errosPorTela[p.tela] ?? 0) + 1;
        }
    }
    /** Abre a tela em que uma pendência se corrige, já na turma ou no professor dela. */
    const irPara = (p: Pendencia) => {
        setFoco({ turmaId: p.turmaId ?? null, professorId: p.professorId ?? null });
        if (p.turmaId) setTurmaDasAulas(p.turmaId);
        setTela(p.tela);
    };
    const doProjeto = projeto && { ...contexto, projeto, mudarProjeto: estado.mudarProjeto, salvarHorario: estado.salvarHorario };
    const abrir = (id: Id, destino: Tela = "quadro") => {
        estado.abrirProjeto(id);
        setTurmaDasAulas(null);
        setTela(destino);
    };

    return (
        <main className="mx-auto min-h-screen max-w-7xl px-3 pt-4 pb-24 md:px-4 md:py-6 print:p-0">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-2 md:mb-6 print:hidden">
                <h1 className="text-xl font-bold md:text-2xl">Gerador de Horários</h1>
                <div className="flex items-center gap-2">
                    {area.projetos.length > 0 && (
                        <Selecao aria-label="Projeto aberto" className="max-w-40 md:max-w-xs" value={projeto?.id ?? ""} onChange={(e) => abrir(e.target.value, tela === "projetos" ? "quadro" : tela)}>
                            {area.projetos.map((p) => (
                                <option key={p.id} value={p.id}>{p.nome || "(sem nome)"}</option>
                            ))}
                        </Selecao>
                    )}
                    <Button variant={tela === "projetos" ? "default" : "outline"} title="Projetos" onClick={() => setTela("projetos")}>
                        <FolderOpen /> <span className="hidden sm:inline">Projetos</span>
                    </Button>
                </div>
            </header>

            <div className="grid gap-6 md:grid-cols-[13rem_1fr] print:block">
                {/* Computador: menu lateral. Celular: barra fixa embaixo, como num aplicativo. */}
                <nav className="fixed inset-x-0 bottom-0 z-40 flex print:hidden justify-around border-t border-border bg-background/95 px-1 py-1 backdrop-blur md:static md:block md:border-0 md:bg-transparent md:p-0">
                    <button
                        type="button"
                        onClick={() => setTela(ehCadastro ? tela : "cursos")}
                        className={cn(
                            "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[0.65rem] font-medium transition-colors md:hidden",
                            ehCadastro ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                        )}
                    >
                        <BookOpen className="size-5" />
                        Cadastros
                    </button>
                    {MENU.map(({ grupo, itens }) => (
                        <div key={grupo} className={cn("md:mb-4 md:flex md:flex-col md:gap-1", grupo === "Cadastros" ? "hidden" : "contents")}>
                            <p className="hidden px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase md:block">
                                {grupo === "Projeto" && projeto ? projeto.nome || "Projeto" : grupo}
                            </p>
                            {itens.map(({ id, rotulo, curto, icone: Icone, doProjeto: precisaDeProjeto }) => (
                                <button
                                    key={id}
                                    type="button"
                                    disabled={precisaDeProjeto && !projeto}
                                    onClick={() => setTela(id)}
                                    aria-current={tela === id ? "page" : undefined}
                                    className={cn(
                                        "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[0.65rem] font-medium transition-colors disabled:opacity-40",
                                        "md:flex-none md:flex-row md:gap-2 md:rounded-2xl md:px-3 md:py-2 md:text-left md:text-sm",
                                        tela === id ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                                    )}
                                >
                                    <span className="relative">
                                        <Icone className="size-5 md:size-4" />
                                        {(errosPorTela[id] ?? 0) > 0 && <span className="absolute -top-1 -right-1.5 size-2 rounded-full bg-destructive md:hidden" />}
                                    </span>
                                    <span className="md:hidden">{curto ?? rotulo}</span>
                                    <span className="hidden flex-1 md:inline">{rotulo}</span>
                                    {(errosPorTela[id] ?? 0) > 0 && (
                                        <span className="hidden rounded-full bg-destructive px-1.5 text-xs font-semibold text-white md:inline" title="Pendências que impedem um horário completo">
                                            {errosPorTela[id]}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="min-w-0">
                    {ehCadastro && (
                        <div className="mb-4 flex gap-2 md:hidden">
                            {MENU[0].itens.map(({ id, rotulo }) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setTela(id)}
                                    className={cn(
                                        "rounded-full border px-3 py-1 text-sm font-medium",
                                        tela === id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                                    )}
                                >
                                    {rotulo}
                                </button>
                            ))}
                        </div>
                    )}
                    {tela === "projetos" && <TelaProjetos {...contexto} projetoAbertoId={projeto?.id ?? null} abrir={abrir} />}
                    {tela === "professores" && <TelaProfessores {...contexto} />}
                    {tela === "cursos" && <TelaCursos {...contexto} />}
                    {tela === "ambientes" && <TelaAmbientes {...contexto} />}
                    {!["projetos", "professores", "cursos", "ambientes"].includes(tela) && !doProjeto && <Vazio>Crie ou abra um projeto em “Projetos”.</Vazio>}
                    {doProjeto && tela === "quadro" && <TelaQuadro {...doProjeto} />}
                    {doProjeto && tela === "turmas" && (
                        <TelaTurmas
                            key={foco.turmaId}
                            turmaInicial={foco.turmaId}
                            {...doProjeto}
                            irParaAulas={(id) => {
                                setTurmaDasAulas(id);
                                setTela("aulas");
                            }}
                        />
                    )}
                    {doProjeto && tela === "aulas" && <TelaAulas {...doProjeto} turmaId={turmaDasAulas} escolherTurma={setTurmaDasAulas} />}
                    {doProjeto && tela === "docentes" && <TelaDocentes key={foco.professorId} professorInicial={foco.professorId} {...doProjeto} />}
                    {doProjeto && tela === "horario" && <TelaHorario key={doProjeto.projeto.id} {...doProjeto} irPara={irPara} />}
                </div>
            </div>
        </main>
    );
}
