"use client";

import { useState } from "react";
import { CalendarDays, Clock, FolderOpen, GraduationCap, LayoutGrid, UserCheck, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Id } from "./modelo/modelo";
import { Selecao, Vazio } from "./componentes/comuns";
import { TelaAulas } from "./telas/TelaAulas";
import { TelaDocentes } from "./telas/TelaDocentes";
import { TelaHorario } from "./telas/TelaHorario";
import { TelaProfessores } from "./telas/TelaProfessores";
import { TelaProjetos } from "./telas/TelaProjetos";
import { TelaQuadro } from "./telas/TelaQuadro";
import { TelaTurmas } from "./telas/TelaTurmas";
import { useAreaDeTrabalho } from "./useAreaDeTrabalho";

type Tela = "projetos" | "professores" | "quadro" | "turmas" | "aulas" | "docentes" | "horario";

const MENU: { grupo: string; itens: { id: Tela; rotulo: string; curto?: string; icone: typeof Clock; doProjeto?: boolean }[] }[] = [
    {
        grupo: "Cadastros",
        itens: [{ id: "professores", rotulo: "Professores", icone: Users }],
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
    const doProjeto = projeto && { ...contexto, projeto, mudarProjeto: estado.mudarProjeto, salvarHorario: estado.salvarHorario };
    const abrir = (id: Id, destino: Tela = "quadro") => {
        estado.abrirProjeto(id);
        setTurmaDasAulas(null);
        setTela(destino);
    };

    return (
        <main className="mx-auto min-h-screen max-w-7xl px-3 pt-4 pb-24 md:px-4 md:py-6">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-2 md:mb-6">
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

            <div className="grid gap-6 md:grid-cols-[13rem_1fr]">
                {/* Computador: menu lateral. Celular: barra fixa embaixo, como num aplicativo. */}
                <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-border bg-background/95 px-1 py-1 backdrop-blur md:static md:block md:border-0 md:bg-transparent md:p-0">
                    {MENU.map(({ grupo, itens }) => (
                        <div key={grupo} className="contents md:mb-4 md:flex md:flex-col md:gap-1">
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
                                    <Icone className="size-5 md:size-4" />
                                    <span className="md:hidden">{curto ?? rotulo}</span>
                                    <span className="hidden md:inline">{rotulo}</span>
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="min-w-0">
                    {tela === "projetos" && <TelaProjetos {...contexto} projetoAbertoId={projeto?.id ?? null} abrir={abrir} />}
                    {tela === "professores" && <TelaProfessores {...contexto} />}
                    {tela !== "projetos" && tela !== "professores" && !doProjeto && <Vazio>Crie ou abra um projeto em “Projetos”.</Vazio>}
                    {doProjeto && tela === "quadro" && <TelaQuadro {...doProjeto} />}
                    {doProjeto && tela === "turmas" && (
                        <TelaTurmas
                            {...doProjeto}
                            irParaAulas={(id) => {
                                setTurmaDasAulas(id);
                                setTela("aulas");
                            }}
                        />
                    )}
                    {doProjeto && tela === "aulas" && <TelaAulas {...doProjeto} turmaId={turmaDasAulas} escolherTurma={setTurmaDasAulas} />}
                    {doProjeto && tela === "docentes" && <TelaDocentes {...doProjeto} />}
                    {doProjeto && tela === "horario" && <TelaHorario key={doProjeto.projeto.id} {...doProjeto} />}
                </div>
            </div>
        </main>
    );
}
