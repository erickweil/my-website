import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Cadastros, Id, ProjetoHorario, Turma, Turno } from "../modelo/modelo";
import { aulasDaTurma, contarTempos, criarTurmaAvulsa, criarTurmaDePeriodo, nomeDoPeriodo, removerTurma, turnosDoQuadro } from "../modelo/operacoes";
import { Ajuda, CampoNumero, Cabecalho, ItemDaLista, ListaLateral, Selecao, Vazio } from "../componentes/comuns";
import { GradeTempos, LegendaDaGrade, pintarHorarios, type EstadoDaGrade } from "../componentes/GradeTempos";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";

const ESTADOS: Record<string, EstadoDaGrade> = {
    aula: { rotulo: "Tem aula", classe: "bg-primary/80 hover:bg-primary" },
    livre: { rotulo: "Sem aula", classe: "bg-muted/50 hover:bg-muted" },
};

/** "18 de 20": aulas atribuídas e tempos marcados da turma. */
export const resumoDaTurma = (aulas: number, tempos: number) => `${aulas} de ${tempos}`;

export function TelaTurmas({ area, projeto, mudarProjeto, irParaAulas, turmaInicial }: ContextoDoProjeto & { irParaAulas: (turmaId: Id) => void; turmaInicial?: Id | null }) {
    const [selecionada, setSelecionada] = useState<Id | null>(turmaInicial ?? null);
    const turma = projeto.turmas.find((t) => t.id === selecionada) ?? projeto.turmas[0];

    const mudar = (campos: Partial<Turma>, cosmetica = false) =>
        mudarProjeto((p) => ({ ...p, turmas: p.turmas.map((t) => (t.id === turma.id ? { ...t, ...campos } : t)) }), cosmetica);

    const { cursos, ambientes } = area.cadastros;
    const cursoDaTurma = cursos.find((c) => c.id === turma?.origem?.cursoId);
    const periodoDaTurma = cursoDaTurma?.periodos.find((p) => p.id === turma?.origem?.periodoId);
    const ambiente = ambientes.find((a) => a.id === turma?.ambienteId);

    return (
        <div>
            <Cabecalho
                titulo="Turmas"
                acoes={
                    <NovaTurma
                        cadastros={area.cadastros}
                        projeto={projeto}
                        onCriar={(novo, turmaId) => {
                            mudarProjeto(() => novo);
                            setSelecionada(turmaId);
                        }}
                    />
                }
            />

            {!turma ? (
                <Vazio>Nenhuma turma neste projeto.</Vazio>
            ) : (
                <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
                    <ListaLateral>
                        {projeto.turmas.map((t) => {
                            const [aulas, tempos] = [aulasDaTurma(projeto, t.id), contarTempos(t.horarios)];
                            return (
                                <ItemDaLista
                                    key={t.id}
                                    ativo={t.id === turma.id}
                                    onClick={() => setSelecionada(t.id)}
                                    titulo={t.nome || "(sem nome)"}
                                    detalhe={resumoDaTurma(aulas, tempos)}
                                    alerta={aulas !== tempos}
                                />
                            );
                        })}
                    </ListaLateral>

                    <div className="min-w-0 space-y-5">
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-48 flex-1 space-y-1.5">
                                <Label htmlFor="turma-nome">Nome</Label>
                                <Input id="turma-nome" value={turma.nome} onChange={(e) => mudar({ nome: e.target.value }, true)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="turma-alunos">Alunos</Label>
                                <CampoNumero id="turma-alunos" className="w-24" max={9999} valor={turma.alunos} onChange={(n) => mudar({ alunos: n }, true)} />
                            </div>
                            {ambientes.length > 0 && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="turma-ambiente">Ambiente padrão</Label>
                                    <Selecao id="turma-ambiente" className="block max-w-48" value={turma.ambienteId ?? ""} onChange={(e) => mudar({ ambienteId: e.target.value || null })}>
                                        <option value="">Nenhum</option>
                                        {ambientes.map((a) => (
                                            <option key={a.id} value={a.id}>{a.nome || "(sem nome)"} ({a.capacidade})</option>
                                        ))}
                                    </Selecao>
                                </div>
                            )}
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    if (confirm(`Remover a turma “${turma.nome}” e as aulas dela?`)) mudarProjeto((p) => removerTurma(p, turma.id));
                                }}
                            >
                                <Trash2 /> Remover
                            </Button>
                        </div>

                        {(cursoDaTurma || (ambiente && turma.alunos > ambiente.capacidade)) && (
                            <p className="text-sm text-muted-foreground">
                                {cursoDaTurma && <>{cursoDaTurma.nome}{periodoDaTurma && `, ${nomeDoPeriodo(cursoDaTurma, periodoDaTurma)}`}</>}
                                {ambiente && turma.alunos > ambiente.capacidade && (
                                    <span className="text-destructive">
                                        {cursoDaTurma && " · "}
                                        {ambiente.nome} comporta {ambiente.capacidade} alunos e a turma tem {turma.alunos}
                                    </span>
                                )}
                            </p>
                        )}

                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Label>
                                    Horários da turma
                                    <Ajuda>
                                        Marque em quais aulas do quadro a turma tem aula. Clique e arraste para marcar várias; clique no dia ou
                                        no número da aula para marcar a coluna ou a linha inteira.
                                    </Ajuda>
                                </Label>
                                <LegendaDaGrade estados={ESTADOS} />
                            </div>
                            <GradeTempos
                                quadro={projeto.quadro}
                                estados={ESTADOS}
                                estadoDe={(dia, tempo) => (turma.horarios[dia]?.includes(tempo) ? "aula" : "livre")}
                                onPintar={(celulas, estado) => mudar({ horarios: pintarHorarios(turma.horarios, celulas, estado === "aula") })}
                            />
                        </div>

                        <ResumoDaTurma aulas={aulasDaTurma(projeto, turma.id)} tempos={contarTempos(turma.horarios)} onVerAulas={() => irParaAulas(turma.id)} />
                    </div>
                </div>
            )}
        </div>
    );
}

