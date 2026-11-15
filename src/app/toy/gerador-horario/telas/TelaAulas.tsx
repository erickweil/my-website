import { useState } from "react";
import { ChevronDown, Link2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Distribuicao, Id, Oferta, Professor } from "../modelo/modelo";
import { aulasDaTurma, contarTempos, criarOferta, juntarOfertas, manterDocentes, nomeNaTurma, ofertasDaTurma, renomearNaTurma, separarTurma } from "../modelo/operacoes";
import { Ajuda, CampoNumero, Cabecalho, RotuloMovel, Selecao, Vazio, rotuloDoProfessor } from "../componentes/comuns";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";
import { novoProfessor } from "./TelaProfessores";
import { ResumoDaTurma } from "./TelaTurmas";

export function TelaAulas({
    area,
    projeto,
    mudarArea,
    mudarProjeto,
    turmaId,
    escolherTurma,
}: ContextoDoProjeto & { turmaId: Id | null; escolherTurma: (id: Id) => void }) {
    const [erro, setErro] = useState<string | null>(null);
    const turma = projeto.turmas.find((t) => t.id === turmaId) ?? projeto.turmas[0];
    if (!turma) {
        return (
            <div>
                <Cabecalho titulo="Aulas" />
                <Vazio>Crie uma turma primeiro: as aulas são cadastradas por turma.</Vazio>
            </div>
        );
    }
    const ofertas = ofertasDaTurma(projeto, turma.id);
    const nomeDaTurma = (id: Id) => projeto.turmas.find((t) => t.id === id)?.nome || "(sem nome)";

    const mudarOferta = (id: Id, campos: Partial<Oferta>, cosmetica = false) =>
        mudarProjeto((p) => manterDocentes({ ...p, ofertas: p.ofertas.map((o) => (o.id === id ? { ...o, ...campos } : o)) }), cosmetica);

    /** Tira a disciplina desta turma; se era conjunta, as outras turmas continuam com ela. */
    const remover = (oferta: Oferta) =>
        mudarProjeto((p) =>
            manterDocentes({
                ...p,
                ofertas: p.ofertas.flatMap((o) => {
                    if (o.id !== oferta.id) return [o];
                    const participacoes = o.participacoes.filter((x) => x.turmaId !== turma.id);
                    return participacoes.length > 0 ? [{ ...o, participacoes }] : [];
                }),
            }),
        );

    const juntar = (ficaId: Id, saiId: Id) => {
        const r = juntarOfertas(projeto, ficaId, saiId);
        if ("erro" in r) setErro(r.erro);
        else {
            setErro(null);
            mudarProjeto(() => manterDocentes(r.projeto));
        }
    };

    const conjuntas = ofertas.filter((o) => o.participacoes.length > 1);

    return (
        <div>
            <Cabecalho titulo="Aulas" />

            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                {projeto.turmas.map((t) => {
                    const fecha = aulasDaTurma(projeto, t.id) === contarTempos(t.horarios);
                    return (
                        <button
                            key={t.id}
                            type="button"
                            title={fecha ? undefined : "As aulas desta turma não fecham com os horários marcados"}
                            onClick={() => escolherTurma(t.id)}
                            className={cn(
                                "shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                                t.id === turma.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {t.nome || "(sem nome)"}
                            {!fecha && <span className={cn("ml-1.5", t.id === turma.id ? "" : "text-destructive")}>●</span>}
                        </button>
                    );
                })}
            </div>

            <div className="rounded-2xl border border-border">
                <div className={cn(COLUNAS, "hidden rounded-t-2xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground md:grid")}>
                    <span>Disciplina</span>
                    <span>Professores</span>
                    <span className="text-center">Aulas/sem.</span>
                    <span title="Aulas seguidas por bloco (2 = aulas duplas). 0 = sem agrupamento.">Agrupar</span>
                    <span />
                </div>
                {ofertas.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma disciplina nesta turma.</p>}
                {ofertas.map((o) => (
                    <div key={o.id} className={cn(COLUNAS, "grid border-t border-border py-2 first:border-t-0 md:first:border-t")}>
                        <div className="col-span-5 md:col-span-1">
                            <Input
                                aria-label="Disciplina"
                                className="h-8"
                                placeholder="Nome da disciplina"
                                value={nomeNaTurma(o, turma.id)}
                                onChange={(e) => mudarProjeto((p) => ({ ...p, ofertas: p.ofertas.map((x) => (x.id === o.id ? renomearNaTurma(x, turma.id, e.target.value) : x)) }), true)}
                            />
                        </div>
                        <div className="col-span-1 text-right md:order-last">
                            <Button size="icon-sm" variant="ghost" title="Remover disciplina da turma" className="text-destructive hover:text-destructive" onClick={() => remover(o)}>
                                <Trash2 />
                            </Button>
                        </div>
                        <div className="col-span-6 md:order-3 md:col-span-1">
                            <RotuloMovel>Professores</RotuloMovel>
                            <SeletorProfessores
                                professores={area.cadastros.professores}
                                selecionados={o.professorIds}
                                onChange={(professorIds) => mudarOferta(o.id, { professorIds })}
                                onCriar={(nome) => {
                                    const novo = novoProfessor(area.cadastros.professores, nome);
                                    mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, professores: [...a.cadastros.professores, novo] } }));
                                    mudarOferta(o.id, { professorIds: [...o.professorIds, novo.id] });
                                }}
                            />
                        </div>
                        <div className="col-span-2 md:order-4 md:col-span-1">
                            <RotuloMovel>Aulas/sem.</RotuloMovel>
                            <CampoNumero aria-label="Aulas por semana" className="h-8" max={60} valor={o.aulasSemana} onChange={(n) => mudarOferta(o.id, { aulasSemana: n })} />
                        </div>
                        <div className="col-span-4 md:order-5 md:col-span-1">
                            <RotuloMovel>Agrupar</RotuloMovel>
                            <CampoDistribuicao valor={o.distribuicao} onChange={(distribuicao) => mudarOferta(o.id, { distribuicao })} />
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-3 space-y-3">
                <Button variant="outline" onClick={() => mudarProjeto((p) => criarOferta(p, turma.id).projeto)}>
                    <Plus /> Disciplina
                </Button>
                <ResumoDaTurma aulas={aulasDaTurma(projeto, turma.id)} tempos={contarTempos(turma.horarios)} />
            </div>

            <section className="mt-8">
                <h3 className="mb-2 flex items-center gap-2 font-medium">
                    Aulas em conjunto
                    <Ajuda>
                        Caso especial: uma disciplina dada para duas ou mais turmas ao mesmo tempo, na mesma sala. As disciplinas
                        juntadas precisam ter o mesmo número de aulas e a mesma distribuição; os professores das duas ficam na aula.
                    </Ajuda>
                </h3>
                <div className="space-y-2">
                    {conjuntas.map((o) => (
                        <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border px-3 py-2 text-sm">
                            <Link2 className="size-4 text-muted-foreground" />
                            <span>
                                <span className="font-medium">{nomeNaTurma(o, turma.id) || "(sem nome)"}</span>
                                <span className="text-muted-foreground"> ({turma.nome})</span>
                            </span>
                            {o.participacoes.filter((x) => x.turmaId !== turma.id).map((x) => (
                                <span key={x.turmaId} className="inline-flex items-center gap-1.5">
                                    <span className="text-muted-foreground">+</span>
                                    <span className="font-medium">{nomeNaTurma(o, x.turmaId) || "(sem nome)"}</span>
                                    <span className="text-muted-foreground">({nomeDaTurma(x.turmaId)})</span>
                                    <button type="button" title="Separar: a turma volta a ter esta disciplina sozinha" className="text-muted-foreground hover:text-destructive" onClick={() => mudarProjeto((p) => separarTurma(p, o.id, x.turmaId))}>
                                        <X className="size-3.5" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ))}
                    <FormularioDeJuncao
                        daTurma={ofertas}
                        turmaId={turma.id}
                        deOutras={projeto.ofertas
                            .filter((c) => !c.participacoes.some((x) => x.turmaId === turma.id))
                            .map((c) => ({ oferta: c, rotulo: c.participacoes.map((x) => `${nomeDaTurma(x.turmaId)}: ${nomeNaTurma(c, x.turmaId) || "(sem nome)"}`).join(" + ") }))}
                        onJuntar={juntar}
                    />
                    {erro && <p className="text-sm text-destructive">{erro}</p>}
                </div>
            </section>
        </div>
    );
}

/** Colunas da tabela de aulas no computador; no celular, 6 colunas em que os campos se empilham. */
const COLUNAS = "grid-cols-6 items-start gap-x-2 gap-y-2 px-3 md:grid-cols-[minmax(9rem,1fr)_minmax(10rem,16rem)_5rem_12rem_2rem]";

/**
 * Agrupamento das aulas: quantas aulas seguidas formam um bloco (0 = sem agrupamento) e se dois
 * blocos podem ficar encostados no mesmo dia.
 */
function CampoDistribuicao({ valor, onChange }: { valor: Distribuicao; onChange: (d: Distribuicao) => void }) {
    return (
        <div className="flex items-center gap-2">
            <CampoNumero
                aria-label="Agrupar"
                title="Aulas seguidas por bloco (2 = aulas duplas). 0 = sem agrupamento."
                className="h-8 w-16 shrink-0"
                max={12}
                valor={valor.tipo === "blocos" ? valor.tamanho : 0}
                // Bloco de 1 aula é o mesmo que não agrupar
                onChange={(n) => onChange(n < 2 ? { tipo: "livre" } : { tipo: "blocos", tamanho: n, emendar: valor.tipo === "blocos" && valor.emendar })}
            />
            <label
                className={cn("flex items-center gap-1.5 text-xs", valor.tipo === "blocos" ? "text-muted-foreground" : "text-muted-foreground/50")}
                title="Permite dois blocos seguidos no mesmo dia (por exemplo, 4 aulas seguidas de uma disciplina de aulas duplas)."
            >
                <Checkbox
                    disabled={valor.tipo !== "blocos"}
                    checked={valor.tipo === "blocos" && valor.emendar}
                    onCheckedChange={(v) => valor.tipo === "blocos" && onChange({ ...valor, emendar: v === true })}
                />
                emendar blocos
            </label>
        </div>
    );
}

function SeletorProfessores({
    professores,
    selecionados,
    onChange,
    onCriar,
}: { professores: Professor[]; selecionados: Id[]; onChange: (ids: Id[]) => void; onCriar: (nome: string) => void }) {
    const [novo, setNovo] = useState("");
    const escolhidos = selecionados.map((id) => professores.find((p) => p.id === id));
    return (
        <Popover>
            <PopoverTrigger
                type="button"
                className="flex min-h-8 w-full items-center gap-1 rounded-3xl border border-border bg-input/30 px-2.5 py-1 text-left text-sm hover:border-foreground/30"
            >
                <span className="flex flex-1 flex-wrap gap-1">
                    {escolhidos.length === 0 ? (
                        <span className="text-destructive">Sem professor</span>
                    ) : (
                        escolhidos.map((p, i) => (
                            <span key={selecionados[i]} className="inline-flex items-center gap-1 rounded-2xl bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                                <span className="size-2 rounded-full" style={{ backgroundColor: p?.cor }} />
                                {rotuloDoProfessor(p)}
                            </span>
                        ))
                    )}
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 gap-1 p-2">
                <div className="max-h-60 overflow-y-auto">
                    {professores.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nenhum professor cadastrado.</p>}
                    {professores.map((p) => {
                        const marcado = selecionados.includes(p.id);
                        return (
                            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-muted">
                                <Checkbox checked={marcado} onCheckedChange={() => onChange(marcado ? selecionados.filter((x) => x !== p.id) : [...selecionados, p.id])} />
                                <span className="size-2.5 rounded-full" style={{ backgroundColor: p.cor }} />
                                <span className="truncate">{p.nome || "(sem nome)"}</span>
                            </label>
                        );
                    })}
                </div>
                <form
                    className="flex gap-1 border-t border-border pt-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (novo.trim()) onCriar(novo.trim());
                        setNovo("");
                    }}
                >
                    <Input className="h-8" placeholder="Novo professor…" value={novo} onChange={(e) => setNovo(e.target.value)} />
                    <Button type="submit" size="icon-sm" variant="outline" title="Criar e selecionar" disabled={!novo.trim()}>
                        <Plus />
                    </Button>
                </form>
            </PopoverContent>
        </Popover>
    );
}

/** Escolhe uma disciplina desta turma e uma de outra, para serem dadas juntas. */
function FormularioDeJuncao({
    daTurma,
    turmaId,
    deOutras,
    onJuntar,
}: { daTurma: Oferta[]; turmaId: Id; deOutras: { oferta: Oferta; rotulo: string }[]; onJuntar: (ficaId: Id, saiId: Id) => void }) {
    const [fica, setFica] = useState("");
    const [sai, setSai] = useState("");
    if (daTurma.length === 0 || deOutras.length === 0) {
        return <p className="text-sm text-muted-foreground">Para juntar, é preciso ter disciplinas nesta turma e em outra.</p>;
    }
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
            <Selecao aria-label="Disciplina desta turma" className="h-8 max-w-full" value={fica} onChange={(e) => setFica(e.target.value)}>
                <option value="">Disciplina desta turma…</option>
                {daTurma.map((o) => (
                    <option key={o.id} value={o.id}>{nomeNaTurma(o, turmaId) || "(sem nome)"} ({o.aulasSemana} aulas)</option>
                ))}
            </Selecao>
            <span className="text-muted-foreground">com</span>
            <Selecao aria-label="Disciplina de outra turma" className="h-8 max-w-full" value={sai} onChange={(e) => setSai(e.target.value)}>
                <option value="">Disciplina de outra turma…</option>
                {deOutras.map(({ oferta, rotulo }) => (
                    <option key={oferta.id} value={oferta.id}>{rotulo} ({oferta.aulasSemana} aulas)</option>
                ))}
            </Selecao>
            <Button
                size="sm"
                variant="outline"
                disabled={!fica || !sai}
                onClick={() => {
                    onJuntar(fica, sai);
                    setFica("");
                    setSai("");
                }}
            >
                <Link2 /> Juntar
            </Button>
        </div>
    );
}
