"use client";

import { mesclarEstado } from "@/components/Canvas/CanvasController";
import ZoomableCanvas, { ZoomEstadoType } from "@/components/Canvas/ZoomableCanvas";
import NonSSRWrapper from "@/components/nonSSRWrapper";
import { UIEvent, useCallback, useEffect, useRef, useState } from "react";
import { GeneticAlgorithmHandler } from "./geneticAlgorithmHandler";
import { GAConfig, GAProgressEvent, GeneticAlgorithm } from "@/lib/genetic/ga";
import { TSPCity, TSPProblem } from "@/lib/genetic/examples/tsp-problem";
import { GAProblem } from "@/lib/genetic/problem";

type GeneticEstado = ZoomEstadoType & {
    px: number,
    py: number,
    cliques: number,
    cities: TSPCity[],

    handler: GeneticAlgorithmHandler,

    progress: GAProgressEvent<object>
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

function drawTSP(ctx: CanvasRenderingContext2D, ga: GeneticAlgorithm<number[]> | null, problem: TSPProblem | null, progress: GAProgressEvent<number[]> | null) {
    if(!ga || !problem || !progress) return;
    
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
    return <NonSSRWrapper>
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
                    handler: new GeneticAlgorithmHandler()
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
                ctx.fillText(`Cliques: ${estado.cliques || 0}`, w-120, 30);

                if(estado.progress) {
                    const { generation, fitness, stagnatedFor } = estado.progress;
                    const gaConfig = estado.handler.gaConfig;
                    ctx.fillText(`Gen: ${generation}`, 10, 30);
                    ctx.fillText(`Fitness: ${fitness}`, 10, 60);
                    ctx.fillText(`Stagnated for: ${stagnatedFor} gens`, 10, 90);
                    ctx.fillText(`Pop size: ${gaConfig?.populationSize ?? 0}`, 10, 120);
                    ctx.fillText(`Cities: ${estado.cities.length}`, 10, 150);
                }

                if(estado.handler.problem instanceof TSPProblem) {
                    drawTSP(
                        ctx,
                        estado.handler.ga as GeneticAlgorithm<number[]>, 
                        estado.handler.problem as TSPProblem,
                        estado.progress as GAProgressEvent<number[]>
                    );
                }
            }}
            everyFrame={(estado) => {
                if(!estado.handler.ga) {
                    const size = estado.cities.length;
                    
                    const problem = new TSPProblem([...estado.cities]);
                    estado.handler.initialize(problem as GAProblem<object>, {
                        populationSize: size * 2,
                        crossoverRate: 0.9,
                        mutationRate: 0.9, 
                        mutationGeneRate: 1 / size,
                        tournamentSize: 8,
                        maxStagnation: 20000,
                        diversityCheck: true
                    });
                    
                }

                const progress = estado.handler.runStep();
                if(progress) {
                    mesclarEstado(estado, {
                        progress: progress
                    });
                }

                return null;
            }}
			events={{
				onClick: (e, estado) => {
                    estado.handler.ga = null;
                    const cities = estado.cities;
                    cities.push(unproject(estado.mouse.x, estado.mouse.y, estado.width, estado.height));
                    return {
                        cliques: estado.cliques + 1,
                        cities: cities
                    }
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
    </NonSSRWrapper>;
}