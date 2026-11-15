/**
 * O que a página troca com o solver em Rust/WASM (rust-wasm/src/horario/): a entrada
 * (`EntradaHorario` em horario_regras.rs) e o resultado (`ResultadoHorario` em
 * horario_resultado.rs). As regras, a validação e os solvers ficam todos em Rust; a página monta a
 * entrada a partir do projeto (modelo/para-solver.ts).
 */

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
        /** Aulas seguidas por bloco; 0 = sem agrupamento. */
        bloco: number;
        /** Com `bloco`: dois blocos podem ficar encostados no mesmo dia. */
        emendar: boolean;
    }[];
    /** Professores e ambientes. */
    recursos: {
        id: string;
        /** Regra obrigatória: nunca tem aula fora destes tempos. */
        disponibilidade: HorariosPorDia;
        /** Regra de qualidade (só o algoritmo genético considera): tempos em que é melhor não ter aula. */
        evitar: HorariosPorDia;
    }[];
}

export type SolverHorario = "pencilmark" | "genetic";

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
    /** Pencilmark: nós visitados. GA: geração. */
    iter: number;
    /** Pencilmark: ramos da busca ainda em aberto. GA: gerações sem melhora. */
    depth: number;
    terminou: boolean;
}

/** O que o worker manda para a página, no progresso e no fim. */
export type HorarioWorkerTaskValue = ResultadoDoSolver & {
    /** Só no GA: tempo médio por geração no último bloco. */
    msPorGeracao?: number;
    /** Só no GA: número de ilhas em uso (0 = uma população só). */
    ilhas?: number;
    /** Só no Pencilmark: threads dividindo a busca (ausente enquanto roda em uma só). */
    threads?: number;
};
