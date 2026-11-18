/**
 * Estado da página: a área de trabalho (cadastros e projetos), salva no localStorage a cada
 * alteração, e qual projeto está aberto. Só roda no navegador (a página é carregada sem SSR).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { carregar, salvar } from "./modelo/armazenamento";
import { areaDeTrabalhoVazia, type AreaDeTrabalho, type HorarioGerado, type Id, type ProjetoHorario } from "./modelo/modelo";

const CHAVE_PROJETO_ABERTO = "geradorHorario:projetoAberto";

export interface Contexto {
    area: AreaDeTrabalho;
    mudarArea: (fn: (area: AreaDeTrabalho) => AreaDeTrabalho) => void;
}

export interface ContextoDoProjeto extends Contexto {
    projeto: ProjetoHorario;
    /**
     * Altera o projeto aberto. Por padrão a alteração deixa o horário gerado desatualizado;
     * `cosmetica` é para o que não muda o horário (nomes, cores).
     */
    mudarProjeto: (fn: (projeto: ProjetoHorario) => ProjetoHorario, cosmetica?: boolean) => void;
    salvarHorario: (horario: HorarioGerado | null) => void;
}

export function useAreaDeTrabalho() {
    const [estado, setEstado] = useState<{ area: AreaDeTrabalho; erroDeLeitura: string | null }>(() => {
        const leitura = carregar(localStorage);
        return leitura.ok
            ? { area: leitura.area, erroDeLeitura: null }
            : { area: areaDeTrabalhoVazia(), erroDeLeitura: leitura.erro };
    });
    const [projetoId, setProjetoId] = useState<Id | null>(() => localStorage.getItem(CHAVE_PROJETO_ABERTO));

    /** O navegador recusou gravar (normalmente, espaço cheio: as versões salvas ocupam bastante). */
    const [erroAoSalvar, setErroAoSalvar] = useState(false);
    /** A área ainda não gravada. */
    const pendente = useRef<AreaDeTrabalho | null>(null);
    const gravarPendente = useCallback(() => {
        if (!pendente.current) return;
        let falhou = false;
        try {
            salvar(localStorage, pendente.current);
        } catch {
            falhou = true;
        }
        pendente.current = null;
        setErroAoSalvar(falhou);
    }, []);
    // Grava 300 ms depois da última alteração (a área com as versões salvas pode ter alguns MB, e
    // fixar aulas uma a uma não deve gravar tudo a cada clique). Com erro de leitura nada é gravado,
    // para não apagar o que está salvo.
    useEffect(() => {
        if (estado.erroDeLeitura) return;
        pendente.current = estado.area;
        const t = setTimeout(gravarPendente, 300);
        return () => clearTimeout(t);
    }, [estado, gravarPendente]);
    // Ao esconder ou fechar a página, e ao sair da tela, grava o que estiver pendente
    useEffect(() => {
        const aoEsconder = () => document.visibilityState === "hidden" && gravarPendente();
        window.addEventListener("pagehide", gravarPendente);
        document.addEventListener("visibilitychange", aoEsconder);
        return () => {
            window.removeEventListener("pagehide", gravarPendente);
            document.removeEventListener("visibilitychange", aoEsconder);
            gravarPendente();
        };
    }, [gravarPendente]);
    useEffect(() => {
        if (projetoId) localStorage.setItem(CHAVE_PROJETO_ABERTO, projetoId);
    }, [projetoId]);

    const { area, erroDeLeitura } = estado;
    const projeto = area.projetos.find((p) => p.id === projetoId) ?? area.projetos[0] ?? null;

    const mudarArea: Contexto["mudarArea"] = (fn) => setEstado((e) => ({ ...e, area: fn(e.area) }));
    const noProjeto = (id: Id, fn: (p: ProjetoHorario) => ProjetoHorario) =>
        mudarArea((a) => ({ ...a, projetos: a.projetos.map((p) => (p.id === id ? fn(p) : p)) }));

    return {
        area,
        erroDeLeitura,
        erroAoSalvar,
        /** Começa do zero, descartando o conteúdo salvo que não pôde ser lido. */
        descartarSalvo: () => setEstado({ area: areaDeTrabalhoVazia(), erroDeLeitura: null }),
        projeto,
        abrirProjeto: setProjetoId,
        mudarArea,
        mudarProjeto: ((fn, cosmetica) => {
            if (projeto) noProjeto(projeto.id, (p) => ({ ...fn(p), revisao: p.revisao + (cosmetica ? 0 : 1) }));
        }) as ContextoDoProjeto["mudarProjeto"],
        salvarHorario: ((horario) => {
            if (projeto) noProjeto(projeto.id, (p) => ({ ...p, horario }));
        }) as ContextoDoProjeto["salvarHorario"],
    };
}
