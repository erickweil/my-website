/**
 * Tipos e constantes da página do gerador de horários.
 *
 * As regras, a leitura do formulário, a validação e os solvers ficam em Rust
 * (rust-wasm/src/horario/). Aqui só ficam o formato do formulário que a página edita e o formato
 * do resultado que ela renderiza, que é o que o Rust devolve.
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
export type HorariosPorDia = Partial<Record<HorarioDia, number[]>>;

/** Formulário editado na página e enviado como está para o Rust (`FomularioHorario`). */
export interface FormularioHorario {
    turmas: {
        nome: string;
        horarios: HorariosPorDia;
    }[];
    disciplinas: {
        nome: string;
        turma: string;
        aulas: number;
        agrupar: number;
        dividir: boolean;
    }[];
    disciplinas_unidas: {
        grupo: string;
        disciplinas: string[];
    }[];
    professores: {
        nome: string;
        disciplinas: string[];
        horarios: HorariosPorDia;
    }[];
}

/** Quadro de uma turma (`TurmaResultado` em horario_resultado.rs). */
export interface TurmaHorarioResult {
    turma: string;
    horario: Array<{
        dia: HorarioDia;
        tempos: Array<{
            descricao: string | null; // nome da disciplina, "???" para não resolvido, null para sem aula
            violacao: string | null; // descrição da violação, se houver
        }>;
    }>;
}

export type SolverHorario = "pencilmark" | "genetic";

/** Resultado de um solver (`ResultadoHorario` em horario_resultado.rs). */
export interface ResultadoHorario {
    /** Quadro para mostrar; null quando o solver não chegou a nenhum quadro. */
    solucao: TurmaHorarioResult[] | null;
    /** true se o quadro tem alguma violação ou célula não resolvida. */
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
export type HorarioWorkerTaskValue = ResultadoHorario & {
    /** Só no GA: tempo médio por geração no último bloco. */
    msPorGeracao?: number;
    /** Só no GA: número de ilhas em uso (0 = uma população só). */
    ilhas?: number;
    /** Só no Pencilmark: threads dividindo a busca (ausente enquanto roda em uma só). */
    threads?: number;
};
