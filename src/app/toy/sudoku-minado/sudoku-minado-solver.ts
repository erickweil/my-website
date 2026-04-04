// Valor 0 representa escolha ainda não feita
// Valores 1-6 representam números escolhidos sem mina
// Valores 7-12 representam números escolhidos com mina
import { Possib } from "@/lib/pencilmark";

// Tabelas de consulta estáticas para evitar cálculos repetitivos
const ADJACENTES: number[][] = Array.from({ length: 36 }, (_, i) => {
    const neighbors = [];
    const px = i % 6, py = Math.floor(i / 6);
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const nx = px + dx, ny = py + dy;
            if (nx >= 0 && nx < 6 && ny >= 0 && ny < 6 && !(dx === 0 && dy === 0)) {
                neighbors.push(ny * 6 + nx);
            }
        }
    }
    return neighbors;
});

// Mapa com os vizinhos que devem ser verificados para cada célula, pré-calculado para eficiência
// A ideia é ter os índices prontos para cada célula (linhas + colunas + caixa)
const SUDOKU_MAP: number[][] = Array.from({ length: 36 }, (_, i) => {
    const neighbors = new Set<number>();
    const py = Math.floor(i / 6);
    const px = Math.floor(i % 6);

    // Adicionar vizinhos da linha
    for (let x = 0; x < 6; x++) {
        neighbors.add(py * 6 + x);
    }

    // Adicionar vizinhos da coluna
    for (let y = 0; y < 6; y++) {
        neighbors.add(y * 6 + px);
    }

    // Adicionar vizinhos da caixa 2x3
    const quadX = Math.floor(px / 3) * 3;
    const quadY = Math.floor(py / 2) * 2;
    for (let x = quadX; x < quadX + 3; x++) {
        for (let y = quadY; y < quadY + 2; y++) {            
            neighbors.add(y * 6 + x);
        }
    }

    // Remover a própria célula
    neighbors.delete(i);

    return Array.from(neighbors);
});

// Deve ter exatamente 21 minas no total, uma em cada caixa, e cada caixa tem um número diferente de minas
const TOTAL_MINAS = 1 + 2 + 3 + 4 + 5 + 6;

export class RegrasSudokuMinado {
    quadro: number[];
    minasQuadro: [number, number];
    minasPorCaixa: [number, number][];
    minasPorCelula: [number, number][];

    constructor() {
        this.quadro = [];
        this.minasQuadro = [0, 0];
        this.minasPorCaixa = new Array(6).fill(null).map(() => [0, 0]);
        this.minasPorCelula = new Array(36).fill(null).map(() => [0, 0]);
    }

    valorSudoku(v: number): number {
        if(v > 6) return v - 6;
        return v;
    }

    ehMina(v: number): boolean {
        return v > 6;
    }

    contarMinasAdjacentes(px: number, py: number, minMax: [number, number]) {
        const index = py * 6 + px;
        const vizinhos = ADJACENTES[index];
        for (const nIndex of vizinhos) {
            const nValor = this.quadro[nIndex];

            if (nValor === 0) {
                // Pode ser mina ou não, aumenta o máximo
                minMax[1]++;
            } else if (this.ehMina(nValor)) {
                // É mina, aumenta mínimo e máximo
                minMax[0]++;
                minMax[1]++;
            }
        }
    }

    /**
     * Verifica se é possível atribuir um valor único de minas para cada caixa.
     * @param minasPorCaixa Array de tuplas [min, max] para cada uma das 6 caixas.
     * @param usadoMask Um inteiro usado como máscara de bits (default 0).
     * @param index O índice da caixa atual na recursão.
     */
    static testarMinasCaixasUnicas(
        minasPorCaixa: [number, number][], 
        usadoMask: number = 0, 
        index: number = 0
    ): boolean {
        // Caso base: todas as caixas foram preenchidas com sucesso
        if (index === minasPorCaixa.length) {
            return true;
        }

        const min = minasPorCaixa[index][0];
        const max = minasPorCaixa[index][1];

        // Tenta cada valor possível dentro do intervalo da caixa atual
        for (let v = min; v <= max; v++) {
            const bit = 1 << v; // Cria um bit na posição do valor 'v'

            // Verifica se o bit 'v' já está ocupado na máscara (equivalente ao .has())
            if (!(usadoMask & bit)) {
                // Tenta resolver a próxima caixa.
                // Passamos (usadoMask | bit) que "ativa" o bit do valor atual.
                // O backtrack é implícito: não alteramos o 'usadoMask' desta iteração,
                // apenas passamos um novo valor para a próxima chamada.
                if (this.testarMinasCaixasUnicas(minasPorCaixa, usadoMask | bit, index + 1)) {
                    return true;
                }
            }
        }

        return false;        
    }

