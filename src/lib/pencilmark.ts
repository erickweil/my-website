/**
Algoritmo para solucionar Sudoku e outros problemas que imita uma forma de resolver à mão

Basicamente a forma mais simples é se analisar todo o quadro marcando (Pencil mark) que possibilidades 
cada quadrado possui, de acordo com as regras do jogo. Então provavelmente haverá uma opção
com apenas uma possibilidade, escolhe esta possibilidade e continua o processo até resolver todo o quadro.

Porém, é possível que não exista nenhuma opção com apenas uma possibilidade, neste caso se utiliza da
técnica de backtracking, basicamente a diferença entre este método e o método backtracking é que 
a busca é feita escolhendo quadrados com o menor número de possibilidades e não apenas linearmente. Isto
proporciona uma melhora de desempenho, tanto que em problemas fáceis resolve em apenas algumas centenas de iterações
(E em problemas difíceis pode demorar tanto quanto o método backtracking comum)
 * 
 * Traduzido de implementação em Go: https://github.com/erickweil/horariogen/blob/develop/pencilmark/possibilidades.go
 */

import { IBitFlag, newBitFlag } from "./bitFlag";

export interface Possib extends IBitFlag {
    index: number;
}

export const newPossib = (index: number, nPossibs: number) => {
    const possib = newBitFlag(nPossibs) as Possib;
    possib.index = index;
    return possib as Possib;
};

export type RegrasQuadro = (quadro: number[], possibs: Possib | null) => boolean;
export type ProgressCallback = (iter: number, depth: number) => void;

function printarPossib(quadro_possib: Possib[]): void {
    let line = "";
    for (let i = 0; i < quadro_possib.length; i++) {
        const p = quadro_possib[i];
        let s = "[";
        for (let k = 0; k < p.nFlags; k++) {
            s += p.ler(k) ? `${k + 1} ` : "  ";
        }
        line += s.trimEnd() + "], ";

        if ((i + 1) % 9 === 0) {
            console.log(line);
            line = "";
        }
    }
}

// Ao mesmo tempo que analisa as possibilidades, encontra a com menor entropia
function obterMelhorPossib(quadro: number[], nPossibs: number, regrasfn: RegrasQuadro): Possib | boolean {
    const p = newPossib(-1, nPossibs);
    const min_p = newPossib(-1, nPossibs);
    const randomIndex = Math.floor(Math.random() * quadro.length);
    let min_cont = -1;

    // Atualizar cache
    if(!regrasfn(quadro, null)) {
        return false;
    }

    for (let index = 0; index < quadro.length; index++) {
        if (quadro[index] !== 0) continue;

        p.resetar(true);
        p.index = index;
        if(!regrasfn(quadro, p)) {
            return false;
        }

        const cont = p.contar();
        if(cont === 0) {
            // Encontrou um quadrado vazio sem possibilidades, ou seja, o quadro é inválido
            return false;
        }

        if (min_cont === -1 || cont < min_cont) {
            min_cont = cont;
            min_p.receber(p);
            min_p.index = p.index;
        } else if(cont === min_cont) {
            // Se tiver a mesma entropia, escolhe o mais próximo do índice aleatório para diversificar as soluções
            if(Math.abs(index - randomIndex) < Math.abs(min_p.index - randomIndex)) {    
                min_p.receber(p);
                min_p.index = p.index;
            }
        }
    }

    if(min_cont === -1) {
        // Não encontrou nenhum vazio, ou seja, o quadro está completo e válido
        return true;
    }

    return min_p;
}

