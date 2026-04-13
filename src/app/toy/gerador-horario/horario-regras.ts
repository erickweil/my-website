import { PencilmarkSolver, Possib } from "@/lib/pencilmark";
import { WorkerResponseMsg } from "@/lib/workerRace";
import { HorarioSolverPencilmark } from "./horario-pencilmark";
import { GeneticAlgorithm } from "@/lib/genetic/ga";
import { HorarioGAProblem } from "./horario-genetic";

export const TODOS_OS_DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
export const QUANTOS_DIAS = TODOS_OS_DIAS.length;
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

export interface TurmaHorarioResult {
    turma: string;
    horario: Array<{
        dia: HorarioDia;
        tempos: (string | null)[];
    }>;
}

export class Horario {
    static diaSemanaMap: Record<HorarioDia, number> = {
        dom: 0,
        seg: 1,
        ter: 2,
        qua: 3,
        qui: 4,
        sex: 5,
        sab: 6,
    };

    dias: number[][];

    constructor(tempos: HorariosPorDia, nTempos: number) {
        this.dias = TODOS_OS_DIAS.map((dia) => {
            // Inicia com array de 0 (indisponível)
            const diaTempos = new Array(nTempos).fill(0); 
            if(tempos[dia]) for (const tempo of tempos[dia]!) {
                if (tempo >= 1 && tempo <= nTempos) {
                    // marca como disponível (1)
                    diaTempos[tempo - 1] = 1;
                }
            }
            return diaTempos;
        });
    }

    possui(dia: number, tempo: number): boolean {
        return this.dias[dia][tempo] !== 0;
    }

    getHorarioDia(dia: number): number[] {
        return this.dias[dia];
    }

    copiar(outro: Horario) {
        for (let dia = 0; dia < this.dias.length; dia++) {
            for (let tempo = 0; tempo < this.dias[dia].length; tempo++) {
                this.dias[dia][tempo] = outro.dias[dia][tempo];
            }
        }
    }

    // Obtém o tempo com o valor mais alto
    static getMaxTempo(tempos: HorariosPorDia): number {
        let maxTempo = 0;
        for (const dia in tempos) {
            const temposDia = tempos[dia as HorarioDia];
            if (!temposDia) continue;
            
            const maxTempoDia = Math.max(...temposDia);
            if (maxTempoDia > maxTempo) {
                maxTempo = maxTempoDia;
            }
        }
        return maxTempo;
    }
}

export class Turma {
    id: number;
    nome: string;
    horarios: Horario;

    constructor(dados: {
        nome: string;
        horarios: HorariosPorDia;
    }, id: number, nTempos: number) {
        this.id = id;
        this.nome = dados.nome;
        this.horarios = new Horario(dados.horarios, nTempos);
    }
}

export class Professor {
    id: number;
    nome: string;
    // 1 = disponível, 0 = ocupado
    horarios: Horario;

    //  -1 = não dá aula
    //   0 = não está definido
    // > 0 = Índice da disciplina
    matriz: Horario;

    constructor(dados: {
        nome: string;
        disciplinas: string[];
        horarios: HorariosPorDia;
    }, id: number, nTempos: number) {
        this.id = id;
        this.nome = dados.nome;
        this.horarios = new Horario(dados.horarios, nTempos);
        this.matriz = new Horario(dados.horarios, nTempos);
    }
}

export class Disciplina {
    id: number;
    
    aulas: number;
    agrupar: number;
    dividir: boolean;
    nome: string;

    turma: Turma;
    disciplinasUnidas: Disciplina[];
    professores: Professor[];

    // contador de aulas alocadas, para controle durante a geração do quadro
    contAulas: number;

    constructor(dados: {
        nome: string;
        turma: string;
        aulas: number;
        agrupar: number;
        dividir: boolean;
    }, id: number) {
        this.id = id;
        this.turma = {} as unknown as Turma;
        this.disciplinasUnidas = [];
        this.professores = [];
        this.aulas = dados.aulas;
        this.agrupar = dados.agrupar;
        this.dividir = dados.dividir;
        this.nome = dados.nome;

        this.contAulas = 0;
    }

    possuiProfessor(prof: Professor): boolean {
        return this.professores.includes(prof);
    }
}

export abstract class RegrasHorario {
    turmas: Turma[];
    disciplinas: Disciplina[];
    professores: Professor[];
    nTempos: number;

