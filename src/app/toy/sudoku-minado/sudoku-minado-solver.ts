// Valor 0 representa escolha ainda não feita
// Valores 1-6 representam números escolhidos sem mina
// Valores 7-12 representam números escolhidos com mina

import { PencilmarkSolver, Possib } from "@/lib/pencilmark";

export class RegrasSudokuMinado {
    quadro: number[];
    minasPorCaixa: [number, number][];
    minasPorCelula: [number, number][];

    constructor() {
        this.quadro = [];
        this.minasPorCaixa = [];
        this.minasPorCelula = [];
    }

    valorSudoku(v: number): number {
        if(v > 6) return v - 6;
        return v;
    }

    ehMina(v: number): boolean {
        return v > 6;
    }

    contarMinasAdjacentes(px: number, py: number, minMax: [number, number]) {
        for(let dx = -1; dx <= 1; dx++) {
            for(let dy = -1; dy <= 1; dy++) {
                const nx = px + dx;
                const ny = py + dy;
                if(nx < 0 || nx >= 6 || ny < 0 || ny >= 6) continue;
                if(nx === px && ny === py) continue;

                const nValor = this.quadro[ny * 6 + nx];
                if(nValor === 0) {
                    // Pode ser mina ou não, aumenta o máximo
                    minMax[1]++;
                } else if(this.ehMina(nValor)) {
                    // É mina, aumenta mínimo e máximo
                    minMax[0]++;
                    minMax[1]++;
                }
            }
        }
    }

    /**
     * Verifica se é possível atribuir um valor único de 1 a 6 para cada caixa
     * @param minasPorCaixa Array de tuplas [min, max] para cada uma das 6 caixas
     */
    static testarMinasCaixasUnicas(minasPorCaixa: [number, number][], valoresUsados = new Set<number>(), index: number = 0): boolean {
        // Caso base: se chegamos ao fim do array, conseguimos preencher todas
        if (index === minasPorCaixa.length) {
            return true;
        }

        // Tenta cada valor possível dentro do intervalo da caixa atual
        for (let v = minasPorCaixa[index][0]; v <= minasPorCaixa[index][1]; v++) {
            // Se o valor v ainda não foi usado por nenhuma caixa anterior
            if (!valoresUsados.has(v)) {
                // "Marca" o valor como usado
                valoresUsados.add(v);

                // Tenta resolver a próxima caixa com este valor fixado
                if (this.testarMinasCaixasUnicas(minasPorCaixa, valoresUsados, index + 1)) {
                    return true;
                }

                // Se não deu certo, "desmarca" (backtrack) e tenta o próximo valor v
                valoresUsados.delete(v);
            }
        }

        // Se testou todos os valores do intervalo e nenhum serviu
        return false;        
    }

    verificaQuadro(): boolean {
        const quadro = this.quadro!;
        // chamado 1 vez para o quadro todo

        // Verificar se é um campo minado válido até agora
        // - Cada célula que não é mina, o número nela indica quantas minas estão adjacentes a ela
        // - Cada caixa 2x3 possui um número de minas diferente
        for(let i = 0; i < 6; i++) {
            let caixaMinMax = this.minasPorCaixa[i];
            if(!caixaMinMax) {
                this.minasPorCaixa[i] = caixaMinMax = [0, 0];
            }
            caixaMinMax[0] = 0;
            caixaMinMax[1] = 0;
        }
        for(let index = 0; index < quadro.length; index++) {
            let minaMinMax = this.minasPorCelula[index]; 
            if(!minaMinMax) {
                this.minasPorCelula[index] = minaMinMax = [0, 0];
            }
            minaMinMax[0] = 0;
            minaMinMax[1] = 0;

            const v = quadro[index];
            const py = Math.floor(index / 6);
            const px = Math.floor(index % 6);

            const caixaIndex = Math.floor(px / 3) + Math.floor(py / 2) * 2;
            const caixaMinMax = this.minasPorCaixa[caixaIndex];
            if(this.ehMina(v)) {
                caixaMinMax[0] += 1; // minasContadas
                caixaMinMax[1] += 1; // minasMaximas
            } else if(v === 0) {
                caixaMinMax[1] += 1; // minasMaximas
            }

            if(this.ehMina(v)) continue;

            this.contarMinasAdjacentes(px, py, minaMinMax);

            if(v === 0) continue;

            const nValor = this.valorSudoku(v);
            if(nValor < minaMinMax[0] || nValor > minaMinMax[1]) {
                // Inválido
                return false;
            }
        }

        if(!RegrasSudokuMinado.testarMinasCaixasUnicas(this.minasPorCaixa)) {
            // Inválido
            return false;
        }
        
        return true;
    }

