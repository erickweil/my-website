import { useState } from "react";
import type { DocenteNoProjeto, Id } from "../modelo/modelo";
import { aulasDoProfessor, contarTempos, formatarHoras, limitarAoQuadro, minutosNosHorarios, turmasDoProfessor } from "../modelo/operacoes";
import { Cabecalho, ItemDaLista, ListaLateral, Vazio, plural } from "../componentes/comuns";
import { GradeTempos, LegendaDaGrade, pintarHorarios, type EstadoDaGrade } from "../componentes/GradeTempos";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";

const ESTADOS: Record<string, EstadoDaGrade> = {
    pode: { rotulo: "Disponível", classe: "bg-emerald-500/70 hover:bg-emerald-500" },
    evitar: { rotulo: "Evitar", classe: "bg-red-500/75 hover:bg-red-500" },
    nao: { rotulo: "Indisponível", classe: "bg-muted/50 hover:bg-muted" },
};

export function TelaDocentes({ area, projeto, mudarProjeto, professorInicial }: ContextoDoProjeto & { professorInicial?: Id | null }) {
    const [selecionado, setSelecionado] = useState<Id | null>(professorInicial ?? null);
    const [pincel, setPincel] = useState("nao");
    const nomeDe = (id: Id) => area.cadastros.professores.find((p) => p.id === id)?.nome || "(sem nome)";
    const docentes = [...projeto.docentes].sort((a, b) => nomeDe(a.professorId).localeCompare(nomeDe(b.professorId)));
    const docente = docentes.find((d) => d.professorId === selecionado) ?? docentes[0];
    const disponiveis = (d: DocenteNoProjeto) => contarTempos(limitarAoQuadro(d.disponibilidade, projeto.quadro));

    /** "10 aulas · 3 turmas" */
    const resumo = (d: DocenteNoProjeto) =>
        `${plural(aulasDoProfessor(projeto, d.professorId), "aula", "aulas")} · ${plural(turmasDoProfessor(projeto, d.professorId), "turma", "turmas")}`;
    /** Carga horária se estiver no campus em todos os horários disponíveis (só informativo). */
    const carga = (d: DocenteNoProjeto) => `${formatarHoras(minutosNosHorarios(d.disponibilidade, projeto.quadro))} disponíveis por semana`;

    const pintar = (celulas: Parameters<typeof pintarHorarios>[1], estado: string) =>
        mudarProjeto((p) => ({
            ...p,
            docentes: p.docentes.map((d) =>
                d.professorId !== docente.professorId
                    ? d
                    : {
                        ...d,
                        disponibilidade: pintarHorarios(d.disponibilidade, celulas, estado !== "nao"),
                        evitar: pintarHorarios(d.evitar, celulas, estado === "evitar"),
                    },
            ),
        }));

    return (
        <div>
            <Cabecalho
                titulo="Docentes"
                ajuda="A disponibilidade de cada professor neste projeto. Aparecem os professores que têm alguma aula. Escolha um estado e clique ou arraste na grade para pintar. O professor nunca recebe aula num horário indisponível. Os horários a evitar são uma preferência que a busca local e o algoritmo genético tentam respeitar; a busca exata nunca põe aula neles. Na lista, as horas disponíveis somam a duração de todos os horários disponíveis (incluindo os a evitar): é a carga se o professor estiver no campus em todos eles."
            />

            {!docente ? (
                <Vazio>Nenhum professor com aula neste projeto. Atribua os professores na tela de aulas.</Vazio>
            ) : (
                <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
                    {/* No computador a lista rola dentro da altura da grade, ao lado dela */}
                    <div className="md:relative">
                    <div className="md:absolute md:inset-0 md:overflow-y-auto md:pr-1">
                    <ListaLateral>
                        {docentes.map((d) => {
                            return (
                                <ItemDaLista
                                    key={d.professorId}
                                    ativo={d.professorId === docente.professorId}
                                    onClick={() => setSelecionado(d.professorId)}
                                    titulo={nomeDe(d.professorId)}
                                    detalhe={
                                        <span className="flex flex-col items-end">
                                            <span>{resumo(d)}</span>
                                            <span title="Horas no campus se estiver em todos os horários disponíveis (inclui os a evitar)">{carga(d)}</span>
                                        </span>
                                    }
                                    alerta={aulasDoProfessor(projeto, d.professorId) > disponiveis(d)}
                                />
                            );
                        })}
                    </ListaLateral>
                    </div>
                    </div>

                    <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <LegendaDaGrade estados={ESTADOS} pincel={pincel} onEscolher={setPincel} />
                        </div>
                        <GradeTempos
                            quadro={projeto.quadro}
                            estados={ESTADOS}
                            pincel={pincel}
                            estadoDe={(dia, tempo) =>
                                !docente.disponibilidade[dia]?.includes(tempo) ? "nao" : docente.evitar[dia]?.includes(tempo) ? "evitar" : "pode"
                            }
                            onPintar={pintar}
                        />
                        <p className="text-sm text-muted-foreground">
                            {resumo(docente)} · {carga(docente)}
                            {aulasDoProfessor(projeto, docente.professorId) > disponiveis(docente) && (
                                <span className="text-destructive"> · não há horários disponíveis suficientes para as aulas</span>
                            )}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