    constructor(formData: FormularioHorario) {        
        // Determina o número de tempos a partir dos dados das turmas e professores
        this.nTempos = 0;
        for (const turma of formData.turmas) {
            const turmaMax = Horario.getMaxTempo(turma.horarios);
            if (turmaMax > this.nTempos) {
                this.nTempos = turmaMax;
            }
        }

        // 1. Inicializar entidades (na ordem das dependências)
        this.turmas = [];
        this.disciplinas = [];
        this.professores = [];
        for(const turma of formData.turmas) {
            const turmaObj = new Turma(turma, this.turmas.length, this.nTempos);
            this.turmas.push(turmaObj);
        }

        for(const professor of formData.professores) {
            const profObj = new Professor(professor, this.professores.length, this.nTempos);
            this.professores.push(profObj);
        }

        for(const disciplina of formData.disciplinas) {
            const discObj = new Disciplina(disciplina, this.disciplinas.length);
            this.disciplinas.push(discObj);

            const turma = this.turmas.find((t) => t.nome === disciplina.turma);
            if (!turma) {
                throw new Error(`Turma "${disciplina.turma}" não encontrada para disciplina "${disciplina.nome}"`);
            }
            discObj.turma = turma;
        }

        for(const professor of formData.professores) {
            const profObj = this.professores.find((p) => p.nome === professor.nome)!;
            
            for(const nomeDisc of professor.disciplinas) {
                const discObj = this.disciplinas.find((d) => d.nome === nomeDisc);
                if (!discObj) {
                    throw new Error(`Disciplina "${nomeDisc}" não encontrada para professor "${professor.nome}"`);
                }

                discObj.professores.push(profObj);
            }
        }

        for(const formDu of formData.disciplinas_unidas) {
            for(const nomeDisc of formDu.disciplinas) {
                const discObj = this.disciplinas.find((d) => d.nome === nomeDisc);
                if (!discObj) {
                    throw new Error(`Disciplina "${nomeDisc}" não encontrada para disciplina unida "${formDu.grupo}"`);
                }

                for(const nomeDiscUnida of formDu.disciplinas) {
                    if (nomeDiscUnida === nomeDisc) continue;

                    const discUnida = this.disciplinas.find((d) => d.nome === nomeDiscUnida);
                    if (!discUnida) {
                        throw new Error(`Disciplina "${nomeDiscUnida}" não encontrada para disciplina unida "${formDu.grupo}"`);
                    }

                    discObj.disciplinasUnidas.push(discUnida);
                }
            }
        }
    }

    toQuadroIndex(idTurma: number, dia: number, tempo: number): number {
        return (idTurma * QUANTOS_DIAS * this.nTempos) + (dia * this.nTempos) + tempo;
    }

    fromQuadroIndex(index: number): { idTurma: number; dia: number; tempo: number } {
        const idTurma = Math.floor(Math.floor(index / this.nTempos) / QUANTOS_DIAS);
        const dia = Math.floor(index / this.nTempos) % QUANTOS_DIAS;
        const tempo = index % this.nTempos;

        return { idTurma: idTurma, dia, tempo };
    }

    getQuadroValor(quadro: number[], idTurma: number, dia: number, tempo: number): number {
        if (idTurma < 0 || idTurma >= this.turmas.length) {
            return -1;
        }
        if (dia < 0 || dia >= QUANTOS_DIAS) {
            return -1;
        }
        if (tempo < 0 || tempo >= this.nTempos) {
            return -1;
        }

        return quadro[this.toQuadroIndex(idTurma, dia, tempo)];
    }

    getQuadroVazio(): number[] {
        // Preencher quadro com 0 onde pode ter aulas e -1 onde não haverá aulas
        const quadro = Array.from(
            { length: this.turmas.length * QUANTOS_DIAS * this.nTempos }, 
            () => -1
        );
        for (const turma of this.turmas) {
            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for (let tempo = 0; tempo < this.nTempos; tempo++) {
                    if (turma.horarios.possui(dia, tempo)) {
                        quadro[this.toQuadroIndex(turma.id, dia, tempo)] = 0; // marca como possível
                    }
                }
            }
        }

        return quadro;
    }

    toStatusString(quadro: number[], maxLength: number = 64): string {
        let retStr = "";
        for(let turma = 0; turma < this.turmas.length; turma++) {
            retStr += `Turma ${this.turmas[turma].nome}:\n`;
            for(let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for(let tempo = 0; tempo < this.nTempos; tempo++) {
                    const val = quadro[this.toQuadroIndex(turma, dia, tempo)];
                    const disciplina = val > 0 ? this.disciplinas[val - 1].nome : (val === 0 ? "???" : "---");
                    retStr += `${disciplina}\t`;
                }
                retStr += "\n";
            }
            retStr += "\n";
        }
        return retStr;
    }
}