    verificaQuadro(): boolean {
        const quadro = this.quadro!;
        // chamado 1 vez para o quadro todo

        this.minasQuadro[0] = 0;
        this.minasQuadro[1] = 0;
        // Verificar se é um campo minado válido até agora
        // - Cada célula que não é mina, o número nela indica quantas minas estão adjacentes a ela
        // - Cada caixa 2x3 possui um número de minas diferente
        for(let i = 0; i < 6; i++) {
            let caixaMinMax = this.minasPorCaixa[i];
            caixaMinMax[0] = 0;
            caixaMinMax[1] = 0;
        }
        for(let index = 0; index < quadro.length; index++) {
            let minaMinMax = this.minasPorCelula[index]; 
            minaMinMax[0] = 0;
            minaMinMax[1] = 0;

            const v = quadro[index];
            const py = Math.floor(index / 6);
            const px = Math.floor(index % 6);

            const caixaIndex = Math.floor(px / 3) + Math.floor(py / 2) * 2;
            const caixaMinMax = this.minasPorCaixa[caixaIndex];
            if(this.ehMina(v)) {
                caixaMinMax[0] += 1; // minasContadas
                this.minasQuadro[0] += 1;

                caixaMinMax[1] += 1; // minasMaximas
                this.minasQuadro[1] += 1;
            } else if(v === 0) {
                caixaMinMax[1] += 1; // minasMaximas
                this.minasQuadro[1] += 1;
            }

            if(this.ehMina(v)) continue;

            this.contarMinasAdjacentes(px, py, minaMinMax);

            if(v === 0) continue;

            const nValor = this.valorSudoku(v);
            if(nValor < minaMinMax[0] || nValor > minaMinMax[1]) {
                // Inválido pois o número da célula não bate com o mínimo/máximo de minas adjacentes
                return false;
            }
        }

        if(TOTAL_MINAS < this.minasQuadro[0] || TOTAL_MINAS > this.minasQuadro[1]) {
            // Inválido pois já tem mais minas do que o total permitido ou não tem mais espaço para atingir o total
            return false;
        }

        if(!RegrasSudokuMinado.testarMinasCaixasUnicas(this.minasPorCaixa)) {
            // Inválido pois não é possível atribuir um número único de minas para cada caixa
            return false;
        }
        
        return true;
    }

    verificaCelula(possibs: Possib): boolean {
        const quadro = this.quadro!;
        const index = possibs.index;
        
        // Se já foi escolhido no quadro, só tem aquela opção disponível
        if(quadro[index] !== 0) {
            possibs.resetar(false);
            possibs.marcar(quadro[index] - 1);
            return true;
        }

        // 1. Regras Sudoku
        const vizinhosSudoku = SUDOKU_MAP[index];
        for(const nIndex of vizinhosSudoku) {
            const quadroV = this.valorSudoku(quadro[nIndex]);
            if(quadroV !== 0) {
                // Não pode com e sem mina
                possibs.desmarcar(quadroV - 1);
                possibs.desmarcar(quadroV - 1 + 6);
            }
        }

        // 2. Ajusta as possibilidades baseado no número que deve estar na célula caso não seja mina
        const minaMinMax = this.minasPorCelula[index];
        for(let v = 1; v <= 6; v++) {
            if(v < minaMinMax[0] || v > minaMinMax[1]) {
                // Caso seja sem mina, não é possível ter esse número pois não bate com o mínimo/máximo de minas adjacentes
                possibs.desmarcar(v - 1);
                // Não afeta o caso com mina
            }
        }

        // Se alguma célula ao redor não é mina e está completa, isto é, o número de minas já foi atingido, então esta aqui não pode ser mina
        let podeSerMina = true;

        const vizinhos = ADJACENTES[index];
        for (const nIndex of vizinhos) {
            const nValor = quadro[nIndex];

            if (nValor === 0) continue; // não sabemos ainda

            if (!this.ehMina(nValor)) {
                const nMinasAdjacentes = this.valorSudoku(nValor);
                const nMinaMinMax = this.minasPorCelula[nIndex];
                if (nMinaMinMax[0] === nMinasAdjacentes) {
                    // Já atingiu o número de minas adjacentes, esta célula não pode ser mina
                    podeSerMina = false;
                    break;
                }
            }
        }
        if (!podeSerMina) {
            // Não pode ser mina, desabilita todas as possibilidades com mina
            for (let v = 7; v <= 12; v++) {
                possibs.desmarcar(v - 1);
            }
        }

        return true;
    }

    gerarRegrasFn(): (quadro: number[], possibs: Possib | null) => boolean {
        return (quadro: number[], possibs: Possib | null): boolean => {
            this.quadro = quadro;
            if(possibs === null) {
                // chamado 1 vez para o quadro todo
                return this.verificaQuadro();
            } else {
                // chamado para cada célula
                return this.verificaCelula(possibs);
            }
        };
    }


    printarQuadro(): void {
        let line = "";
        for (let i = 0; i < this.quadro.length; i++) {
            const v = this.quadro[i];
            let s = "";
            if(v === 0) {
                s = ". ";
            } else if(this.ehMina(v)) {
                s = `*${this.valorSudoku(v)} `;
            } else {
                s = `${v} `;
            }

            line += s;

            if ((i + 1) % 3 === 0) {
                line += " ";
            }

            if ((i + 1) % 6 === 0) {
                line += " ";
            }

            if ((i + 1) % 36 === 0) {
                console.log(line);
                line = "";
                continue;
            }
            if ((i + 1) % 12 === 0) {
                console.log(line);
                line = "";
            }
        }
    }
}

export type WorkerTaskValue = {
    solucao?: number[];
    iter: number;
    depth: number;
};