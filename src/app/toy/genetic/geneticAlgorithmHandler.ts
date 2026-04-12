import { TSPProblem } from "@/lib/genetic/examples/tsp-problem";
import { GAConfig, GeneticAlgorithm } from "@/lib/genetic/ga";
import { GAProblem } from "@/lib/genetic/problem";

export class GeneticAlgorithmHandler {
    problem: GAProblem<object> | null;
    ga: GeneticAlgorithm<object> | null;
    gaConfig: GAConfig<object> | null;

    generation: number;

    constructor() {
        this.ga = null;
        this.problem = null;
        this.gaConfig = null;

        this.generation = 0;
    }

    initialize(problem: GAProblem<object>, config: GAConfig<object>) {
        this.problem = problem;
        this.gaConfig = {
            ...config,
            resetPopulation: false
        };
        this.ga = new GeneticAlgorithm(this.problem, this.gaConfig);
        this.generation = 0;
    }

    runStep() {
        if(!this.ga) return null;
        
        let result;
        const timeStart = performance.now();
        do {
            this.ga.updateConfig(this.gaConfig!);
            
            result = this.ga.run(50);

            this.generation = result.generation;
        } while(performance.now() - timeStart < 10); // limita a execução a ~10ms por passo para manter a UI responsiva

        return result;
    }
}