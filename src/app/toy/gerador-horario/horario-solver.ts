import { PencilmarkSolver, Possib } from "@/lib/pencilmark";
import { WorkerResponseMsg } from "@/lib/workerRace";

export const TODOS_OS_DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
const QUANTOS_DIAS = TODOS_OS_DIAS.length;
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

class Horario {
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

class Turma {
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

class Professor {
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

class Disciplina {
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


export class RegrasHorario {
    quadro: number[];

    turmas: Turma[];
    disciplinas: Disciplina[];
    professores: Professor[];

    nTempos: number;

    nPossibs: number;

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
                if (this.getQuadroValor(idTurma, dia, t) === idDisc + 1) leftRun++;
                else break;
            }

            // Conta aulas consecutivas desta disciplina imediatamente à direita
            let rightRun = 0;
            for (let t = tempo + 1; t < this.nTempos; t++) {
                if (this.getQuadroValor(idTurma, dia, t) === idDisc + 1) rightRun++;
                else break;
            }

            const currentRun = leftRun + 1 + rightRun;

            // Se dividir está ativo, o run não pode ultrapassar G (grupos não se tocam)
            if (disc.dividir && currentRun > G) return false;

            // Verifica se o grupo está bloqueado dos dois lados (não pode mais crescer).
            // getQuadroValor retorna -1 para OOB, que é ≠ 0 → bloqueado.
            // Valor 0 = slot livre → não bloqueado (pode crescer).
            const leftBoundaryV  = this.getQuadroValor(idTurma, dia, tempo - leftRun  - 1);
            const rightBoundaryV = this.getQuadroValor(idTurma, dia, tempo + rightRun + 1);
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
            const valor = this.getQuadroValor(unida.turma.id, dia, tempo);
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
            const valorOutra = this.getQuadroValor(outraTurma.id, dia, tempo);
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

    toQuadroIndex(idTurma: number, dia: number, tempo: number): number {
        return (idTurma * QUANTOS_DIAS * this.nTempos) + (dia * this.nTempos) + tempo;
    }

    fromQuadroIndex(index: number): { idTurma: number; dia: number; tempo: number } {
        const idTurma = Math.floor(Math.floor(index / this.nTempos) / QUANTOS_DIAS);
        const dia = Math.floor(index / this.nTempos) % QUANTOS_DIAS;
        const tempo = index % this.nTempos;

        return { idTurma: idTurma, dia, tempo };
    }

    getQuadroValor(idTurma: number, dia: number, tempo: number): number {
        if (idTurma < 0 || idTurma >= this.turmas.length) {
            return -1;
        }
        if (dia < 0 || dia >= QUANTOS_DIAS) {
            return -1;
        }
        if (tempo < 0 || tempo >= this.nTempos) {
            return -1;
        }

        return this.quadro[this.toQuadroIndex(idTurma, dia, tempo)];
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
}

export type HorarioWorkerTaskValue = {
    solucao?: TurmaHorarioResult[];
    completo?: boolean;
    iter: number;
    depth: number;
};

export function solucionarQuadroHorario(
    baseIter: number | null,
    formData: FormularioHorario,
    diasAtivos: HorarioDia[],
    postMessage?: (msg: WorkerResponseMsg<HorarioWorkerTaskValue>) => void
) {
    const regras = new RegrasHorario(formData);
    // A FAZER: Somar a quantidade de aulas de cada turma, para validar caso aconteça aulas demais para o horário

    console.log(`Carregou ${regras.turmas.length} turmas, ${regras.disciplinas.length} disciplinas, ${regras.professores.length} professores. com ${regras.nTempos} tempos, total espaços no quadro: ${regras.quadro.length} (${regras.nPossibs} possibilidades cada espaço) Gerando soluções...`);
    
    const stats = PencilmarkSolver.solucionarQuadro(
        regras.quadro,
        regras.nPossibs,
        regras.gerarRegrasFn(),
        (iter, depth) => {
            postMessage?.({ type: "message", value: { iter, depth } });
        },
        1, // maxSolucoes
        baseIter // baseIter - começa a iterar a partir de 2^8 iterações
    );

    let quadroSolucionado = stats?.solucoes.at(0);
    if(!quadroSolucionado && stats?.melhor) {
        // Se não encontrou solução completa, mas encontrou uma solução parcial melhor que o quadro inicial, usar essa solução parcial
        quadroSolucionado = stats.melhor;
    }
    if (!quadroSolucionado || quadroSolucionado.length <= 0) {
        // Retorno normal, para parar os outros workers, já que é impossível resolver
        return {
            solucao: undefined,
            completo: false,
            iter: stats?.iter || 0,
            depth: 0
        };
    }

    // Converter solução para formato de saída
    const resultado: TurmaHorarioResult[] = regras.turmas.map((turma) => ({
        turma: turma.nome,
        horario: diasAtivos.map((dia) => {
            const diaIdx = Horario.diaSemanaMap[dia];
            const tempos: (string | null)[] = [];
            for (let tempo = 0; tempo < regras.nTempos; tempo++) {
                const valor = quadroSolucionado[regras.toQuadroIndex(turma.id, diaIdx, tempo)];
                if (valor === 0) {
                    tempos.push("???"); // Não resolvido
                } else if(valor === -1) {
                    tempos.push(null); // Sem aula
                } else {
                    const disc = regras.disciplinas[valor - 1];
                    tempos.push(disc?.nome || "Disciplina Desconhecida");
                }
            }
            return { dia, tempos };
        }),
    }));

    return {
        solucao: resultado,
        completo: stats.solucoes.length > 0,
        iter: stats?.iter || 0,
        depth: 0
    };
}