import { crossoverOX1Operator } from "../crossoverOperators.ts";
import { calcMutationAmount} from "../mutationOperators.ts";
import { GAProblem } from "../problem.ts";

/**
 * Representação dos genes:
 *   Um array flat de 81 números (índices 0..8), onde genes[row*9+col] é o valor (1..9).
 *
 * Estratégia de codificação "row-permutation":
 *   Cada linha é uma permutação de [1..9], garantindo que não há repetição por linha.
 *   Isso reduz drasticamente o espaço de busca e direciona o GA a resolver colunas e boxes.
 *
 * Células fixadas pelo puzzle (clues) NUNCA são trocadas durante mutação nem crossover —
 * a função `locked` marca quais posições são intocáveis.
 */

// Índices das 9 células de cada box 3x3
const BOX_CELLS: number[][] = (() => {
    const boxes: number[][] = Array.from({ length: 9 }, () => []);
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const boxId = Math.floor(r / 3) * 3 + Math.floor(c / 3);
            boxes[boxId].push(r * 9 + c);
        }
    }
    return boxes;
})();

class SudokuGenes {
    public quadro: Int32Array; // 81 células, valores 0-9 (0 = livre)
    public rows: Int32Array[]; // 9 linhas, cada uma com 9 valores
    constructor() {
        this.quadro = new Int32Array(81);
        // Cria as 9 views para as linhas, apontando para os segmentos corretos do quadro
        // (Não são cópias, mas sim "views" que acessam o mesmo array subjacente)
        this.rows = Array.from(
            { length: 9 }, 
            (_, i) => this.quadro.subarray(i * 9, (i + 1) * 9)
        );
    }

    fillRandom(clues: number[]): void {
        this.quadro.fill(0);

        for (let row = 0; row < 9; row++) {
            const base = row * 9;

            // Valores já fixados nesta linha
            const fixed = new Set<number>();
            for (let col = 0; col < 9; col++) {
                const clue = clues[base + col];
                if (clue !== 0) {
                    this.quadro[base + col] = clue;
                    fixed.add(clue);
                }
            }

            // Valores que faltam para completar 1-9 nesta linha
            const missing = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(v => !fixed.has(v)));

            let mi = 0;
            for (let col = 0; col < 9; col++) {
                if (clues[base + col] === 0) {
                    this.quadro[base + col] = missing[mi++];
                }
            }
        }
    }
}

export class SudokuGAProblem implements GAProblem<SudokuGenes> {
    public readonly size: number;
    public readonly maxFitness?: number | undefined;

    /** Células fixas do puzzle (valor > 0 = fixado) */
    private readonly clues: number[];

    /**
     * @param clues Array de 81 valores (1-9 para clues, 0 para células livres).
     *              Exemplo: "530070000600195000..." (formato string também aceito abaixo)
     */
    constructor(clues: number[]) {
        if (clues.length !== 81) throw new Error("clues deve ter 81 elementos");

        this.size = 81;
        this.clues = clues;
        const clueCount = clues.filter(c => c !== 0).length;
        this.maxFitness = (3 * 9 * 9) + (clueCount * 8);
    }

    clone = (genes: SudokuGenes, other: SudokuGenes) => {
        genes.quadro.set(other.quadro);
    };

    mutate = (genes: SudokuGenes, mutationRate: number) => {
        const mutations = calcMutationAmount(this.size, mutationRate);
        for(let i = 0; i < mutations; i++) {
            // Swap aleatório entre duas posições
            let idx1: number, idx2: number, attempts = 0;
            do {
                idx1 = Math.floor(Math.random() * this.size); // Escolhe uma posição aleatória
                // Escolhe outra posição aleatória, mas na mesma linha
                const rowStart = Math.floor(idx1 / 9) * 9;
                idx2 = rowStart + Math.floor(Math.random() * 9);
            } while(attempts++ < 20 && (idx2 === idx1 || this.clues[idx1] !== 0 || this.clues[idx2] !== 0));
            if(attempts >= 20) continue; // Falhou em encontrar posições válidas, pula esta mutação

            // Swap simples entre genes[idx1] e genes[idx2]
            const temp = genes.quadro[idx1];
            genes.quadro[idx1] = genes.quadro[idx2];
            genes.quadro[idx2] = temp;  
        }
    };

