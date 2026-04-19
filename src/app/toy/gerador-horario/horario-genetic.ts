import { cloneArrayOperator, GAProblem } from "@/lib/genetic/problem";
import { FormularioHorario, QUANTOS_DIAS, RegrasHorario } from "./horario-regras";
import { calcMutationAmount } from "@/lib/genetic/mutationOperators";

export class HorarioGAProblem extends RegrasHorario implements GAProblem<number[]> {
    public readonly size: number;
    public readonly maxFitness?: number | undefined;

    constructor(formData: FormularioHorario) {
        super(formData);

        this.size = this.turmas.length * QUANTOS_DIAS * this.nTempos;
        // Fitness 0 é que não tem nada errado, negativo quando tem violações. Então o máximo é 0.
        this.maxFitness = 0;
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
        // Começa 0, para cada coisa errada subtrai
        let fitness = 0;

        // Reseta as matrizes de disponibilidade dos professores para contagem de fitness
        for (const prof of this.professores) {
            prof.matriz.copiar(prof.horarios);
        }

        // Pass 1: conta quantas turmas precisam de cada (prof, dia, tempo).
        // Isso evita o viés em que a turma com id menor sempre "ganha" o professor.
        for (const turma of this.turmas) {
            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for (let tempo = 0; tempo < this.nTempos; tempo++) {
                    // Slots inativos: nada a verificar
                    if (!turma.horarios.possui(dia, tempo)) continue;

                    const idDisciplina = quadro[this.toQuadroIndex(turma.id, dia, tempo)] - 1;
                    if (idDisciplina < 0) continue; // slot vazio

                    const disciplina = this.disciplinas[idDisciplina];

                    // prof.matriz começa como cópia de prof.horarios (0, 1)
                    // Para cada disciplina alocada, decrementa a disponibilidade dos professores daquela disciplina
                    for (const prof of disciplina.professores) {
                        prof.matriz.dias[dia][tempo]--;
                    }
                }
            }
        }

        // Pass 2: conta a pontuação de cada slot com base na disponibilidade dos professores e nas disciplinas unidas
        for (const turma of this.turmas) {
            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for (let tempo = 0; tempo < this.nTempos; tempo++) {
                    const index = this.toQuadroIndex(turma.id, dia, tempo);

                    if (!turma.horarios.possui(dia, tempo)) {
                        // Deveria ser vazio
                        if (quadro[index] !== -1) {
                            fitness -= 1000;
                        }
                        continue;
                    }

                    const idDisciplina = quadro[index] - 1;
                    if (idDisciplina < 0) {
                        // Deveria ter uma disciplina alocada
                        fitness -= 1000;
                        continue; // slot vazio
                    }

                    const disciplina = this.disciplinas[idDisciplina];

                    // Regra: Disponibilidade do professor e sem conflito entre turmas
                    for (const prof of disciplina.professores) {
                        const disponibilidade = prof.matriz.dias[dia][tempo];
                        // Penaliza proporcional ao Nº de conflitos
                        if (disponibilidade <= 0) {
                            fitness += disponibilidade * 50;
                        }
                    }

                    // Regra: Disciplinas unidas devem ocupar o mesmo (dia, tempo)
                    for (const unida of disciplina.disciplinasUnidas) {
                        const valor = this.getQuadroValor(quadro, unida.turma.id, dia, tempo);
                        // Penaliza disciplinas que não estão juntas quando deveriam
                        if (valor !== unida.id + 1) {
                            fitness -= 30;
                        }
                    }
                }
            }
        }

        // Regra: Agrupamento em blocos de G aulas consecutivas
        // Mesma lógica de verificaQuadro do pencilmark, mas como recompensa
        for (const disc of this.disciplinas) {
            if (disc.agrupar <= 0) continue;
            const G = disc.agrupar;
            const turmaId = disc.turma.id;

            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                let runStart = -1;

                for (let tempo = 0; tempo <= this.nTempos; tempo++) {
                    // Sentinela no final do dia: força o fechamento do último run
                    const v = tempo < this.nTempos
                        ? quadro[this.toQuadroIndex(turmaId, dia, tempo)]
                        : -1;

                    if (v === disc.id + 1) {
                        if (runStart === -1) runStart = tempo;
                    } else if (runStart !== -1) {
                        const runLength = tempo - runStart;

                        /*// dividir → run deve ser exatamente G
                        // !dividir → run deve ser múltiplo de G
                        const valid = disc.dividir
                            ? (runLength === G)
                            : (runLength % G === 0);

                        if (valid) {
                            fitness += 25;
                        }*/

                        // Penalizar proporcional ao quanto o run se aproxima do ideal (multiplo de G, ou igual a G se dividir)
                        const ideal = disc.dividir ? G : Math.round(runLength / G) * G;
                        const diff = Math.abs(runLength - ideal);
                        fitness -= diff * 20;

                        runStart = -1;
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

            // Troca se ambos os slots forem ativos (>= 0) e diferentes
            if (quadro[index1] >= 0 && quadro[index2] >= 0 && quadro[index1] !== quadro[index2]) {
                const temp = quadro[index1];
                quadro[index1] = quadro[index2];
                quadro[index2] = temp;
                mutationsAmount--;
                if (mutationsAmount <= 0) break;
            }
        }
    }

    crossover = (childA: number[], childB: number[], parentA: number[], parentB: number[]) => {
        // Crossover por blocos de turmas: para cada turma, escolhe aleatoriamente um dos pais
        // Os filhos recebem blocos complementares (se childA ← parentA, childB ← parentB)
        for (const turma of this.turmas) {
            const useA = Math.random() < 0.5;

            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for (let tempo = 0; tempo < this.nTempos; tempo++) {
                    const index = this.toQuadroIndex(turma.id, dia, tempo);
                    childA[index] = useA ? parentA[index] : parentB[index];
                    childB[index] = useA ? parentB[index] : parentA[index];
                }
            }
        }
    }
}