/** A conta que precisa fechar para existir horário: aulas atribuídas = tempos marcados. */
export function ResumoDaTurma({ aulas, tempos, onVerAulas }: { aulas: number; tempos: number; onVerAulas?: () => void }) {
    const diferenca = tempos - aulas;
    return (
        <div
            className={
                "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm " +
                (diferenca >= 0 ? "border-border bg-muted/30" : "border-destructive/40 bg-destructive/5")
            }
        >
            <span>
                <strong className="tabular-nums">{aulas}</strong> aulas por semana nas disciplinas ·{" "}
                <strong className="tabular-nums">{tempos}</strong> horários marcados
                {diferenca > 0 && <span className="text-muted-foreground"> · {diferenca === 1 ? "1 horário fica vago" : `${diferenca} horários ficam vagos`}, de preferência no começo ou no fim do turno</span>}
                {diferenca < 0 && <span className="text-destructive"> · {diferenca === -1 ? "sobra 1 aula, que não cabe" : `sobram ${-diferenca} aulas, que não cabem`} nos horários</span>}
                {diferenca === 0 && tempos > 0 && <span className="text-muted-foreground"> · fecha</span>}
            </span>
            {onVerAulas && (
                <Button variant="outline" size="sm" onClick={onVerAulas}>
                    Ver aulas da turma
                </Button>
            )}
        </div>
    );
}

const NOME_DO_TURNO: Record<Turno, string> = { matutino: "Manhã", vespertino: "Tarde", noturno: "Noite" };

/** Botão "+ Turma": abre o formulário da turma nova, de um período de um curso ou avulsa. */
function NovaTurma({
    cadastros,
    projeto,
    onCriar,
}: { cadastros: Cadastros; projeto: ProjetoHorario; onCriar: (projeto: ProjetoHorario, turmaId: Id) => void }) {
    const turnos = turnosDoQuadro(projeto.quadro);
    const [aberto, setAberto] = useState(false);
    const [cursoId, setCursoId] = useState("");
    const [periodoId, setPeriodoId] = useState("");
    const [nome, setNome] = useState("");
    const [alunos, setAlunos] = useState(0);
    const [ambienteId, setAmbienteId] = useState("");
    const [marcados, setMarcados] = useState<Turno[] | null>(null);

    const curso = cadastros.cursos.find((c) => c.id === cursoId);
    const periodo = curso?.periodos.find((p) => p.id === periodoId) ?? curso?.periodos[0];
    const sugestao = curso && periodo ? `${curso.nome} ${periodo.numero}º` : `Turma ${projeto.turmas.length + 1}`;
    const turnosDaTurma = marcados ?? turnos;

    const criar = () => {
        const dados = { nome: nome.trim() || sugestao, alunos, turnos: turnosDaTurma, ambienteId: ambienteId || null };
        const r = curso && periodo ? criarTurmaDePeriodo(projeto, curso, periodo.id, dados) : criarTurmaAvulsa(projeto, dados);
        onCriar(r.projeto, r.turma.id);
        setAberto(false);
        // O curso fica, para criar as turmas dos outros períodos; o resto é de cada turma
        setNome("");
        setAmbienteId("");
        setMarcados(null);
    };

    return (
        <Popover open={aberto} onOpenChange={setAberto}>
            <PopoverTrigger
                type="button"
                disabled={turnos.length === 0}
                title={turnos.length === 0 ? "Antes, defina as aulas no quadro de horários" : undefined}
                className="inline-flex h-9 items-center gap-1.5 rounded-4xl bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
            >
                <Plus className="size-4" /> Turma
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 gap-3">
                {cadastros.cursos.length > 0 && (
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                        <label className="space-y-1 text-xs text-muted-foreground">
                            <span className="block">Curso</span>
                            <Selecao
                                className="w-full"
                                value={cursoId}
                                onChange={(e) => {
                                    setCursoId(e.target.value);
                                    setPeriodoId("");
                                }}
                            >
                                <option value="">Sem curso (avulsa)</option>
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
                {turnos.length > 1 && (
                    <div className="flex flex-wrap gap-3 text-sm">
                        {turnos.map((t) => (
                            <label key={t} className="flex items-center gap-1.5">
                                <Checkbox
                                    checked={turnosDaTurma.includes(t)}
                                    onCheckedChange={(v) => setMarcados(v === true ? [...turnosDaTurma, t] : turnosDaTurma.filter((x) => x !== t))}
                                />
                                {NOME_DO_TURNO[t]}
                            </label>
                        ))}
                    </div>
                )}
                {cadastros.ambientes.length > 0 && (
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Ambiente padrão</span>
                        <Selecao className="w-full" value={ambienteId} onChange={(e) => setAmbienteId(e.target.value)}>
                            <option value="">Nenhum</option>
                            {cadastros.ambientes.map((a) => (
                                <option key={a.id} value={a.id}>{a.nome || "(sem nome)"} ({a.capacidade})</option>
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
