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
    cor: PALETA_CORES[existentes.length % PALETA_CORES.length],
});

const COLUNAS = "grid-cols-[2.5rem_1fr_2rem] items-center gap-x-2 px-3";

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
                ajuda="Vale para todos os projetos. A disponibilidade fica em Docentes, dentro de cada projeto."
            />

            {professores.length === 0 ? (
                <Vazio>Nenhum professor cadastrado. Você também pode criar professores direto na tela de aulas.</Vazio>
            ) : (
                <div className="rounded-2xl border border-border">
                    <div className={COLUNAS + " grid rounded-t-2xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground"}>
                        <span>Cor</span>
                        <span>Nome</span>
                        <span />
                    </div>
                    {professores.map((p) => {
                        const temAulas = area.projetos.some((proj) => aulasDoProfessor(proj, p.id) > 0);
                        return (
                            <div key={p.id} className={COLUNAS + " grid border-t border-border py-1.5 "}>
                                <input
                                    type="color"
                                    aria-label="Cor no horário"
                                    title="Cor no horário"
                                    className="size-8 cursor-pointer rounded-md border border-border bg-transparent"
                                    value={p.cor}
                                    onChange={(e) => mudar(p.id, { cor: e.target.value })}
                                />
                                <Input aria-label="Nome" className="h-8" placeholder="Nome do professor" value={p.nome} onChange={(e) => mudar(p.id, { nome: e.target.value })} />
                                <div className="text-right">
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        title="Remover professor"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => {
                                            if (!temAulas || confirm(`Remover “${p.nome}”? Ele sai das aulas em que está, em todos os projetos.`)) {
                                                mudarArea((a) => removerProfessor(a, p.id));
                                            }
                                        }}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
