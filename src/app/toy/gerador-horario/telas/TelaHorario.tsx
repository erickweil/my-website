import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Download, Loader2, Play, Printer, Square, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { WorkerResponseMsg } from "@/lib/workerRace";
import { cn } from "@/lib/utils";
import { DIAS_SEMANA_MAP, type HorarioWorkerTaskValue, type ProgressoDoSolver, type SolverHorario } from "../horario-regras";
import { detalharProblema, diagnosticar, observarHorario, type Pendencia } from "../modelo/diagnostico";
import type { Dia, HorarioGerado, Id, Oferta, Professor, ProjetoHorario } from "../modelo/modelo";
import { NOME_DO_TURNO, ambienteDaOferta, fimDaFaixa, nomeNaTurma, rotuloDoTempo, aulasPorTurno } from "../modelo/operacoes";
import { doSolver, paraSolver } from "../modelo/para-solver";
import { Ajuda, Cabecalho, CartaoDePendencias, ItemDaLista, ListaComLimite, ListaLateral, Selecao, Vazio, corDoTexto, plural } from "../componentes/comuns";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";

type Visao = "turmas" | "professores" | "ambientes";

interface Celula {
    /** Linhas da célula: a primeira em destaque. */
    linhas: string[];
    cor?: string;
    problema?: string;
    /** Para o title: disciplina, turmas, professores e ambiente de cada aula da célula. */
    detalhes?: string[];
    /** A aula chegou nesta célula na última atualização do quadro (durante a busca). */
    mudou?: boolean;
    /** A aula não tem professor (fica sem cor). */
    semProfessor?: boolean;
    /** Regras de qualidade que a aula não atende (preferências, não impedem o horário). */
    avisos?: string[];
}

/** Um quadro dias × aulas: de uma turma, de um professor ou de um ambiente. */
interface Quadro {
    id: Id;
    titulo: string;
    /** Horários em que este quadro pode ter aula (os outros ficam apagados). */
    ativo: (dia: Dia, tempo: number) => boolean;
    celulas: Map<string, Celula>;
    /** Horário ativo sem aula conta como falha (turma) ou é só um horário livre (professor, ambiente)? */
    vazioEhFalha: boolean;
}

const chave = (dia: Dia, tempo: number) => `${dia}|${tempo}`;
const chaveDaAlocacao = (a: { ofertaId: Id; dia: Dia; tempo: number }) => `${a.ofertaId}|${a.dia}|${a.tempo}`;

/** As alocações de `novo` que não estavam em `antes` (o que a última atualização do quadro mudou). */
function alocacoesNovas(antes: HorarioGerado | null, novo: HorarioGerado): Set<string> {
    if (!antes) return new Set();
    const tinha = new Set(antes.alocacoes.map(chaveDaAlocacao));
    return new Set(novo.alocacoes.map(chaveDaAlocacao).filter((k) => !tinha.has(k)));
}

