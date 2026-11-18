import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Cadastros, Id, ProjetoHorario, Turma } from "../modelo/modelo";
import { aulasDaTurma, contarTempos, criarTurmaAvulsa, criarTurmaDePeriodo, nomeDoPeriodo, removerTurma, turnosDoQuadro } from "../modelo/operacoes";
import { diagnosticar, type Pendencia } from "../modelo/diagnostico";
import { Ajuda, AvisosDaTela, CampoNumero, Cabecalho, Selecao, Vazio, marcaDe, rotuloDoAmbiente } from "../componentes/comuns";
import { GradeTempos, LegendaDaGrade, pintarHorarios, type EstadoDaGrade } from "../componentes/GradeTempos";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";
import { AulasDaTurma, JA_NA_TELA } from "./AulasDaTurma";

const ESTADOS: Record<string, EstadoDaGrade> = {
    aula: { rotulo: "Tem aula", classe: "bg-primary/80 hover:bg-primary" },
    livre: { rotulo: "Sem aula", classe: "bg-muted/50 hover:bg-muted" },
};

export type AbaDaTurma = "horarios" | "aulas";

/** As pendências que se corrigem na tela de turmas (nos horários ou nas aulas). */
const daTela = (p: Pendencia) => p.tela === "turmas" || p.tela === "aulas";

/** Turmas agrupadas pelo curso de origem; as sem curso por último. */
function agruparPorCurso(projeto: ProjetoHorario, cadastros: Cadastros): { titulo: string; turmas: Turma[] }[] {
    const grupos = new Map<string, Turma[]>();
    for (const t of projeto.turmas) {
        const chave = t.origem?.cursoId ?? "";
        grupos.set(chave, [...(grupos.get(chave) ?? []), t]);
    }
    return [...grupos.entries()]
        .map(([cursoId, turmas]) => ({
            cursoId,
            titulo: cursoId ? cadastros.cursos.find((c) => c.id === cursoId)?.nome || "(curso sem nome)" : "Sem curso",
            turmas,
        }))
        .sort((a, b) => (!a.cursoId ? 1 : !b.cursoId ? -1 : a.titulo.localeCompare(b.titulo)));
}

