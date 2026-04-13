import { cloneArrayOperator, GAProblem } from "@/lib/genetic/problem";
import { Disciplina, FormularioHorario, Horario, Professor, QUANTOS_DIAS, RegrasHorario, Turma } from "./horario-regras";
import { calcMutationAmount } from "@/lib/genetic/mutationOperators";

export class HorarioGAProblem extends RegrasHorario implements GAProblem<number[]> {
    public readonly size: number;
    public readonly maxFitness?: number | undefined;

    constructor(formData: FormularioHorario) {
        super(formData);

        this.size = this.turmas.length * QUANTOS_DIAS * this.nTempos;
        this.maxFitness = undefined;
    }

    // Funções Solver Genético
    clone = cloneArrayOperator<number[]>();

    randomGenes(): number[] {
        // Gerar um quadro aleatório respeitando as restrições iniciais:
        // - Somente alocar disciplinas nos horários possíveis para a turma
        // - Somente alocar disciplinas na turma correta 
        // - Respeitar o número de aulas de cada disciplina (mas sem se preocupar com agrupamento, para não bloquear o solver)
        const genes = this.getQuadroVazio();

        for (const turma of this.turmas) {
            const disciplinasMap = this.disciplinas.filter(d => d.turma.id === turma.id).map(d => {
                return {
                    disciplina: d,
                    aulasRestantes: d.aulas
                };
            })
            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for (let tempo = 0; tempo < this.nTempos; tempo++) {
                    const index = this.toQuadroIndex(turma.id, dia, tempo);
                    if (genes[index] !== 0) continue; // só preenche os espaços do horário ativo

                    // Escolhe aleatoriamente uma disciplina que ainda tenha aulas restantes
                    const disponiveis = disciplinasMap.filter(d => d.aulasRestantes > 0);
                    if (disponiveis.length === 0) continue; // isso deveria ser um Erro?

                    const escolha = disponiveis[Math.floor(Math.random() * disponiveis.length)];
                    genes[index] = escolha.disciplina.id + 1;
                    escolha.aulasRestantes--;
                }
            }
        }

        return genes;
    }

    fitness(quadro: number[]): number {
        let fitness = 0;

        for (const prof of this.professores) {
            prof.matriz.copiar(prof.horarios);
        }

        for (const turma of this.turmas) {
            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for (let tempo = 0; tempo < this.nTempos; tempo++) {
                    const index = this.toQuadroIndex(turma.id, dia, tempo);
                    if (!turma.horarios.possui(dia, tempo)) {
                        if (quadro[index] === -1) {
                            fitness += 10; // recompensa por respeitar slot sem aula
                        }
                        continue;
                    }
                    const idDisciplina = quadro[index] - 1;
                    if (idDisciplina < 0) continue; // sem aula nesse espaço

                    // Recompensa por respeitar slot com aula
                    fitness += 10;

                    const disciplina = this.disciplinas[idDisciplina];

                    for (const prof of disciplina.professores) {
                        if(prof.horarios.possui(dia, tempo)) {
                            // recompensa por respeitar disponibilidade do professor
                            fitness += 5;
                        }
                        prof.matriz.dias[dia][tempo] = 0;
                    }

                    for(const unida of disciplina.disciplinasUnidas) {
                        const valor = this.getQuadroValor(quadro, unida.turma.id, dia, tempo);
                        if (valor === unida.id + 1) {
                            // recompensa por respeitar disciplina unida alocada junto
                            fitness += 5;
                        }
                    }
                }
            }
        }

        return fitness;
    }

    mutate = (quadro: number[], mutationRate: number) => {
        let mutationsAmount = calcMutationAmount(quadro.length, mutationRate);
        let maxAttempts = mutationsAmount * 10;
        for (let i = 0; i < maxAttempts; i++) {
            // Faz swap dentro das turmas
            const turma = this.turmas[Math.floor(Math.random() * this.turmas.length)];
            const dia1 = Math.floor(Math.random() * QUANTOS_DIAS);
            const dia2 = Math.floor(Math.random() * QUANTOS_DIAS);
            const tempo1 = Math.floor(Math.random() * this.nTempos);
            const tempo2 = Math.floor(Math.random() * this.nTempos);

            const index1 = this.toQuadroIndex(turma.id, dia1, tempo1);
            const index2 = this.toQuadroIndex(turma.id, dia2, tempo2);

            // Só troca se ambos os slots forem de aula
            if (quadro[index1] > 0 && quadro[index2] > 0) {
                const temp = quadro[index1];
                quadro[index1] = quadro[index2];
                quadro[index2] = temp;
                mutationsAmount--;
                if (mutationsAmount <= 0) break;
            }
        }
    }

    crossover = (childA: number[], childB: number[], parentA: number[], parentB: number[]) => {
        // Crossover por blocos de turmas: para cada turma, escolhe aleatoriamente um dos pais para copiar a turma inteira
        for (const turma of this.turmas) {
            const source = Math.random() < 0.5 ? parentA : parentB;
            const destA = childA;
            const destB = childB;

            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for (let tempo = 0; tempo < this.nTempos; tempo++) {
                    const index = this.toQuadroIndex(turma.id, dia, tempo);
                    destA[index] = source[index];
                    destB[index] = source[index];
                }
            }
        }
    }
}