function montarQuadros(
    projeto: ProjetoHorario,
    horario: HorarioGerado,
    visao: Visao,
    professor: (id: Id) => Professor | undefined,
    ambientes: { id: Id; nome: string }[],
    novas: Set<string> = new Set(),
): Quadro[] {
    const oferta = (id: Id) => projeto.ofertas.find((o) => o.id === id);
    const nomeDaTurma = (id: Id) => projeto.turmas.find((t) => t.id === id)?.nome || "(sem nome)";
    const turmasDa = (o: Oferta) => o.participacoes.map((p) => nomeDaTurma(p.turmaId)).join(" + ");
    const cor = (o: Oferta) => professor(o.professorIds[0])?.cor;
    const nomesDosProfessores = (o: Oferta) => o.professorIds.map((id) => professor(id)?.nome || "(sem nome)").join(", ");

    /**
     * As regras de qualidade que uma aula não atende. Só as que se ligam a uma aula: horário a
     * evitar do professor, aula sozinha num lado do intervalo, mais de um trecho no dia e, no
     * quadro do professor, jornada e descanso do dia.
     */
    const avisosDaAula = (o: Oferta, dia: Dia, tempo: number, turmaId?: Id, professorId?: Id): string[] => {
        const avisos: string[] = [];
        for (const id of o.professorIds) {
            if (professorId && id !== professorId) continue;
            if (projeto.docentes.find((d) => d.professorId === id)?.evitar[dia]?.includes(tempo)) {
                avisos.push(`${professor(id)?.nome || "O professor"} pediu para evitar este horário.`);
            }
        }
        for (const q of horario.qualidade) {
            if (q.dia !== dia) continue;
            const daAula = q.ofertaId === o.id && (!turmaId || !q.turmaId || q.turmaId === turmaId);
            if (daAula && (q.regra === "intervalo" || q.regra === "turno")) avisos.push(`Aula sozinha de um lado ${q.regra === "turno" ? "da troca de turno" : "do intervalo"}.`);
            if (daAula && q.regra === "espalhar") avisos.push("A disciplina está em mais de um trecho neste dia.");
            if (professorId && q.professorId === professorId && q.regra === "jornada") avisos.push("Jornada do professor acima de 10 horas neste dia.");
            if (professorId && q.professorId === professorId && q.regra === "descanso") avisos.push("Menos de 11 horas de descanso até o dia seguinte.");
        }
        return [...new Set(avisos)];
    };

    /** O que aparece ao passar o mouse numa aula: disciplina, turmas, professores, ambiente. */
    const detalhar = (o: Oferta, turmaId: Id): string => {
        const professores = o.professorIds.map((id) => professor(id)?.nome || "(sem nome)");
        const ambienteId = ambienteDaOferta(projeto, o);
        const ambiente = ambienteId ? ambientes.find((x) => x.id === ambienteId)?.nome || "(sem nome)" : null;
        return [
            nomeNaTurma(o, turmaId) || "(sem nome)",
            `${o.participacoes.length > 1 ? "Turmas" : "Turma"}: ${turmasDa(o)}`,
            `${professores.length > 1 ? "Professores" : "Professor"}: ${professores.join(", ") || "nenhum"}`,
            `Ambiente: ${ambiente ?? "nenhum"}`,
        ].join("\n");
    };

    /** Quadro de um recurso (professor ou ambiente): as aulas das ofertas que o usam. */
    const doRecurso = (id: Id, titulo: string, usa: (o: Oferta) => boolean, ativo: Quadro["ativo"], quem: string, professorId?: Id): Quadro => {
        const celulas = new Map<string, Celula>();
        for (const a of horario.alocacoes) {
            const o = oferta(a.ofertaId);
            if (!o || !usa(o)) continue;
            const k = chave(a.dia, a.tempo);
            const linhas = [nomeNaTurma(o, o.participacoes[0].turmaId) || "(sem nome)", turmasDa(o)];
            const anterior = celulas.get(k);
            const mudou = novas.has(chaveDaAlocacao(a)) || anterior?.mudou;
            const detalhes = [...(anterior?.detalhes ?? []), detalhar(o, o.participacoes[0].turmaId)];
            const avisos = [...(anterior?.avisos ?? []), ...avisosDaAula(o, a.dia, a.tempo, undefined, professorId)];
            celulas.set(k, anterior ? { ...anterior, linhas: [...anterior.linhas, ...linhas], problema: `${quem} está em duas aulas ao mesmo tempo.`, mudou, detalhes, avisos } : { linhas, cor: cor(o), mudou, detalhes, semProfessor: o.professorIds.length === 0, avisos });
        }
        return { id, titulo, ativo, celulas, vazioEhFalha: false };
    };

    if (visao === "professores") {
        return projeto.docentes
            .map((d) => {
                const nome = professor(d.professorId)?.nome || "(sem nome)";
                return doRecurso(d.professorId, nome, (o) => o.professorIds.includes(d.professorId), (dia, t) => !!d.disponibilidade[dia]?.includes(t), nome, d.professorId);
            })
            .sort((a, b) => a.titulo.localeCompare(b.titulo));
    }
    if (visao === "ambientes") {
        return ambientes
            .filter((amb) => projeto.ofertas.some((o) => ambienteDaOferta(projeto, o) === amb.id))
            .map((amb) => doRecurso(amb.id, amb.nome || "(sem nome)", (o) => ambienteDaOferta(projeto, o) === amb.id, () => true, amb.nome));
    }
    return projeto.turmas.map((turma) => {
        const celulas = new Map<string, Celula>();
        for (const a of horario.alocacoes) {
            const o = oferta(a.ofertaId);
            if (o?.participacoes.some((p) => p.turmaId === turma.id)) {
                celulas.set(chave(a.dia, a.tempo), {
                    // O professor vai na célula: dispensa a legenda de cores
                    linhas: [nomeNaTurma(o, turma.id) || "(sem nome)", nomesDosProfessores(o) || "sem professor"],
                    cor: cor(o),
                    semProfessor: o.professorIds.length === 0,
                    avisos: avisosDaAula(o, a.dia, a.tempo, turma.id),
                    mudou: novas.has(chaveDaAlocacao(a)),
                    detalhes: [detalhar(o, turma.id)],
                });
            }
        }
        for (const p of horario.problemas) {
            if (p.turmaId !== turma.id || !p.dia || !p.tempo) continue;
            const k = chave(p.dia, p.tempo);
            celulas.set(k, { ...(celulas.get(k) ?? { linhas: [] }), problema: p.mensagem });
        }
        return { id: turma.id, titulo: turma.nome || "(sem nome)", ativo: (dia, t) => !!turma.horarios[dia]?.includes(t), celulas, vazioEhFalha: true };
    });
}

