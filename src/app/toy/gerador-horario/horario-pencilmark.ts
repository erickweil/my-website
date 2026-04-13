import { Possib } from "@/lib/pencilmark";
import { Disciplina, FormularioHorario, Horario, Professor, QUANTOS_DIAS, RegrasHorario, Turma } from "./horario-regras";

export class HorarioSolverPencilmark extends RegrasHorario {
    quadro: number[];
    nPossibs: number;

    constructor(formData: FormularioHorario) {
        super(formData);

        this.nPossibs = this.disciplinas.length;
        this.quadro = this.getQuadroVazio();
    }

    gerarRegrasFn(): (quadro: number[], possibs: Possib | null) => boolean {
        return (quadro: number[], possibs: Possib | null): boolean => {
            this.quadro = quadro;
            if (possibs === null) {
                // chamado 1 vez para o quadro todo
                return this.verificaQuadro();
            } else {
                // chamado para cada célula
                return this.verificaCelula(possibs);
            }
        };
    }

    verificaQuadro(): boolean {
        // Iniciar regras, como contagem de aulas alocadas por disciplina, para controle durante a geração do quadro
        for (const prof of this.professores) {
            prof.matriz.copiar(prof.horarios);
        }
        for (const disc of this.disciplinas) {
            disc.contAulas = 0;
        }
        for (const turma of this.turmas) {
            for (let tempo = 0; tempo < this.nTempos; tempo++) {
                for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                    const index = this.toQuadroIndex(turma.id, dia, tempo);
                    const idDisciplina = this.quadro[index] - 1;
                    if (idDisciplina < 0) continue; // sem aula nesse espaço

                    const disciplina = this.disciplinas[idDisciplina];
                    disciplina.contAulas++;

                    // Isso é necessário mesmo?
                    for (const prof of disciplina.professores) {
                        prof.matriz.dias[dia][tempo] = 0;
                    }
                }
            }
        }

        // Verificar consistência dos agrupamentos já definidos no quadro.
        // Necessário pois o solver pode alocar uma disciplina isolada e só perceber
        // depois (ao fechar os vizinhos) que o grupo não pode atingir o tamanho G.
        for (const disc of this.disciplinas) {
            if (disc.agrupar <= 0) continue;
            const G = disc.agrupar;
            const turmaId = disc.turma.id;

            for (let dia = 0; dia < QUANTOS_DIAS; dia++) {
                let runStart = -1;

                for (let tempo = 0; tempo <= this.nTempos; tempo++) {
                    // sentinela no final do dia: força o fechamento do último run
                    const v = tempo < this.nTempos
                        ? this.quadro[this.toQuadroIndex(turmaId, dia, tempo)]
                        : -1;

                    if (v === disc.id + 1) {
                        if (runStart === -1) runStart = tempo;
                    } else if (runStart !== -1) {
                        const runLength = tempo - runStart;

                        // Run fechado dos dois lados com tamanho não múltiplo de G — inválido
                        // v !== 0 significa: OOB (-1), sem-aula (-1) ou outra disciplina (> 0)
                        const rightBlocked = v !== 0;
                        const leftBoundaryV = runStart > 0
                            ? this.quadro[this.toQuadroIndex(turmaId, dia, runStart - 1)]
                            : -1; // OOB = bloqueado
                        const leftBlocked = leftBoundaryV !== 0;

                        if (leftBlocked && rightBlocked) {
                            // dividir → run deve ser exatamente G (grupos não podem se tocar)
                            // !dividir → run deve ser múltiplo de G
                            if (disc.dividir ? runLength !== G : runLength % G !== 0) return false;
                        }

                        runStart = -1;
                    }
                }
            }
        }

