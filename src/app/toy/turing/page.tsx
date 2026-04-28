"use client";
import React, { useState } from 'react';
import { useWasm } from '@/lib/useWasm';
import NonSSRWrapper from '@/components/nonSSRWrapper';
import ZoomableCanvas, { pageToZoomCanvas, zoomCanvasToPage, ZoomEstadoType } from '@/components/Canvas/ZoomableCanvas';
import { mesclarEstado } from '@/components/Canvas/CanvasController';
import { TuringMachine2D, TuringMachineResult } from '@/pkg/turing';
import { compileTuringCode } from './turing';
import { getExampleCodes } from './turingexamples';

function reCenterTape(machine: TuringMachine2D, estado: TuringState): {
        span: { x: number, y: number },
        scale: number
} {
    // 1. Obter posições to tamanho da fita, e então alterar span e scale (zoom) para centralizar e caber a fita na tela
    const tapeBounds = estado.tapeBoundsBuffer;
    machine.get_tape_bounds(tapeBounds);
    const tapeWidth = (tapeBounds[1] - tapeBounds[0]) * CHAR_SCALE;
    const tapeHeight = (tapeBounds[3] - tapeBounds[2]) * CHAR_SCALE;
    const tapeCenterX = ((tapeBounds[0] + tapeBounds[1]) / 2 + 0.5) * CHAR_SCALE;
    const tapeCenterY = ((tapeBounds[2] + tapeBounds[3]) / 2 + 0.5) * CHAR_SCALE;

    // Zoom para caber, mas limitando para no máximo 200%
    const scaleX = (estado.width - CHAR_SCALE * 4) / (tapeWidth + 1);
    const scaleY = (estado.height - CHAR_SCALE * 4) / (tapeHeight + 1);
    const scale = Math.min(scaleX, scaleY, 2.0);

    const canvasCenter = pageToZoomCanvas({ x: estado.width/2, y: estado.height/2 }, 0, 0, {x: 0, y: 0}, scale);

    return {
        span: {
            x: -canvasCenter.x + tapeCenterX,
            y: -canvasCenter.y + tapeCenterY,
        },
        scale: scale
    };
}

const CHAR_SCALE = 40;
type TuringState = ZoomEstadoType & {
    program: string | null;
    /** Identifcador único da execução. Para permitir resetar tudo e executar novamente */
    programKey: number;
    stateMap: Map<string, number> | null;
    machine: InstanceType<typeof TuringMachine2D> | null;
    machineResult: TuringMachineResult | null;
    tapeData: Int32Array | null;
    tapeBoundsBuffer: Int32Array;

    // Controle de execução e step-by-step
    stepTime: number;
    lastHandledStepRequest: number;
};