/** Os quadros como CSV (separado por ponto e vírgula, que é o que as planilhas em português abrem). */
function paraCsv(projeto: ProjetoHorario, quadros: Quadro[]): string {
    const campo = (s: string) => `"${s.replaceAll('"', '""')}"`;
    const linhas: string[] = [];
    for (const q of quadros) {
        linhas.push(campo(q.titulo));
        linhas.push(["Aula", "Início", "Fim", ...projeto.quadro.dias.map((d) => DIAS_SEMANA_MAP[d])].map(campo).join(";"));
        for (const t of aulasPorTurno(projeto.quadro)) {
            linhas.push(campo(NOME_DO_TURNO[t.turno]));
            for (const l of t.linhas) {
                if (l.tipo !== "aula") continue;
                const f = l.faixa;
                linhas.push([`${l.numero}ª`, f.inicio, fimDaFaixa(f), ...projeto.quadro.dias.map((d) => q.celulas.get(chave(d, l.tempo))?.linhas.join(" - ") ?? "")].map(campo).join(";"));
            }
        }
        linhas.push("");
    }
    return "﻿" + linhas.join("\r\n");
}

export function TelaHorario({ area, projeto, salvarHorario, irPara }: ContextoDoProjeto & { irPara: (p: Pendencia) => void }) {
    const [solver, setSolver] = useState<SolverHorario>("local");
    const [ilhas, setIlhas] = useState(true);
    const [gerando, setGerando] = useState(false);
    /** Quadro parcial enquanto a busca roda. */
    const [parcial, setParcial] = useState<HorarioGerado | null>(null);
    /** Progresso da busca em andamento (ou da última, depois que ela para). */
    const [progresso, setProgresso] = useState<{ solver: SolverHorario; valor: ProgressoDoSolver; msDaMudanca: number } | null>(null);
    /** Aulas que chegaram onde estão na última atualização do quadro parcial. */
    const [novas, setNovas] = useState<Set<string>>(new Set());
    const [erro, setErro] = useState<string | null>(null);
    const [visao, setVisao] = useState<Visao>("turmas");
    /** Quadro mostrado (turma, professor ou ambiente), ou todos um embaixo do outro. */
    const [selecionado, setSelecionado] = useState<Id | "todos">("todos");
    /** Para a busca em andamento e fica com o último quadro que ela entregou. */
    const parar = useRef<(() => void) | null>(null);
    // Sair da tela no meio da geração também para (e guarda o último quadro)
    useEffect(() => () => parar.current?.(), []);

    const professor = (id: Id) => area.cadastros.professores.find((p) => p.id === id);
    const pendencias = diagnosticar(projeto, area.cadastros);
    const totalDeAulas = projeto.ofertas.reduce((s, o) => s + o.aulasSemana, 0);

    /**
     * Roda o solver num worker. Cada quadro que chega substitui o anterior na tela; quando a busca
     * termina, ou quando o usuário para, o último quadro recebido é o que fica salvo no projeto.
     */
    const gerar = () => {
        setErro(null);
        setParcial(null);
        setProgresso(null);
        setNovas(new Set());
        setGerando(true);
        const doProjeto = projeto;
        const doSolverEscolhido = solver;
        let msDaMudanca = 0;
        const worker = new Worker(new URL("../horario-wasm.worker.ts", import.meta.url));
        let ultimo: HorarioGerado | null = null;
        const encerrar = () => {
            worker.terminate();
            parar.current = null;
            if (ultimo) salvarHorario(ultimo);
            setGerando(false);
            setParcial(null);
            setNovas(new Set());
        };
        worker.onmessage = (e: MessageEvent<WorkerResponseMsg<HorarioWorkerTaskValue>>) => {
            const msg = e.data;
            const resultado = msg.value?.resultado;
            if (msg.type === "error") {
                setErro(msg.message ?? "Erro desconhecido ao gerar o horário.");
            } else if (resultado?.alocacoes) {
                const novo = doSolver(doProjeto, resultado);
                setNovas(alocacoesNovas(ultimo, novo));
                ultimo = novo;
                msDaMudanca = msg.value!.progresso.ms;
                setParcial(novo);
            } else if (resultado && msg.type === "success") {
                // Terminou sem chegar a nenhum quadro: fica a mensagem do solver
                ultimo = doSolver(doProjeto, resultado);
            }
            if (msg.value?.progresso) setProgresso({ solver: doSolverEscolhido, valor: msg.value.progresso, msDaMudanca });
            if (msg.type !== "message") encerrar();
        };
        worker.onerror = () => {
            setErro("Erro desconhecido ao gerar o horário.");
            encerrar();
        };
        parar.current = encerrar;
        worker.postMessage({ action: "solucionarQuadroHorario", solver, entrada: paraSolver(projeto), ilhas });
    };

    const horario = gerando ? parcial : projeto.horario;
    const desatualizado = !gerando && projeto.horario !== null && projeto.horario.revisao < projeto.revisao;
    const gerais = horario?.problemas.filter((p) => !p.turmaId) ?? [];
    const observacoes = horario && !gerando ? observarHorario(projeto, area.cadastros, horario) : [];
    const temAmbientes = projeto.ofertas.some((o) => ambienteDaOferta(projeto, o) !== null);
    const visaoAtual = visao === "ambientes" && !temAmbientes ? "turmas" : visao;
    const quadros = horario ? montarQuadros(projeto, horario, visaoAtual, professor, area.cadastros.ambientes, gerando ? novas : undefined) : [];
    // O escolhido some quando muda a visão (era uma turma e agora são professores): volta a "Todos"
    const atual = quadros.some((q) => q.id === selecionado) ? selecionado : "todos";
    const contar = (q: Quadro) => {
        const celulas = [...q.celulas.values()];
        return { problemas: celulas.filter((c) => c.problema).length, avisos: celulas.filter((c) => !c.problema && c.avisos?.length).length };
    };

    /** Problemas das turmas, com quem está em choque quando dá para saber. */
    const problemas = (horario?.problemas ?? [])
        .filter((p) => p.turmaId && p.dia && p.tempo)
        .map((p) => ({
            ...p,
            turma: projeto.turmas.find((t) => t.id === p.turmaId)?.nome || "(sem nome)",
            detalhes: p.ofertaId && horario ? detalharProblema(projeto, area.cadastros, horario, p.ofertaId, p.dia!, p.tempo!) : [],
        }));

    const exportar = () => {
        const url = URL.createObjectURL(new Blob([paraCsv(projeto, quadros)], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `horario-${projeto.nome.replace(/[^\p{L}\p{N}]+/gu, "-") || "projeto"}-${visaoAtual}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

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
                                <Button variant="outline" onClick={() => parar.current?.()}>
                                    <Square className="fill-current" /> Parar
                                </Button>
                            ) : (
                                <Button onClick={gerar} disabled={projeto.turmas.length === 0 || totalDeAulas === 0}>
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
                        <div className="inline-flex rounded-full border border-border p-0.5" role="tablist" aria-label="Visão do horário">
                            {(["turmas", "professores", ...(temAmbientes ? (["ambientes"] as const) : [])] as Visao[]).map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    role="tab"
                                    aria-selected={v === visaoAtual}
                                    onClick={() => {
                                        setVisao(v);
                                        setSelecionado("todos");
                                    }}
                                    className={cn(
                                        "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                                        v === visaoAtual ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    Por {v === "turmas" ? "turma" : v === "professores" ? "professor" : "ambiente"}
                                </button>
                            ))}
                        </div>
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
                <div className="grid gap-6 md:grid-cols-[12rem_1fr] print:block">
                    <div className="min-w-0 print:hidden md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:self-start md:overflow-y-auto md:pr-1">
                        <ListaLateral>
                            <ItemDaLista ativo={atual === "todos"} onClick={() => setSelecionado("todos")} titulo="Todos" detalhe={quadros.length} />
                            {quadros.map((q) => {
                                const { problemas: n, avisos } = contar(q);
                                return (
                                    <ItemDaLista
                                        key={q.id}
                                        ativo={q.id === atual}
                                        onClick={() => setSelecionado(q.id)}
                                        titulo={q.titulo}
                                        detalhe={n > 0 ? <span title={plural(n, "aula fora das regras obrigatórias", "aulas fora das regras obrigatórias")}>{n}</span> : undefined}
                                        alerta={n > 0}
                                        marca={n > 0 ? "erro" : avisos > 0 ? "aviso" : null}
                                    />
                                );
                            })}
                        </ListaLateral>
                    </div>
                    <div className="min-w-0 space-y-8">
                        <h2 className="hidden text-xl font-semibold print:block">Horário — {projeto.nome}</h2>
                        {quadros.length === 0 && <Vazio>Nada para mostrar nesta visão.</Vazio>}
                        {quadros.map((q) => (
                            // Os que não estão à vista continuam no documento para a impressão sair completa
                            <div key={q.id} className={cn(atual !== "todos" && q.id !== atual && "hidden print:block")}>
                                <QuadroDeHorario projeto={projeto} quadro={q} />
                            </div>
                        ))}
                    </div>
                </div>
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

function QuadroDeHorario({ projeto, quadro }: { projeto: ProjetoHorario; quadro: Quadro }) {
    const { dias } = projeto.quadro;
    /** Há algo para mostrar neste tempo: uma aula, um problema ou, numa turma, um horário que devia ter aula. */
    const temAlgo = (t: number) => dias.some((d) => quadro.celulas.has(chave(d, t)) || (quadro.vazioEhFalha && quadro.ativo(d, t)));
    // Turno inteiro sem nada não aparece; nos outros, todas as aulas do turno
    const turnos = aulasPorTurno(projeto.quadro).filter((t) => t.linhas.some((l) => l.tipo === "aula" && temAlgo(l.tempo)));
    return (
        <section className="break-inside-avoid space-y-2">
            <h3 className="text-lg font-medium">{quadro.titulo}</h3>
            {turnos.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    {quadro.vazioEhFalha ? "Esta turma não tem horários no quadro." : "Nenhuma aula alocada no horário."}
                </p>
            ) : (
                <div className="overflow-x-auto rounded-2xl border border-border [print-color-adjust:exact]">
                    <table className="w-full table-fixed border-collapse text-sm">
                        <thead>
                            <tr className="bg-muted/50">
                                <th className="w-9 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground md:w-28">
                                    <span className="hidden md:inline">Aula</span>
                                </th>
                                {dias.map((d) => (
                                    <th key={d} className="px-1 py-1.5 font-medium">
                                        <span className="hidden sm:inline">{DIAS_SEMANA_MAP[d]}</span>
                                        <span className="sm:hidden">{DIAS_SEMANA_MAP[d].slice(0, 3)}</span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        {turnos.map((turno) => (
                            <tbody key={turno.turno}>
                                <tr className="border-t border-border bg-muted/50">
                                    <th colSpan={dias.length + 1} className="px-2 py-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                        {NOME_DO_TURNO[turno.turno]}
                                    </th>
                                </tr>
                                {turno.linhas.map((l) => {
                                    const f = l.faixa;
                                    if (l.tipo === "intervalo") {
                                        return (
                                            <tr key={f.id} className="bg-muted/30 text-xs text-muted-foreground">
                                                <td className="px-2 py-0.5">
                                                    <span className="hidden md:inline">{f.inicio}</span>
                                                </td>
                                                <td colSpan={dias.length} className="py-0.5 text-center">{f.tipo === "intervalo" ? f.nome || "Intervalo" : ""}</td>
                                            </tr>
                                        );
                                    }
                                    const t = l.tempo;
                                    return (
                                        <tr key={f.id} className="border-t border-border">
                                            <td className="px-2 py-1 whitespace-nowrap" title={`${f.inicio}–${fimDaFaixa(f)}`}>
                                                <span className="font-medium">{l.numero}ª</span>{" "}
                                                <span className="hidden text-xs text-muted-foreground md:inline">{f.inicio}–{fimDaFaixa(f)}</span>
                                            </td>
                                            {dias.map((d) => {
                                                const celula = quadro.celulas.get(chave(d, t));
                                                const ativo = quadro.ativo(d, t);
                                                const [principal, ...resto] = celula?.linhas ?? [];
                                                return (
                                                    <td
                                                        key={d}
                                                        title={
                                                            celula &&
                                                            [
                                                                ...(celula.detalhes ?? []),
                                                                celula.problema && `Regra obrigatória: ${celula.problema}`,
                                                                ...(celula.avisos ?? []).map((a) => `Qualidade: ${a}`),
                                                                celula.mudou && "Mudou de lugar na última atualização.",
                                                            ]
                                                                .filter(Boolean)
                                                                .join("\n\n")
                                                        }
                                                        className={cn(
                                                            "relative h-12 border-l border-border px-0.5 py-0.5 text-center text-[0.65rem] leading-tight hyphens-auto sm:px-1 sm:text-xs",
                                                            !ativo && "bg-muted/40",
                                                            // Vermelho: regra obrigatória. Amarelo: regra de qualidade (preferência)
                                                            celula?.problema && "outline-3 -outline-offset-3 outline-destructive",
                                                            !celula?.problema && celula?.avisos?.length && "outline-3 -outline-offset-3 outline-amber-400",
                                                            // Sem professor não há cor: o tracejado mostra que é aula, não horário livre
                                                            celula?.semProfessor && "bg-muted",
                                                            celula?.semProfessor && !celula.problema && !celula.avisos?.length && "outline-1 -outline-offset-4 outline-dashed outline-muted-foreground/60",
                                                        )}
                                                        style={principal && celula?.cor ? { backgroundColor: celula.cor, color: corDoTexto(celula.cor) } : undefined}
                                                    >
                                                        {principal ? (
                                                            <>
                                                                <p className={cn("font-medium break-words text-balance", resto.length > 0 ? "line-clamp-2" : "line-clamp-3")}>{principal}</p>
                                                                {resto.length > 0 && <p className="truncate">{resto.join(" · ")}</p>}
                                                            </>
                                                        ) : ativo && quadro.vazioEhFalha ? (
                                                            <span className="text-destructive">vazio</span>
                                                        ) : null}
                                                        {celula?.problema ? (
                                                            <CircleAlert className="absolute top-0.5 right-0.5 size-3.5 rounded-full bg-white text-destructive" />
                                                        ) : celula?.avisos?.length ? (
                                                            <TriangleAlert className="absolute top-0.5 right-0.5 size-3.5 rounded-sm bg-white p-px text-amber-600" />
                                                        ) : null}
                                                        {celula?.mudou && (
                                                            <span className="absolute top-1 left-1 size-2 rounded-full bg-sky-500 ring-2 ring-white" aria-label="Mudou de lugar" />
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        ))}
                    </table>
                </div>
            )}
        </section>
    );
}

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

function duracao(ms: number): string {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${numero.format(ms / 1000)} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** O que `iter` e `depth` contam em cada método. */
const UNIDADES: Record<SolverHorario, { iter: string; depth: (n: string) => string }> = {
    local: { iter: "movimentos", depth: (n) => `sem melhora há ${n} movimentos` },
    genetic: { iter: "gerações", depth: (n) => `sem melhora há ${n} gerações` },
    pencilmark: { iter: "nós", depth: (n) => `${n} ramos em aberto` },
};

function Item({ rotulo, children, title }: { rotulo: string; children: ReactNode; title?: string }) {
    return (
        <div title={title}>
            <dt className="text-xs text-muted-foreground">{rotulo}</dt>
            <dd className="font-medium tabular-nums">{children}</dd>
        </div>
    );
}

/** Números da busca: tempo, ritmo, custo e quando o quadro mudou pela última vez. */
function PainelDeProgresso({ progresso, gerando, horario }: {
    progresso: { solver: SolverHorario; valor: ProgressoDoSolver; msDaMudanca: number };
    gerando: boolean;
    /** O melhor quadro: o parcial durante a busca, o salvo depois. */
    horario: HorarioGerado | null;
}) {
    const { solver, valor: p, msDaMudanca } = progresso;
    const unidade = UNIDADES[solver];
    const porSegundo = p.ms > 0 ? (p.iter / p.ms) * 1000 : 0;
    const desdeAMudanca = p.ms - msDaMudanca;
    // Destaque por um instante quando o quadro acaba de mudar
    const recente = gerando && p.versao > 0 && desdeAMudanca < 800;
    const extras = [
        p.cadeias && plural(p.cadeias, "cadeia", "cadeias"),
        p.ilhas ? plural(p.ilhas, "ilha", "ilhas") : null,
        p.threads && plural(p.threads, "thread", "threads"),
    ].filter(Boolean);
    const violacoes = horario ? horario.problemas.filter((x) => x.turmaId).length : null;
    // O custo junta as duas partes; as de qualidade, somadas, valem menos que uma obrigatória, por isso
    // ele vai no title, com todas as casas
    const titulo = p.custo === undefined
        ? undefined
        : `Custo ${p.custo.toLocaleString("pt-BR", { maximumFractionDigits: 20 })} (0 = todas as regras atendidas). Cada violação de regra obrigatória vale ao menos 20; as observações de qualidade, todas somadas, valem menos que uma violação.`;

    return (
        <div className={cn("mt-3 border-t border-border pt-3", !gerando && "text-muted-foreground")}>
            {/* Celular: só uma linha; os números completos ficam para telas maiores */}
            <p className="text-xs text-muted-foreground tabular-nums sm:hidden">
                {duracao(p.ms)} · {compacto.format(p.iter)} {unidade.iter} · {p.versao === 0 ? "sem quadro ainda" : plural(p.versao, "atualização", "atualizações")}
            </p>
            <dl className="hidden gap-x-6 gap-y-2 sm:grid sm:grid-cols-3 lg:grid-cols-6">
                <Item rotulo={gerando ? "Tempo" : "Duração"}>{duracao(p.ms)}</Item>
                <Item rotulo={unidade.iter[0].toUpperCase() + unidade.iter.slice(1)} title={extras.join(", ")}>
                    {compacto.format(p.iter)} <span className="text-xs font-normal text-muted-foreground">({compacto.format(porSegundo)}/s)</span>
                </Item>
                {horario && violacoes !== null && (
                    <>
                        <Item rotulo="Regras obrigatórias" title={titulo}>
                            {horario.completo ? "atendidas" : plural(violacoes, "violação", "violações")}
                        </Item>
                        <Item rotulo="Qualidade" title={titulo}>
                            {plural(horario.qualidade.length, "observação", "observações")}
                        </Item>
                    </>
                )}
                <Item rotulo="Busca">{unidade.depth(compacto.format(p.depth))}</Item>
                <Item rotulo="Quadro">
                    <span className="flex items-center gap-1.5">
                        <span className={cn("size-2 shrink-0 rounded-full bg-muted-foreground/40 transition-colors", recente && "bg-sky-500 dark:bg-sky-400")} />
                        {p.versao === 0
                            ? "sem quadro ainda"
                            : `${plural(p.versao, "atualização", "atualizações")}, a última há ${duracao(desdeAMudanca)}`}
                    </span>
                </Item>
            </dl>
        </div>
    );
}
