import { useState } from "react";
import { CircleAlert, CircleCheck, Download, Loader2, Play, Printer, Square, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DIAS_SEMANA_MAP, type SolverHorario } from "../../horario-regras";
import { detalharProblema, diagnosticar, observarHorario, type Pendencia } from "../../modelo/diagnostico";
import type { HorarioGerado, Id } from "../../modelo/modelo";
import { ambienteDaOferta, rotuloDoTempo } from "../../modelo/operacoes";
import { Ajuda, Cabecalho, ListaComLimite, Vazio, baixarArquivo, nomeDeArquivo, plural } from "../../componentes/comuns";
import { Selecao } from "../../componentes/campos";
import { Abas } from "../../componentes/escolha";
import { ItemDaLista, ListaComDetalhe } from "../../componentes/lista";
import { CartaoDePendencias } from "../../componentes/pendencias";
import type { ContextoDoProjeto } from "../../useAreaDeTrabalho";
import { PainelDeProgresso } from "./PainelDeProgresso";
import { QuadroDeHorario } from "./QuadroDeHorario";
import { montarQuadros, paraCsv, type Visao } from "./quadros";
import { useGeracao } from "./useGeracao";

export function TelaHorario({ area, projeto, salvarHorario, irPara }: ContextoDoProjeto & { irPara: (p: Pendencia) => void }) {
    const [solver, setSolver] = useState<SolverHorario>("local");
    const [ilhas, setIlhas] = useState(true);
    const { gerando, parcial, progresso, novas, erro, gerar, parar } = useGeracao(salvarHorario);
    const [visao, setVisao] = useState<Visao>("turmas");
    /** Quadro mostrado (turma, professor ou ambiente), ou todos um embaixo do outro. */
    const [selecionado, setSelecionado] = useState<Id | "todos">("todos");
    const professor = (id: Id) => area.cadastros.professores.find((p) => p.id === id);
    const pendencias = diagnosticar(projeto, area.cadastros);
    const totalDeAulas = projeto.ofertas.reduce((s, o) => s + o.aulasSemana, 0);

    const horario = gerando ? parcial : projeto.horario;
    const desatualizado = !gerando && projeto.horario !== null && projeto.horario.revisao < projeto.revisao;
    const gerais = horario?.problemas.filter((p) => !p.turmaId) ?? [];
    const observacoes = horario && !gerando ? observarHorario(projeto, area.cadastros, horario) : [];
    const temAmbientes = projeto.ofertas.some((o) => ambienteDaOferta(projeto, o) !== null);
    const visaoAtual = visao === "ambientes" && !temAmbientes ? "turmas" : visao;
    const quadros = horario ? montarQuadros(projeto, horario, visaoAtual, professor, area.cadastros.ambientes, gerando ? novas : undefined) : [];
    // O escolhido some quando muda a visão (era uma turma e agora são professores): volta a "Todos"
    const atual = quadros.some((q) => q.id === selecionado) ? selecionado : "todos";

    /** Problemas das turmas, com quem está em choque quando dá para saber. */
    const problemas = (horario?.problemas ?? [])
        .filter((p) => p.turmaId && p.dia && p.tempo)
        .map((p) => ({
            ...p,
            turma: projeto.turmas.find((t) => t.id === p.turmaId)?.nome || "(sem nome)",
            detalhes: p.ofertaId && horario ? detalharProblema(projeto, area.cadastros, horario, p.ofertaId, p.dia!, p.tempo!) : [],
        }));

    const exportar = () => baixarArquivo(`${nomeDeArquivo("horario", projeto.nome)}-${visaoAtual}.csv`, paraCsv(projeto, quadros), "text/csv;charset=utf-8");

    return (
        <div>
            <div className="print:hidden">
                <Cabecalho
                    titulo="Horário"
                    acoes={
                        <>
                            <label className="flex items-center gap-2 text-sm">
                                <span className="text-muted-foreground">Método</span>
                                <Ajuda>
                                    <p><strong>Busca local:</strong> o padrão. Roda até atender a todas as regras ou até você parar, e fica com o melhor horário encontrado.</p>
                                    <p><strong>Busca exata:</strong> acha um horário válido ou prova que não existe. Rápida em quadros pequenos; ignora as regras de qualidade.</p>
                                    <p><strong>Algoritmo genético:</strong> experimental, mais lento.</p>
                                </Ajuda>
                                <Selecao className="h-9" value={solver} disabled={gerando} onChange={(e) => setSolver(e.target.value as SolverHorario)}>
                                    <option value="local">Busca local</option>
                                    <option value="pencilmark">Busca exata</option>
                                    <option value="genetic">Algoritmo genético</option>
                                </Selecao>
                            </label>
                            {solver === "genetic" && (
                                <label className="flex items-center gap-2 text-sm" title="Várias populações evoluem em paralelo e trocam indivíduos entre si.">
                                    <Checkbox checked={ilhas} disabled={gerando} onCheckedChange={(v) => setIlhas(v === true)} /> Ilhas
                                </label>
                            )}
                            {gerando ? (
                                <Button variant="outline" onClick={parar}>
                                    <Square className="fill-current" /> Parar
                                </Button>
                            ) : (
                                <Button onClick={() => gerar(projeto, solver, ilhas)} disabled={projeto.turmas.length === 0 || totalDeAulas === 0}>
                                    <Play /> {projeto.horario ? "Gerar de novo" : "Gerar horário"}
                                </Button>
                            )}
                        </>
                    }
                />

                <div className="mb-4 space-y-3">
                    <CartaoDePendencias pendencias={pendencias} onIr={irPara} />

                    {erro && (
                        <Alert variant="destructive">
                            <CircleAlert />
                            <AlertTitle>Não foi possível gerar</AlertTitle>
                            <AlertDescription>{erro}</AlertDescription>
                        </Alert>
                    )}

                    {(gerando || horario) && (
                        <div className="rounded-2xl border border-border px-4 py-3 text-sm">
                            {gerando ? (
                                <p className="flex items-center gap-2 font-medium">
                                    <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                                    {!parcial
                                        ? "Preparando…"
                                        : parcial.completo
                                          ? `Regras obrigatórias atendidas. Melhorando a qualidade: ${plural(parcial.qualidade.length, "observação", "observações")}…`
                                          : solver === "pencilmark"
                                            ? `${parcial.alocacoes.length} de ${totalDeAulas} aulas alocadas…`
                                            : `${plural(parcial.problemas.filter((p) => p.turmaId).length, "violação", "violações")} e ${plural(parcial.qualidade.length, "observação", "observações")}…`}
                                </p>
                            ) : horario && <ResumoDoResultado horario={horario} observacoes={observacoes.length} totalDeAulas={totalDeAulas} />}

                            {!gerando && horario && !horario.completo && (gerais.length > 0 || problemas.length > 0) && (
                                <div className="mt-2 text-destructive">
                                    {gerais.map((p) => (
                                        <p key={p.mensagem}>{p.mensagem}</p>
                                    ))}
                                    {problemas.length > 0 && (
                                        <ListaComLimite itens={problemas} limite={3} className="list-disc space-y-0.5 pl-5">
                                            {(p) => (
                                                <li key={`${p.turmaId}|${p.dia}|${p.tempo}`}>
                                                    {p.turma}, {DIAS_SEMANA_MAP[p.dia!].toLowerCase()}, {rotuloDoTempo(projeto.quadro, p.tempo!)}:{" "}
                                                    {p.detalhes.length > 0 ? p.detalhes.join(" ") : p.mensagem}
                                                </li>
                                            )}
                                        </ListaComLimite>
                                    )}
                                </div>
                            )}
                            {desatualizado && (
                                <p className="mt-2 flex items-center gap-2 text-amber-700 dark:text-amber-400">
                                    <TriangleAlert className="size-4 shrink-0" /> O projeto mudou depois que este horário foi gerado. Gere de novo para atualizar.
                                </p>
                            )}
                            {observacoes.length > 0 && (
                                <details className="group mt-2">
                                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">
                                        Ver as {plural(observacoes.length, "observação", "observações")} de qualidade
                                    </summary>
                                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-700 dark:text-amber-400">
                                        {observacoes.map((o) => <li key={o}>{o}</li>)}
                                    </ul>
                                </details>
                            )}

                            {progresso && (gerando || progresso.solver !== "pencilmark") && (
                                <PainelDeProgresso progresso={progresso} gerando={gerando} horario={gerando ? parcial : projeto.horario} />
                            )}
                        </div>
                    )}

                    {!horario && !gerando && (
                        <Vazio>Nenhum horário gerado para este projeto. Confira as pendências acima e clique em “Gerar horário”.</Vazio>
                    )}
                </div>

                {horario && (
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                        <Abas
                            rotulo="Visão do horário"
                            atual={visaoAtual}
                            onEscolher={(v) => {
                                setVisao(v);
                                setSelecionado("todos");
                            }}
                            abas={[
                                { id: "turmas", rotulo: "Por turma" },
                                { id: "professores", rotulo: "Por professor" },
                                ...(temAmbientes ? [{ id: "ambientes" as const, rotulo: "Por ambiente" }] : []),
                            ]}
                        />
                        {!gerando && (
                            <div className="ml-auto flex gap-2">
                                <Button size="sm" variant="outline" title="Imprime todos os quadros da visão atual" onClick={() => window.print()}>
                                    <Printer /> Imprimir
                                </Button>
                                <Button size="sm" variant="outline" title="Planilha (CSV) com todos os quadros da visão atual" onClick={exportar}>
                                    <Download /> Exportar
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {horario && (
                <ListaComDetalhe
                    lista={
                        <>
                            <ItemDaLista ativo={atual === "todos"} onClick={() => setSelecionado("todos")} titulo="Todos" detalhe={quadros.length} />
                            {quadros.map((q) => {
                                const celulas = [...q.celulas.values()];
                                const problemas = celulas.filter((c) => c.problema).length;
                                const avisos = celulas.filter((c) => !c.problema && c.avisos?.length).length;
                                return (
                                    <ItemDaLista
                                        key={q.id}
                                        ativo={q.id === atual}
                                        onClick={() => setSelecionado(q.id)}
                                        titulo={q.titulo}
                                        detalhe={problemas > 0 ? <span title={plural(problemas, "aula fora das regras obrigatórias", "aulas fora das regras obrigatórias")}>{problemas}</span> : undefined}
                                        alerta={problemas > 0}
                                        marca={problemas > 0 ? "erro" : avisos > 0 ? "aviso" : null}
                                    />
                                );
                            })}
                        </>
                    }
                >
                    <div className="space-y-8">
                        <h2 className="hidden text-xl font-semibold print:block">Horário — {projeto.nome}</h2>
                        {quadros.length === 0 && <Vazio>Nada para mostrar nesta visão.</Vazio>}
                        {quadros.map((q) => (
                            // Os que não estão à vista continuam no documento para a impressão sair completa
                            <div key={q.id} className={atual !== "todos" && q.id !== atual ? "hidden print:block" : undefined}>
                                <QuadroDeHorario projeto={projeto} quadro={q} />
                            </div>
                        ))}
                    </div>
                </ListaComDetalhe>
            )}
        </div>
    );
}

/** A situação do horário salvo, numa linha. */
function ResumoDoResultado({ horario, observacoes, totalDeAulas }: { horario: HorarioGerado; observacoes: number; totalDeAulas: number }) {
    if (!horario.completo) {
        const violacoes = horario.problemas.filter((p) => p.turmaId).length;
        return (
            <p className="flex items-center gap-2 font-medium text-destructive">
                <CircleAlert className="size-4 shrink-0" />
                {horario.alocacoes.length < totalDeAulas
                    ? `Horário incompleto: ${horario.alocacoes.length} de ${totalDeAulas} aulas alocadas`
                    : `Horário com ${plural(violacoes, "violação", "violações")} das regras obrigatórias`}
            </p>
        );
    }
    if (observacoes === 0) {
        return (
            <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                <CircleCheck className="size-4 shrink-0" /> Horário completo, sem nenhuma observação.
            </p>
        );
    }
    return (
        <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-4 shrink-0" /> Horário completo: atende a todas as regras obrigatórias
            <span className="font-normal text-muted-foreground">· {plural(observacoes, "observação", "observações")} de qualidade</span>
        </p>
    );
}
