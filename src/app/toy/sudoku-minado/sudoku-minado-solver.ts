// Valor 0 representa escolha ainda não feita
// Valores 1-6 representam números escolhidos sem mina
// Valores 7-12 representam números escolhidos com mina

import { PencilmarkSolver, Possib } from "@/lib/pencilmark";

function valorSudoku(v: number): number {
    if(v > 6) return v - 6;
    return v;
}

function ehMina(v: number): boolean {
    return v > 6;
}

function contarMinasAdjacentes(quadro: number[], px: number, py: number): [number, number] {
    let minasAdjMin = 0;
    let minasAdjMax = 0;
    for(let dx = -1; dx <= 1; dx++) {
        for(let dy = -1; dy <= 1; dy++) {
            const nx = px + dx;
            const ny = py + dy;
            if(nx < 0 || nx >= 6 || ny < 0 || ny >= 6) continue;
            if(nx === px && ny === py) continue;

            const nValor = quadro[ny * 6 + nx];
            if(nValor === 0) {
                // Pode ser mina ou não, aumenta o máximo
                minasAdjMax++;
            } else if(ehMina(nValor)) {
                // É mina, aumenta mínimo e máximo
                minasAdjMin++;
                minasAdjMax++;
            }
        }
    }

    return [minasAdjMin, minasAdjMax];
}

