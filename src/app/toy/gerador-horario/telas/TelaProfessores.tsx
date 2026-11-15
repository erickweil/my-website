import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Professor } from "../modelo/modelo";
import { PALETA_CORES, aulasDoProfessor, novoId, removerProfessor } from "../modelo/operacoes";
import { Cabecalho, Vazio } from "../componentes/comuns";
import type { Contexto } from "../useAreaDeTrabalho";

export const novoProfessor = (existentes: Professor[], nome = ""): Professor => ({
    id: novoId(),
    nome,
    sigla: "",
    cor: PALETA_CORES[existentes.length % PALETA_CORES.length],
});

const COLUNAS = "grid-cols-6 items-center gap-x-2 gap-y-1.5 px-3 md:grid-cols-[2.5rem_1fr_8rem_minmax(8rem,14rem)_2rem]";

export function TelaProfessores({ area, mudarArea }: Contexto) {
    const { professores } = area.cadastros;
    const mudar = (id: string, campos: Partial<Professor>) =>
        mudarArea((a) => ({
            ...a,
            cadastros: { ...a.cadastros, professores: a.cadastros.professores.map((p) => (p.id === id ? { ...p, ...campos } : p)) },
        }));
    const adicionar = () =>
        mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, professores: [...a.cadastros.professores, novoProfessor(a.cadastros.professores)] } }));

    return (
        <div>
            <Cabecalho
                titulo="Professores"
                acoes={
                    <Button onClick={adicionar}>
                        <Plus /> Professor
                    </Button>
                }
                ajuda="O cadastro vale para todos os projetos. A disponibilidade de cada professor é definida dentro do projeto, em Docentes, porque muda a cada período letivo. A sigla é o que aparece no horário quando o espaço é pequeno."
            />

            {professores.length === 0 ? (
                <Vazio>Nenhum professor cadastrado. Você também pode criar professores direto na tela de aulas.</Vazio>
            ) : (
                <div className="rounded-2xl border border-border">
                    <div className={COLUNAS + " hidden rounded-t-2xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground md:grid"}>
                        <span>Cor</span>
                        <span>Nome</span>
                        <span>Sigla</span>
                        <span>Aulas por semana</span>
                        <span />
                    </div>
                    {professores.map((p) => {
                        const cargas = area.projetos.map((proj) => ({ nome: proj.nome, aulas: aulasDoProfessor(proj, p.id) })).filter((c) => c.aulas > 0);
                        return (
                            <div key={p.id} className={COLUNAS + " grid border-t border-border py-1.5 first:border-t-0 md:first:border-t"}>
                                <input
                                    type="color"
                                    aria-label="Cor no horário"
                                    title="Cor no horário"
                                    className="size-8 cursor-pointer rounded-md border border-border bg-transparent"
                                    value={p.cor}
                                    onChange={(e) => mudar(p.id, { cor: e.target.value })}
                                />
                                <Input aria-label="Nome" className="col-span-4 h-8 md:col-span-1" placeholder="Nome do professor" value={p.nome} onChange={(e) => mudar(p.id, { nome: e.target.value })} />
                                <div className="text-right md:order-last">
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        title="Remover professor"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => {
                                            if (cargas.length === 0 || confirm(`Remover “${p.nome}”? Ele sai das aulas em que está, em todos os projetos.`)) {
                                                mudarArea((a) => removerProfessor(a, p.id));
                                            }
                                        }}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                                <Input aria-label="Sigla" className="col-span-2 h-8 md:col-span-1" placeholder="sigla" value={p.sigla} onChange={(e) => mudar(p.id, { sigla: e.target.value })} />
                                <span className="col-span-4 text-xs text-muted-foreground md:col-span-1">
                                    {cargas.length === 0 ? "sem aulas" : cargas.map((c) => `${c.aulas} em ${c.nome}`).join(" · ")}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
