import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ConfigDoProjeto, Regra, Solver } from "../modelo/modelo";
import { PESOS_PADRAO, REGRAS_DE_QUALIDADE, REGRAS_OBRIGATORIAS, pesoDaRegra } from "../modelo/modelo";
import { Cabecalho } from "../componentes/comuns";
import { CampoDecimal, Selecao } from "../componentes/campos";
import type { ContextoDoProjeto } from "../useAreaDeTrabalho";

export const NOME_DO_SOLVER: Record<Solver, string> = {
    local: "Busca local",
    pencilmark: "Busca exata",
    genetic: "Algoritmo genético",
};

const SOBRE_O_SOLVER: Record<Solver, string> = {
    local: "O padrão. Continua do horário atual e roda até atender a todas as regras ou até você parar.",
    pencilmark: "Acha um horário que cumpre as regras obrigatórias ou prova que não existe. Rápida em quadros pequenos; ignora as regras de qualidade, o horário atual e as aulas fixadas (uma fixada fora do lugar aparece como problema).",
    genetic: "Mais lento. Começa de variações do horário atual; útil para sair de um ponto em que a busca local empacou.",
};

const REGRAS: Record<Regra, { nome: string; descricao: string; unidade: string }> = {
    professor: { nome: "Professor indisponível", descricao: "Aula num horário em que o professor (ou o ambiente) não está disponível.", unidade: "por aula" },
    conflito: { nome: "Professor em duas aulas", descricao: "Cada turma a mais do mesmo professor ou ambiente no mesmo horário.", unidade: "por aula a mais" },
    unidas: { nome: "Aula em conjunto separada", descricao: "Aula em conjunto que não acontece ao mesmo tempo em todas as turmas dela.", unidade: "por aula" },
    agrupar: { nome: "Divisão em blocos", descricao: "Desvio da divisão da disciplina em blocos (tamanho e quantidade de pedaços).", unidade: "por unidade de desvio" },
    fixa: { nome: "Aula fixada fora do lugar", descricao: "Aula fixada no horário que o gerador tirou da célula em que ela foi fixada.", unidade: "por aula" },
    evitar: { nome: "Horários a evitar", descricao: "O professor recebe aula num horário que pediu para evitar.", unidade: "por aula" },
    jornada: { nome: "Jornada do professor", descricao: "Mais de 10 horas entre a primeira e a última aula do dia.", unidade: "por hora a mais" },
    descanso: { nome: "Descanso entre dias", descricao: "Menos de 11 horas entre a última aula de um dia e a primeira do seguinte.", unidade: "por hora a menos" },
    intervalo: { nome: "Aula sozinha no intervalo", descricao: "Um grupo de aulas da disciplina deixa uma aula sozinha de um lado do intervalo.", unidade: "por ocorrência" },
    turno: { nome: "Aula sozinha na troca de turno", descricao: "O mesmo, na passagem de um turno para outro.", unidade: "por ocorrência" },
    janela: { nome: "Horário vago entre aulas", descricao: "A turma fica com horário vago no meio do turno em vez de no começo ou no fim.", unidade: "por horário vago" },
    espalhar: { nome: "Disciplina espalhada na semana", descricao: "Mais de um trecho da disciplina no mesmo dia (para as que pedem espalhar).", unidade: "por trecho a mais" },
};

const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 10 });

