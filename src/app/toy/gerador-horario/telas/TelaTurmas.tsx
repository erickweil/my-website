import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Cadastros, Id, ProjetoHorario, Turma } from "../modelo/modelo";
import { aulasDaTurma, contarTempos, criarTurmaAvulsa, criarTurmaDePeriodo, nomeDoPeriodo, removerTurma, turnosDoQuadro } from "../modelo/operacoes";
import type { Pendencia } from "../modelo/diagnostico";
import { Ajuda, Cabecalho, Vazio, rotuloDoAmbiente } from "../componentes/comuns";
import { CampoNumero, Selecao } from "../componentes/campos";
import { Abas } from "../componentes/escolha";
import { BotaoAdicionar, GrupoDaLista, ItemDaLista, ListaComDetalhe } from "../componentes/lista";
import { AvisosDaTela, marcaDe, usePendencias } from "../componentes/pendencias";
import { BotaoRemover } from "../componentes/tabela";
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
    const pendencias = usePendencias(projeto, area.cadastros).filter(daTela);
    const grupos = agruparPorCurso(projeto, area.cadastros);

    const mudar = (campos: Partial<Turma>, cosmetica = false) =>
        mudarProjeto((p) => ({ ...p, turmas: p.turmas.map((t) => (t.id === turma.id ? { ...t, ...campos } : t)) }), cosmetica);

    const { cursos, ambientes } = area.cadastros;
    const cursoDaTurma = cursos.find((c) => c.id === turma?.origem?.cursoId);
    const periodoDaTurma = cursoDaTurma?.periodos.find((p) => p.id === turma?.origem?.periodoId);
    const ambiente = ambientes.find((a) => a.id === turma?.ambienteId);
    const superlotada = !!ambiente && ambiente.capacidade > 0 && turma.alunos > ambiente.capacidade;
    const [aulas, tempos] = turma ? [aulasDaTurma(projeto, turma.id), contarTempos(turma.horarios)] : [0, 0];

    const novaTurma = (
        <NovaTurma
            cadastros={area.cadastros}
            projeto={projeto}
            onCriar={(novo, turmaId, comAulas) => {
                mudarProjeto(() => novo);
                abrirTurma(turmaId);
                mudarAba(comAulas ? "aulas" : "horarios");
            }}
        />
    );

    return (
        <div>
            <Cabecalho titulo="Turmas" />
            <AvisosDaTela className="mb-4" pendencias={pendencias.filter((p) => !p.turmaId)} />

            <ListaComDetalhe
                lista={
                    <>
                        {grupos.map((g) => (
                            <Fragment key={g.titulo}>
                                {grupos.length > 1 && <GrupoDaLista titulo={g.titulo} />}
                                {g.turmas.map((t) => {
                                    const [aulasDela, temposDela] = [aulasDaTurma(projeto, t.id), contarTempos(t.horarios)];
                                    return (
                                        <ItemDaLista
                                            key={t.id}
                                            ativo={t.id === turma?.id}
                                            onClick={() => abrirTurma(t.id)}
                                            titulo={t.nome || "(sem nome)"}
                                            detalhe={`${aulasDela}/${temposDela}`}
                                            alerta={aulasDela > temposDela}
                                            marca={marcaDe(pendencias.filter((p) => p.turmaId === t.id))}
                                        />
                                    );
                                })}
                            </Fragment>
                        ))}
                        {novaTurma}
                    </>
                }
            >
                {!turma ? (
                    <Vazio>Nenhuma turma neste projeto. Crie a primeira em “+ Turma”.</Vazio>
                ) : (
                    <div className="space-y-4">
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
                            <BotaoRemover
                                titulo="Remover turma"
                                confirmar={`Remover a turma “${turma.nome}” e as aulas dela?`}
                                onRemover={() => mudarProjeto((p) => removerTurma(p, turma.id))}
                            />
                        </div>

                        {(cursoDaTurma || superlotada) && (
                            <p className="text-sm text-muted-foreground">
                                {cursoDaTurma && <>{cursoDaTurma.nome}{periodoDaTurma && `, ${nomeDoPeriodo(cursoDaTurma, periodoDaTurma)}`}</>}
                                {superlotada && (
                                    <span className="text-destructive">
                                        {cursoDaTurma && " · "}
                                        {ambiente.nome} tem {ambiente.capacidade} lugares e a turma tem {turma.alunos} alunos
                                    </span>
                                )}
                            </p>
                        )}

                        <AvisosDaTela pendencias={pendencias.filter((p) => p.turmaId === turma.id && !(p.codigo && JA_NA_TELA.includes(p.codigo)))} />

                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                            <Abas
                                rotulo="Turma"
                                atual={aba}
                                onEscolher={mudarAba}
                                abas={[
                                    { id: "horarios", rotulo: "Horários", contagem: tempos, alerta: tempos === 0 },
                                    { id: "aulas", rotulo: "Aulas", contagem: aulas, alerta: aulas === 0 },
                                ]}
                            />
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
                    </div>
                )}
            </ListaComDetalhe>
        </div>
    );
}

/** A conta que precisa fechar para existir horário: aulas da turma × horários marcados. */
export function ResumoDaTurma({ aulas, tempos }: { aulas: number; tempos: number }) {
    const diferenca = tempos - aulas;
    return (
        <p
            className={cn("text-sm tabular-nums", diferenca < 0 ? "font-medium text-destructive" : "text-muted-foreground")}
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
                disabled={turnos.length === 0}
                title={turnos.length === 0 ? "Antes, defina as aulas no quadro de horários" : undefined}
                render={<BotaoAdicionar>Turma</BotaoAdicionar>}
            />
            <PopoverContent align="start" className="w-80 gap-3">
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
