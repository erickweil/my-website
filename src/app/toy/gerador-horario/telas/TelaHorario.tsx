import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CircleAlert, CircleCheck, Download, Loader2, Play, Printer, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { WorkerResponseMsg } from "@/lib/workerRace";
import { cn } from "@/lib/utils";
import { DIAS_SEMANA_MAP, type HorarioWorkerTaskValue, type ProgressoDoSolver, type SolverHorario } from "../horario-regras";
import { detalharProblema, diagnosticar, observarHorario, type Pendencia } from "../modelo/diagnostico";
import type { Dia, HorarioGerado, Id, Oferta, Professor, ProjetoHorario } from "../modelo/modelo";
import { ambienteDaOferta, aulasDoQuadro, fimDaFaixa, nomeNaTurma } from "../modelo/operacoes";
import { doSolver, paraSolver } from "../modelo/para-solver";
import { Ajuda, Cabecalho, Selecao, Vazio, corDoTexto, plural } from "../componentes/comuns";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";

type Visao = "turmas" | "professores" | "ambientes";

interface Celula {
    /** Linhas da célula: a primeira em destaque. */
    linhas: string[];
    cor?: string;
    problema?: string;
    /** A aula chegou nesta célula na última atualização do quadro (durante a busca). */
    mudou?: boolean;
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

    /** Quadro de um recurso (professor ou ambiente): as aulas das ofertas que o usam. */
    const doRecurso = (id: Id, titulo: string, usa: (o: Oferta) => boolean, ativo: Quadro["ativo"], quem: string): Quadro => {
        const celulas = new Map<string, Celula>();
        for (const a of horario.alocacoes) {
            const o = oferta(a.ofertaId);
            if (!o || !usa(o)) continue;
            const k = chave(a.dia, a.tempo);
            const linhas = [nomeNaTurma(o, o.participacoes[0].turmaId) || "(sem nome)", turmasDa(o)];
            const anterior = celulas.get(k);
            const mudou = novas.has(chaveDaAlocacao(a)) || anterior?.mudou;
            celulas.set(k, anterior ? { ...anterior, linhas: [...anterior.linhas, ...linhas], problema: `${quem} está em duas aulas ao mesmo tempo.`, mudou } : { linhas, cor: cor(o), mudou });
        }
        return { id, titulo, ativo, celulas, vazioEhFalha: false };
    };