export function TelaTurmas({
    turmaAberta,
    abrirTurma,
    aba,
    mudarAba,
    ...contexto
}: ContextoDoProjeto & { turmaAberta: Id | null; abrirTurma: (id: Id) => void; aba: AbaDaTurma; mudarAba: (aba: AbaDaTurma) => void }) {
    const { area, projeto, mudarProjeto } = contexto;
    const turma = projeto.turmas.find((t) => t.id === turmaAberta) ?? projeto.turmas[0];
    const pendencias = diagnosticar(projeto, area.cadastros).filter(daTela);
    const grupos = agruparPorCurso(projeto, area.cadastros);

    const mudar = (campos: Partial<Turma>, cosmetica = false) =>
        mudarProjeto((p) => ({ ...p, turmas: p.turmas.map((t) => (t.id === turma.id ? { ...t, ...campos } : t)) }), cosmetica);

    const { cursos, ambientes } = area.cadastros;
    const cursoDaTurma = cursos.find((c) => c.id === turma?.origem?.cursoId);
    const periodoDaTurma = cursoDaTurma?.periodos.find((p) => p.id === turma?.origem?.periodoId);
    const ambiente = ambientes.find((a) => a.id === turma?.ambienteId);
    const [aulas, tempos] = turma ? [aulasDaTurma(projeto, turma.id), contarTempos(turma.horarios)] : [0, 0];

    return (
        <div>
            <Cabecalho
                titulo="Turmas"
                acoes={
                    <NovaTurma
                        cadastros={area.cadastros}
                        projeto={projeto}
                        onCriar={(novo, turmaId, comAulas) => {
                            mudarProjeto(() => novo);
                            abrirTurma(turmaId);
                            mudarAba(comAulas ? "aulas" : "horarios");
                        }}
                    />
                }
            />

            <AvisosDaTela className="mb-4" pendencias={pendencias.filter((p) => !p.turmaId)} />

            {!turma ? (
                <Vazio>Nenhuma turma neste projeto. Crie a primeira em “+ Turma”.</Vazio>
            ) : (
                <>
                    {/* Turmas por curso: no celular cada curso é uma fila que rola de lado */}
                    <div className="mb-5 space-y-2">
                        {grupos.map((g) => (
                            <div key={g.titulo} className="flex min-w-0 gap-3 max-md:flex-col max-md:gap-1 md:items-baseline">
                                {grupos.length > 1 && (
                                    <p className="w-32 shrink-0 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase" title={g.titulo}>
                                        {g.titulo}
                                    </p>
                                )}
                                <div className="-mx-3 flex min-w-0 gap-1.5 overflow-x-auto px-3 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
                                    {g.turmas.map((t) => (
                                        <BotaoDaTurma
                                            key={t.id}
                                            nome={t.nome || "(sem nome)"}
                                            ativo={t.id === turma.id}
                                            marca={marcaDe(pendencias.filter((p) => p.turmaId === t.id))}
                                            onClick={() => abrirTurma(t.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <section className="space-y-4 rounded-2xl border border-border p-3 md:p-4">
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-40 flex-1 space-y-1.5">
                                <Label htmlFor="turma-nome">Nome</Label>
                                <Input id="turma-nome" value={turma.nome} onChange={(e) => mudar({ nome: e.target.value }, true)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="turma-alunos">Alunos</Label>
                                <CampoNumero id="turma-alunos" className="w-20" max={9999} valor={turma.alunos} onChange={(n) => mudar({ alunos: n }, true)} />
                            </div>
                            {ambientes.length > 0 && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="turma-ambiente">Sala</Label>
                                    <Selecao id="turma-ambiente" className="block max-w-52" value={turma.ambienteId ?? ""} onChange={(e) => mudar({ ambienteId: e.target.value || null })}>
                                        <option value="">Nenhuma</option>
                                        {ambientes.map((a) => (
                                            <option key={a.id} value={a.id}>{rotuloDoAmbiente(a)}</option>
                                        ))}
                                    </Selecao>
                                </div>
                            )}
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Remover turma"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                    if (confirm(`Remover a turma “${turma.nome}” e as aulas dela?`)) mudarProjeto((p) => removerTurma(p, turma.id));
                                }}
                            >
                                <Trash2 />
                            </Button>
                        </div>

                        {(cursoDaTurma || (ambiente && turma.alunos > ambiente.capacidade && ambiente.capacidade > 0)) && (
                            <p className="text-sm text-muted-foreground">
                                {cursoDaTurma && <>{cursoDaTurma.nome}{periodoDaTurma && `, ${nomeDoPeriodo(cursoDaTurma, periodoDaTurma)}`}</>}
                                {ambiente && ambiente.capacidade > 0 && turma.alunos > ambiente.capacidade && (
                                    <span className="text-destructive">
                                        {cursoDaTurma && " · "}
                                        {ambiente.nome} tem {ambiente.capacidade} lugares e a turma tem {turma.alunos} alunos
                                    </span>
                                )}
                            </p>
                        )}

                        <AvisosDaTela pendencias={pendencias.filter((p) => p.turmaId === turma.id && !(p.codigo && JA_NA_TELA.includes(p.codigo)))} />

                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
                            <div className="flex gap-1" role="tablist" aria-label="Turma">
                                {(["horarios", "aulas"] as const).map((a) => (
                                    <button
                                        key={a}
                                        type="button"
                                        role="tab"
                                        aria-selected={aba === a}
                                        onClick={() => mudarAba(a)}
                                        className={cn(
                                            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                                            aba === a ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        {a === "horarios" ? "Horários" : "Aulas"}
                                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{a === "horarios" ? tempos : aulas}</span>
                                    </button>
                                ))}
                            </div>
                            <ResumoDaTurma aulas={aulas} tempos={tempos} />
                        </div>

                        {aba === "horarios" ? (
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                        Clique ou arraste para marcar
                                        <Ajuda>Clique no dia, no turno ou no número da aula para marcar a coluna ou a linha inteira.</Ajuda>
                                    </p>
                                    <LegendaDaGrade estados={ESTADOS} />
                                </div>
                                <GradeTempos
                                    quadro={projeto.quadro}
                                    estados={ESTADOS}
                                    estadoDe={(dia, tempo) => (turma.horarios[dia]?.includes(tempo) ? "aula" : "livre")}
                                    onPintar={(celulas, estado) => mudar({ horarios: pintarHorarios(turma.horarios, celulas, estado === "aula") })}
                                />
                            </div>
                        ) : (
                            <AulasDaTurma {...contexto} turma={turma} />
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

function BotaoDaTurma({ nome, ativo, marca, onClick }: { nome: string; ativo: boolean; marca: "erro" | "aviso" | null; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={ativo ? "true" : undefined}
            className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                ativo ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
            )}
        >
            {nome}
            {marca && (
                <span
                    className={cn("size-2 rounded-full", marca === "erro" ? "bg-destructive" : "bg-amber-500", ativo && "ring-2 ring-primary-foreground")}
                    title={marca === "erro" ? "Tem pendências que impedem um horário completo" : "Tem avisos"}
                />
            )}
        </button>
    );
}

/** A conta que precisa fechar para existir horário: aulas da turma × horários marcados. */
export function ResumoDaTurma({ aulas, tempos }: { aulas: number; tempos: number }) {
    const diferenca = tempos - aulas;
    return (
        <p
            className={cn("pb-2 text-sm tabular-nums", diferenca < 0 ? "font-medium text-destructive" : "text-muted-foreground")}
            title="Aulas por semana nas disciplinas × horários marcados para a turma"
        >
            {aulas} aulas em {tempos} horários
            {diferenca < 0 && ` · sobram ${-diferenca}`}
            {diferenca > 0 && ` · ${diferenca} ${diferenca === 1 ? "vago" : "vagos"}`}
        </p>
    );
}

/** Botão "+ Turma": nome, alunos, sala e, se quiser, o curso e período de onde vêm as aulas. */
function NovaTurma({
    cadastros,
    projeto,
    onCriar,
}: { cadastros: Cadastros; projeto: ProjetoHorario; onCriar: (projeto: ProjetoHorario, turmaId: Id, comAulas: boolean) => void }) {
    const turnos = turnosDoQuadro(projeto.quadro);
    const [aberto, setAberto] = useState(false);
    const [cursoId, setCursoId] = useState("");
    const [periodoId, setPeriodoId] = useState("");
    const [nome, setNome] = useState("");
    const [alunos, setAlunos] = useState(0);
    const [ambienteId, setAmbienteId] = useState("");

    const curso = cadastros.cursos.find((c) => c.id === cursoId);
    const periodo = curso?.periodos.find((p) => p.id === periodoId) ?? curso?.periodos[0];
    const sugestao = curso && periodo ? `${curso.nome} ${periodo.numero}º` : `Turma ${projeto.turmas.length + 1}`;

    const criar = () => {
        // A turma nasce com o primeiro turno do quadro marcado; o resto se ajusta na aba de horários
        const dados = { nome: nome.trim() || sugestao, alunos, turnos: turnos.slice(0, 1), ambienteId: ambienteId || null };
        const r = curso && periodo ? criarTurmaDePeriodo(projeto, curso, periodo.id, dados) : criarTurmaAvulsa(projeto, dados);
        onCriar(r.projeto, r.turma.id, !!(curso && periodo));
        setAberto(false);
        // O curso fica, para criar as turmas dos outros períodos; o resto é de cada turma
        setNome("");
        setAmbienteId("");
    };

    return (
        <Popover open={aberto} onOpenChange={setAberto}>
            <PopoverTrigger
                type="button"
                disabled={turnos.length === 0}
                title={turnos.length === 0 ? "Antes, defina as aulas no quadro de horários" : undefined}
                className="inline-flex h-9 items-center gap-1.5 rounded-4xl bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
            >
                <Plus className="size-4" /> Turma
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 gap-3">
                {cadastros.cursos.length > 0 && (
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                        <label className="space-y-1 text-xs text-muted-foreground">
                            <span className="block">Curso (opcional)</span>
                            <Selecao
                                className="w-full"
                                value={cursoId}
                                onChange={(e) => {
                                    setCursoId(e.target.value);
                                    setPeriodoId("");
                                }}
                            >
                                <option value="">Nenhum</option>
                                {cadastros.cursos.map((c) => (
                                    <option key={c.id} value={c.id}>{c.nome || "(sem nome)"}</option>
                                ))}
                            </Selecao>
                        </label>
                        {curso && (
                            <label className="space-y-1 text-xs text-muted-foreground">
                                <span className="block">Período</span>
                                <Selecao value={periodo?.id ?? ""} onChange={(e) => setPeriodoId(e.target.value)}>
                                    {curso.periodos.map((p) => (
                                        <option key={p.id} value={p.id}>{nomeDoPeriodo(curso, p)}</option>
                                    ))}
                                </Selecao>
                            </label>
                        )}
                    </div>
                )}
                <div className="grid grid-cols-[1fr_5rem] gap-2">
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Nome da turma</span>
                        <Input placeholder={sugestao} value={nome} onChange={(e) => setNome(e.target.value)} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Alunos</span>
                        <CampoNumero max={9999} valor={alunos} onChange={setAlunos} />
                    </label>
                </div>
                {cadastros.ambientes.length > 0 && (
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Sala</span>
                        <Selecao className="w-full" value={ambienteId} onChange={(e) => setAmbienteId(e.target.value)}>
                            <option value="">Nenhuma</option>
                            {cadastros.ambientes.map((a) => (
                                <option key={a.id} value={a.id}>{rotuloDoAmbiente(a)}</option>
                            ))}
                        </Selecao>
                    </label>
                )}
                <Button onClick={criar}>
                    {curso && periodo ? `Criar com ${periodo.componentes.length} disciplinas` : "Criar turma"}
                </Button>
            </PopoverContent>
        </Popover>
    );
}
