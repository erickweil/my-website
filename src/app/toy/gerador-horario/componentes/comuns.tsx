import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Ambiente, Professor } from "../modelo/modelo";

/** Ícone de ajuda: a explicação abre ao clicar. */
export function Ajuda({ children }: { children: React.ReactNode }) {
    return (
        <Popover>
            <PopoverTrigger type="button" aria-label="Ajuda" className="inline-flex align-middle text-muted-foreground hover:text-foreground">
                <CircleHelp className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 gap-2 text-sm font-normal">{children}</PopoverContent>
        </Popover>
    );
}

/** Cabeçalho de uma tela: título, ajuda opcional e ações à direita. */
export function Cabecalho({ titulo, ajuda, acoes }: { titulo: string; ajuda?: React.ReactNode; acoes?: React.ReactNode }) {
    return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
                {titulo}
                {ajuda && <Ajuda>{ajuda}</Ajuda>}
            </h2>
            {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
        </div>
    );
}

export function Vazio({ children }: { children: React.ReactNode }) {
    return <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

/**
 * Lista que mostra só os primeiros `limite` itens, com um botão para ver o resto: para avisos que
 * podem ser muitos e não devem empurrar o resto da tela para baixo.
 */
export function ListaComLimite<T>({ itens, limite = 5, className, children }: {
    itens: T[];
    limite?: number;
    className?: string;
    children: (item: T, i: number) => React.ReactNode;
}) {
    const [aberta, setAberta] = useState(false);
    // Esconder só um ou dois não vale o botão
    const cabe = itens.length <= limite + 2;
    const visiveis = aberta || cabe ? itens : itens.slice(0, limite);
    return (
        <>
            <ul className={className}>{visiveis.map(children)}</ul>
            {!cabe && (
                <button type="button" className="mt-1 text-xs font-medium underline" onClick={() => setAberta(!aberta)}>
                    {aberta ? "Ver menos" : `Ver mais ${itens.length - limite}`}
                </button>
            )}
        </>
    );
}

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export const rotuloDoProfessor = (p: Professor | undefined) => p?.nome || "(sem nome)";

/** "Lab. 2 · 30 lugares" (sem a capacidade quando ela não foi informada). */
export const rotuloDoAmbiente = (a: Ambiente) => `${a.nome || "(sem nome)"}${a.capacidade > 0 ? ` · ${a.capacidade} lugares` : ""}`;

/** Preto ou branco, o que tiver mais contraste com a cor (luminância relativa da WCAG). */
export const corDoTexto = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Contraste com o preto (l + 0,05) / 0,05 contra o branco 1,05 / (l + 0,05): empatam em l ≈ 0,179
    return l > 0.179 ? "#000" : "#fff";
};

/** "horario-2027-1": um nome de arquivo a partir de um texto qualquer. */
export const nomeDeArquivo = (prefixo: string, texto: string) =>
    `${prefixo}-${texto.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "projeto"}`;

/** Faz o navegador baixar um arquivo gerado na página. */
export function baixarArquivo(nome: string, conteudo: string, tipo: string) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
}