export function regrasSudokuMinado(quadro: number[], possibs: Possib | null): boolean {
    if(possibs === null) {
        // chamado 1 vez para o quadro todo

        // Verificar se é um campo minado válido até agora
        // - Cada célula que não é mina, o número nela indica quantas minas estão adjacentes a ela
        // - Cada caixa 2x3 possui um número de minas diferente
        const minasPorCaixa: Map<number, [number, number]> = new Map(); // chave = indice, valor = [minasContadas, minasMaximas]
        for(let i = 0; i < 6; i++) {
            minasPorCaixa.set(i, [0, 0]);
        }
        for(let index = 0; index < quadro.length; index++) {
            const v = quadro[index];
            const py = Math.floor(index / 6);
            const px = Math.floor(index % 6);

            const caixaIndex = Math.floor(px / 3) + Math.floor(py / 2) * 2;
            const caixaMinMax = minasPorCaixa.get(caixaIndex)!;
            if(ehMina(v)) {
                caixaMinMax[0] += 1; // minasContadas
                caixaMinMax[1] += 1; // minasMaximas
            } else if(v === 0) {
                caixaMinMax[1] += 1; // minasMaximas
            }

            if(v === 0 || ehMina(v)) continue;

            const [minasAdjMin, minasAdjMax] = contarMinasAdjacentes(quadro, px, py);
            const nValor = valorSudoku(v);

            if(nValor < minasAdjMin || nValor > minasAdjMax) {
                // Inválido
                return false;
            }
        }

        /*// Em vez de verificar se tem 1 mina por cada caixa, a regra é que são no máximo 21 minas.
        if(minasTotal > 21) {
            // Inválido
            return false;
        }*/

        // Verificar se alguma caixa 2x3 possui o mesmo número de minas
        const contados: Set<number> = new Set();
        for(const [minasContadas, minasMaximas] of minasPorCaixa.values()) {
            if(minasContadas === 0 || minasContadas !== minasMaximas) continue;
            if(contados.has(minasContadas)) {
                // Inválido
                return false;
            }
            contados.add(minasContadas);
        }
        
        return true;
    }

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
        const quadroV = valorSudoku(quadro[y * 6 + px]);
        if(quadroV !== 0) {
            // Não pode com e sem mina
            possibs.p[quadroV - 1] = false;
            possibs.p[quadroV - 1 + 6] = false;
        }
    }

    // Linhas
    for(let x = 0; x < 6; x++) {
        if(x === px) continue;
        const quadroV = valorSudoku(quadro[py * 6 + x]);
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
            const quadroV = valorSudoku(quadro[y * 6 + x]);
            if(quadroV !== 0) {
                // Não pode com e sem mina
                possibs.p[quadroV - 1] = false;
                possibs.p[quadroV - 1 + 6] = false;
            }
        }
    }

    
    /*
    // Regras Campo Minado
    // Algumas regras do campo minado se aplicam: Se uma célula não é uma mina, o número nela indica quantas minas estão adjacentes a ela (até 8 vizinhos). Além disso, não irá expandir células vazias ao clicar nelas.
        
    // 1. Verifica se é possível ou não que a célula seja uma mina, por contar o min/max de minas adjacentes 
    // (Tem que lembrar que a célula atual não foi contada pois está sem marcar, então se for mina, o número de minas adjacentes aumentaria em 1)
    // Cada vizinho, possui seu máximo/mínimo de minas adjacentes, 
    let minaOuNao = 0; // 0 = não decidido, 1 = pode ser mina, -1 = não pode ser mina
    for(let dx = -1; dx <= 1; dx++) {
        for(let dy = -1; dy <= 1; dy++) {
            const nx = px + dx;
            const ny = py + dy;
            if(nx < 0 || nx >= 6 || ny < 0 || ny >= 6) continue;
            if(nx === px && ny === py) continue;

            const nValor = quadro[ny * 6 + nx];
            if(ehMina(nValor)) {
                continue; // Já é mina, não dá para saber nada
            }
            const [
                minasAdjMin, // Número de minas adjacentes que estão marcadas
                minasAdjMax  // Número máximo de minas adjacentes possíveis
            ] = contarMinasAdjacentes(quadro, nx, ny);

            if(nValor === 0) {
                // Célula não definida, 
                if(minasAdjMin + 1 > minasAdjMax) {
                    // Se for mina, o mínimo de minas adjacentes do vizinho ultrapassa o máximo possível
                    minaOuNao = -1;
                    break;
                }
            } else {
                // Célula definida com número indicando quantas minas adjacentes deveriam existir
                const nMinasAdjacentes = valorSudoku(nValor);

                // Se o número de minas adjacentes for igual ao número na célula, completou.
                if(minasAdjMin + 1 > nMinasAdjacentes) {
                    // Não pode ser mina
                    minaOuNao = -1;
                    break;
                }

                // Se só falta essa para completar, precisa ser mina para o vizinho atingir o número correto
                if(minasAdjMin + 1 === nMinasAdjacentes && minasAdjMin + 1 === minasAdjMax) {
                    // Precisa ser mina
                    minaOuNao = 1;
                    break;
                }
            }
        }
        if(minaOuNao !== 0) break;
    }
    
    if(minaOuNao === -1) {
        // Não pode ser mina, desabilita todas as possibilidades com mina
        for(let v = 7; v <= 12; v++) {
            possibs.p[v - 1] = false;
        }
    } else if(minaOuNao === 1) {
        // Precisa ser mina, desabilita todas as possibilidades sem mina
        for(let v = 1; v <= 6; v++) {
            possibs.p[v - 1] = false;
        }
    }*/

    // 2. Ajusta as possibilidades baseado no número que deve estar na célula caso não seja mina
    const [minasAdjMin, minasAdjMax] = contarMinasAdjacentes(quadro, px, py);
    for(let v = 1; v <= 6; v++) {
        if(v < minasAdjMin || v > minasAdjMax) {
            // Caso seja sem mina, não é possível ter esse número pois não bate com o mínimo/máximo de minas adjacentes
            possibs.p[v - 1] = false;
            // Não afeta o caso com mina
        }
    }

    return true;
}

export function printarQuadro(quadro: number[]): void {
    let line = "";
    for (let i = 0; i < quadro.length; i++) {
        const v = quadro[i];
        let s = "";
        if(v === 0) {
            s = ". ";
        } else if(ehMina(v)) {
            s = `*${valorSudoku(v)} `;
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
        if ((i + 1) % 9 === 0) {
            console.log(line);
            line = "";
        }
    }
}