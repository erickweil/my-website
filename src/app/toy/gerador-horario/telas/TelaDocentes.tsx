import { useState } from "react";
import type { DocenteNoProjeto, Id } from "../modelo/modelo";
import { aulasDoProfessor, contarTempos, formatarHoras, limitarAoQuadro, minutosNosHorarios, turmasDoProfessor } from "../modelo/operacoes";
import { Cabecalho, Vazio, plural } from "../componentes/comuns";
import { ItemDaLista, ListaComDetalhe } from "../componentes/lista";
import { AvisosDaTela, marcaDe, usePendencias } from "../componentes/pendencias";
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
    const professorDe = (id: Id) => area.cadastros.professores.find((p) => p.id === id);
    const nomeDe = (id: Id) => professorDe(id)?.nome || "(sem nome)";
    const pendencias = usePendencias(projeto, area.cadastros).filter((p) => p.tela === "docentes");
    const docentes = [...projeto.docentes].sort((a, b) => nomeDe(a.professorId).localeCompare(nomeDe(b.professorId)));
    const docente = docentes.find((d) => d.professorId === selecionado) ?? docentes[0];
    const disponiveis = (d: DocenteNoProjeto) => contarTempos(limitarAoQuadro(d.disponibilidade, projeto.quadro));

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
                ajuda="Pinte a grade com o estado escolhido. Indisponível: nunca recebe aula. Evitar: só se não houver jeito."
            />

            {!docente ? (
                <Vazio>Nenhum professor com aula neste projeto. Atribua os professores na tela de aulas.</Vazio>
            ) : (
                <ListaComDetalhe
                    lista={docentes.map((d) => (
                        <ItemDaLista
                            key={d.professorId}
                            ativo={d.professorId === docente.professorId}
                            onClick={() => setSelecionado(d.professorId)}
                            titulo={nomeDe(d.professorId)}
                            detalhe={`${aulasDoProfessor(projeto, d.professorId)} de ${disponiveis(d)}`}
                            alerta={aulasDoProfessor(projeto, d.professorId) > disponiveis(d)}
                            marca={marcaDe(pendencias.filter((p) => p.professorId === d.professorId))}
                        />
                    ))}
                >
                    <div className="space-y-3">
                        <div>
                            <h3 className="flex items-center gap-2 text-lg font-semibold">
                                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: professorDe(docente.professorId)?.cor }} />
                                {nomeDe(docente.professorId)}
                            </h3>
                            <p className="text-sm text-muted-foreground" title="Horas no campus se estiver em todos os horários disponíveis (inclui os a evitar)">
                                {plural(aulasDoProfessor(projeto, docente.professorId), "aula", "aulas")} em {plural(turmasDoProfessor(projeto, docente.professorId), "turma", "turmas")} ·{" "}
                                {plural(disponiveis(docente), "horário disponível", "horários disponíveis")} ({formatarHoras(minutosNosHorarios(docente.disponibilidade, projeto.quadro))} por semana)
                            </p>
                        </div>
                        <AvisosDaTela pendencias={pendencias.filter((p) => p.professorId === docente.professorId)} />
                        <LegendaDaGrade estados={ESTADOS} pincel={pincel} onEscolher={setPincel} />
                        <GradeTempos
                            quadro={projeto.quadro}
                            estados={ESTADOS}
                            pincel={pincel}
                            estadoDe={(dia, tempo) =>
                                !docente.disponibilidade[dia]?.includes(tempo) ? "nao" : docente.evitar[dia]?.includes(tempo) ? "evitar" : "pode"
                            }
                            onPintar={pintar}
                        />
                    </div>
                </ListaComDetalhe>
            )}
        </div>
    );
}