    verificaCelula(possibs: Possib): boolean {
        const quadro = this.quadro!;
        const index = possibs.index;
        const py = Math.floor(index / 6);
        const px = Math.floor(index % 6);
        
        // Regras Sudoku
        // Se já foi escolhido no quadro, só tem aquela opção disponível
        if(quadro[index] !== 0) {
            for(let i = 0; i < 12; i++) {
                possibs.p[i] = false;
            }
            possibs.p[quadro[index] - 1] = true;
            return true;
        }

        // Colunas
        for(let y = 0; y < 6; y++) {
            if(y === py) continue;
            const quadroV = this.valorSudoku(quadro[y * 6 + px]);
            if(quadroV !== 0) {
                // Não pode com e sem mina
                possibs.p[quadroV - 1] = false;
                possibs.p[quadroV - 1 + 6] = false;
            }
        }

        // Linhas
        for(let x = 0; x < 6; x++) {
            if(x === px) continue;
            const quadroV = this.valorSudoku(quadro[py * 6 + x]);
            if(quadroV !== 0) {
                // Não pode com e sem mina
                possibs.p[quadroV - 1] = false;
                possibs.p[quadroV - 1 + 6] = false;
            }
        }

        // Verificar quadrado 2x3
        const quadx = Math.floor(px / 3) * 3;
        const quady = Math.floor(py / 2) * 2;
        for(let x = quadx; x < quadx + 3; x++) {
            for(let y = quady; y < quady + 2; y++) {
                if(x === px && y === py) continue;
                const quadroV = this.valorSudoku(quadro[y * 6 + x]);
                if(quadroV !== 0) {
                    // Não pode com e sem mina
                    possibs.p[quadroV - 1] = false;
                    possibs.p[quadroV - 1 + 6] = false;
                }
            }
        }

        // 2. Ajusta as possibilidades baseado no número que deve estar na célula caso não seja mina
        const minaMinMax = this.minasPorCelula[index];
        for(let v = 1; v <= 6; v++) {
            if(v < minaMinMax[0] || v > minaMinMax[1]) {
                // Caso seja sem mina, não é possível ter esse número pois não bate com o mínimo/máximo de minas adjacentes
                possibs.p[v - 1] = false;
                // Não afeta o caso com mina
            }
        }

        // Se alguma célula ao redor não é mina e está completa, isto é, o número de minas já foi atingido, então esta aqui não pode ser mina
        let podeSerMina = true;
        for(let dx = -1; dx <= 1; dx++) {
            for(let dy = -1; dy <= 1; dy++) {
                const nx = px + dx;
                const ny = py + dy;
                if(nx < 0 || nx >= 6 || ny < 0 || ny >= 6) continue;
                if(nx === px && ny === py) continue;

                const nIndex = ny * 6 + nx;
                const nValor = quadro[nIndex];
                if(nValor === 0) continue; // não sabemos ainda

                if(!this.ehMina(nValor)) {
                    const nMinasAdjacentes = this.valorSudoku(nValor);
                    const nMinaMinMax = this.minasPorCelula[nIndex];
                    if(nMinaMinMax[0] === nMinasAdjacentes) {
                        // Já atingiu o número de minas adjacentes, esta célula não pode ser mina
                        podeSerMina = false;
                        break;
                    }
                }
            }
            if(!podeSerMina) break;
        }
        if(!podeSerMina) {
            // Não pode ser mina, desabilita todas as possibilidades com mina
            for(let v = 7; v <= 12; v++) {
                possibs.p[v - 1] = false;
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