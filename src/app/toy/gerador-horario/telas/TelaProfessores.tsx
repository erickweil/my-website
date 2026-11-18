import { Input } from "@/components/ui/input";
import type { Professor } from "../modelo/modelo";
import { aulasDoProfessor, novoProfessor, removerProfessor } from "../modelo/operacoes";
import { Cabecalho } from "../componentes/comuns";
import { BotaoAdicionar } from "../componentes/lista";
import { BotaoRemover, LinhaEditavel, TabelaEditavel } from "../componentes/tabela";
import type { Contexto } from "../useAreaDeTrabalho";

const COLUNAS = "grid-cols-[2.5rem_1fr_2rem] items-center gap-x-2 px-3";

export function TelaProfessores({ area, mudarArea }: Contexto) {
    const { professores } = area.cadastros;
    const mudar = (id: string, campos: Partial<Professor>) =>
        mudarArea((a) => ({
            ...a,
            cadastros: { ...a.cadastros, professores: a.cadastros.professores.map((p) => (p.id === id ? { ...p, ...campos } : p)) },
        }));

    return (
        <div>
            <Cabecalho titulo="Professores" ajuda="Vale para todos os projetos. A disponibilidade fica em Docentes, dentro de cada projeto." />
            <TabelaEditavel
                colunas={COLUNAS}
                cabecalho={<><span>Cor</span><span>Nome</span><span /></>}
                vazio={professores.length === 0 && "Nenhum professor cadastrado. Também dá para criar professores direto nas aulas da turma."}
            >
                {professores.map((p) => (
                    <LinhaEditavel key={p.id} colunas={COLUNAS}>
                        <input
                            type="color"
                            aria-label="Cor no horário"
                            title="Cor no horário"
                            className="size-8 cursor-pointer rounded-md border border-border bg-transparent"
                            value={p.cor}
                            onChange={(e) => mudar(p.id, { cor: e.target.value })}
                        />
                        <Input aria-label="Nome" className="h-8" placeholder="Nome do professor" value={p.nome} onChange={(e) => mudar(p.id, { nome: e.target.value })} />
                        <BotaoRemover
                            titulo="Remover professor"
                            confirmar={area.projetos.some((proj) => aulasDoProfessor(proj, p.id) > 0) && `Remover “${p.nome}”? Ele sai das aulas em que está, em todos os projetos.`}
                            onRemover={() => mudarArea((a) => removerProfessor(a, p.id))}
                        />
                    </LinhaEditavel>
                ))}
            </TabelaEditavel>
            <BotaoAdicionar
                className="mt-2 md:w-auto"
                onClick={() => mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, professores: [...a.cadastros.professores, novoProfessor(a.cadastros.professores)] } }))}
            >
                Professor
            </BotaoAdicionar>
        </div>
    );
}