        return true;
    }

    verificaCelula(possibs: Possib): boolean {
        const index = possibs.index;
        const { idTurma, dia, tempo } = this.fromQuadroIndex(index);

        // Se já foi escolhido no quadro, só tem aquela opção disponível
        // -1 indica que não haverá nenhuma escolha,
        // 0 indica que não foi escolhido
        // >0 indica que uma matéria foi escolhida
        const valor = this.quadro[index];
        if(valor !== 0) {
            possibs.resetar(false);
            if (valor > 0) {
                possibs.marcar(valor - 1);
            }
            return true;
        }

        // A turma deve poder ter aula nesse horário
        const turma = this.turmas[idTurma];
        if (!turma.horarios.possui(dia, tempo)) {
            possibs.resetar(false);
            return false;
        }

        // Verificar se já tem o número necessário de aulas alocadas para cada disciplina possível nesse espaço
        for (let idDisc = 0; idDisc < this.disciplinas.length; idDisc++) {
            if(!possibs.ler(idDisc)) continue;

            if (!this.podeDisciplina(idDisc, idTurma, dia, tempo)) {
                possibs.desmarcar(idDisc);
            }
        }

        return true;
    }

    public podeDisciplina(idDisc: number, idTurma: number, dia: number, tempo: number): boolean {
        const disc = this.disciplinas[idDisc];

        // A disciplina deve poder ser nesta turma
        if(disc.turma.id !== idTurma) return false;

        // esgotou o número de aulas a serem escolhidas desta matéria
        if(disc.contAulas >= disc.aulas) return false;

        // O professor deve estar disponivel neste tempo
        const profs = disc.professores;
        for (const prof of profs) {
            // O professor não dá aulas neste dia/tempo ou O professor já está em outra turma neste dia/tempo
            if (!prof.matriz.possui(dia, tempo)) return false;
        }

        // As aulas devem ser agrupadas em blocos de exatamente G aulas consecutivas.
        // agrupar = 0 → sem restrição; agrupar = G → todos os runs desta disciplina no dia
        // devem ter comprimento exatamente G.
        if (disc.agrupar > 0) {
            const G = disc.agrupar;

            // Conta aulas consecutivas desta disciplina imediatamente à esquerda
            let leftRun = 0;
            for (let t = tempo - 1; t >= 0; t--) {
                if (this.getQuadroValor(this.quadro, idTurma, dia, t) === idDisc + 1) leftRun++;
                else break;
            }

            // Conta aulas consecutivas desta disciplina imediatamente à direita
            let rightRun = 0;
            for (let t = tempo + 1; t < this.nTempos; t++) {
                if (this.getQuadroValor(this.quadro, idTurma, dia, t) === idDisc + 1) rightRun++;
                else break;
            }

            const currentRun = leftRun + 1 + rightRun;

            // Se dividir está ativo, o run não pode ultrapassar G (grupos não se tocam)
            if (disc.dividir && currentRun > G) return false;

            // Verifica se o grupo está bloqueado dos dois lados (não pode mais crescer).
            // getQuadroValor retorna -1 para OOB, que é ≠ 0 → bloqueado.
            // Valor 0 = slot livre → não bloqueado (pode crescer).
            const leftBoundaryV  = this.getQuadroValor(this.quadro, idTurma, dia, tempo - leftRun  - 1);
            const rightBoundaryV = this.getQuadroValor(this.quadro, idTurma, dia, tempo + rightRun + 1);
            const leftBlocked  = leftBoundaryV  !== 0;
            const rightBlocked = rightBoundaryV !== 0;

            // Grupo fechado: dividir → deve ser exatamente G; senão → múltiplo de G
            if (leftBlocked && rightBlocked) {
                if (disc.dividir ? currentRun !== G : currentRun % G !== 0) return false;
            }
        }

        // As disciplinas unidas devem ser escolhidas juntas
        // Checagem direta: se disc tem unidas, as turmas parceiras devem estar vazias ou com a disciplina correta
        const unidas = disc.disciplinasUnidas;
        for (const unida of unidas) {
            const valor = this.getQuadroValor(this.quadro, unida.turma.id, dia, tempo);
            if (valor !== 0 && valor !== unida.id + 1) {
                // Se foi escolhido, deve ser a mesma disciplina
                return false;
            }
        }

        // Checagem reversa: se alguma disciplina já alocada em outra turma neste (dia, tempo)
        // exige que uma disciplina unida específica esteja NESTA turma, então somente essa
        // disciplina pode ser colocada aqui.
        for (const outraTurma of this.turmas) {
            if (outraTurma.id === idTurma) continue;
            const valorOutra = this.getQuadroValor(this.quadro, outraTurma.id, dia, tempo);
            if (valorOutra <= 0) continue;

            const discOutra = this.disciplinas[valorOutra - 1];
            for (const unidaDaOutra of discOutra.disciplinasUnidas) {
                // Se a unida da outra disciplina deve estar nesta turma, e não sou eu → inválido
                if (unidaDaOutra.turma.id === idTurma && unidaDaOutra.id !== idDisc) {
                    return false;
                }
            }
        }

        return true;
    }
}
