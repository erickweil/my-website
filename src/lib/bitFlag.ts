export interface IBitFlag {
    /** Número total de flags que a instância pode representar.
     * Por exemplo, se nFlags for 9, a instância pode representar flags de 0 a 8 (total de 9 flags).
     * Se nFlags for 32, pode representar flags de 0 a 31.
     * Se nFlags for 33, pode representar flags de 0 a 32, e assim por diante.
     */
    nFlags: number;
    /** retorna o número de flags que estão ativas (marcadas como verdadeiras). */
    contar(): number;
    /** copia o estado das flags de outra instância do mesmo tipo e número de flags. */
    receber(outro: IBitFlag): void;
    /** preenche todas as flags com o valor booleano fornecido (true para marcar todas, false para desmarcar todas). */
    resetar(valor: boolean): void;
    /** ativa a flag na posição n (0-indexada). */
    marcar(n: number): void;
    /** desativa a flag na posição n (0-indexada). */
    desmarcar(n: number): void;
    /** retorna o valor booleano da flag na posição n (true se marcada, false se desmarcada). */
    ler(n: number): boolean;
}

export const newBitFlag = (nFlags: number): IBitFlag => {
    if (nFlags <= 32) {
        return new BitFlag32(nFlags);
    } else {
        return new BitFlagArray(nFlags);
    }
};

export class BitFlag32 implements IBitFlag {
    public nFlags: number;
    private flags: number;

    constructor(nFlags: number) {
        if (nFlags > 32) {
            throw new Error("BitFlag32 suporta no máximo 32 flags.");
        }
        this.nFlags = nFlags;
        this.flags = 0;
    }

    contar(): number {
        let n = this.flags;
        n = n - ((n >>> 1) & 0x55555555);
        n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
        return Math.imul((n + (n >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
    }

    receber(outro: IBitFlag): void {
        if (this.nFlags !== outro.nFlags || !(outro instanceof BitFlag32)) {
            throw new Error("As instâncias devem ter o mesmo número de flags e mesmo tipo para receber.");
        }
        this.flags = outro.flags;
    }

    resetar(valor: boolean): void {
        //this.flags = valor ? (1 << this.nFlags) - 1 : 0;
        // Se nFlags for 32, (32 - 32) é 0. (-1 >>> 0) resulta em 0xFFFFFFFF (todos os 32 bits ligados)
        // Se nFlags for 3, (32 - 3) é 29. (-1 >>> 29) resulta em 7 (0b111)
        this.flags = valor ? (-1 >>> (32 - this.nFlags)) : 0;
    }

    marcar(n: number): void {
        this.flags |= (1 << n);
    }

    desmarcar(n: number): void {
        this.flags &= ~(1 << n);
    }

    ler(n: number): boolean {
        return (this.flags & (1 << n)) !== 0;
    }
}

export class BitFlagArray implements IBitFlag {
    public nFlags: number;
    private flags: Uint32Array;

    constructor(nFlags: number) {
        this.nFlags = nFlags;
        
        // Cada índice do Uint32Array guarda 32 bits. 
        // Math.ceil garante o espaço necessário para todas as flags.
        this.flags = new Uint32Array(Math.ceil(nFlags / 32));
    }

    /**
     * Retorna quantos elementos estão marcados como verdadeiros (bit 1).
     * Utiliza o algoritmo SWAR (SIMD Within A Register) / Hamming Weight, 
     * que conta os bits na velocidade do hardware em tempo O(1) por bloco de 32 bits.
     */
    public contar(): number {
        let count = 0;
        for (let i = 0; i < this.flags.length; i++) {
            let n = this.flags[i];
            n = n - ((n >>> 1) & 0x55555555);
            n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
            // Usamos Math.imul para uma multiplicação inteira rápida de 32 bits
            count += (Math.imul((n + (n >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24);
        }
        return count;
    }

    public receber(outro: IBitFlag): void {
        if (this.nFlags !== outro.nFlags || !(outro instanceof BitFlagArray)) {
            throw new Error("As instâncias devem ter o mesmo número de flags e mesmo tipo para receber.");
        }

        this.flags.set(outro.flags);
    }

    public resetar(valor: boolean): void {
        if (!valor) {
            this.flags.fill(0); // Zera todos os bits
            return;
        }

        // Preenche tudo com 1s (0xFFFFFFFF é o máximo para 32 bits unsigned)
        this.flags.fill(0xFFFFFFFF);
        
        // Remove o excesso de 1s do último bloco, para que contar() não conte bits
        // além do nFlags estipulado.
        const remainder = this.nFlags & 31; // Equivalente a nFlags % 32
        if (remainder !== 0) {
            // Cria uma máscara apenas com a quantidade de '1's do resto
            this.flags[this.flags.length - 1] = (1 << remainder) - 1;
        }
    }

    public marcar(n: number): void {
        const arrayIndex = n >>> 5; // Equivalente a Math.floor(n / 32)
        const bitIndex = n & 31;    // Equivalente a n % 32

        this.flags[arrayIndex] |= (1 << bitIndex);  // Liga o bit
    }

    public desmarcar(n: number): void {
        const arrayIndex = n >>> 5; // Equivalente a Math.floor(n / 32)
        const bitIndex = n & 31;    // Equivalente a n % 32

        this.flags[arrayIndex] &= ~(1 << bitIndex); // Desliga o bit
    }

    public ler(n: number): boolean {        
        const arrayIndex = n >>> 5;
        const bitIndex = n & 31;
        
        return (this.flags[arrayIndex] & (1 << bitIndex)) !== 0;
    }
}