function TuringCanvas({ program, programKey, speedSteps, paused, stepRequest }: {
    program?: string | null,
    programKey?: number,
    speedSteps?: number,
    paused?: boolean,
    stepRequest?: number,
}) {
    return <NonSSRWrapper>
        <ZoomableCanvas<TuringState>
            options={{
                useTouchManager: true,
                spanButton: "any",
                minZoomScale: 0.05,
                maxZoomScale: 5,
                initialState: {
                    program: program || null,
                    programKey: programKey ?? 0,
                    stateMap: null,
                    machine: null,
                    machineResult: null,
                    tapeData: null,
                    tapeBoundsBuffer: new Int32Array(4),
                    stepTime: 0,
                    lastHandledStepRequest: stepRequest ?? 0,
                }
            }}
			draw={(ctx, estado) => {
                if(!ctx) {
                    console.warn("Canvas context is null, cannot draw.");
                    return;
                }

                const w = ctx.canvas.width;
                const h = ctx.canvas.height;

                const machine = estado.machine;
                if(machine) {
                    const corners = [
                        { x: 0, y: 0 }, // canto superior esquerdo
                        { x: w, y: h }, // canto inferior direito
                    ];
                    for(const corner of corners) {
                        const cornerCoords = pageToZoomCanvas(corner, 0, 0, estado.span, estado.scale);
                        corner.x = cornerCoords.x;
                        corner.y = cornerCoords.y;
                    }
                    const offsetLeft = Math.floor(corners[0].x / CHAR_SCALE);
                    const offsetTop  = Math.floor(corners[0].y / CHAR_SCALE);
                    const frameBufferWidth  = Math.ceil(corners[1].x / CHAR_SCALE) - offsetLeft;
                    const frameBufferHeight = Math.ceil(corners[1].y / CHAR_SCALE) - offsetTop;

                    let tapeData = estado.tapeData;
                    if(!tapeData || tapeData.length < frameBufferWidth * frameBufferHeight) {
                        const newSize = tapeData ? tapeData.length * 2 : (frameBufferWidth * frameBufferHeight) * 2;
                        tapeData = new Int32Array(Math.max(newSize, frameBufferWidth * frameBufferHeight));
                        estado.tapeData = tapeData;
                    }

                    machine.update_framebuffer(
                        tapeData,
                        offsetLeft,
                        offsetTop,
                        frameBufferWidth, 
                        frameBufferHeight
                    );

                    // Borda ao redor da fita ativa
                    const tapeBounds = estado.tapeBoundsBuffer;
                    machine.get_tape_bounds(tapeBounds);
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(
                        tapeBounds[0] * CHAR_SCALE,
                        tapeBounds[2] * CHAR_SCALE,
                        (tapeBounds[1] - tapeBounds[0] + 1) * CHAR_SCALE,
                        (tapeBounds[3] - tapeBounds[2] + 1) * CHAR_SCALE
                    );

                    // Agora desenhar em toda a tela, apenas seção do frameBuffer que está visível
                    ctx.fillStyle = 'black';
                    ctx.font = `${CHAR_SCALE}px monospace`;
                    ctx.textAlign = 'center';
                    ctx.textRendering = 'optimizeSpeed';
                    const headX = machine.head_x();
                    const headY = machine.head_y();
                    const drawOnlyRects = estado.scale <= 0.15;
                    for(let y = 0; y < frameBufferHeight; y++) {
                        for(let x = 0; x < frameBufferWidth; x++) {
                            const charX = offsetLeft + x;
                            const charY = offsetTop + y;
                            const charData = tapeData[y * frameBufferWidth + x];
                            if(charData === 0) {
                                continue;
                            }

                            const char = String.fromCodePoint(charData);                            
                            if(drawOnlyRects) {
                                // Pequeno demais para desenhar caracteres legíveis, desenha retângulos para indicar presença de dados
                                ctx.fillRect(
                                    charX * CHAR_SCALE, 
                                    charY * CHAR_SCALE, 
                                    CHAR_SCALE, 
                                    CHAR_SCALE
                                );
                            } else {
                                ctx.fillText(char, 
                                    charX * CHAR_SCALE + CHAR_SCALE / 2, 
                                    (charY + 1) * CHAR_SCALE - CHAR_SCALE / 8
                                );
                            }
                        }
                    }

                    // Destaque o cabeçote se estiver nessa posição
                    ctx.strokeStyle = 'red';
                    ctx.lineWidth = drawOnlyRects ? CHAR_SCALE : 4;
                    ctx.strokeRect(
                        headX * CHAR_SCALE, 
                        headY * CHAR_SCALE, 
                        CHAR_SCALE, 
                        CHAR_SCALE
                    );
                    ctx.strokeStyle = 'black';
                    

                    // HUD: etapas, estado, posição, status
                    let currentStateName = "?";
                    let currentStateCode = machine.get_state();
                    estado.stateMap?.forEach((code, name) => {
                        if(code === currentStateCode) {
                            currentStateName = name;
                        }
                    });
                    let machineStatus: string;
                    switch(estado.machineResult) {
                        case TuringMachineResult.Continue: machineStatus = 'Executando'; break;
                        case TuringMachineResult.Halt:     machineStatus = 'Halt'; break;
                        case TuringMachineResult.TransitionNotFound: machineStatus = 'ERRO: Transição não encontrada'; break;
                        default: machineStatus = paused ? 'Pausado' : '...'; break;
                    }
                    ctx.fillStyle = 'black';
                    ctx.textAlign = 'left';
                    ctx.font = '16px monospace';
                    ctx.fillText(
                        `Etapas: ${machine.get_step_count()}  Estado: ${currentStateName}  Pos: (${headX}, ${headY})  ${machineStatus}`,
                        offsetLeft * CHAR_SCALE,
                        offsetTop * CHAR_SCALE + 20
                    );
                }
            }}
            onPropsChange={(estado) => {
                const keyChanged    = estado.programKey !== (programKey ?? 0);
                const programChanged = estado.program !== (program || null);
                if(programChanged || keyChanged) {
                    if(estado.machine) {
                        // Objetos criados via WASM não são GC'ed
                        // É necessário liberar manualmente a memória quando não forem mais necessários
                        estado.machine.free();
                    }
                    mesclarEstado(estado, {
                        program: program || null,
                        programKey: programKey ?? 0,
                        machine: null,
                        tapeData: null,
                        stateMap: null,
                        reverseStateMap: null,
                        machineResult: null,
                        span: { x: 0, y: 0 },
                        spanningStart: { x: 0, y: 0 },
                        spanning: false,
                        scale: 1.0,
                    });
                }
            }}
            everyFrame={(estado) => {
                let machine = estado.machine;
                if(!machine) {
                    if(estado.program) {
                        const { compiledProgram, stateMap, input, startState, defaultValue } = compileTuringCode(estado.program);
                        machine = new TuringMachine2D(compiledProgram, 0, 0, startState, defaultValue);
                        if(input) {
                            machine.preload_tape(input);
                        }

                        // Centralizar a fita no meio da tela
                        const { span, scale } = reCenterTape(machine, estado);


                        mesclarEstado(estado, {
                            machine: machine,
                            machineResult: null,
                            tapeData: null,
                            stateMap: stateMap,
                            lastHandledStepRequest: stepRequest ?? 0,
                            span: span,
                            scale: scale
                        });
                    }
                }

                const isPaused = paused ?? false;
                const currentStep = stepRequest ?? 0;

                let machineResult: TuringMachineResult | null = estado.machineResult;
                if(machine && (machineResult === null || machineResult === TuringMachineResult.Continue)) {

                    if(isPaused) {
                        // Só avança se houver um step pendente
                        if(currentStep !== estado.lastHandledStepRequest) {
                            const result = machine!.run(1);
                            mesclarEstado(estado, {
                                machineResult: result,
                                lastHandledStepRequest: currentStep,
                            });
                        }
                        return null;
                    }

                    if(speedSteps === undefined || speedSteps === 0) {
                        if(estado.stepTime < performance.now()) {
                            machineResult = machine.run(1);
                            mesclarEstado(estado, {
                                stepTime: performance.now() + 150, // espera um pouco antes de permitir o próximo passo, para limitar a velocidade
                            });
                        }
                    } else if(speedSteps > 0) {
                        machineResult = machine.run(speedSteps);
                    } else {
                        const timeStart = performance.now();
                        do {
                            machineResult = machine.run(1_000_000);
                            if(machineResult !== TuringMachineResult.Continue) {
                                break; // parou por halt ou transição não encontrada
                            }
                        } while(performance.now() - timeStart < 20); // limita a execução para manter a UI responsiva
                    }

                    mesclarEstado(estado, {
                        machineResult: machineResult,
                    });
                    return null;
                }

                return null;
            }}
			events={{
				// onClick: (e, estado) => {
                //     return {
                //     }
                // },
				//onKeyPress:onKeyPress,
				//onKeyDown:onKeyDown,
				//onKeyUp:onKeyUp,
				//onSpan: onSpan
			}}
            onDismount={(estado) => {
                // Objetos criados via WASM não são GC'ed
                // mas se fizer free aqui dá erro de null pointer enviado pro rust
                //estado.machine?.free();
                console.log("Canvas is being dismounted, final state:", estado);
            }}
        />
    </NonSSRWrapper>;
}

