"use client";

import { mesclarEstado } from "@/components/Canvas/CanvasController";
import ZoomableCanvas, { ZoomEstadoType } from "@/components/Canvas/ZoomableCanvas";
import NonSSRWrapper from "@/components/nonSSRWrapper";
import { UIEvent, useCallback, useEffect, useRef, useState } from "react";
import { GAConfig, GAProgressEvent, GeneticAlgorithm } from "@/lib/genetic/ga";
import { TSPCity, TSPProblem } from "@/lib/genetic/examples/tsp-problem";
import { useWasm } from "@/lib/useWasm";
import { TSPGAProblemRunner } from "@/pkg/rust_wasm";

type GeneticEstado = ZoomEstadoType & {
    px: number,
    py: number,
    cliques: number,
    cities: TSPCity[],

    ga: GeneticAlgorithm<object> | null;
    wasmRunner: TSPGAProblemRunner | null;
    progress: GAProgressEvent<object> & {
        msPerGeneration?: number;
    } | null;
};


/** Cor de fundo do canvas — fundo escuro para contraste máximo. */
const BG_COLOR     = "#0d1117";
/** Cor das linhas da rota (violet-600, semi-transparente). */
const ROUTE_COLOR  = "rgb(255, 0, 0)";
const ROUTE_COLOR_2  = "rgba(73, 64, 94, 0.25)";

/** Preenchimento das cidades normais (slate-200). */
const CITY_FILL    = "#ffe600";
/** Borda das cidades normais (violet-700). */
const CITY_STROKE  = "rgb(0, 0, 0)";

const CITY_RADIUS  = 7.0;   // raio lógico em px (cidades normais)
const ROUTE_WIDTH  = 2.5;  // espessura da linha em px lógicos

function project(city: TSPCity, canvasLogW: number, canvasLogH: number): { x: number; y: number } {
    const size = Math.min(canvasLogW, canvasLogH) - 32 * 2;
    const ox = (canvasLogW - size) / 2;
    const oy = (canvasLogH - size) / 2;
    return { x: ox + city.x * size, y: oy + city.y * size };
}

function unproject(x: number, y: number, canvasLogW: number, canvasLogH: number): { x: number; y: number } {
    const size = Math.min(canvasLogW, canvasLogH) - 32 * 2;
    const ox = (canvasLogW - size) / 2;
    const oy = (canvasLogH - size) / 2;
    return { x: (x - ox) / size, y: (y - oy) / size };
}