    op = crossoverOX1Operator<Int32Array>(9, gene => gene);
    crossover = (childA: SudokuGenes, childB: SudokuGenes, parentA: SudokuGenes, parentB: SudokuGenes) => {
        for(let row = 0; row < 9; row++) {
            if(Math.random() < 0.5) {
                // Crossover OX1, as linhas correspondentes dos pais
                this.op(
                    childA.rows[row],
                    childB.rows[row],
                    parentA.rows[row],
                    parentB.rows[row]
                );
            } else {
                // Apenas copia as linhas dos pais aleatoriamente
                if(Math.random() < 0.5) {
                    childA.rows[row].set(parentA.rows[row]);
                    childB.rows[row].set(parentB.rows[row]);
                } else {
                    childA.rows[row].set(parentB.rows[row]);
                    childB.rows[row].set(parentA.rows[row]);
                }
            }
        }
    }

    // ------------------------------------------------------------------ //
    //  Factory: constrói a partir de string de 81 dígitos (0 = livre)      //
    // ------------------------------------------------------------------ //
    static fromString(puzzle: string): SudokuGAProblem {
        if (puzzle.length !== 81) throw new Error("String deve ter 81 caracteres");
        return new SudokuGAProblem(puzzle.split("").map(Number));
    }

    // ------------------------------------------------------------------ //
    //  randomGenes: inicializa cada linha como permutação válida de 1-9    //
    //  respeitando os clues fixados naquela linha                          //
    // ------------------------------------------------------------------ //
    randomGenes(): SudokuGenes {
        const genes = new SudokuGenes();
        genes.fillRandom(this.clues);
        return genes;
    }

    _counts: number[] = new Array(10).fill(0); // buffer para contagem (1-9)
    fitness(genes: SudokuGenes): number {
        const quadro = genes.quadro;
        const counts = this._counts;
        let score = 0;

        // 1. Linhas (Opcional se sua estratégia de 'row-permutation' for perfeita)
        // Se você garante que cada linha SEMPRE tem 1-9, o score das linhas será sempre 81 (9*9).
        // Mas vamos incluir para manter a robustez.
        for (let r = 0; r < 9; r++) {
            counts.fill(0);
            for (let c = 0; c < 9; c++) {
                counts[quadro[r * 9 + c]]++;
            }
            // Recompensa: Para cada número que aparece EXATAMENTE uma vez, +1 ponto.
            for (let i = 1; i <= 9; i++) {
                if (counts[i] === 1) score++;
            }
        }

        // 2. Colunas
        for (let c = 0; c < 9; c++) {
            counts.fill(0);
            for (let r = 0; r < 9; r++) {
                counts[quadro[r * 9 + c]]++;
            }
            // Recompensa granular por coluna
            for (let i = 1; i <= 9; i++) {
                if (counts[i] === 1) score++;
            }
        }

        // 3. Boxes (Quadrantes 3x3)
        for (let b = 0; b < 9; b++) {
            counts.fill(0);
            for (const idx of BOX_CELLS[b]) {
                counts[quadro[idx]]++;
            }
            // Recompensa granular por box
            for (let i = 1; i <= 9; i++) {
                if (counts[i] === 1) score++;
            }
        }

        for(let i = 0; i < this.clues.length; i++) {
            if(this.clues[i] !== 0 && this.clues[i] === quadro[i]) {
                score += 8; // Recompensa extra por cada clue corretamente mantido
            }
        }

        return score; // Max Fitness = 243 (81*3) + (8 pontos por cada clue corretamente mantido)
    }

    // ------------------------------------------------------------------ //
    //  hash: polynomial rolling hash sobre o quadro (para diversityCheck)  //
    // ------------------------------------------------------------------ //
    hash(genes: SudokuGenes): number {
        let h = 0;
        const q = genes.quadro;
        for (let i = 0; i < 81; i++) {
            // Polynomial rolling hash com Math.imul (mantém no espaço int32)
            h = (Math.imul(h, 31) + q[i]) | 0;
        }
        return h;
    }

    // ------------------------------------------------------------------ //
    //  toStatusString: mostra o grid formatado                             //
    // ------------------------------------------------------------------ //
    toStatusString(genes: SudokuGenes, _maxLength: number = 64): string {
        const quadro = genes.quadro;
        const rows: string[] = [];
        for (let r = 0; r < 9; r++) {
            let rowStr = "";
            for (let c = 0; c < 9; c++) {
                const val = quadro[r * 9 + c];
                rowStr += (val === 0 ? "." : val.toString()) + " ";
                if (c === 2 || c === 5) rowStr += "| ";
            }
            rows.push(rowStr.trim());
            if (r === 2 || r === 5) rows.push("-".repeat(21));
        }
        return rows.join("\n");
    }
}

// ------------------------------------------------------------------ //
//  Helpers                                                             //
// ------------------------------------------------------------------ //

function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}