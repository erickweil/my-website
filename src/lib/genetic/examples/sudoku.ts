import { extend } from "zod/v4-mini";
import { crossoverOX1Operator } from "../crossoverOperators.ts";
import { calcMutationAmount, mutationCombineOperator, mutationNeighborSwapOperator, mutationRandomSwapOperator, mutationShiftSwapOperator } from "../mutationOperators.ts";
import { CloneOperator, CrossoverOperator, GAProblem, GAProblemArray } from "../problem.ts";

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

const createView = <T extends Array<unknown>>() => {
    const ret = {
        bind(arr: T, start: number, end: number) {
            ret.arr = arr;
            ret.start = start;
            ret.end = end;
            return ret.view;
        },
        arr: undefined as T | undefined,
        start: 0,
        end: 0,
        view: new Proxy({}, {
            get: (_, prop) => {
                if (prop === 'length') return ret.end - ret.start;
                // Converte a string do índice para número e soma o deslocamento
                return ret.arr![ret.start + Number(prop)];
            },
            set: (_, prop, value) => {
                ret.arr![ret.start + Number(prop)] = value;
                return true;
            }
        }) as unknown as T
    };
    return ret;
};

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

        // maxFitness = linhas + colunas + boxes completamente sem repetição
        // Cada unidade perfeita vale 9 pontos (valores únicos 1-9).
        // 27 unidades × 9 = 243 … mas usamos contagem de conflitos (ver fitness),
        // então maxFitness = 0 conflitos → representamos como 27*9 pares únicos.
        this.size = 81;
        this.maxFitness = 243;
        this.clues = clues;
    }

    clone = (genes: SudokuGenes, other: SudokuGenes) => {
        genes.quadro.set(other.quadro);
    };

    mutate = (genes: SudokuGenes, mutationRate: number) => {
        // Escolhe uma linha aleatória (0-8)
        const rowIndex = Math.floor(Math.random() * 9);
        const rowOffset = rowIndex * 9;
        const row = genes.rows[rowIndex];
        // Aplica mutação de swap na linha, respeitando os locked
        for(let c1 = 0; c1 < 9; c1++) {
            if (this.clues[rowOffset + c1] !== 0) continue; // Não mexe em clues

            for(let c2 = c1 + 1; c2 < 9; c2++) {
                if (this.clues[rowOffset + c2] !== 0) continue; // Não mexe em clues
                if (Math.random() >= mutationRate) continue; // Decide se muta esta posição

                // Swap simples entre genes[c1] e genes[c2]
                const temp = row[c1];
                row[c1] = row[c2];
                row[c2] = temp;                
            }
        }
    };

    op = crossoverOX1Operator<Int32Array>(9, gene => gene);
    crossover = (childA: SudokuGenes, childB: SudokuGenes, parentA: SudokuGenes, parentB: SudokuGenes) => {
        // Crossover OX1, entre duas linhas correspondentes dos pais
        const row = Math.floor(Math.random() * 9);
        this.op(
            childA.rows[row],
            childB.rows[row],
            parentA.rows[row],
            parentB.rows[row]
        );

        // Copia as outras linhas (não crossover) dos pais para os filhos, respeitando os locked
        for(let r = 0; r < 9; r++) {
            if (r === row) continue; // linha crossover já foi processada

            const base = r * 9;
            for(let c = 0; c < 9; c++) {
                const i = base + c;
                if (this.clues[i] !== 0) {
                    // Célula fixa: copia do pai correspondente (pode ser qualquer um, pois são iguais)
                    childA.quadro[i] = parentA.quadro[i];
                    childB.quadro[i] = parentB.quadro[i];
                } else {
                    // Célula livre: mantém o valor do filho (que pode ter sido modificado por crossover)
                    childA.quadro[i] = childA.quadro[i] || parentA.quadro[i];
                    childB.quadro[i] = childB.quadro[i] || parentB.quadro[i];
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

        return score; // Max Fitness = 243 (81*3)
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