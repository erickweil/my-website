import { useState } from "react";
import type { DocenteNoProjeto, Id } from "../modelo/modelo";
import { aulasDoProfessor, contarTempos, limitarAoQuadro, turmasDoProfessor } from "../modelo/operacoes";
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
                ajuda="A disponibilidade de cada professor neste projeto. Aparecem os professores que têm alguma aula. Escolha um estado e clique ou arraste na grade para pintar. O professor nunca recebe aula num horário indisponível. Os horários a evitar são uma preferência para o algoritmo genético, que tenta respeitá-los; a busca exata nunca põe aula neles."
            />

            {!docente ? (
                <Vazio>Nenhum professor com aula neste projeto. Atribua os professores na tela de aulas.</Vazio>
            ) : (
                <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
                    <ListaLateral>
                        {docentes.map((d) => {
                            return (
                                <ItemDaLista
                                    key={d.professorId}
                                    ativo={d.professorId === docente.professorId}
                                    onClick={() => setSelecionado(d.professorId)}
                                    titulo={nomeDe(d.professorId)}
                                    detalhe={resumo(d)}
                                    alerta={aulasDoProfessor(projeto, d.professorId) > disponiveis(d)}
                                />
                            );
                        })}
                    </ListaLateral>

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
                            {resumo(docente)}
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
