import { Input } from "@/components/ui/input";
import type { Ambiente } from "../modelo/modelo";
import { ambienteDaOferta, novoId, removerAmbiente } from "../modelo/operacoes";
import { Cabecalho } from "../componentes/comuns";
import { CampoNumero } from "../componentes/campos";
import { BotaoAdicionar } from "../componentes/lista";
import { BotaoRemover, LinhaEditavel, TabelaEditavel } from "../componentes/tabela";
import type { Contexto } from "../useAreaDeTrabalho";

const COLUNAS = "grid-cols-[1fr_6rem_2rem] items-center gap-x-2 px-3";

export function TelaAmbientes({ area, mudarArea }: Contexto) {
    const { ambientes } = area.cadastros;
    const mudar = (id: string, campos: Partial<Ambiente>) =>
        mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, ambientes: a.cadastros.ambientes.map((x) => (x.id === id ? { ...x, ...campos } : x)) } }));
    const emUso = (id: string) => area.projetos.some((p) => p.turmas.some((t) => t.ambienteId === id) || p.ofertas.some((o) => ambienteDaOferta(p, o) === id));

    return (
        <div>
            <Cabecalho titulo="Ambientes" ajuda="Salas, laboratórios, quadra. Duas aulas nunca ficam no mesmo ambiente ao mesmo tempo." />
            <TabelaEditavel
                colunas={COLUNAS}
                cabecalho={<><span>Nome</span><span className="text-center">Lugares</span><span /></>}
                vazio={ambientes.length === 0 && "Nenhum ambiente cadastrado. É opcional: sem ambientes, o horário considera só turmas e professores."}
            >
                {ambientes.map((amb) => (
                    <LinhaEditavel key={amb.id} colunas={COLUNAS}>
                        <Input aria-label="Nome" className="h-8" placeholder="Ex.: Sala 12, Lab. Informática 1" value={amb.nome} onChange={(e) => mudar(amb.id, { nome: e.target.value })} />
                        <CampoNumero aria-label="Lugares" title="Quantos alunos comporta" className="h-8" max={9999} valor={amb.capacidade} onChange={(n) => mudar(amb.id, { capacidade: n })} />
                        <BotaoRemover
                            titulo="Remover ambiente"
                            confirmar={emUso(amb.id) && `Remover “${amb.nome}”? As turmas e aulas que o usam ficam sem ambiente.`}
                            onRemover={() => mudarArea((a) => removerAmbiente(a, amb.id))}
                        />
                    </LinhaEditavel>
                ))}
            </TabelaEditavel>
            <BotaoAdicionar
                className="mt-2 md:w-auto"
                onClick={() => mudarArea((a) => ({ ...a, cadastros: { ...a.cadastros, ambientes: [...a.cadastros.ambientes, { id: novoId(), nome: "", capacidade: 40 }] } }))}
            >
                Ambiente
            </BotaoAdicionar>
        </div>
    );
}
