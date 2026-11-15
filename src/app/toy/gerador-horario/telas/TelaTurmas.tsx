import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Id, Turma } from "../modelo/modelo";
import { aulasDaTurma, contarTempos, criarTurmaAvulsa, removerTurma } from "../modelo/operacoes";
import { Ajuda, CampoNumero, Cabecalho, ItemDaLista, ListaLateral, Vazio } from "../componentes/comuns";
import { GradeTempos, LegendaDaGrade, pintarHorarios, type EstadoDaGrade } from "../componentes/GradeTempos";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";

const ESTADOS: Record<string, EstadoDaGrade> = {
    aula: { rotulo: "Tem aula", classe: "bg-primary/80 hover:bg-primary" },
    livre: { rotulo: "Sem aula", classe: "bg-muted/50 hover:bg-muted" },
};

/** "18 de 20": aulas atribuídas e tempos marcados da turma. */
export const resumoDaTurma = (aulas: number, tempos: number) => `${aulas} de ${tempos}`;

export function TelaTurmas({ projeto, mudarProjeto, irParaAulas }: ContextoDoProjeto & { irParaAulas: (turmaId: Id) => void }) {
    const [selecionada, setSelecionada] = useState<Id | null>(null);
    const turma = projeto.turmas.find((t) => t.id === selecionada) ?? projeto.turmas[0];

    const mudar = (campos: Partial<Turma>, cosmetica = false) =>
        mudarProjeto((p) => ({ ...p, turmas: p.turmas.map((t) => (t.id === turma.id ? { ...t, ...campos } : t)) }), cosmetica);

    const adicionar = () => {
        // O id é sorteado aqui para a turma nova já ficar selecionada
        const { projeto: novo, turma: nova } = criarTurmaAvulsa(projeto, { nome: `Turma ${projeto.turmas.length + 1}` });
        mudarProjeto(() => novo);
        setSelecionada(nova.id);
    };

    return (
        <div>
            <Cabecalho
                titulo="Turmas"
                acoes={
                    <Button onClick={adicionar} disabled={projeto.quadro.faixas.length === 0}>
                        <Plus /> Turma
                    </Button>
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
                                <CampoNumero id="turma-alunos" className="w-24" valor={turma.alunos} onChange={(n) => mudar({ alunos: n }, true)} />
                            </div>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    if (confirm(`Remover a turma “${turma.nome}” e as aulas dela?`)) mudarProjeto((p) => removerTurma(p, turma.id));
                                }}
                            >
                                <Trash2 /> Remover
                            </Button>
                        </div>

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
                (diferenca === 0 ? "border-border bg-muted/30" : "border-destructive/40 bg-destructive/5")
            }
        >
            <span>
                <strong className="tabular-nums">{aulas}</strong> aulas por semana nas disciplinas ·{" "}
                <strong className="tabular-nums">{tempos}</strong> horários marcados
                {diferenca > 0 && <span className="text-destructive"> · faltam {diferenca} aulas para preencher os horários</span>}
                {diferenca < 0 && <span className="text-destructive"> · sobram {-diferenca} aulas, que não cabem nos horários</span>}
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
