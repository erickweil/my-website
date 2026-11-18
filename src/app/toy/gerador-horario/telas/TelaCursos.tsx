import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Componente, Curso, Id } from "../modelo/modelo";
import { adicionarPeriodo, duplicarCurso, nomeDoPeriodo, novoComponente, novoCurso, removerCurso } from "../modelo/operacoes";
import { Cabecalho, Vazio, plural } from "../componentes/comuns";
import { CampoNumero, Selecao } from "../componentes/campos";
import { Pilula } from "../componentes/escolha";
import { BotaoAdicionar, ItemDaLista, ListaComDetalhe } from "../componentes/lista";
import { BotaoRemover, LinhaEditavel, TabelaEditavel } from "../componentes/tabela";
import type { Contexto } from "../useAreaDeTrabalho";

const NIVEIS: Record<Curso["nivel"], string> = {
    integrado: "Técnico integrado",
    subsequente: "Técnico subsequente",
    superior: "Superior",
    outro: "Outro",
};

const COLUNAS = "grid-cols-[1fr_5rem_2rem] items-center gap-x-2 px-3";

export function TelaCursos({ area, mudarArea }: Contexto) {
    const { cursos } = area.cadastros;
    const [selecionado, setSelecionado] = useState<Id | null>(null);
    const [periodoId, setPeriodoId] = useState<Id | null>(null);
    const curso = cursos.find((c) => c.id === selecionado) ?? cursos[0];
    const periodo = curso?.periodos.find((p) => p.id === periodoId) ?? curso?.periodos[0];

    const mudarCursos = (fn: (cursos: Curso[]) => Curso[]) => mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, cursos: fn(a.cadastros.cursos) } }));
    const mudar = (fn: (c: Curso) => Curso) => mudarCursos((cs) => cs.map((c) => (c.id === curso.id ? fn(c) : c)));
    const mudarComponentes = (fn: (cs: Componente[]) => Componente[]) =>
        mudar((c) => ({ ...c, periodos: c.periodos.map((p) => (p.id === periodo?.id ? { ...p, componentes: fn(p.componentes) } : p)) }));
    const mudarComponente = (id: Id, campos: Partial<Componente>) => mudarComponentes((cs) => cs.map((x) => (x.id === id ? { ...x, ...campos } : x)));

    const abrir = (id: Id) => {
        setSelecionado(id);
        setPeriodoId(null);
    };
    const adicionar = (novo: Curso) => {
        mudarCursos((cs) => [...cs, novo]);
        abrir(novo.id);
    };
    const turmasDoCurso = (id: Id) => area.projetos.reduce((n, p) => n + p.turmas.filter((t) => t.origem?.cursoId === id).length, 0);

    return (
        <div>
            <Cabecalho titulo="Cursos" ajuda="As disciplinas de cada período e as aulas por semana. Uma turma criada a partir do curso recebe essas aulas." />

            <ListaComDetalhe
                lista={
                    <>
                        {cursos.map((c) => (
                            <ItemDaLista key={c.id} ativo={c.id === curso?.id} onClick={() => abrir(c.id)} titulo={c.nome || "(sem nome)"} />
                        ))}
                        <BotaoAdicionar onClick={() => adicionar(novoCurso(`Curso ${cursos.length + 1}`))}>Curso</BotaoAdicionar>
                    </>
                }
            >
                {!curso ? (
                    <Vazio>Nenhum curso cadastrado. O cadastro é opcional: serve para criar turmas já com as disciplinas.</Vazio>
                ) : (
                    <div className="space-y-5">
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-48 flex-1 space-y-1.5">
                                <Label htmlFor="curso-nome">Nome</Label>
                                <Input id="curso-nome" value={curso.nome} onChange={(e) => mudar((c) => ({ ...c, nome: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="curso-nivel">Nível</Label>
                                <Selecao id="curso-nivel" className="block" value={curso.nivel} onChange={(e) => mudar((c) => ({ ...c, nivel: e.target.value as Curso["nivel"] }))}>
                                    {Object.entries(NIVEIS).map(([id, nome]) => (
                                        <option key={id} value={id}>{nome}</option>
                                    ))}
                                </Selecao>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="curso-regime">Períodos</Label>
                                <Selecao id="curso-regime" className="block" value={curso.regime} onChange={(e) => mudar((c) => ({ ...c, regime: e.target.value as Curso["regime"] }))}>
                                    <option value="semestral">Semestres</option>
                                    <option value="anual">Anos</option>
                                </Selecao>
                            </div>
                            <div className="flex gap-1">
                                <Button variant="outline" title="Novo curso com a mesma matriz, para um novo PPC" onClick={() => adicionar(duplicarCurso(curso))}>
                                    <Copy /> Duplicar
                                </Button>
                                <BotaoRemover
                                    titulo="Remover curso"
                                    confirmar={`Remover o curso “${curso.nome}”?${turmasDoCurso(curso.id) > 0 ? ` ${plural(turmasDoCurso(curso.id), "turma continua existindo", "turmas continuam existindo")}, sem vínculo com o curso.` : ""}`}
                                    onRemover={() => mudarArea((a) => removerCurso(a, curso.id))}
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {curso.periodos.map((p) => (
                                <Pilula key={p.id} ativa={p.id === periodo?.id} onClick={() => setPeriodoId(p.id)}>
                                    {nomeDoPeriodo(curso, p)}
                                </Pilula>
                            ))}
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    const novo = adicionarPeriodo(curso);
                                    mudar(() => novo);
                                    setPeriodoId(novo.periodos.at(-1)!.id);
                                }}
                            >
                                <Plus /> Período
                            </Button>
                        </div>

                        {periodo && (
                            <div className="space-y-2">
                                <TabelaEditavel
                                    colunas={COLUNAS}
                                    cabecalho={<><span>Disciplina</span><span className="text-center">Aulas/sem.</span><span /></>}
                                    vazio={periodo.componentes.length === 0 && "Nenhuma disciplina neste período."}
                                >
                                    {periodo.componentes.map((c) => (
                                        <LinhaEditavel key={c.id} colunas={COLUNAS}>
                                            <Input aria-label="Disciplina" className="h-8" placeholder="Nome da disciplina" value={c.nome} onChange={(e) => mudarComponente(c.id, { nome: e.target.value })} />
                                            <CampoNumero aria-label="Aulas por semana" className="h-8" max={60} valor={c.aulasSemana} onChange={(n) => mudarComponente(c.id, { aulasSemana: n })} />
                                            <BotaoRemover titulo="Remover disciplina" onRemover={() => mudarComponentes((cs) => cs.filter((x) => x.id !== c.id))} />
                                        </LinhaEditavel>
                                    ))}
                                </TabelaEditavel>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <BotaoAdicionar className="md:w-auto" onClick={() => mudarComponentes((cs) => [...cs, novoComponente()])}>
                                        Disciplina
                                    </BotaoAdicionar>
                                    <span className="text-sm text-muted-foreground">
                                        {plural(periodo.componentes.reduce((s, c) => s + c.aulasSemana, 0), "aula por semana", "aulas por semana")}
                                    </span>
                                    {curso.periodos.length > 1 && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => {
                                                if (periodo.componentes.length === 0 || confirm(`Remover o ${nomeDoPeriodo(curso, periodo)} e as disciplinas dele?`)) {
                                                    mudar((c) => ({ ...c, periodos: c.periodos.filter((p) => p.id !== periodo.id) }));
                                                    setPeriodoId(null);
                                                }
                                            }}
                                        >
                                            Remover {nomeDoPeriodo(curso, periodo)}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </ListaComDetalhe>
        </div>
    );
}
