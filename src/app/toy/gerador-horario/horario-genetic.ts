import { cloneArrayOperator, GAProblem } from "@/lib/genetic/problem";
import { FormularioHorario, QUANTOS_DIAS, RegrasHorario } from "./horario-regras";
import { calcMutationAmount } from "@/lib/genetic/mutationOperators";

export class HorarioGAProblem extends RegrasHorario implements GAProblem<number[]> {
    public readonly size: number;
    public readonly maxFitness?: number | undefined;

    constructor(formData: FormularioHorario) {
        super(formData);

        this.size = this.turmas.length * QUANTOS_DIAS * this.nTempos;

        // Calcula o fitness máximo teórico (pode não ser atingível dependendo do problema)
        let maxFit = 0;
        for (const disc of this.disciplinas) {
            // Recompensa por professor disponível e sem conflito
            maxFit += disc.aulas * disc.professores.length * 5;
            // Recompensa por disciplinas unidas alocadas juntas
            maxFit += disc.aulas * disc.disciplinasUnidas.length * 5;
            // Recompensa por agrupamento correto
            if (disc.agrupar > 0) {
                const numGroups = Math.floor(disc.aulas / disc.agrupar);
                maxFit += numGroups * 8;
            }
        }
        this.maxFitness = maxFit > 0 ? maxFit : undefined;
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

        // Reseta matrizes de ocupação dos professores (cópia da disponibilidade original)
        for (const prof of this.professores) {
            prof.matriz.copiar(prof.horarios);
        }

        for (const turma of this.turmas) {
            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                for (let tempo = 0; tempo < this.nTempos; tempo++) {
                    const index = this.toQuadroIndex(turma.id, dia, tempo);

                    // Slots inativos: nada a verificar
                    if (!turma.horarios.possui(dia, tempo)) continue;

                    const idDisciplina = quadro[index] - 1;
                    if (idDisciplina < 0) continue; // slot vazio

                    const disciplina = this.disciplinas[idDisciplina];

                    // Regra: Disponibilidade do professor E sem conflito entre turmas
                    // prof.matriz começa como cópia de prof.horarios e é zerada conforme
                    // o professor é alocado. Se prof.matriz.possui(dia, tempo) == true,
                    // o professor está disponível E ainda não está em outra turma.
                    for (const prof of disciplina.professores) {
                        if (prof.matriz.possui(dia, tempo)) {
                            fitness += 5;
                        }
                        prof.matriz.dias[dia][tempo] = 0;
                    }

                    // Regra: Disciplinas unidas devem ocupar o mesmo (dia, tempo)
                    for (const unida of disciplina.disciplinasUnidas) {
                        const valor = this.getQuadroValor(quadro, unida.turma.id, dia, tempo);
                        if (valor === unida.id + 1) {
                            fitness += 5;
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

                        // dividir → run deve ser exatamente G
                        // !dividir → run deve ser múltiplo de G
                        const valid = disc.dividir
                            ? (runLength === G)
                            : (runLength % G === 0);

                        if (valid) {
                            fitness += 8;
                        }

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