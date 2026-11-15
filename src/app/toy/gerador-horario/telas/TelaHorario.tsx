import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Loader2, Play, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { raceWorkers } from "@/lib/workerRace";
import { cn } from "@/lib/utils";
import { DIAS_SEMANA_MAP, type HorarioWorkerTaskValue, type SolverHorario } from "../horario-regras";
import type { Dia, HorarioGerado, Id, Oferta, Professor, ProjetoHorario, Turma } from "../modelo/modelo";
import { aulasDaTurma, aulasDoProfessor, contarTempos, fimDaFaixa, limitarAoQuadro, ofertasDaTurma } from "../modelo/operacoes";
import { doSolver, paraSolver } from "../modelo/para-solver";
import { Ajuda, Cabecalho, Selecao, Vazio, corDoTexto, rotuloDoProfessor } from "../componentes/comuns";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";

/** O que impede um horário completo e dá para ver só olhando os dados. */
function pendencias(projeto: ProjetoHorario, nomeDoProfessor: (id: Id) => string): string[] {
    const lista: string[] = [];
    if (projeto.turmas.length === 0) lista.push("O projeto não tem turmas.");
    for (const t of projeto.turmas) {
        const [aulas, tempos] = [aulasDaTurma(projeto, t.id), contarTempos(limitarAoQuadro(t.horarios, projeto.quadro))];
        if (tempos === 0) lista.push(`A turma “${t.nome}” não tem nenhum horário marcado.`);
        else if (aulas < tempos) lista.push(`A turma “${t.nome}” tem ${tempos} horários marcados e só ${aulas} aulas: faltam ${tempos - aulas}.`);
        else if (aulas > tempos) lista.push(`A turma “${t.nome}” tem ${aulas} aulas para ${tempos} horários: sobram ${aulas - tempos}.`);
    }
    for (const o of projeto.ofertas) {
        if (o.aulasSemana > 0 && o.professorIds.length === 0) lista.push(`A disciplina “${o.nome}” está sem professor.`);
        if (o.distribuicao.tipo === "blocos" && o.aulasSemana % o.distribuicao.tamanho !== 0) {
            lista.push(`A disciplina “${o.nome}” tem ${o.aulasSemana} aulas, que não fecham em blocos de ${o.distribuicao.tamanho}.`);
        }
    }
    for (const d of projeto.docentes) {
        const [aulas, tempos] = [aulasDoProfessor(projeto, d.professorId), contarTempos(limitarAoQuadro(d.disponibilidade, projeto.quadro))];
        if (aulas > tempos) lista.push(`${nomeDoProfessor(d.professorId)} tem ${aulas} aulas e só ${tempos} horários disponíveis.`);
    }
    return lista;
}