export default function TuringPage() {
    const exampleCodes = getExampleCodes();
    const wasm = useWasm();

    const [currentCode, setCurrentCode] = useState(exampleCodes["busy beaver"]);
    const [runningCode, setRunningCode] = useState<string | null>(currentCode);
    const [programKey, setProgramKey] = useState(1);
    const [paused, setPaused] = useState(false);
    const [speed, setSpeed] = useState(0);

    //const SPEED_LABELS = ['.', '×1', '×10', '×100', '×1k', '×∞'];
    //const SPEED_STEPS  = [0, 1, 10, 100, 1_000, -1]; // -1 = time-limited burst
    const SPEED_CONFIG = [
        { label: '.', steps: 0 },
        { label: '×1', steps: 1 },
        { label: '×10', steps: 10 },
        { label: '×100', steps: 100 },
        { label: '×1k', steps: 1_000 },
        { label: 'MAX', steps: -1 }, // -1 = time-limited burst
    ];
    const [stepRequest, setStepRequest] = useState(0);

    const isLoaded = runningCode !== null;

    function handleLoad() {
        setRunningCode(currentCode);
        setProgramKey(k => k + 1);
        setPaused(false);
        setStepRequest(0);
    }

    function handleReset() {
        setRunningCode(currentCode);
        setProgramKey(k => k + 1);
        setPaused(true);
        setStepRequest(0);
    }

    function handlePlayPause() {
        if(!isLoaded) {
            handleLoad();
            return;
        }
        setPaused(p => !p);
    }

    function handleStep() {
        if(!isLoaded) {
            setRunningCode(currentCode);
            setProgramKey(k => k + 1);
            setPaused(true);
            setStepRequest(1);
            return;
        }
        setPaused(true);
        setStepRequest(s => s + 1);
    }

    return <div className='h-screen max-h-screen w-full flex flex-row overflow-hidden'>
        { !wasm && (
            <p>Carregando WebAssembly...</p>
        )}
        { wasm && (<>
            {/* Painel lateral */}
            <div className='min-w-84 w-84 flex flex-col gap-3 p-4 h-full border-r'>

                {/* Seletor de exemplos */}
                <select
                    className='w-full px-3 py-2 bg-gray-100 text-gray-800 rounded border hover:bg-gray-200 text-sm'
                    onChange={(e) => setCurrentCode(exampleCodes[e.target.value])}
                    defaultValue="busy beaver"
                >
                    {Object.keys(exampleCodes).map(key => (
                        <option key={key} value={key}>{key}</option>
                    ))}
                </select>

                {/* Editor de código */}
                <textarea
                    className='w-full flex-1 font-mono text-sm border rounded p-2 resize-none'
                    value={currentCode}
                    onChange={(e) => setCurrentCode(e.target.value)}
                    spellCheck={false}
                />

                {/* Controles de execução */}
                <div className='flex flex-col gap-2'>

                    {/* Play / Pause / Step / Reset */}
                    <div className='flex gap-2'>
                        <button
                            title={paused ? 'Continuar' : 'Pausar'}
                            className='flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 font-medium'
                            onClick={handlePlayPause}
                        >
                            {(paused || !isLoaded) ? '▶ Play' : '⏸ Pause'}
                        </button>
                        <button
                            title='Executar um passo'
                            className='px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-medium'
                            onClick={handleStep}
                        >
                            ⏭ Step
                        </button>
                        <button
                            title='Reiniciar'
                            className='px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-medium'
                            onClick={handleReset}
                        >
                            ↺
                        </button>
                    </div>

                    {/* Carregar programa */}
                    <button
                        className='w-full px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium'
                        onClick={handleLoad}
                    >
                        ▶ Carregar código
                    </button>

                    {/* Velocidade */}
                    <div className='flex items-center gap-3'>
                        <span className='text-sm text-gray-600'>Vel:</span>
                        <input
                            className='flex-1'
                            type='range'
                            min={0}
                            max={SPEED_CONFIG.length - 1}
                            value={speed}
                            onChange={(e) => setSpeed(parseInt(e.target.value))}
                        />
                        <span className='text-sm font-mono min-w-10 text-right'>{SPEED_CONFIG[speed].label} </span>
                    </div>
                </div>
            </div>

            {/* Canvas */}
            <div className='w-full h-full overflow-hidden'>
                <TuringCanvas
                    program={runningCode}
                    programKey={programKey}
                    paused={paused}
                    speedSteps={SPEED_CONFIG[speed].steps}
                    stepRequest={stepRequest}
                />
            </div>
        </>)}
    </div>;
}