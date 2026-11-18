import { useState } from "react";
import { Eye, History, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Id, VersaoDoHorario } from "../../modelo/modelo";
import { plural } from "../../componentes/comuns";

const dataEHora = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Situação do horário de uma versão, numa palavra. */
function situacao(v: VersaoDoHorario): { texto: string; ruim: boolean } {
    const h = v.projeto.horario;
    if (!h) return { texto: "sem horário", ruim: true };
    if (!h.completo) return { texto: "com problemas", ruim: true };
    return { texto: h.qualidade.length ? plural(h.qualidade.length, "observação", "observações") : "sem observações", ruim: false };
}

/** O histórico de horários do projeto: salvar o atual e abrir, restaurar ou excluir os anteriores. */
export function Versoes({ versoes, vendo, podeSalvar, onSalvar, onVer, onRestaurar, onExcluir }: {
    versoes: VersaoDoHorario[];
    /** A versão aberta na tela, se alguma. */
    vendo: Id | null;
    podeSalvar: boolean;
    onSalvar: (nome: string) => void;
    onVer: (id: Id) => void;
    onRestaurar: (id: Id) => void;
    onExcluir: (id: Id) => void;
}) {
    const [aberto, setAberto] = useState(false);
    const [nome, setNome] = useState("");
    const sugestao = `Versão ${versoes.length + 1}`;
    const fechando = (f: () => void) => () => {
        f();
        setAberto(false);
    };

    return (
        <Popover open={aberto} onOpenChange={setAberto}>
            <PopoverTrigger render={<Button size="sm" variant="outline" title="Salvar o horário atual ou voltar a um anterior" />}>
                <History /> Versões{versoes.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{versoes.length}</span>}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-3 p-3">
                <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSalvar(nome.trim() || sugestao);
                        setNome("");
                    }}
                >
                    <Input className="h-8" placeholder={sugestao} value={nome} disabled={!podeSalvar} onChange={(e) => setNome(e.target.value)} />
                    <Button type="submit" size="sm" disabled={!podeSalvar} title={podeSalvar ? "Guarda o horário como está agora" : "Gere um horário antes"}>
                        <Save /> Salvar
                    </Button>
                </form>

                {versoes.length === 0 ? (
                    <p className="py-2 text-center text-xs text-muted-foreground">Nenhuma versão salva. Salve o horário quando ele estiver bom, para poder voltar a ele.</p>
                ) : (
                    <ul className="-mx-1 max-h-80 space-y-0.5 overflow-y-auto">
                        {[...versoes].reverse().map((v) => {
                            const s = situacao(v);
                            return (
                                <li key={v.id} className={cn("flex items-center gap-2 rounded-xl px-2 py-1.5", v.id === vendo ? "bg-primary/10" : "hover:bg-muted")}>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{v.nome}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {dataEHora(v.criadaEm)} · <span className={s.ruim ? "text-destructive" : undefined}>{s.texto}</span>
                                        </p>
                                    </div>
                                    <Button size="icon-sm" variant="ghost" title="Ver esta versão" aria-label="Ver" onClick={fechando(() => onVer(v.id))}>
                                        <Eye />
                                    </Button>
                                    <Button size="icon-sm" variant="ghost" title="Voltar o projeto a esta versão" aria-label="Restaurar" onClick={fechando(() => onRestaurar(v.id))}>
                                        <RotateCcw />
                                    </Button>
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        title="Excluir esta versão"
                                        aria-label="Excluir"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => confirm(`Excluir a versão “${v.nome}”?`) && onExcluir(v.id)}
                                    >
                                        <Trash2 />
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </PopoverContent>
        </Popover>
    );
}
