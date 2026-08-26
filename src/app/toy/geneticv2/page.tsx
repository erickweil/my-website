"use client";
import { useWasm } from "@/lib/useWasm";
import { useEffect, useState } from "react";

export default function GeneticV2() {
    const wasm = useWasm();
    const size = 50;
    const generationCount = 1000;

    const [cities, setCities] = useState<{ x: number; y: number }[] | undefined>(undefined);

    const [logLines, setLogLines] = useState({ lines: [] as string[] });
    const consoleLog = (...args: unknown[]) => {
        setLogLines((prev) => ({ lines: [...prev.lines, args.map(String).join(" ")] }));
    }
    const consoleClear = () => {
        setLogLines({ lines: [] });
    }
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    useEffect(() => {
        if (!wasm) return; // WASM ainda não carregou
        async function run() {
            const generatedCities = Array.from({ length: size }, () => ({
                x: Math.random(),
                y: Math.random(),
            }));
            setCities(generatedCities);
        }
        run();
    }, [wasm]);

    const runGeneticAlgorithmV1 = async () => {
        if (!wasm || !cities) return null; // WASM ainda não carregou

        consoleClear();
        const cfg = new wasm.GAConfig();
        cfg.population_size = size * 2;
        cfg.crossover_rate = 0.9;
        cfg.mutation_rate = 0.9;
        cfg.mutation_gene_rate = 1 / size;
        cfg.tournament_size = 8;
        cfg.max_stagnation = 50000;
        cfg.diversity_check = false;
        let runner = new wasm.TSPGAProblemRunner(cities, cfg);

        consoleLog("Running Genetic Algorithm V1...");
        await delay(1);
        const timeStart = performance.now();
        runner.run(generationCount);
        const elapsed = performance.now() - timeStart;

        const info = runner.get_info() as { generation: number; best_fitness: number; stagnated_for: number, best_genes: number[] };
        consoleLog(`Genetic Algorithm V1 - Time: ${elapsed.toFixed(2)} ms, Generation: ${info.generation}, Best Fitness: ${info.best_fitness}, Stagnated For: ${info.stagnated_for}`);

        runner.free();
    };

    const runGeneticAlgorithmV2 = async () => {
        if (!wasm || !cities) return null; // WASM ainda não carregou
        consoleClear();

        let citiesArray = new Float64Array(cities.length * 2);
        cities.forEach((city, index) => {
            citiesArray[index * 2] = city.x;
            citiesArray[index * 2 + 1] = city.y;
        });

        consoleLog("Running Genetic Algorithm V1...");
        await delay(1);
        const timeStart = performance.now();
        let result = wasm.run_tsp_v2(citiesArray, generationCount);
        const elapsed = performance.now() - timeStart;
        consoleLog(`Genetic Algorithm V2 - Time: ${elapsed.toFixed(2)} ms - Best Fitness: ${result}`);
    }

    return (
        <div>
            <h1>Genetic Algorithm V2</h1>
            <p>Teste com pacote https://github.com/leimbernon/genetic-algorithms</p>

            <button onClick={runGeneticAlgorithmV1} disabled={!wasm || !cities}>
                Run Genetic Algorithm V1
            </button>
            <button onClick={runGeneticAlgorithmV2} disabled={!wasm || !cities}>
                Run Genetic Algorithm V2
            </button>
            <pre style={{ maxHeight: "300px", overflowY: "auto", backgroundColor: "#f0f0f0", padding: "10px" }}>
                {logLines.lines.join("\n")}
            </pre>
        </div>
    );
}