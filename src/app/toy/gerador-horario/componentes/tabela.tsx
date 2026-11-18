/**
 * Tabela de linhas editáveis (faixas do quadro, aulas da turma, cadastros), feita com grid.
 *
 * As que têm muitas colunas (`empilha`) mudam de layout pela largura da própria tabela, não da
 * tela: largas, uma linha por item com cabeçalho; estreitas, os campos de cada item se empilham
 * com um rótulo pequeno em cima (`RotuloEmpilhado`). Assim a tabela não estoura quando o menu
 * lateral está aberto num computador.
 *
 * `colunas` são as classes de grid das linhas e do cabeçalho; nas que empilham, as colunas largas
 * vão com o prefixo `@3xl:`.
 */

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TabelaEditavel({ colunas, cabecalho, empilha = false, vazio, children }: {
    colunas: string;
    cabecalho: React.ReactNode;
    empilha?: boolean;
    /** Mostrado no lugar das linhas quando não há nenhuma. */
    vazio?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="@container">
            {/* Empilhada, a tabela fica sem cabeçalho: a primeira linha não precisa da borda de cima */}
            <div className={cn("rounded-2xl border border-border", empilha && "[&>:nth-child(2)]:border-t-0 @3xl:[&>:nth-child(2)]:border-t")}>
                <div className={cn(colunas, "rounded-t-2xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground", empilha ? "hidden @3xl:grid" : "grid")}>{cabecalho}</div>
                {vazio && <p className="border-t border-border px-3 py-6 text-center text-sm text-muted-foreground">{vazio}</p>}
                {children}
            </div>
        </div>
    );
}

export function LinhaEditavel({ colunas, className, children }: { colunas: string; className?: string; children: React.ReactNode }) {
    return <div className={cn(colunas, "grid border-t border-border py-1.5", className)}>{children}</div>;
}

/** Rótulo em cima de um campo, só quando a tabela está empilhada (sem cabeçalho). */
export function RotuloEmpilhado({ children }: { children: React.ReactNode }) {
    return <span className="mb-0.5 block text-xs text-muted-foreground @3xl:hidden">{children}</span>;
}

/** Lixeira de uma linha. Com `confirmar`, pergunta antes (a frase da pergunta). */
export function BotaoRemover({ titulo, confirmar, onRemover }: { titulo: string; confirmar?: string | false; onRemover: () => void }) {
    return (
        <Button
            size="icon-sm"
            variant="ghost"
            title={titulo}
            aria-label={titulo}
            className="justify-self-end text-destructive hover:text-destructive"
            onClick={() => {
                if (!confirmar || confirm(confirmar)) onRemover();
            }}
        >
            <Trash2 />
        </Button>
    );
}