    if (visao === "professores") {
        return projeto.docentes
            .map((d) => {
                const nome = professor(d.professorId)?.nome || "(sem nome)";
                return doRecurso(d.professorId, nome, (o) => o.professorIds.includes(d.professorId), (dia, t) => !!d.disponibilidade[dia]?.includes(t), nome);
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
                celulas.set(chave(a.dia, a.tempo), { linhas: [nomeNaTurma(o, turma.id) || "(sem nome)"], cor: cor(o), mudou: novas.has(chaveDaAlocacao(a)) });
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
        aulasDoQuadro(projeto.quadro).forEach((f, i) => {
            linhas.push([`${i + 1}ª`, f.inicio, fimDaFaixa(f), ...projeto.quadro.dias.map((d) => q.celulas.get(chave(d, i + 1))?.linhas.join(" - ") ?? "")].map(campo).join(";"));
        });
        linhas.push("");
    }
    return "﻿" + linhas.join("\r\n");
}

const ROTULO_DA_TELA: Record<Pendencia["tela"], string> = { quadro: "Quadro", turmas: "Turmas", aulas: "Aulas", docentes: "Docentes" };

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
    /** Para a busca em andamento e fica com o último quadro que ela entregou. */
    const parar = useRef<(() => void) | null>(null);
    // Sair da tela no meio da geração também para (e guarda o último quadro)
    useEffect(() => () => parar.current?.(), []);

    const professor = (id: Id) => area.cadastros.professores.find((p) => p.id === id);
    const pendencias = diagnosticar(projeto, area.cadastros);
    const erros = pendencias.filter((p) => p.gravidade === "erro").length;
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
                <Cabecalho titulo="Horário" />

                {pendencias.length > 0 && (
                    <Alert className="mb-4" variant={erros > 0 ? "destructive" : "default"}>
                        <TriangleAlert />
                        <AlertTitle>
                            {erros > 0 ? `${plural(erros, "pendência impede", "pendências impedem")} um horário completo` : plural(pendencias.length, "aviso", "avisos")}
                        </AlertTitle>
                        <AlertDescription>
                            <ul className="space-y-1">
                                {pendencias.map((p) => (
                                    <li key={p.mensagem} className={cn("flex items-start gap-2", p.gravidade === "aviso" && "text-muted-foreground")}>
                                        <span className="flex-1">{p.mensagem}</span>
                                        <button type="button" className="inline-flex shrink-0 items-center gap-1 text-xs underline" onClick={() => irPara(p)}>
                                            {ROTULO_DA_TELA[p.tela]} <ArrowRight className="size-3" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </AlertDescription>
                    </Alert>
                )}

                <div className="mb-6 flex flex-wrap items-center gap-3">
                    {gerando ? (
                        <Button size="lg" variant="outline" onClick={() => parar.current?.()}>
                            <X /> Interromper
                        </Button>
                    ) : (
                        <Button size="lg" onClick={gerar} disabled={projeto.turmas.length === 0 || totalDeAulas === 0}>
                            <Play /> {projeto.horario ? "Gerar de novo" : "Gerar horário"}
                        </Button>
                    )}
                    {gerando && (
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            {!parcial
                                ? "Preparando…"
                                : parcial.completo
                                  ? `Horário válido. Melhorando a qualidade: ${plural(parcial.qualidade.length, "observação", "observações")}…`
                                  : `${parcial.alocacoes.length} de ${totalDeAulas} aulas alocadas…`}
                        </span>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-2">
                            Método
                            <Ajuda>
                                <p>
                                    <strong>Busca local (padrão):</strong> parte de um horário com erros e o conserta trocando aulas de
                                    lugar. Mostra o melhor horário que encontrou até agora, mesmo com erros, e depois de chegar a um horário
                                    válido continua tentando atender às regras de qualidade. Roda até atender a todas as regras ou até
                                    você interromper; ao interromper, fica o melhor horário encontrado.
                                </p>
                                <p>
                                    <strong>Busca exata:</strong> acha um horário que cumpre todas as regras obrigatórias, ou prova que não
                                    existe. Resolve quadros pequenos depressa, mas pode não terminar nos grandes. Trata os horários a evitar
                                    como indisponíveis e só deixa horário vago no começo ou no fim do turno; as outras regras de qualidade
                                    ela não considera.
                                </p>
                                <p>
                                    <strong>Algoritmo genético:</strong> o método anterior, com as mesmas regras da busca local e também
                                    sem limite de tempo. É bem mais lento e costuma estacionar perto de um horário válido.
                                </p>
                                <p>
                                    <strong>Regras de qualidade:</strong> horários que o professor pediu para evitar; no máximo 10 horas
                                    entre a primeira e a última aula do professor no dia; 11 horas de descanso até a primeira aula do dia
                                    seguinte; grupo de aulas da mesma disciplina que atravessa o intervalo (ou a troca de turno) sem deixar
                                    uma aula sozinha de um lado; quando a turma tem mais horários que aulas, os vagos no começo ou no fim
                                    do turno, não entre duas aulas. O horário mostra o que não foi atendido, em qualquer método.
                                </p>
                            </Ajuda>
                            <Selecao className="h-8" value={solver} disabled={gerando} onChange={(e) => setSolver(e.target.value as SolverHorario)}>
                                <option value="local">Busca local (padrão)</option>
                                <option value="pencilmark">Busca exata</option>
                                <option value="genetic">Algoritmo genético</option>
                            </Selecao>
                        </label>
                        {solver === "genetic" && (
                            <label className="flex items-center gap-2" title="Várias populações evoluem em paralelo e trocam indivíduos entre si.">
                                <Checkbox checked={ilhas} disabled={gerando} onCheckedChange={(v) => setIlhas(v === true)} /> Usar ilhas
                            </label>
                        )}
                    </div>
                </div>

                {progresso && (gerando || progresso.solver !== "pencilmark") && (
                    <PainelDeProgresso progresso={progresso} gerando={gerando} parcial={parcial} />
                )}

                {erro && (
                    <Alert variant="destructive" className="mb-4">
                        <CircleAlert />
                        <AlertTitle>Não foi possível gerar</AlertTitle>
                        <AlertDescription>{erro}</AlertDescription>
                    </Alert>
                )}

                {!horario && !gerando && <Vazio>Nenhum horário gerado para este projeto.</Vazio>}

                {horario && !gerando && (
                    <div className="mb-4 space-y-2">
                        {horario.completo ? (
                            <p className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
                                <CircleCheck className="size-5" /> Horário completo, sem problemas.
                            </p>
                        ) : (
                            <Alert variant="destructive">
                                <CircleAlert />
                                <AlertTitle>
                                    Horário incompleto: {horario.alocacoes.length} de {totalDeAulas} aulas alocadas
                                </AlertTitle>
                                <AlertDescription>
                                    {gerais.map((p) => (
                                        <p key={p.mensagem}>{p.mensagem}</p>
                                    ))}
                                    {problemas.length > 0 && (
                                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                            {problemas.map((p) => (
                                                <li key={`${p.turmaId}|${p.dia}|${p.tempo}`}>
                                                    {p.turma}, {DIAS_SEMANA_MAP[p.dia!].toLowerCase()}, {p.tempo}ª aula: {p.detalhes.length > 0 ? p.detalhes.join(" ") : p.mensagem}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </AlertDescription>
                            </Alert>
                        )}
                        {desatualizado && (
                            <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                                <TriangleAlert className="size-4 shrink-0" /> O projeto mudou depois que este horário foi gerado. Gere de novo para atualizar.
                            </p>
                        )}
                        {observacoes.length > 0 && (
                            <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-600 dark:text-amber-400">
                                {observacoes.map((o) => (
                                    <li key={o}>{o}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {horario && (
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                        {(["turmas", "professores", ...(temAmbientes ? (["ambientes"] as const) : [])] as Visao[]).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setVisao(v)}
                                className={cn(
                                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                                    v === visaoAtual ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                                )}
                            >
                                Por {v === "turmas" ? "turma" : v === "professores" ? "professor" : "ambiente"}
                            </button>
                        ))}
                        {!gerando && (
                            <div className="ml-auto flex gap-2">
                                <Button size="sm" variant="outline" onClick={() => window.print()}>
                                    <Printer /> Imprimir
                                </Button>
                                <Button size="sm" variant="outline" title="Planilha (CSV) da visão atual" onClick={exportar}>
                                    <Download /> Exportar
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {horario && (
                <div className="space-y-8">
                    <h2 className="hidden text-xl font-semibold print:block">Horário — {projeto.nome}</h2>
                    <div className="flex flex-wrap gap-2 [print-color-adjust:exact]">
                        {projeto.docentes.map((d) => {
                            const p = professor(d.professorId);
                            return (
                                <span key={d.professorId} className="rounded-full px-3 py-0.5 text-xs font-medium" style={{ backgroundColor: p?.cor, color: p ? corDoTexto(p.cor) : undefined }}>
                                    {p?.nome || "(sem nome)"}
                                </span>
                            );
                        })}
                    </div>
                    {quadros.length === 0 && <Vazio>Nada para mostrar nesta visão.</Vazio>}
                    {quadros.map((q) => (
                        <QuadroDeHorario key={q.id} projeto={projeto} quadro={q} />
                    ))}
                </div>
            )}
        </div>
    );
}

function QuadroDeHorario({ projeto, quadro }: { projeto: ProjetoHorario; quadro: Quadro }) {
    const { dias, faixas } = projeto.quadro;
    let tempo = 0;
    return (
        <section className="break-inside-avoid space-y-2">
            <h3 className="text-lg font-medium">{quadro.titulo}</h3>
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
                    <tbody>
                        {faixas.map((f) => {
                            if (f.tipo === "intervalo") {
                                return (
                                    <tr key={f.id} className="bg-muted/30 text-xs text-muted-foreground">
                                        <td className="px-2 py-0.5">
                                            <span className="hidden md:inline">{f.inicio}</span>
                                        </td>
                                        <td colSpan={dias.length} className="py-0.5 text-center">{f.nome || "Intervalo"}</td>
                                    </tr>
                                );
                            }
                            const t = ++tempo;
                            // Aula do quadro que não se aplica (a turma não tem horário nela) e está vazia: não aparece
                            if (!dias.some((d) => quadro.ativo(d, t) || quadro.celulas.has(chave(d, t)))) return null;
                            return (
                                <tr key={f.id} className="border-t border-border">
                                    <td className="px-2 py-1 whitespace-nowrap" title={`${f.inicio}–${fimDaFaixa(f)}`}>
                                        <span className="font-medium">{t}ª</span>{" "}
                                        <span className="hidden text-xs text-muted-foreground md:inline">{f.inicio}–{fimDaFaixa(f)}</span>
                                    </td>
                                    {dias.map((d) => {
                                        const celula = quadro.celulas.get(chave(d, t));
                                        const ativo = quadro.ativo(d, t);
                                        const [principal, ...resto] = celula?.linhas ?? [];
                                        return (
                                            <td
                                                key={d}
                                                title={celula?.problema ?? (celula?.mudou ? `Mudou na última atualização: ${celula.linhas.join(" — ")}` : celula?.linhas.join(" — "))}
                                                className={cn(
                                                    "relative h-12 border-l border-border px-0.5 py-0.5 text-center text-[0.65rem] leading-tight hyphens-auto sm:px-1 sm:text-xs",
                                                    !ativo && "bg-muted/40",
                                                    celula?.problema && "outline-2 -outline-offset-2 outline-destructive",
                                                    celula?.mudou && !celula.problema && "outline-2 -outline-offset-2 outline-sky-500 dark:outline-sky-400",
                                                )}
                                                style={principal && celula?.cor ? { backgroundColor: celula.cor, color: corDoTexto(celula.cor) } : undefined}
                                            >
                                                {principal ? (
                                                    <>
                                                        <p className={cn("font-medium break-words text-balance", resto.length > 0 ? "line-clamp-2" : "line-clamp-3")}>{principal}</p>
                                                        {resto.length > 0 && <p className="truncate opacity-80">{resto.join(" · ")}</p>}
                                                    </>
                                                ) : ativo && quadro.vazioEhFalha ? (
                                                    <span className="text-destructive">vazio</span>
                                                ) : null}
                                                {celula?.problema && <CircleAlert className="absolute top-0.5 right-0.5 size-3.5 rounded-full bg-white text-destructive" />}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
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
function PainelDeProgresso({ progresso, gerando, parcial }: {
    progresso: { solver: SolverHorario; valor: ProgressoDoSolver; msDaMudanca: number };
    gerando: boolean;
    parcial: HorarioGerado | null;
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
    const violacoes = parcial ? parcial.problemas.filter((x) => x.turmaId).length : null;

    return (
        <div className={cn("mb-4 rounded-2xl border border-border px-4 py-3 text-sm", !gerando && "text-muted-foreground")}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
                <Item rotulo={gerando ? "Tempo" : "Duração"}>{duracao(p.ms)}</Item>
                <Item rotulo={unidade.iter[0].toUpperCase() + unidade.iter.slice(1)} title={extras.join(", ")}>
                    {compacto.format(p.iter)} <span className="text-xs font-normal text-muted-foreground">({compacto.format(porSegundo)}/s)</span>
                </Item>
                {p.custo !== undefined && (
                    <Item rotulo="Custo" title="Soma das penalidades do melhor horário: 0 = todas as regras atendidas. As regras de qualidade, somadas, valem menos que uma regra obrigatória.">
                        {numero.format(p.custo)}
                    </Item>
                )}
                {violacoes !== null && parcial && (
                    <Item rotulo="Situação">
                        {parcial.completo ? `válido, ${plural(parcial.qualidade.length, "observação", "observações")}` : plural(violacoes, "célula com problema", "células com problema")}
                    </Item>
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
            {gerando && p.versao > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                    As aulas que mudaram de lugar na última atualização ficam com contorno azul.
                </p>
            )}
        </div>
    );
}
