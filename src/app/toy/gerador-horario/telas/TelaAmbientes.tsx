import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Ambiente } from "../modelo/modelo";
import { ambienteDaOferta, novoId, removerAmbiente } from "../modelo/operacoes";
import { CampoNumero, Cabecalho, RotuloMovel, Vazio, plural } from "../componentes/comuns";
import type { Contexto } from "../useAreaDeTrabalho";

const COLUNAS = "grid-cols-6 items-center gap-x-2 gap-y-1.5 px-3 md:grid-cols-[1fr_7rem_minmax(8rem,16rem)_2rem]";

export function TelaAmbientes({ area, mudarArea }: Contexto) {
    const { ambientes } = area.cadastros;
    const mudar = (id: string, campos: Partial<Ambiente>) =>
        mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, ambientes: a.cadastros.ambientes.map((x) => (x.id === id ? { ...x, ...campos } : x)) } }));
    /** Em quantas disciplinas o ambiente é usado, por projeto. */
    const usos = (id: string) =>
        area.projetos.map((p) => ({ nome: p.nome, n: p.ofertas.filter((o) => ambienteDaOferta(p, o) === id).length })).filter((u) => u.n > 0);

    return (
        <div>
            <Cabecalho
                titulo="Ambientes"
                ajuda="Salas, laboratórios, quadra. Cada turma tem um ambiente padrão, e cada disciplina pode usar outro (um laboratório, por exemplo). Duas aulas nunca são colocadas no mesmo ambiente ao mesmo tempo. A capacidade é conferida contra o número de alunos da turma."
                acoes={
                    <Button
                        onClick={() =>
                            mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, ambientes: [...a.cadastros.ambientes, { id: novoId(), nome: "", capacidade: 40 }] } }))
                        }
                    >
                        <Plus /> Ambiente
                    </Button>
                }
            />

            {ambientes.length === 0 ? (
                <Vazio>Nenhum ambiente cadastrado. O cadastro é opcional: sem ambientes, o horário é gerado só com turmas e professores.</Vazio>
            ) : (
                <div className="rounded-2xl border border-border">
                    <div className={COLUNAS + " hidden rounded-t-2xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground md:grid"}>
                        <span>Nome</span>
                        <span className="text-center">Capacidade</span>
                        <span>Uso</span>
                        <span />
                    </div>
                    {ambientes.map((amb) => {
                        const u = usos(amb.id);
                        return (
                            <div key={amb.id} className={COLUNAS + " grid border-t border-border py-1.5 first:border-t-0 md:first:border-t"}>
                                <Input aria-label="Nome" className="col-span-5 h-8 md:col-span-1" placeholder="Ex.: Sala 12, Lab. Informática 1" value={amb.nome} onChange={(e) => mudar(amb.id, { nome: e.target.value })} />
                                <div className="text-right md:order-last">
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        title="Remover ambiente"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => {
                                            if (u.length === 0 || confirm(`Remover “${amb.nome}”? As turmas e disciplinas que o usam ficam sem ambiente.`)) {
                                                mudarArea((a) => removerAmbiente(a, amb.id));
                                            }
                                        }}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <RotuloMovel>Capacidade</RotuloMovel>
                                    <CampoNumero aria-label="Capacidade" title="Quantos alunos comporta" className="h-8" max={9999} valor={amb.capacidade} onChange={(n) => mudar(amb.id, { capacidade: n })} />
                                </div>
                                <span className="col-span-4 text-xs text-muted-foreground md:col-span-1">
                                    {u.length === 0 ? "sem uso" : u.map((x) => `${plural(x.n, "disciplina", "disciplinas")} em ${x.nome}`).join(" · ")}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
