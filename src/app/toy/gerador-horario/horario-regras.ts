/**
 * O que a página troca com o solver em Rust/WASM (rust-wasm/src/horario/): a entrada
 * (`EntradaHorario` em horario_regras.rs) e o resultado (`ResultadoHorario` em
 * horario_resultado.rs). As regras, a validação e os solvers ficam todos em Rust; a página monta a
 * entrada a partir do projeto (modelo/para-solver.ts).
 */

import type { Regra } from "./modelo/modelo.ts";

export const TODOS_OS_DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
export type HorarioDia = typeof TODOS_OS_DIAS[number];

export const DIAS_SEMANA_MAP: Record<HorarioDia, string> = {
  dom: "Domingo",
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
  sab: "Sábado",
};

/** Tempos marcados por dia; o tempo é o número da aula no dia, a partir de 1. */
export type HorariosPorDia = Partial<Record<HorarioDia, number[]>>;

/**
 * Regras de divisão das aulas de uma disciplina em pedaços (trechos de aulas seguidas num dia),
 * no estilo do XHSTT. Tudo opcional: sem nada, a divisão é livre.
 */
export interface EntradaDivisao {
    /** Menor e maior pedaço (padrão: 1 e todas as aulas). */
    tamanhoMin?: number;
    tamanhoMax?: number;
    /** Quantos pedaços na semana (padrão: de 1 a todas as aulas). */
    quantidadeMin?: number;
    quantidadeMax?: number;
    /** Quantos pedaços de um tamanho. */
    porTamanho?: { tamanho: number; min: number; max: number }[];
    /** Regra de qualidade: no máximo um pedaço por dia. */
    espalhar?: boolean;
}

/** O problema entregue ao solver. Tudo se referencia por id. */
export interface EntradaDoSolver {
    turmas: {
        id: string;
        /** Em quais tempos a turma tem aula. */
        horarios: HorariosPorDia;
    }[];
    /** Uma disciplina sendo dada: para quais turmas, usando quais recursos, quantas vezes por semana. */
    aulas: {
        id: string;
        /** Mais de uma = turmas juntas, sempre no mesmo horário. */
        turmas: string[];
        /** Professores e ambiente: cada um só pode estar numa aula por horário. */
        recursos: string[];
        aulasSemana: number;
        /** Como as aulas se dividem em pedaços de aulas seguidas (ver modelo/divisao.ts). */
        divisao: EntradaDivisao;
    }[];
    /** Professores e ambientes. */
    recursos: {
        id: string;
        /** true = ambiente: só não pode ter duas aulas ao mesmo tempo, sem regras de qualidade. */
        ambiente: boolean;
        /** Regra obrigatória: nunca tem aula fora destes tempos. */
        disponibilidade: HorariosPorDia;
        /**
         * Tempos em que é melhor não ter aula: regra de qualidade na busca local e no algoritmo
         * genético; na busca exata, o professor fica indisponível neles.
         */
        evitar: HorariosPorDia;
    }[];
    /**
     * As aulas do dia, na ordem (a 1ª é o tempo 1), em minutos desde a meia-noite. As regras de
     * qualidade de jornada, descanso e intervalo saem daqui.
     */
    tempos: { inicio: number; fim: number; turno: string }[];
    /**
     * O horário de onde a busca parte (busca local e genético), com as aulas fixadas (`fixa`: regra
     * obrigatória de ficar ali). Vazio = quadro sorteado. Ver rust-wasm/src/horario/horario_inicial.rs.
     */
    inicial?: { aula: string; dia: HorarioDia; tempo: number; fixa: boolean }[];
    config?: {
        /** O peso de cada regra no custo (ver `PESOS_PADRAO` em modelo/modelo.ts). */
        pesos: Record<Regra, number>;
        /** Parâmetros opcionais do algoritmo genético (`EntradaConfigGA` em horario_regras.rs). */
        ga?: {
            populacao?: number;
            migracao?: number;
            epoca?: number;
            estagnacao?: number;
        };
    };
}

/** Uma ocorrência de regra de qualidade num horário (`Ocorrencia` em horario_qualidade.rs). */
export interface OcorrenciaDeQualidade {
    regra: "evitar" | "jornada" | "descanso" | "intervalo" | "turno" | "janela" | "espalhar";
    /** O professor (evitar, jornada, descanso). */
    recurso: string | null;
    /** A turma (evitar, intervalo, turno, janela, espalhar) e a aula (evitar, intervalo, turno, espalhar). */
    turma: string | null;
    aula: string | null;
    /** O dia; no descanso, o primeiro dos dois. */
    dia: HorarioDia;
    /** Jornada: minutos acima das 10 horas. Descanso: minutos que faltam para as 11 horas. */
    minutos: number;
}

/** Busca exata (Pencilmark), busca local ou algoritmo genético. */
export type SolverHorario = "pencilmark" | "local" | "genetic";

/** Resultado de um solver, no progresso e no fim. */
export interface ResultadoDoSolver {
    /** As aulas do quadro; null quando o solver não chegou a nenhum quadro. */
    alocacoes: { aula: string; dia: HorarioDia; tempo: number }[] | null;
    /** Células que quebram uma regra obrigatória, ou que ficaram vazias. */
    problemas: { turma: string; dia: HorarioDia; tempo: number; aula: string | null; mensagem: string }[];
    /** true se o quadro quebra alguma regra obrigatória ou tem célula não resolvida. */
    alguma_violacao: boolean;
    /** Mensagem para o usuário quando há violação ou não há solução. */
    mensagem: string | null;
    /** Onde o quadro deixa a desejar nas regras de qualidade (também quando há violação). */
    qualidade: OcorrenciaDeQualidade[];
    /** Pencilmark: nós visitados. GA: geração. Busca local: movimentos, somando as cadeias. */
    iter: number;
    /** Pencilmark: ramos da busca ainda em aberto. GA: gerações sem melhora. Busca local: movimentos sem melhora. */
    depth: number;
    terminou: boolean;
}

/** Como a busca está indo: o worker manda a cada bloco de trabalho (cerca de 250 ms). */
export interface ProgressoDoSolver {
    /** Tempo desde o início da busca. */
    ms: number;
    /** Pencilmark: nós visitados. GA: geração. Busca local: movimentos, somando as cadeias. */
    iter: number;
    /** Pencilmark: ramos da busca ainda em aberto. GA: gerações sem melhora. Busca local: movimentos sem melhora. */
    depth: number;
    /** Busca local e GA: custo do melhor quadro (0 = todas as regras atendidas). */
    custo?: number;
    /** Quantas vezes o melhor quadro mudou (mesmo com o mesmo custo). */
    versao: number;
    /** Só no GA: tempo médio por geração no último bloco. */
    msPorGeracao?: number;
    /** Só no GA: número de ilhas em uso (0 = uma população só). */
    ilhas?: number;
    /** Só no Pencilmark: threads dividindo a busca (ausente enquanto roda em uma só). */
    threads?: number;
    /** Só na busca local: buscas independentes em paralelo. */
    cadeias?: number;
}

/** O que o worker manda para a página, no progresso e no fim. */
export interface HorarioWorkerTaskValue {
    progresso: ProgressoDoSolver;
    /** O melhor quadro: só quando ele mudou desde a última mensagem, e sempre no fim. */
    resultado?: ResultadoDoSolver;
}
