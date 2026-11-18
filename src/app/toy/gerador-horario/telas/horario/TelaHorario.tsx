import { useState } from "react";
import { CircleAlert, CircleCheck, Download, Eraser, Eye, Loader2, Play, Printer, Square, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DIAS_SEMANA_MAP } from "../../horario-regras";
import { detalharProblema, observarHorario, type Pendencia } from "../../modelo/diagnostico";
import { SOLVERS, pesoDaRegra, type HorarioGerado, type Id, type Solver } from "../../modelo/modelo";
import { ambienteDaOferta, rotuloDoTempo } from "../../modelo/operacoes";
import { chaveDaAlocacao, pontoDePartida } from "../../modelo/para-solver";
import { removerVersao, restaurarVersao, salvarVersao } from "../../modelo/versoes";
import { Ajuda, Cabecalho, ListaComLimite, Vazio, baixarArquivo, nomeDeArquivo, plural } from "../../componentes/comuns";
import { Selecao } from "../../componentes/campos";
import { Abas } from "../../componentes/escolha";
import { ItemDaLista, ListaComDetalhe } from "../../componentes/lista";
import { CartaoDePendencias, usePendencias } from "../../componentes/pendencias";
import type { ContextoDoProjeto } from "../../useAreaDeTrabalho";
import { NOME_DO_SOLVER } from "../TelaConfiguracao";
import { PainelDeProgresso } from "./PainelDeProgresso";
import { QuadroDeHorario } from "./QuadroDeHorario";
import { montarQuadros, paraCsv, type Celula, type Visao } from "./quadros";
import { useGeracao } from "./useGeracao";
import { Versoes } from "./Versoes";

