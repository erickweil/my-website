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

export class Possib {
    index: number;
    p: boolean[];

    constructor(index: number, nPossibs: number) {
        this.index = index;
        // Começa com todas as possibilidades são possíveis
        this.p = new Array(nPossibs).fill(true);
    }

    contar(): number {
        let n = 0;
        for (let i = 0; i < this.p.length; i++) {
            if (this.p[i]) n++;
        }
        return n;
    }

    receber(outro: Possib): void {
        this.index = outro.index;
        for (let i = 0; i < this.p.length; i++) {
            this.p[i] = outro.p[i];
        }
    }

    resetar(valor: boolean): void {
        this.p.fill(valor);
    }
}

export type RegrasQuadro = (quadro: number[], possibs: Possib | null) => boolean;
export type ProgressCallback = (iter: number, depth: number) => void;

function printarPossib(quadro_possib: Possib[]): void {
    let line = "";
    for (let i = 0; i < quadro_possib.length; i++) {
        const p = quadro_possib[i];
        let s = "[";
        for (let k = 0; k < p.p.length; k++) {
            s += p.p[k] ? `${k + 1} ` : "  ";
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
    const p = new Possib(-1, nPossibs);
    const min_p = new Possib(-1, nPossibs);
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
        if (min_cont === -1 || cont < min_cont || (cont === min_cont && Math.random() < 0.5)) {
            min_cont = cont;
            min_p.receber(p);
        }

        if (min_cont <= 0) return false;
    }

    if(min_cont === -1) {
        // Não encontrou nenhum vazio, ou seja, o quadro está completo e válido
        return true;
    } else if (min_cont <= 0) {
        // Encontrou um quadrado vazio sem possibilidades, ou seja, o quadro é inválido
        return false;
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
 */
function solucionarQuadro(
    quadro: number[],
    nPossibs: number,
    regrasfn: RegrasQuadro,
    progressCallback?: ProgressCallback,
    maxSolucoes: number = 1
) {
    const stats = { 
        iter: 0, 
        maxSolucoes: maxSolucoes,
        solucoes: [] as number[][],
    };
    _solucionarQuadro(0, stats, quadro, nPossibs, regrasfn, progressCallback);
    return stats;
}

function _solucionarQuadro(
    depth: number,
    stats: { iter: number, solucoes: number[][], maxSolucoes: number },
    quadro: number[],
    nPossibs: number,
    regrasfn: RegrasQuadro,
    progressCallback?: ProgressCallback
): boolean {
    stats.iter++;
    if (stats.iter % 5000 === 0 && progressCallback && Math.random() < 0.25) {
        // Assim outras promessas concorrentes podem avançar
        // await new Promise(resolve => setTimeout(resolve, 0));        
        progressCallback(stats.iter, depth);
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
    const offset = Math.floor(Math.random() * p.p.length);
    for (let i = 0; i < p.p.length; i++) {
        const k = (offset + i) % p.p.length;
        // Se é possível colocar o valor k neste quadrado
        if (p.p[k]) {
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
        const quantos = p instanceof Possib ? p.contar() : 0;

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