function drawTSPPath(ctx: CanvasRenderingContext2D, cities: { x: number; y: number }[], order: number[]) {
    ctx.beginPath();
    for(let i = 0; i < order.length; i++) {
        const cityIndex = order[i];
        const city = cities[cityIndex];
        const { x, y } = project(city, ctx.canvas.width, ctx.canvas.height);
        if(i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.closePath();
    ctx.stroke();
}

function drawTSP(ctx: CanvasRenderingContext2D, ga: GeneticAlgorithm<number[]> | null, progress: GAProgressEvent<number[]> | null) {
    if(!ga || !progress) return;
    const problem = ga.problem as TSPProblem;

    ctx.strokeStyle = ROUTE_COLOR_2;
    ctx.lineWidth = 0.5;
    for(let i = 0; i < ga.population.length && i < 10; i++) {
        const individual = ga.population[i];
        drawTSPPath(ctx, problem.cities, individual.genes);
    }
    
    // Desenha as linhas da rota
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = ROUTE_WIDTH;
    drawTSPPath(ctx, problem.cities, progress.genes);


    // Desenha as cidades
    for(let city of problem.cities) {
        const { x, y } = project(city, ctx.canvas.width, ctx.canvas.height);

        ctx.beginPath();
        ctx.arc(x, y, CITY_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = CITY_FILL;
        ctx.fill();
        ctx.strokeStyle = CITY_STROKE;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}

export default function Genetic() {
    const wasm = useWasm();
    const [solver, setSolver] = useState<"ts" | "wasm">("ts");

    return <div className="h-screen max-h-screen w-full flex flex-row overflow-hidden">
        {/* Painel de controle fixo no canto superior direito */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2 bg-white/80 backdrop-blur rounded-lg px-3 py-2 shadow text-sm font-medium select-none">
            <span className={solver === "ts" ? "font-bold" : "text-gray-400"}>TS</span>
            <button
                onClick={() => setSolver(s => s === "ts" ? "wasm" : "ts")}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${solver === "wasm" ? "bg-violet-600" : "bg-gray-300"} ${!wasm && solver === "ts" ? "" : ""}`}
                title={!wasm ? "WASM ainda carregando..." : undefined}
            >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${solver === "wasm" ? "translate-x-6" : "translate-x-1"}`} />
            </button>
            <span className={solver === "wasm" ? "font-bold text-violet-700" : "text-gray-400"}>
                WASM {!wasm && "(carregando…)"}
            </span>
        </div>
        <div className='w-full h-full overflow-hidden'>
        <NonSSRWrapper>
        <ZoomableCanvas<GeneticEstado>
            options={{
                useTouchManager: true,
                spanButton: "any",
                // DEBUG: true,
                initialState: {
                    px: 0, 
                    py: 0,
                    cliques: 0,
                    cities: [],
                    ga: null,
                    wasmRunner: null,
                    progress: null
                }
            }}
			draw={(ctx, estado) => {
                if(!ctx) {
                    console.warn("Canvas context is null, cannot draw.");
                    return;
                }

                const w = ctx.canvas.width;
                const h = ctx.canvas.height;

                ctx.clearRect(0, 0, w, h);
                
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, w, h);
                
                ctx.fillStyle = "black";
                ctx.font = "20px Arial";
                ctx.textAlign = "left";

                if(estado.progress) {
                    const { generation, fitness, stagnatedFor } = estado.progress;
                    if(generation && generation > 0) {
                        ctx.fillText(`Gen: ${generation}`, 10, 30);
                        ctx.fillText(`Fitness: ${fitness}`, 10, 60);
                        ctx.fillText(`Stagnated for: ${stagnatedFor} gens`, 10, 90);
                        if(estado.progress.msPerGeneration) {
                            ctx.fillText(`ms/gen: ${estado.progress.msPerGeneration.toFixed(2)}`, 10, 150);
                        }
                    }

                    const ga = estado.ga;
                    const hasTSP = (ga?.problem instanceof TSPProblem && ga.population.length > 0)
                        || (estado.wasmRunner != null && estado.cities.length > 0);

                    if(hasTSP) {
                        // Cria um problema TSP temporário só para o draw (cidades são suficientes)
                        const cities = ga?.problem instanceof TSPProblem
                            ? (ga.problem as TSPProblem).cities
                            : estado.cities;

                        if (ga?.problem instanceof TSPProblem && ga.population.length > 0) {
                            ctx.fillText(`Pop size: ${ga.population.length}`, 10, 120);
                        }

                        // Reutiliza drawTSP passando um objeto compatível
                        const fakeProblem = { cities } as TSPProblem;
                        const fakeGa = { problem: fakeProblem, population: ga?.population ?? [] } as unknown as GeneticAlgorithm<number[]>;
                        drawTSP(
                            ctx,
                            fakeGa,
                            estado.progress! as GAProgressEvent<number[]>
                        );
                    } else {
                        // texto "Clique para adicionar cidades" centralizado
                        ctx.textAlign = "center";
                        ctx.font = "24px Arial";
                        ctx.fillText("Traveling Salesman Problem", w / 2, h / 2);
                        ctx.font = "18px Arial";
                        ctx.fillText("Clique para adicionar cidades", w / 2, h / 2 + 30);
                    }
                }
            }}
            everyFrame={(estado) => {
                if (solver === "wasm") {
                    if (!wasm) return null; // WASM ainda não carregou
                    const size = estado.cities.length;
                    if (size < 3) return null;

                    let runner = estado.wasmRunner;
                    if (!runner) {
                        const cfg = new wasm.GAConfig();
                        cfg.population_size = size * 2;
                        cfg.crossover_rate = 0.9;
                        cfg.mutation_rate = 0.9;
                        cfg.mutation_gene_rate = 1 / size;
                        cfg.tournament_size = 8;
                        cfg.max_stagnation = 50000;
                        cfg.diversity_check = false;
                        cfg.reset_population = false;
                        runner = new wasm.TSPGAProblemRunner(estado.cities, cfg);
                    }

                    let generationCount = 0;
                    const timeStart = performance.now();
                    do {
                        runner.run(100);
                        generationCount += 100;
                    } while (performance.now() - timeStart < 20);
                    const elapsed = performance.now() - timeStart;

                    const info = runner.get_info() as { generation: number; best_fitness: number; stagnated_for: number, best_genes: number[] };

                    mesclarEstado(estado, {
                        wasmRunner: runner,
                        ga: null,
                        progress: {
                            genes: info.best_genes,
                            generation: info.generation,
                            fitness: info.best_fitness,
                            current: undefined,
                            stagnatedFor: info.stagnated_for,
                            msPerGeneration: elapsed / generationCount
                        },
                    });
                } else {
                    let ga = estado.ga;
                    if(!ga) {
                        const size = estado.cities.length;
                        
                        const problem = new TSPProblem([...estado.cities]);
                        const gaConfig = {
                            populationSize: size * 2,
                            crossoverRate: 0.9,
                            mutationRate: 0.9, 
                            mutationGeneRate: 1 / size,
                            tournamentSize: 8,
                            maxStagnation: 50000,
                            diversityCheck: false,
                            resetPopulation: false
                        };
                        ga = new GeneticAlgorithm(problem, gaConfig) as GeneticAlgorithm<object>;
                    }

                    let result;
                    let generationCount = 0;
                    const timeStart = performance.now();
                    do {
                        result = ga.run(100);
                        generationCount += 100;
                    } while(performance.now() - timeStart < 20);
                    const elapsed = performance.now() - timeStart;

                    mesclarEstado(estado, {
                        ga: ga,
                        wasmRunner: null,
                        progress: {
                            ...result,
                            msPerGeneration: elapsed / generationCount
                        }
                    });
                }

                return null;
            }}
			events={{
				onClick: (e, estado) => {
                    const cities = estado.cities;
                    cities.push(unproject(estado.mouse.x, estado.mouse.y, estado.width, estado.height));

                    // deve recriar o runner com o novo número de cidades
                    if(estado.wasmRunner) {
                        estado.wasmRunner.free();
                        estado.wasmRunner = null;
                    }

                    return {
                        cliques: estado.cliques + 1,
                        cities: cities,
                        ga: null,
                        wasmRunner: null,
                        progress: null
                    }
                },
                onKeyDown: (e, estado) => {
                    if (e.key === "g") {
                        // Criar 100 cidades
                        const newCities: TSPCity[] = [];
                        for (let i = 0; i < 100; i++) {
                            newCities.push({
                                x: Math.random(),
                                y: Math.random()
                            });
                        }
                        return {
                            cliques: estado.cliques + 1,
                            cities: newCities,
                            ga: null,
                            wasmRunner: null,
                            progress: null
                        };
                    }
                    return null;
                },
				//onKeyPress:onKeyPress,
				//onKeyDown:onKeyDown,
				//onKeyUp:onKeyUp,
				//onSpan: onSpan
			}}
            onDismount={(estado) => {
                console.log("Canvas is being dismounted, final state:", estado);
            }}
        />
    </NonSSRWrapper>
    </div>
    </div>;
}