export function TelaHorario({ area, projeto, mudarArea, mudarProjeto, salvarHorario, irPara }: ContextoDoProjeto & { irPara: (p: Pendencia) => void }) {
    const solver = projeto.config.solver;
    const { gerando, parcial, progresso, novas, erro, gerar, parar } = useGeracao(salvarHorario);
    const [visao, setVisao] = useState<Visao>("turmas");
    /** Quadro mostrado (turma, professor ou ambiente), ou todos um embaixo do outro. */
    const [selecionado, setSelecionado] = useState<Id | "todos">("todos");
    /** Versão salva aberta na tela (só para ver), ou o horário atual. */
    const [vendoId, setVendoId] = useState<Id | null>(null);
    const versao = projeto.versoes.find((v) => v.id === vendoId) ?? null;

    // O que a tela mostra: o horário atual (ou o parcial, durante a busca) ou o de uma versão salva,
    // com os dados e cadastros daquele momento. As regras de qualidade desligadas não aparecem.
    const dados = versao?.projeto ?? projeto;
    const cadastros = versao?.cadastros ?? area.cadastros;
    const regraLigada = (r: Parameters<typeof pesoDaRegra>[1]) => pesoDaRegra(projeto.config, r) > 0;
    const bruto = versao ? versao.projeto.horario : gerando ? parcial : projeto.horario;
    const horario = bruto && { ...bruto, qualidade: bruto.qualidade.filter((q) => regraLigada(q.regra)) };

    const professor = (id: Id) => cadastros.professores.find((p) => p.id === id);
    const pendencias = usePendencias(projeto, area.cadastros);
    const totalDeAulas = dados.ofertas.reduce((s, o) => s + o.aulasSemana, 0);
    const desatualizado = !versao && !gerando && projeto.horario !== null && projeto.horario.revisao < projeto.revisao;
    const gerais = horario?.problemas.filter((p) => !p.turmaId) ?? [];
    const observacoes = horario && !gerando ? observarHorario(dados, cadastros, horario) : [];
    const temAmbientes = dados.ofertas.some((o) => ambienteDaOferta(dados, o) !== null);
    const visaoAtual = visao === "ambientes" && !temAmbientes ? "turmas" : visao;
    const quadros = horario ? montarQuadros(dados, horario, visaoAtual, professor, cadastros.ambientes, gerando ? novas : undefined, regraLigada) : [];
    // O escolhido some quando muda a visão (era uma turma e agora são professores): volta a "Todos"
    const atual = quadros.some((q) => q.id === selecionado) ? selecionado : "todos";

    /** Problemas das turmas, com quem está em choque quando dá para saber. */
    const problemas = (horario?.problemas ?? [])
        .filter((p) => p.turmaId && p.dia && p.tempo)
        .map((p) => ({
            ...p,
            turma: dados.turmas.find((t) => t.id === p.turmaId)?.nome || "(sem nome)",
            detalhes: p.ofertaId && horario ? detalharProblema(dados, cadastros, horario, p.ofertaId, p.dia!, p.tempo!) : [],
        }));

    const exportar = () => baixarArquivo(`${nomeDeArquivo("horario", projeto.nome)}-${visaoAtual}.csv`, paraCsv(dados, quadros), "text/csv;charset=utf-8");

    /** De onde a próxima geração parte (a busca exata sempre começa do zero). */
    const partida = solver === "pencilmark" ? [] : pontoDePartida(projeto);
    const fixadas = projeto.horario?.fixadas.length ?? 0;

    /**
     * Fixa as aulas das células; se todas já estavam fixadas, desafixa (como nas grades de
     * disponibilidade). Fixar fica com o que as células mostram agora: uma fixação de outra aula
     * nessas células (que o gerador tirou do lugar) sai. Lê o horário dentro da atualização, não da
     * renderização: os quadros guardam versões antigas desta função (ver QuadroDeHorario).
     */
    const fixar = (celulas: Celula[]) =>
        mudarProjeto((p) => {
            const h = p.horario;
            if (!h) return p;
            const aulas = new Set(celulas.flatMap((c) => c.aulas));
            const nasCelulas = new Set(celulas.flatMap((c) => c.fixadas));
            const desafixar = [...aulas].every((k) => nasCelulas.has(k));
            const ficam = h.fixadas.filter((a) => !nasCelulas.has(chaveDaAlocacao(a)));
            const novas = desafixar ? [] : h.alocacoes.filter((a) => aulas.has(chaveDaAlocacao(a)));
            return { ...p, horario: { ...h, fixadas: [...ficam, ...novas] } };
        }, true);

    /**
     * Tira do quadro as aulas não fixadas (a próxima geração sorteia de novo o que não está fixado)
     * ou, com `tambemAsFixadas`, tudo (a próxima geração começa do zero).
     */
    const limpar = (tambemAsFixadas: boolean) => {
        const h = projeto.horario;
        if (!h) return;
        if (tambemAsFixadas || h.fixadas.length === 0) return salvarHorario(null);
        const fixas = new Set(h.fixadas.map(chaveDaAlocacao));
        const ficam = h.alocacoes.filter((a) => fixas.has(chaveDaAlocacao(a)));
        salvarHorario({ ...h, completo: false, alocacoes: ficam, problemas: [], qualidade: [] });
    };

    const restaurar = (id: Id) => {
        const v = projeto.versoes.find((x) => x.id === id);
        if (!v || !confirm(`Voltar o projeto à versão “${v.nome}”? Turmas, aulas, disponibilidades e o horário voltam ao que eram nela. Salve uma versão antes se quiser guardar o estado atual.`)) return;
        mudarArea((a) => restaurarVersao(a, projeto.id, id));
        setVendoId(null);
    };

    return (
        <div>
            <div className="print:hidden">
                <Cabecalho
                    titulo="Horário"
                    acoes={
                        !versao && (
                            <>
                                <label className="flex items-center gap-2 text-sm">
                                    <span className="text-muted-foreground">Método</span>
                                    <Ajuda>
                                        <p>A busca local e o genético continuam do horário atual. Uma aula fixada é uma regra obrigatória a mais: o gerador só a tira do lugar se não achar um horário melhor com ela ali, e então ela aparece como problema. Para começar do zero, limpe o horário.</p>
                                        <p>Clique numa aula para fixá-la (ou no dia, no número da aula, no turno ou no nome do quadro, para fixar várias).</p>
                                        <p>Pesos das regras e outras opções ficam em Configuração.</p>
                                    </Ajuda>
                                    <Selecao
                                        className="h-9"
                                        value={solver}
                                        disabled={gerando}
                                        onChange={(e) => mudarProjeto((p) => ({ ...p, config: { ...p.config, solver: e.target.value as Solver } }), true)}
                                    >
                                        {SOLVERS.map((s) => (
                                            <option key={s} value={s}>{NOME_DO_SOLVER[s]}</option>
                                        ))}
                                    </Selecao>
                                </label>
                                {gerando ? (
                                    <Button variant="outline" onClick={parar}>
                                        <Square className="fill-current" /> Parar
                                    </Button>
                                ) : (
                                    <>
                                        {projeto.horario && <LimparHorario fixadas={fixadas} onLimpar={limpar} />}
                                        <Button
                                            onClick={() => gerar(projeto, solver)}
                                            disabled={projeto.turmas.length === 0 || totalDeAulas === 0}
                                            title={
                                                partida.length === 0
                                                    ? "Começa de um quadro sorteado"
                                                    : partida.every((a) => a.fixada)
                                                      ? "Começa das aulas fixadas; o resto é sorteado"
                                                      : "Continua do horário atual, com as aulas fixadas como regra obrigatória"
                                            }
                                        >
                                            <Play /> {partida.some((a) => !a.fixada) ? "Continuar" : "Gerar horário"}
                                        </Button>
                                    </>
                                )}
                            </>
                        )
                    }
                />

                {versao && (
                    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
                        <Eye className="size-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                            <p className="font-medium">Vendo a versão “{versao.nome}”</p>
                            <p className="text-xs text-muted-foreground">
                                Salva em {new Date(versao.criadaEm).toLocaleString("pt-BR")}, com as turmas, aulas e professores daquele momento.
                            </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => restaurar(versao.id)}>
                            Restaurar esta versão
                        </Button>
                        <Button size="sm" onClick={() => setVendoId(null)}>
                            Voltar ao atual
                        </Button>
                    </div>
                )}

                <div className="mb-4 space-y-3">
                    {!versao && <CartaoDePendencias pendencias={pendencias} onIr={irPara} />}

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
                                                    {p.turma}, {DIAS_SEMANA_MAP[p.dia!].toLowerCase()}, {rotuloDoTempo(dados.quadro, p.tempo!)}:{" "}
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

                            {!versao && fixadas > 0 && !gerando && (
                                <p className="mt-2 text-xs text-muted-foreground">{plural(fixadas, "aula fixada", "aulas fixadas")}: para a geração, são regras obrigatórias.</p>
                            )}

                            {!versao && progresso && (gerando || progresso.solver !== "pencilmark") && (
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
                            <div className="ml-auto flex flex-wrap gap-2">
                                <Versoes
                                    versoes={projeto.versoes}
                                    vendo={vendoId}
                                    podeSalvar={!!projeto.horario}
                                    onSalvar={(nome) => mudarArea((a) => salvarVersao(a, projeto.id, nome))}
                                    onVer={setVendoId}
                                    onRestaurar={restaurar}
                                    onExcluir={(id) => {
                                        mudarArea((a) => removerVersao(a, projeto.id, id));
                                        if (id === vendoId) setVendoId(null);
                                    }}
                                />
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
                        <h2 className="hidden text-xl font-semibold print:block">Horário — {projeto.nome}{versao && ` (${versao.nome})`}</h2>
                        {quadros.length === 0 && <Vazio>Nada para mostrar nesta visão.</Vazio>}
                        {quadros.map((q) => (
                            // Os que não estão à vista continuam no documento para a impressão sair completa
                            <div key={q.id} className={atual !== "todos" && q.id !== atual ? "hidden print:block" : undefined}>
                                <QuadroDeHorario projeto={dados} quadro={q} onFixar={!versao && !gerando ? fixar : undefined} />
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

/** O botão Limpar e a confirmação, com a opção de tirar também as aulas fixadas. */
function LimparHorario({ fixadas, onLimpar }: { fixadas: number; onLimpar: (tambemAsFixadas: boolean) => void }) {
    const [aberto, setAberto] = useState(false);
    const [tambemAsFixadas, setTambemAsFixadas] = useState(false);
    const limpaTudo = fixadas === 0 || tambemAsFixadas;
    return (
        <Dialog
            open={aberto}
            onOpenChange={(a) => {
                setAberto(a);
                if (a) setTambemAsFixadas(false);
            }}
        >
            <DialogTrigger render={<Button variant="ghost" title="Tirar as aulas do quadro" />}>
                <Eraser /> Limpar
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Limpar o horário?</DialogTitle>
                    <DialogDescription>
                        {limpaTudo
                            ? "Todas as aulas saem do quadro; a próxima geração começa do zero."
                            : `${plural(fixadas, "aula fixada fica", "aulas fixadas ficam")} no quadro; o resto sai e é sorteado de novo na próxima geração.`}
                    </DialogDescription>
                </DialogHeader>
                {fixadas > 0 && (
                    <label className="flex items-center gap-2">
                        <Checkbox checked={tambemAsFixadas} onCheckedChange={(v) => setTambemAsFixadas(v === true)} />
                        Limpar também as aulas fixadas ({fixadas})
                    </label>
                )}
                <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
                    <Button
                        variant="destructive"
                        onClick={() => {
                            onLimpar(tambemAsFixadas);
                            setAberto(false);
                        }}
                    >
                        Limpar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