export function TelaConfiguracao({ projeto, mudarProjeto }: ContextoDoProjeto) {
    const { config } = projeto;
    // Mudar o peso de uma regra muda o que o horário deve atender: o horário gerado fica desatualizado
    const mudar = (campos: Partial<ConfigDoProjeto>, mudaRegras = false) => mudarProjeto((p) => ({ ...p, config: { ...p.config, ...campos } }), !mudaRegras);

    return (
        <div className="max-w-3xl">
            <Cabecalho titulo="Configuração" ajuda="Como o horário deste projeto é gerado. Vale só para este projeto." />

            <section className="mb-8 space-y-3">
                <h3 className="font-medium">Método</h3>
                <div className="space-y-2">
                    {(Object.keys(NOME_DO_SOLVER) as Solver[]).map((s) => (
                        <label key={s} className="flex cursor-pointer gap-3 rounded-2xl border border-border p-3 has-checked:border-primary has-checked:bg-primary/5">
                            <input type="radio" name="solver" className="mt-1 accent-primary" checked={config.solver === s} onChange={() => mudar({ solver: s })} />
                            <span>
                                <span className="block font-medium">{NOME_DO_SOLVER[s]}</span>
                                <span className="block text-sm text-muted-foreground">{SOBRE_O_SOLVER[s]}</span>
                            </span>
                        </label>
                    ))}
                </div>
                <div className="flex flex-wrap gap-x-8 gap-y-3 pt-1 text-sm">
                    <div className="space-y-1">
                        <Label htmlFor="config-cadeias">Busca local: buscas em paralelo</Label>
                        <Selecao id="config-cadeias" value={config.cadeias} onChange={(e) => mudar({ cadeias: Number(e.target.value) })}>
                            <option value={0}>Automático</option>
                            {[1, 2, 4, 8].map((n) => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </Selecao>
                    </div>
                    <label className="flex items-center gap-2 self-end pb-2" title="Várias populações evoluem em paralelo e trocam indivíduos entre si">
                        <Checkbox checked={config.ilhas} onCheckedChange={(v) => mudar({ ilhas: v === true })} />
                        Algoritmo genético: usar ilhas
                    </label>
                </div>
            </section>

            <section className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <h3 className="font-medium">Pesos das regras</h3>
                        <p className="text-sm text-muted-foreground">
                            A busca local e o genético procuram o horário de menor custo: a soma, em todas as regras, do peso vezes o que a
                            regra deixou de atender. Um horário só é válido sem nenhuma violação obrigatória, qualquer que seja o peso. Por
                            padrão a qualidade pesa muito menos que as obrigatórias; um peso de qualidade maior que um obrigatório faz o
                            gerador aceitar violar a obrigatória para atender à de qualidade. 0 desliga a regra (uma de qualidade desligada
                            também não aparece nas observações).
                        </p>
                    </div>
                    <Button variant="outline" size="sm" disabled={Object.keys(config.pesos).length === 0} onClick={() => mudar({ pesos: {} }, true)}>
                        <RotateCcw /> Restaurar padrões
                    </Button>
                </div>
                <TabelaDePesos titulo="Regras obrigatórias" regras={REGRAS_OBRIGATORIAS} config={config} mudar={mudar} />
                <TabelaDePesos titulo="Regras de qualidade" regras={REGRAS_DE_QUALIDADE} config={config} mudar={mudar} />
            </section>
        </div>
    );
}

function TabelaDePesos({ titulo, regras, config, mudar }: {
    titulo: string;
    regras: readonly Regra[];
    config: ConfigDoProjeto;
    mudar: (campos: Partial<ConfigDoProjeto>, mudaRegras: boolean) => void;
}) {
    return (
        <div className="space-y-2">
            <h4 className="text-sm font-medium">{titulo}</h4>
            <div className="divide-y divide-border rounded-2xl border border-border">
                {regras.map((regra) => {
                    const peso = pesoDaRegra(config, regra);
                    const padrao = PESOS_PADRAO[regra];
                    return (
                        <div key={regra} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{REGRAS[regra].nome}</p>
                                <p className="text-xs text-muted-foreground">{REGRAS[regra].descricao}</p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="text-right">
                                    {REGRAS[regra].unidade}
                                    {peso !== padrao && <span className="block">padrão {numero(padrao)}</span>}
                                </span>
                                <CampoDecimal
                                    aria-label={`Peso: ${REGRAS[regra].nome}`}
                                    className="h-8 w-24"
                                    valor={peso}
                                    onChange={(n) => {
                                        // Igual ao padrão: volta a acompanhar o padrão
                                        const pesos = { ...config.pesos, [regra]: n };
                                        if (n === padrao) delete pesos[regra];
                                        mudar({ pesos }, true);
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