export function TelaHorario({ area, projeto, salvarHorario }: ContextoDoProjeto) {
    const [solver, setSolver] = useState<SolverHorario>("pencilmark");
    const [ilhas, setIlhas] = useState(true);
    const [gerando, setGerando] = useState(false);
    /** Quadro parcial enquanto a busca roda. */
    const [parcial, setParcial] = useState<HorarioGerado | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const interromper = useRef<(() => void) | null>(null);
    // Sair da tela no meio da geração encerra o worker
    useEffect(() => () => interromper.current?.(), []);

    const professor = (id: Id) => area.cadastros.professores.find((p) => p.id === id);
    const avisos = pendencias(projeto, (id) => professor(id)?.nome || "(sem nome)");
    const totalDeAulas = projeto.ofertas.reduce((s, o) => s + o.aulasSemana, 0);

    const gerar = async () => {
        setErro(null);
        setParcial(null);
        setGerando(true);
        const { formulario, diasAtivos } = paraSolver(projeto);
        const { promise, abort } = raceWorkers<HorarioWorkerTaskValue>({
            n: 1,
            createWorker: () => new Worker(new URL("../horario-wasm.worker.ts", import.meta.url)),
            initMessage: () => ({ action: "solucionarQuadroHorario", solver, formData: formulario, diasAtivos, ilhas }),
            onMessage: (_, msg) => {
                if (msg.value?.solucao) setParcial(doSolver(projeto, msg.value));
            },
        });
        interromper.current = abort;
        try {
            salvarHorario(doSolver(projeto, await promise));
        } catch (e) {
            // Interrompido pelo usuário: fica o que já estava salvo
            if (!(e instanceof DOMException && e.name === "AbortError")) {
                setErro(e instanceof Error ? e.message : "Erro desconhecido ao gerar o horário.");
            }
        } finally {
            interromper.current = null;
            setGerando(false);
            setParcial(null);
        }
    };

    const horario = gerando ? parcial : projeto.horario;
    const desatualizado = !gerando && projeto.horario !== null && projeto.horario.revisao < projeto.revisao;
    const semTurma = horario?.problemas.filter((p) => !p.turmaId) ?? [];

    return (
        <div>
            <Cabecalho titulo="Horário" />

            {avisos.length > 0 && (
                <Alert className="mb-4">
                    <TriangleAlert />
                    <AlertTitle>Antes de gerar: {avisos.length === 1 ? "1 pendência" : `${avisos.length} pendências`}</AlertTitle>
                    <AlertDescription>
                        <ul className="list-disc space-y-0.5 pl-4">
                            {avisos.map((a) => (
                                <li key={a}>{a}</li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            <div className="mb-6 flex flex-wrap items-center gap-3">
                {gerando ? (
                    <Button size="lg" variant="outline" onClick={() => interromper.current?.()}>
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
                        {parcial ? `${parcial.alocacoes.length} de ${totalDeAulas} aulas alocadas…` : "Preparando…"}
                    </span>
                )}
                <details className="ml-auto text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Opções avançadas</summary>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2">
                            Método
                            <Ajuda>
                                A busca exata acha um horário sem erros ou prova que não existe. O algoritmo genético devolve o melhor
                                horário que encontrar, mesmo com erros.
                            </Ajuda>
                            <Selecao className="h-8" value={solver} disabled={gerando} onChange={(e) => setSolver(e.target.value as SolverHorario)}>
                                <option value="pencilmark">Busca exata (padrão)</option>
                                <option value="genetic">Algoritmo genético</option>
                            </Selecao>
                        </label>
                        {solver === "genetic" && (
                            <label className="flex items-center gap-2" title="Várias populações evoluem em paralelo e trocam indivíduos entre si.">
                                <Checkbox checked={ilhas} disabled={gerando} onCheckedChange={(v) => setIlhas(v === true)} /> Usar ilhas
                            </label>
                        )}
                    </div>
                </details>
            </div>

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
                                {semTurma.map((p) => (
                                    <p key={p.mensagem}>{p.mensagem}</p>
                                ))}
                                <p>As células com problema estão marcadas nos quadros abaixo.</p>
                            </AlertDescription>
                        </Alert>
                    )}
                    {desatualizado && (
                        <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                            <TriangleAlert className="size-4" /> O projeto mudou depois que este horário foi gerado. Gere de novo para atualizar.
                        </p>
                    )}
                </div>
            )}

            {horario && (
                <div className="space-y-8">
                    <div className="flex flex-wrap gap-2">
                        {projeto.docentes.map((d) => {
                            const p = professor(d.professorId);
                            return (
                                <span key={d.professorId} className="rounded-full px-3 py-0.5 text-xs font-medium" style={{ backgroundColor: p?.cor, color: p ? corDoTexto(p.cor) : undefined }}>
                                    {p?.nome || "(sem nome)"}
                                </span>
                            );
                        })}
                    </div>
                    {projeto.turmas.map((t) => (
                        <QuadroDaTurma key={t.id} projeto={projeto} turma={t} horario={horario} professor={professor} />
                    ))}
                </div>
            )}
        </div>
    );
}

function QuadroDaTurma({
    projeto,
    turma,
    horario,
    professor,
}: { projeto: ProjetoHorario; turma: Turma; horario: HorarioGerado; professor: (id: Id) => Professor | undefined }) {
    const ofertas = new Map<Id, Oferta>(ofertasDaTurma(projeto, turma.id).map((o) => [o.id, o]));
    const chave = (dia: Dia, tempo: number) => `${dia}|${tempo}`;
    const aulaEm = new Map<string, Oferta>();
    for (const a of horario.alocacoes) {
        const o = ofertas.get(a.ofertaId);
        if (o) aulaEm.set(chave(a.dia, a.tempo), o);
    }
    const problemaEm = new Map<string, string>();
    for (const p of horario.problemas) {
        if (p.turmaId === turma.id && p.dia && p.tempo) problemaEm.set(chave(p.dia, p.tempo), p.mensagem);
    }

    let tempo = 0;
    return (
        <section className="space-y-2">
            <h3 className="text-lg font-medium">{turma.nome || "(sem nome)"}</h3>
            <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full table-fixed border-collapse text-sm">
                    <thead>
                        <tr className="bg-muted/50">
                            <th className="w-9 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground md:w-28">
                                <span className="hidden md:inline">Aula</span>
                            </th>
                            {projeto.quadro.dias.map((d) => (
                                <th key={d} className="px-1 py-1.5 font-medium">
                                    <span className="hidden sm:inline">{DIAS_SEMANA_MAP[d]}</span>
                                    <span className="sm:hidden">{DIAS_SEMANA_MAP[d].slice(0, 3)}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {projeto.quadro.faixas.map((f) => {
                            if (f.tipo === "intervalo") {
                                return (
                                    <tr key={f.id} className="bg-muted/30 text-xs text-muted-foreground">
                                        <td className="px-2 py-0.5">
                                            <span className="hidden md:inline">{f.inicio}</span>
                                        </td>
                                        <td colSpan={projeto.quadro.dias.length} className="py-0.5 text-center">{f.nome || "Intervalo"}</td>
                                    </tr>
                                );
                            }
                            const t = ++tempo;
                            // Aula do quadro em que a turma não tem horário em dia nenhum: não aparece
                            if (!projeto.quadro.dias.some((d) => turma.horarios[d]?.includes(t))) return null;
                            return (
                                <tr key={f.id} className="border-t border-border">
                                    <td className="px-2 py-1 whitespace-nowrap" title={`${f.inicio}–${fimDaFaixa(f)}`}>
                                        <span className="font-medium">{t}ª</span>{" "}
                                        <span className="hidden text-xs text-muted-foreground md:inline">{f.inicio}–{fimDaFaixa(f)}</span>
                                    </td>
                                    {projeto.quadro.dias.map((d) => {
                                        const oferta = aulaEm.get(chave(d, t));
                                        const problema = problemaEm.get(chave(d, t));
                                        const temAula = turma.horarios[d]?.includes(t);
                                        const profs = oferta?.professorIds.map(professor) ?? [];
                                        const cor = profs[0]?.cor;
                                        return (
                                            <td
                                                key={d}
                                                title={problema ?? (oferta ? `${oferta.nome} — ${profs.map((p) => p?.nome).join(", ")}` : undefined)}
                                                className={cn("relative h-12 border-l border-border px-0.5 py-0.5 text-center text-[0.65rem] leading-tight hyphens-auto sm:px-1 sm:text-xs", !temAula && "bg-muted/40", problema && "outline-2 -outline-offset-2 outline-destructive")}
                                                style={oferta && cor ? { backgroundColor: cor, color: corDoTexto(cor) } : undefined}
                                            >
                                                {oferta ? (
                                                    <>
                                                        <p className="line-clamp-2 font-medium break-words text-balance">{oferta.sigla || oferta.nome || "(sem nome)"}</p>
                                                        <p className="hidden truncate opacity-80 sm:block">{profs.map(rotuloDoProfessor).join(", ")}</p>
                                                    </>
                                                ) : temAula ? (
                                                    <span className="text-destructive">vazio</span>
                                                ) : null}
                                                {problema && <CircleAlert className="absolute top-0.5 right-0.5 size-3.5 rounded-full bg-white text-destructive" />}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {problemaEm.size > 0 && (
                <ul className="list-disc pl-5 text-xs text-destructive">
                    {[...problemaEm].map(([k, mensagem]) => {
                        const [d, t] = k.split("|");
                        return <li key={k}>{DIAS_SEMANA_MAP[d as Dia]}, {t}ª aula: {mensagem}</li>;
                    })}
                </ul>
            )}
        </section>
    );
}
