import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Componente, Curso, Id } from "../modelo/modelo";
import { adicionarPeriodo, duplicarCurso, nomeDoPeriodo, novoComponente, novoCurso, removerCurso } from "../modelo/operacoes";
import { CampoNumero, Cabecalho, ItemDaLista, ListaLateral, Selecao, Vazio, plural } from "../componentes/comuns";
import type { Contexto } from "../useAreaDeTrabalho";

const NIVEIS: Record<Curso["nivel"], string> = {
    integrado: "Técnico integrado",
    subsequente: "Técnico subsequente",
    superior: "Superior",
    outro: "Outro",
};

const COLUNAS = "grid-cols-[1fr_5rem_2rem] items-center gap-x-2 px-3";

export function TelaCursos({ area, mudarArea }: Contexto) {
    const { cursos } = area.cadastros;
    const [selecionado, setSelecionado] = useState<Id | null>(null);
    const [periodoId, setPeriodoId] = useState<Id | null>(null);
    const curso = cursos.find((c) => c.id === selecionado) ?? cursos[0];
    const periodo = curso?.periodos.find((p) => p.id === periodoId) ?? curso?.periodos[0];

    const mudarCursos = (fn: (cursos: Curso[]) => Curso[]) => mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, cursos: fn(a.cadastros.cursos) } }));
    const mudar = (fn: (c: Curso) => Curso) => mudarCursos((cs) => cs.map((c) => (c.id === curso.id ? fn(c) : c)));
    const mudarComponentes = (fn: (cs: Componente[]) => Componente[]) =>
        mudar((c) => ({ ...c, periodos: c.periodos.map((p) => (p.id === periodo?.id ? { ...p, componentes: fn(p.componentes) } : p)) }));
    const mudarComponente = (id: Id, campos: Partial<Componente>) => mudarComponentes((cs) => cs.map((x) => (x.id === id ? { ...x, ...campos } : x)));

    const adicionar = (novo: Curso) => {
        mudarCursos((cs) => [...cs, novo]);
        setSelecionado(novo.id);
        setPeriodoId(null);
    };
    const turmasDoCurso = (id: Id) => area.projetos.reduce((n, p) => n + p.turmas.filter((t) => t.origem?.cursoId === id).length, 0);

    return (
        <div>
            <Cabecalho
                titulo="Cursos"
                ajuda="As disciplinas de cada período e as aulas por semana. Uma turma criada a partir do curso recebe essas aulas."
                acoes={
                    <Button onClick={() => adicionar(novoCurso(`Curso ${cursos.length + 1}`))}>
                        <Plus /> Curso
                    </Button>
                }
            />

            {!curso ? (
                <Vazio>Nenhum curso cadastrado.</Vazio>
            ) : (
                <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
                    <ListaLateral>
                        {cursos.map((c) => (
                            <ItemDaLista
                                key={c.id}
                                ativo={c.id === curso.id}
                                onClick={() => {
                                    setSelecionado(c.id);
                                    setPeriodoId(null);
                                }}
                                titulo={c.nome || "(sem nome)"}
                                detalhe={plural(c.periodos.length, "período", "períodos")}
                            />
                        ))}
                    </ListaLateral>

                    <div className="min-w-0 space-y-5">
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-48 flex-1 space-y-1.5">
                                <Label htmlFor="curso-nome">Nome</Label>
                                <Input id="curso-nome" value={curso.nome} onChange={(e) => mudar((c) => ({ ...c, nome: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="curso-nivel">Nível</Label>
                                <Selecao id="curso-nivel" className="block" value={curso.nivel} onChange={(e) => mudar((c) => ({ ...c, nivel: e.target.value as Curso["nivel"] }))}>
                                    {Object.entries(NIVEIS).map(([id, nome]) => (
                                        <option key={id} value={id}>{nome}</option>
                                    ))}
                                </Selecao>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="curso-regime">Períodos</Label>
                                <Selecao id="curso-regime" className="block" value={curso.regime} onChange={(e) => mudar((c) => ({ ...c, regime: e.target.value as Curso["regime"] }))}>
                                    <option value="semestral">Semestres</option>
                                    <option value="anual">Anos</option>
                                </Selecao>
                            </div>
                            <Button variant="outline" title="Novo curso com a mesma matriz, para um novo PPC" onClick={() => adicionar(duplicarCurso(curso))}>
                                <Copy /> Duplicar
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    const n = turmasDoCurso(curso.id);
                                    const aviso = n > 0 ? ` ${plural(n, "turma continua existindo", "turmas continuam existindo")}, sem vínculo com a matriz.` : "";
                                    if (confirm(`Remover o curso “${curso.nome}”?${aviso}`)) mudarArea((a) => removerCurso(a, curso.id));
                                }}
                            >
                                <Trash2 /> Remover
                            </Button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {curso.periodos.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setPeriodoId(p.id)}
                                    className={cn(
                                        "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                                        p.id === periodo?.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {nomeDoPeriodo(curso, p)}
                                </button>
                            ))}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    const novo = adicionarPeriodo(curso);
                                    mudar(() => novo);
                                    setPeriodoId(novo.periodos.at(-1)!.id);
                                }}
                            >
                                <Plus /> Período
                            </Button>
                        </div>

                        {periodo && (
                            <div>
                                <div className="rounded-2xl border border-border">
                                    <div className={cn(COLUNAS, "grid rounded-t-2xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground")}>
                                        <span>Disciplina</span>
                                        <span className="text-center">Aulas/sem.</span>
                                        <span />
                                    </div>
                                    {periodo.componentes.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma disciplina neste período.</p>}
                                    {periodo.componentes.map((c) => (
                                        <div key={c.id} className={cn(COLUNAS, "grid border-t border-border py-1.5")}>
                                            <Input aria-label="Disciplina" className="h-8" placeholder="Nome da disciplina" value={c.nome} onChange={(e) => mudarComponente(c.id, { nome: e.target.value })} />
                                            <CampoNumero aria-label="Aulas por semana" className="h-8" max={60} valor={c.aulasSemana} onChange={(n) => mudarComponente(c.id, { aulasSemana: n })} />
                                            <Button size="icon-sm" variant="ghost" title="Remover disciplina da matriz" className="text-destructive hover:text-destructive" onClick={() => mudarComponentes((cs) => cs.filter((x) => x.id !== c.id))}>
                                                <Trash2 />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                    <Button variant="outline" onClick={() => mudarComponentes((cs) => [...cs, novoComponente()])}>
                                        <Plus /> Disciplina
                                    </Button>
                                    <span className="text-sm text-muted-foreground">
                                        {plural(periodo.componentes.reduce((s, c) => s + c.aulasSemana, 0), "aula por semana", "aulas por semana")} no {nomeDoPeriodo(curso, periodo)}
                                    </span>
                                    {curso.periodos.length > 1 && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => {
                                                if (periodo.componentes.length === 0 || confirm(`Remover o ${nomeDoPeriodo(curso, periodo)} e as disciplinas dele?`)) {
                                                    mudar((c) => ({ ...c, periodos: c.periodos.filter((p) => p.id !== periodo.id) }));
                                                    setPeriodoId(null);
                                                }
                                            }}
                                        >
                                            <Trash2 /> Remover período
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
