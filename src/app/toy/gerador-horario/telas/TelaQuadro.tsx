import { Fragment, useState } from "react";
import { Coffee, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DIAS_SEMANA_MAP } from "../horario-regras";
import { DIAS, TURNOS, type Faixa, type Turno } from "../modelo/modelo";
import { NOME_DO_TURNO, faixaSobreposta, fimDaFaixa, novoId, substituirTurno, trocarDias, trocarFaixas, turnoDaHora, aulasPorTurno } from "../modelo/operacoes";
import { Ajuda, CampoNumero, Cabecalho, Selecao } from "../componentes/comuns";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";

const INICIO_DO_TURNO: Record<Turno, string> = { matutino: "07:30", vespertino: "13:30", noturno: "19:00" };

/** Colunas da tabela de faixas no computador; no celular, 6 colunas em que os campos se empilham. */
const COLUNAS = "grid-cols-6 items-center gap-x-2 gap-y-1.5 px-3 md:grid-cols-[minmax(9rem,1fr)_7.5rem_6rem_4rem_9rem_2rem]";

export function TelaQuadro({ projeto, mudarProjeto }: ContextoDoProjeto) {
    const { quadro } = projeto;
    const sobreposta = faixaSobreposta(quadro);
    const [gerar, setGerar] = useState({ turno: "matutino" as Turno, inicio: "07:30", aulas: 5, intervaloApos: 3, intervaloMin: 20 });

    const mudarFaixa = (id: string, campos: Partial<Faixa>) =>
        mudarProjeto((p) => trocarFaixas(p, p.quadro.faixas.map((f) => (f.id === id ? ({ ...f, ...campos } as Faixa) : f))));

    /** Faixa nova logo depois da última. */
    const adicionar = (tipo: Faixa["tipo"]) =>
        mudarProjeto((p) => {
            const ultima = p.quadro.faixas.at(-1);
            const inicio = ultima ? fimDaFaixa(ultima) : "07:30";
            const nova: Faixa =
                tipo === "aula"
                    ? { tipo, id: novoId(), inicio, duracaoMin: p.quadro.duracaoAulaMin, turno: turnoDaHora(inicio) }
                    : { tipo, id: novoId(), nome: "Intervalo", inicio, duracaoMin: 20 };
            return trocarFaixas(p, [...p.quadro.faixas, nova]);
        });

    // Número de cada aula dentro do turno dela, e as aulas que começam um turno (levam o cabeçalho)
    const numeroDaAula = new Map<string, number>();
    const comecaTurno = new Set<string>();
    for (const t of aulasPorTurno(quadro)) {
        for (const l of t.linhas) {
            if (l.tipo !== "aula") continue;
            numeroDaAula.set(l.faixa.id, l.numero);
            if (l.numero === 1) comecaTurno.add(l.faixa.id);
        }
    }
    return (
        <div>
            <Cabecalho
                titulo="Quadro de horários"
                ajuda="Os dias da semana e a sequência de aulas e intervalos do dia. O mesmo quadro vale para todas as turmas do projeto: cada turma usa a parte que lhe cabe (só a manhã, só a noite). As faixas ficam em ordem de horário; incluir ou remover uma aula renumera as seguintes, e o que já foi marcado nas turmas e nos professores acompanha a aula."
            />

            <section className="mb-8 space-y-2">
                <Label>Dias com aula</Label>
                <div className="flex flex-wrap gap-2">
                    {DIAS.map((dia) => {
                        const ativo = quadro.dias.includes(dia);
                        return (
                            <button
                                key={dia}
                                type="button"
                                aria-pressed={ativo}
                                onClick={() => mudarProjeto((p) => trocarDias(p, ativo ? p.quadro.dias.filter((d) => d !== dia) : [...p.quadro.dias, dia]))}
                                className={cn(
                                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                                    ativo ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {DIAS_SEMANA_MAP[dia]}
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="mb-8">
                <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                    <Label>Aulas e intervalos do dia</Label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        Duração padrão da aula
                        <CampoNumero
                            className="h-8 w-16"
                            min={1}
                            max={300}
                            valor={quadro.duracaoAulaMin}
                            onChange={(n) => mudarProjeto((p) => ({ ...p, quadro: { ...p.quadro, duracaoAulaMin: n } }), true)}
                        />
                        min
                    </label>
                </div>

                <div className="rounded-2xl border border-border">
                    <div className={cn(COLUNAS, "hidden rounded-t-2xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground md:grid")}>
                        <span>Faixa</span>
                        <span>Início</span>
                        <span>Duração (min)</span>
                        <span>Fim</span>
                        <span>Turno</span>
                        <span />
                    </div>
                    {quadro.faixas.length === 0 && (
                        <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma aula no quadro. Gere um turno abaixo ou adicione as aulas uma a uma.</p>
                    )}
                    {quadro.faixas.map((f) => (
                        <Fragment key={f.id}>
                        {comecaTurno.has(f.id) && f.tipo === "aula" && (
                            <div className="border-t border-border bg-muted/50 px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase first:border-t-0 md:first:border-t">
                                {NOME_DO_TURNO[f.turno]}
                            </div>
                        )}
                        <div
                            className={cn(COLUNAS, "grid border-t border-border py-1.5 first:border-t-0 md:first:border-t", f.tipo === "intervalo" && "bg-muted/30", f === sobreposta && "bg-destructive/10")}
                        >
                            <div className="col-span-5 flex items-center gap-2 md:col-span-1">
                                {f.tipo === "aula" ? (
                                    <span className="font-medium">{numeroDaAula.get(f.id)}ª aula</span>
                                ) : (
                                    <>
                                        <Coffee className="size-4 shrink-0 text-muted-foreground" />
                                        <Input
                                            aria-label="Nome do intervalo"
                                            className="h-8 w-36"
                                            value={f.nome}
                                            onChange={(e) => mudarProjeto((p) => trocarFaixas(p, p.quadro.faixas.map((x) => (x.id === f.id ? { ...f, nome: e.target.value } : x))), true)}
                                        />
                                    </>
                                )}
                                <span className="text-xs text-muted-foreground md:hidden">até {fimDaFaixa(f)}</span>
                            </div>
                            <div className="col-span-1 text-right md:order-last">
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    title="Remover"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => mudarProjeto((p) => trocarFaixas(p, p.quadro.faixas.filter((x) => x.id !== f.id)))}
                                >
                                    <Trash2 />
                                </Button>
                            </div>
                            <div className="col-span-2 md:col-span-1">
                                <Input aria-label="Início" type="time" className="h-8" value={f.inicio} onChange={(e) => e.target.value && mudarFaixa(f.id, { inicio: e.target.value })} />
                            </div>
                            <div className="col-span-2 md:col-span-1">
                                <CampoNumero aria-label="Duração em minutos" title="Duração em minutos" className="h-8" min={1} max={300} valor={f.duracaoMin} onChange={(n) => mudarFaixa(f.id, { duracaoMin: n })} />
                            </div>
                            <div className="hidden text-muted-foreground tabular-nums md:block">{fimDaFaixa(f)}</div>
                            <div className="col-span-2 md:col-span-1">
                                {f.tipo === "aula" && (
                                    <Selecao aria-label="Turno" className="h-8 w-full" value={f.turno} onChange={(e) => mudarFaixa(f.id, { turno: e.target.value as Turno })}>
                                        {TURNOS.map((t) => (
                                            <option key={t} value={t}>{NOME_DO_TURNO[t]}</option>
                                        ))}
                                    </Selecao>
                                )}
                            </div>
                        </div>
                        </Fragment>
                    ))}
                </div>
                {sobreposta && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-destructive">
                        <TriangleAlert className="size-4" /> A faixa das {sobreposta.inicio} começa antes de a anterior terminar.
                    </p>
                )}
                <div className="mt-3 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => adicionar("aula")}>
                        <Plus /> Aula
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => adicionar("intervalo")}>
                        <Plus /> Intervalo
                    </Button>
                </div>
            </section>

            <section className="rounded-2xl border border-border p-4">
                <h3 className="mb-3 flex items-center gap-2 font-medium">
                    Gerar um turno
                    <Ajuda>
                        Cria as aulas de um turno de uma vez, com a duração padrão. Se o turno já existe, ele é refeito e as outras
                        faixas ficam como estão.
                    </Ajuda>
                </h3>
                <div className="flex flex-wrap items-end gap-3">
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Turno</span>
                        <Selecao value={gerar.turno} onChange={(e) => setGerar({ ...gerar, turno: e.target.value as Turno, inicio: INICIO_DO_TURNO[e.target.value as Turno] })}>
                            {TURNOS.map((t) => (
                                <option key={t} value={t}>{NOME_DO_TURNO[t]}</option>
                            ))}
                        </Selecao>
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Começa às</span>
                        <Input type="time" className="w-28" value={gerar.inicio} onChange={(e) => e.target.value && setGerar({ ...gerar, inicio: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Aulas</span>
                        <CampoNumero className="w-16" min={1} max={12} valor={gerar.aulas} onChange={(n) => setGerar({ ...gerar, aulas: n })} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Intervalo depois da aula</span>
                        <CampoNumero className="w-16" min={0} max={12} valor={gerar.intervaloApos} onChange={(n) => setGerar({ ...gerar, intervaloApos: n })} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Duração do intervalo (min)</span>
                        <CampoNumero className="w-20" min={0} max={180} valor={gerar.intervaloMin} onChange={(n) => setGerar({ ...gerar, intervaloMin: n })} />
                    </label>
                    <Button onClick={() => mudarProjeto((p) => substituirTurno(p, { ...gerar, duracaoMin: p.quadro.duracaoAulaMin }))}>
                        Gerar turno
                    </Button>
                </div>
            </section>
        </div>
    );
}
