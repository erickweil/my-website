export type CrossoverOperator<G> = (childA: G, childB: G, parentA: G, parentB: G) => void;

export function crossoverUniformOperator<G extends Array<unknown>>(size: number): CrossoverOperator<G> {
    return (childA: G, childB: G, parentA: G, parentB: G) => {
        for (let i = 0; i < size; i++) {
            if (Math.random() < 0.5) {
                childA[i] = parentA[i];
                childB[i] = parentB[i];
            } else {
                childA[i] = parentB[i];
                childB[i] = parentA[i];
            }
        }
    };
}

export function crossover1PointOperator<G extends Array<unknown>>(size: number): CrossoverOperator<G> {
    return (childA: G, childB: G, parentA: G, parentB: G) => {
        const crossoverPoint = Math.floor(Math.random() * size);
        for(let i = 0; i < size; i++) {
            if (i < crossoverPoint) {
                childA[i] = parentA[i];
                childB[i] = parentB[i];
            } else {
                childA[i] = parentB[i];
                childB[i] = parentA[i];
            }
        }
    };
}

export function crossover2PointOperator<G extends Array<unknown>>(size: number): CrossoverOperator<G> {
    return (childA: G, childB: G, parentA: G, parentB: G) => {
        let point1 = Math.floor(Math.random() * size);
        let point2 = Math.floor(Math.random() * size);
        while (point2 === point1) {
            point2 = Math.floor(Math.random() * size);
        }
        if (point1 > point2) { 
            const t = point1; 
            point1 = point2;
            point2 = t; 
        }

        for (let i = 0; i < size; i++) {
            if (i >= point1 && i < point2) {
                childA[i] = parentB[i];
                childB[i] = parentA[i];
            } else {
                childA[i] = parentA[i];
                childB[i] = parentB[i];
            }
        }
    };
}

export function crossoverOX1Operator<G extends Array<unknown>, K = G[number]>(size: number, getIndex: (gene: K) => number): CrossoverOperator<G> {
    const markedA = Array.from({ length: size }, () => 0);
    const markedB = Array.from({ length: size }, () => 0);
    let epoch = 0;
    /**
     * https://en.wikipedia.org/wiki/Crossover_(evolutionary_algorithm)
     * Order crossover (OX1)
     * 
        1. select a random slice of consecutive genes from parent 1
        2. copy the slice to child 1 and mark out the genes in parent 2
        3. starting from the right side of the slice, copy genes from parent 2 as they appear to child 1 if they are not yet marked out.
     */
    return (childA: G, childB: G, parentA: G, parentB: G) => {
        const stamp = ++epoch;

        let crossoverPoint1 = Math.floor(Math.random() * size);
        let crossoverPoint2 = Math.floor(Math.random() * size);
        while(crossoverPoint2 === crossoverPoint1) {
            crossoverPoint2 = Math.floor(Math.random() * size);
        }
        if (crossoverPoint1 > crossoverPoint2) {
            let temp = crossoverPoint1;
            crossoverPoint1 = crossoverPoint2;
            crossoverPoint2 = temp;
        }

        // Copia o segmento selecionado de A para o filho A e de B para o filho B
        for(let i = crossoverPoint1; i <= crossoverPoint2; i++) {
            let geneA = parentA[i]; childA[i] = geneA; markedA[getIndex(geneA as K)] = stamp;
            let geneB = parentB[i]; childB[i] = geneB; markedB[getIndex(geneB as K)] = stamp;
        }

        let indexParentB = (crossoverPoint2 + 1) % size;
        let indexChildA  = indexParentB;

        let indexParentA = (crossoverPoint2 + 1) % size;
        let indexChildB  = indexParentA;
        for(let i = 0; i < size; i++) {
            // Preenche o filho A com os genes de B, na ordem em que aparecem, ignorando os já copiados
            const geneA = parentB[indexParentB];
            if (markedA[getIndex(geneA as K)] !== stamp) {
                childA[indexChildA] = geneA;
                indexChildA = (indexChildA + 1) % size;
            }

            indexParentB = (indexParentB + 1) % size;

            // Preenche o filho B com os genes de A, na ordem em que aparecem, ignorando os já copiados
            const geneB = parentA[indexParentA];
            if (markedB[getIndex(geneB as K)] !== stamp) {
                childB[indexChildB] = geneB;
                indexChildB = (indexChildB + 1) % size;
            }

            indexParentA = (indexParentA + 1) % size;
        }
    };
}