function getRandomRange(n: number): number[] {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/*
// NÃO: Parece que deixou mais lento. (Investigar melhor)
async function solucionarQuadroConcorrente(
    quadro: number[],
    nPossibs: number,
    regrasfn: RegrasQuadro,
    progressCallback?: ProgressCallback,
    maxSolucoes: number = 1,
    nPromessas: number = 1
) {
    // Inicia N promessas concorrentes para solucionar o quadro, e retorna a primeira que resolver
    const result = await Promise.race(Array.from({ length: nPromessas }, () => {
        const quadroCopy = [...quadro];
        const stats = {
            iter: 0,
            maxSolucoes: maxSolucoes,
            solucoes: [] as number[][],
        };
        return _solucionarQuadro(0, stats, quadroCopy, nPossibs, regrasfn, progressCallback)
            .then(() => stats)
    }));

    return result;
}*/

/**
 * Resolve o quadro retornando o número de iterações e se obteve sucesso.
 * @param [baseIter] irá começar em 2^baseIter a iteração (31 para desativar)
 */
function solucionarQuadro(
    quadro: number[],
    nPossibs: number,
    regrasfn: RegrasQuadro,
    progressCallback?: ProgressCallback,
    maxSolucoes: number = 1,
    baseIter: number = 10
) {
    /*const stats = { 
        iter: 0, 
        maxSolucoes: maxSolucoes,
        solucoes: [] as number[][],
    };
    _solucionarQuadro(0, stats, quadro, nPossibs, regrasfn, progressCallback);
    return stats;*/

    // reinício a cada 2^N iterações para evitar ficar preso em um caminho ruim por muito tempo
    const solucoes = [] as number[][];
    const stats = {
        iter: 0,
        maxSolucoes: maxSolucoes,
        solucoes: solucoes,
        maxIter: undefined as number | undefined
    };
    for(let iter = baseIter; iter < 32; iter++) {
        const quadroCopy = [...quadro];
        stats.maxIter = iter < 31 ? (1 << iter) : undefined;
        _solucionarQuadro(0, stats, quadroCopy, nPossibs, regrasfn, progressCallback);

        if(solucoes.length >= maxSolucoes) {
            // Obteve sucesso, retorna as soluções encontradas
            return stats;
        }
    }

    return stats;
}

function _solucionarQuadro(
    depth: number,
    stats: { iter: number, solucoes: number[][], maxSolucoes: number, maxIter?: number },
    quadro: number[],
    nPossibs: number,
    regrasfn: RegrasQuadro,
    progressCallback?: ProgressCallback
): boolean {
    stats.iter++;
    if (stats.iter % 1000 === 0 && Math.random() < 0.25) {

        if(stats.maxIter && stats.iter > stats.maxIter) {
            return true;
        }
        
        if(stats.iter % 10000 === 0 && progressCallback) {
            progressCallback(stats.iter, depth);
        }
    }

    const p = obterMelhorPossib(quadro, nPossibs, regrasfn);
    if(p === true) {
        stats.solucoes.push([...quadro]);
        return stats.solucoes.length >= stats.maxSolucoes;
    } else if (!p) {
        return false;
    }

    // Uma vez escolhido o quadrado a partir do qual continuar,
    // testa cada possibilidade deste quadrado
    //const randRange = getRandomRange(p.p.length);
    //for (const k of randRange) {

    // Percorre os k valores em ordem circular a partir de um offset aleatório
    const offset = Math.floor(Math.random() * p.nFlags);
    for (let i = 0; i < p.nFlags; i++) {
        const k = (offset + i) % p.nFlags;
        // Se é possível colocar o valor k neste quadrado
        if (p.ler(k)) {
            quadro[p.index] = k + 1;

            // Não está solucionado ainda, continua tentando
            // Tenta solucionar com mais escolhas depois dessa, e se der certo retorna true
            if (_solucionarQuadro(depth + 1, stats, quadro, nPossibs, regrasfn, progressCallback)) {
                return true;
            }

            // Essa escolha não resolveu o sudoku, remove ela para tentar outras
            quadro[p.index] = 0;
        }
    }

    // Backtracking: Nenhuma escolha foi válida para este quadrado, ou seja, é ímpossível solucionar nesta configuração
    return false;
}

/**
 * A ideia é começar com um quadro resolvido, e ir desmarcando células até onde continue tendo só uma solução
 * Como isso é um processo aleatório, o resultado final pode variar a cada execução, mas sempre será um quadro com solução única
 */
function desmarcarQuadro(
    quadro: number[],
    nPossibs: number,
    regrasfn: RegrasQuadro,
    progressCallback?: ProgressCallback,
    maxSolucoes: number = 1
) {
    const indices = getRandomRange(quadro.length);
    let iter = 0;
    for (const index of indices) {
        const originalValue = quadro[index];
        quadro[index] = 0;

        if (progressCallback) {
            progressCallback(iter++, index);
        }

        const p = obterMelhorPossib(quadro, nPossibs, regrasfn);
        const quantos = typeof p !== "boolean" ? p.contar() : 0;

        // Se não é única a solução, volta o valor
        if (quantos === 0 || quantos > maxSolucoes) {
            quadro[index] = originalValue;
        }
    }
}

export class PencilmarkSolver {
    static solucionarQuadro = solucionarQuadro;
    static printarPossib = printarPossib;
    static desmarcarQuadro = desmarcarQuadro;
}