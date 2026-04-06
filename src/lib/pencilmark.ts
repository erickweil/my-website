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

const getRandomRange = (n: number): number[] => {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

export type RegrasQuadro = (quadro: number[], possibs: Possib | null) => boolean;
export type ProgressCallback = (iter: number, depth: number) => void;

export class PencilmarkSolver {
    regrasfn: RegrasQuadro;
    quadro: number[];
    nPossibs: number;
    maxSolucoes: number;
    maxIter: number | undefined;

    cachePossib: Possib[];
    solucoes: number[][];
    iter: number;
    
    melhor: number[]; // Melhor solução encontrada até agora, mesmo que não seja completa
    melhorPreenchidos: number;
constructor(regrasfn: RegrasQuadro, quadro: number[], nPossibs: number, maxSolucoes: number = 1, maxIter?: number) {
    this.regrasfn = regrasfn;
    this.quadro = quadro;
    this.melhor = [...quadro];
    this.melhorPreenchidos = quadro.filter(v => v !== 0).length;
    this.nPossibs = nPossibs;
    this.maxSolucoes = maxSolucoes;
    this.maxIter = maxIter;
    
    this.cachePossib = [];
    this.solucoes = [];
    this.iter = 0;
}

/*static printarPossib(quadro_possib: Possib[]): void {
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
}*/

// Ao mesmo tempo que analisa as possibilidades, encontra a com menor entropia
private obterMelhorPossib(depth: number): Possib | boolean {
    //const p = newPossib(-1, nPossibs);
    //const min_p = newPossib(-1, nPossibs);
    let p: Possib;
    let min_p: Possib;
    if(this.cachePossib.length < depth * 2 + 2) {
        p = newPossib(-1, this.nPossibs);
        min_p = newPossib(-1, this.nPossibs);
        this.cachePossib.push(p, min_p);
    } else {
        p = this.cachePossib[depth * 2];
        min_p = this.cachePossib[depth * 2 + 1];
    }

    const randomIndex = Math.floor(Math.random() * this.quadro.length);
    let min_cont = -1;
    let preenchidos = 0;

    // Atualizar cache
    if(!this.regrasfn(this.quadro, null)) {
        return false;
    }

    for (let index = 0; index < this.quadro.length; index++) {
        if (this.quadro[index] !== 0) {
            preenchidos++;
            continue;
        }

        p.resetar(true);
        p.index = index;
        if(!this.regrasfn(this.quadro, p)) {
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

    if(preenchidos > this.melhorPreenchidos) {
        this.melhorPreenchidos = preenchidos;
        this.melhor = [...this.quadro];
    }

    if(min_cont === -1) {
        // Não encontrou nenhum vazio, ou seja, o quadro está completo e válido
        return true;
    }

    return min_p;
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
 * @param [baseIter] irá começar em 2^baseIter a iteração (31 ou null para desativar)
 */
static solucionarQuadro(
    quadro: number[],
    nPossibs: number,
    regrasfn: RegrasQuadro,
    progressCallback?: ProgressCallback,
    maxSolucoes: number = 1,
    baseIter: number | null = 10
) {
    /*const stats = { 
        iter: 0, 
        maxSolucoes: maxSolucoes,
        solucoes: [] as number[][],
    };
    _solucionarQuadro(0, stats, quadro, nPossibs, regrasfn, progressCallback);
    return stats;*/
    const solver = new PencilmarkSolver(regrasfn, [], nPossibs, maxSolucoes);

    if(baseIter === null) {
        solver.maxIter = undefined;
        solver.quadro = [...quadro];
        solver._solucionarQuadro(0, progressCallback);
    } else for(let iter = baseIter; iter < 32; iter++) {
        // reinício a cada 2^N iterações para evitar ficar preso em um caminho ruim por muito tempo
        solver.maxIter = iter < 31 ? (1 << iter) : undefined;
        solver.quadro = [...quadro];
        const result = solver._solucionarQuadro(0, progressCallback);

        if(result === false) {
            // Se deu falso, é porque chegou no fim
            break;
        }

        if(solver.solucoes.length >= maxSolucoes) {
            // Obteve sucesso, retorna as soluções encontradas
            break;
        }
    }

    return {
        iter: solver.iter,
        solucoes: solver.solucoes,
        melhor: solver.melhor
    };
}

_solucionarQuadro(
    depth: number,
    progressCallback?: ProgressCallback
): boolean {
    this.iter++;
    if (this.iter % 2048 === 0) {

        if(this.maxIter && this.iter > this.maxIter) {
            return true;
        }
        
        if(progressCallback && Math.random() < 0.05) {
            progressCallback(this.iter, depth);
        }
    }

    const p = this.obterMelhorPossib(depth);
    if(p === true) {
        this.solucoes.push([...this.quadro]);
        return this.solucoes.length >= this.maxSolucoes;
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
            this.quadro[p.index] = k + 1;

            // Não está solucionado ainda, continua tentando
            // Tenta solucionar com mais escolhas depois dessa, e se der certo retorna true
            if (this._solucionarQuadro(depth + 1, progressCallback)) {
                return true;
            }

            // Essa escolha não resolveu o sudoku, remove ela para tentar outras
            this.quadro[p.index] = 0;
        }
    }

    // Backtracking: Nenhuma escolha foi válida para este quadrado, ou seja, é ímpossível solucionar nesta configuração
    return false;
}

/**
 * A ideia é começar com um quadro resolvido, e ir desmarcando células até onde continue tendo só uma solução
 * Como isso é um processo aleatório, o resultado final pode variar a cada execução, mas sempre será um quadro com solução única
 * 
 * Para cada célula removida, resolve o quadro com maxSolucoes=2 para verificar se a solução continua única.
 * Se encontrar mais de uma solução (ou nenhuma), restaura o valor original da célula.
 */
static desmarcarQuadro(
    quadro: number[],
    nPossibs: number,
    regrasfn: RegrasQuadro,
    progressCallback?: ProgressCallback,
) {
    const indices = getRandomRange(quadro.length);
    let iter = 0;
    for (const index of indices) {
        const originalValue = quadro[index];
        quadro[index] = 0;

        if (progressCallback) {
            progressCallback(iter++, index);
        }

        const solver = new PencilmarkSolver(regrasfn, [...quadro], nPossibs, 2, undefined);
        const p = solver.obterMelhorPossib(0);
        const quantos = typeof p !== "boolean" ? p.contar() : 0;
        if (quantos === 0) {
            // Não encontrou nenhuma solução, ou seja, o quadro ficou inválido, avisa
            console.warn(`INCONSISTENTE: Quadro inválido ao remover célula ${index} (valor original: ${originalValue})`);
        }

        if (quantos === 1) {
            // Agora verifica se a solução é única.
            solver._solucionarQuadro(0);
            if (solver.solucoes.length === 0) {
                // Não encontrou nenhuma solução, ou seja, o quadro ficou inválido, avisa
                console.warn(`INCONSISTENTE: Quadro inválido ao remover célula ${index} (valor original: ${originalValue})`)
            }

            if (solver.solucoes.length === 1) {
                // A solução continua única, pode manter a célula vazia
                continue;
            }
        }

        quadro[index] = originalValue;
    }
}

}