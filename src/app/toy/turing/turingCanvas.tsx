import React from 'react';
import NonSSRWrapper from '@/components/nonSSRWrapper';
import ZoomableCanvas, { pageToZoomCanvas, ZoomEstadoType } from '@/components/Canvas/ZoomableCanvas';
import { mesclarEstado } from '@/components/Canvas/CanvasController';
import { TuringMachine2D, TuringMachineResult } from '@/pkg/turing';
import { compileTuringCode } from './turingLanguage';

const CHAR_SCALE = 40;
const MAX_ZOOM_SCALE = 5.0;
const MIN_ZOOM_SCALE = (1 / CHAR_SCALE) / 16;
type TuringState = ZoomEstadoType & {
    program: string | null;
    /** Identifcador único da execução. Para permitir resetar tudo e executar novamente */
    programKey: number;
    stateMap: Map<string, number> | null;
    transitionToLineMap: Map<number, number> | null;
    machine: InstanceType<typeof TuringMachine2D> | null;
    machineResult: TuringMachineResult | null;
    tapeData: Int32Array | null;
    tapeColorData: ImageData | null;
    tapeColorCanvas: HTMLCanvasElement | null;
    tapeBoundsBuffer: Int32Array;

    // Controle de execução e step-by-step
    stepTime: number;
    lastHandledStepRequest: number;
    lastCenterTapeRequest: number;
};

function reCenterTape(machine: TuringMachine2D, estado: TuringState): {
        span: { x: number, y: number },
        scale: number
} {
    // 1. Obter posições to tamanho da fita, e então alterar span e scale (zoom) para centralizar e caber a fita na tela
    const tapeBounds = estado.tapeBoundsBuffer;
    machine.get_tape_bounds(tapeBounds);
    const tapeWidth = (tapeBounds[1] - tapeBounds[0]) * CHAR_SCALE;
    const tapeHeight = (tapeBounds[3] - tapeBounds[2]) * CHAR_SCALE;
    let tapeCenterX = ((tapeBounds[0] + tapeBounds[1]) / 2 + 0.5) * CHAR_SCALE;
    let tapeCenterY = ((tapeBounds[2] + tapeBounds[3]) / 2 + 0.5) * CHAR_SCALE;

    // Zoom para caber, mas limitando para no máximo 200%
    const scaleX = (estado.width - CHAR_SCALE * 8) / (tapeWidth + 1);
    const scaleY = (estado.height - CHAR_SCALE * 8) / (tapeHeight + 1);
    let scale = Math.min(scaleX, scaleY, 2.0);
    scale = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, scale));

    if(scale === MIN_ZOOM_SCALE) {
        // Se for tão pequeno que nem cabe, centraliza no cabeçote ao invés do centro da fita
        tapeCenterX = machine.head_x() * CHAR_SCALE;
        tapeCenterY = machine.head_y() * CHAR_SCALE;
    }

    const canvasCenter = pageToZoomCanvas({ x: estado.width/2, y: estado.height/2 }, 0, 0, {x: 0, y: 0}, scale);

    return {
        span: {
            x: -canvasCenter.x + tapeCenterX,
            y: -canvasCenter.y + tapeCenterY,
        },
        scale: scale,
    };
}

function nextPowerOfTwo(n: number) {
  if (n <= 0) return 1;
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

export function TuringCanvas({ program, programKey, speedSteps, paused, stepRequest, centerTapeRequest, onStateChange }: {
    program?: string | null,
    programKey?: number,
    speedSteps?: number,
    paused?: boolean,
    stepRequest?: number,
    centerTapeRequest?: number,
    /** Chamado sempre que o estado da máquina muda, passando o stateCode atual. */
    onStateChange?: (lineHighlight: number | null) => void,
}) {
    return <NonSSRWrapper>
        <ZoomableCanvas<TuringState>
            options={{
                useTouchManager: true,
                spanButton: "any",
                minZoomScale: MIN_ZOOM_SCALE,
                maxZoomScale: MAX_ZOOM_SCALE,
                initialState: {
                    program: program || null,
                    programKey: programKey ?? 0,
                    stateMap: null,
                    transitionToLineMap: null,
                    machine: null,
                    machineResult: null,
                    tapeData: null,
                    tapeColorData: null,
                    tapeColorCanvas: null,
                    tapeBoundsBuffer: new Int32Array(4),
                    stepTime: 0,
                    lastHandledStepRequest: stepRequest ?? 0,
                    lastCenterTapeRequest: centerTapeRequest ?? 0,
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

                    let colorCanvas = estado.tapeColorCanvas;
                    if(!colorCanvas) {
                        colorCanvas = document.createElement('canvas');
                        estado.tapeColorCanvas = colorCanvas;
                    }

                    let colorData = estado.tapeColorData;
                    if(!colorData || colorData.width !== w || colorData.height !== h) {
                        /*let sizeX = Math.min(w, Math.max(frameBufferWidth, colorData ? colorData.width * 2 : frameBufferWidth * 2));
                        let sizeY = Math.min(h, Math.max(frameBufferHeight, colorData ? colorData.height * 2 : frameBufferHeight * 2));
                        if(!colorData || colorData.width !== sizeX || colorData.height !== sizeY) {
                            colorData = new ImageData(
                                sizeX,
                                sizeY
                            );
                        }*/
                        colorData = new ImageData(w, h);
                        estado.tapeColorData = colorData;
                    }
                    colorCanvas.width = Math.min(frameBufferWidth, w);
                    colorCanvas.height = Math.min(frameBufferHeight, h);

                    const drawOnlyRects = estado.scale <= 0.15;
                    if(!drawOnlyRects) {
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
                    }

                    let scaleTapeColor = 1;
                    if(estado.scale < 2 / CHAR_SCALE) {
                        scaleTapeColor = nextPowerOfTwo(Math.ceil(2 / (estado.scale * CHAR_SCALE)));
                    }
                    machine.update_colorbuffer(
                        estado.tapeColorData!.data as unknown as Uint8Array,
                        offsetLeft,
                        offsetTop,
                        frameBufferWidth, 
                        frameBufferHeight,
                        colorData.width,
                        colorData.height,
                        scaleTapeColor
                    );

                    const tapeBounds = estado.tapeBoundsBuffer;
                    machine.get_tape_bounds(tapeBounds);
                    let startY = Math.max(offsetTop, tapeBounds[2]);
                    let endY = Math.min(offsetTop + frameBufferHeight, tapeBounds[3] + 1);
                    let startX = Math.max(offsetLeft, tapeBounds[0]);
                    let endX = Math.min(offsetLeft + frameBufferWidth, tapeBounds[1] + 1);

                    // Borda ao redor da fita ativa
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(
                        tapeBounds[0] * CHAR_SCALE,
                        tapeBounds[2] * CHAR_SCALE,
                        (tapeBounds[1] - tapeBounds[0] + 1) * CHAR_SCALE,
                        (tapeBounds[3] - tapeBounds[2] + 1) * CHAR_SCALE
                    );
                    

                    // Desenhar o fundo usando o color buffer
                    // Tem que escalonar para cada pixel atingir CHAR_SCALE
                    const colorCtx = colorCanvas.getContext('2d')!;
                    colorCtx.putImageData(estado.tapeColorData!, 0, 0);
                    ctx.imageSmoothingEnabled = false;
                    /*// Assim desenha tudo
                    ctx.drawImage(colorCanvas,
                        0, 0, colorCanvas.width, colorCanvas.height,
                        offsetLeft * CHAR_SCALE, offsetTop * CHAR_SCALE, colorCanvas.width * CHAR_SCALE * scaleTapeColor, colorCanvas.height * CHAR_SCALE * scaleTapeColor
                    );
                    estado.tapeColorData!.data.fill(0);*/

                    // Assim desenhando só a parte dentros dos bounds
                    // Guard necessário: drawImage lança IndexSizeError se as dimensões forem zero ou negativas
                    // (ocorre quando a fita está completamente fora da viewport)
                    if (endX > startX && endY > startY) {
                        ctx.drawImage(colorCanvas,
                            Math.floor((startX - offsetLeft) / scaleTapeColor), 
                            Math.floor((startY - offsetTop) / scaleTapeColor), 
                            (endX - startX) / scaleTapeColor, 
                            (endY - startY) / scaleTapeColor,

                            (startX * CHAR_SCALE), 
                            (startY * CHAR_SCALE), 
                            Math.max((endX - startX) * CHAR_SCALE, scaleTapeColor * CHAR_SCALE), 
                            Math.max((endY - startY) * CHAR_SCALE, scaleTapeColor * CHAR_SCALE)
                        );
                    }

                    // Agora desenhar em toda a tela, apenas seção do frameBuffer que está visível
                    ctx.fillStyle = 'black';
                    ctx.font = `${CHAR_SCALE}px monospace`;
                    ctx.textAlign = 'center';
                    ctx.textRendering = 'optimizeSpeed';
                    const headX = machine.head_x();
                    const headY = machine.head_y();
                    
                    if(!drawOnlyRects) {
                        let tapeData = estado.tapeData!;
                        // Atravessa só dentro dos bounds
                        for(let y = startY; y < endY; y++) {
                            for(let x = startX; x < endX; x++) {
                                const charX = x;
                                const charY = y;
                                const charData = tapeData[(y - offsetTop) * frameBufferWidth + (x - offsetLeft)];
                                if(charData === 0) {
                                    continue;
                                }

                                const char = String.fromCodePoint(charData);
                                ctx.fillText(char, 
                                    charX * CHAR_SCALE + CHAR_SCALE / 2, 
                                    (charY + 1) * CHAR_SCALE - CHAR_SCALE / 8
                                );                                
                            }
                        }
                    }

                    // HUD: etapas, estado, posição, status
                    let currentStateName = "?";
                    let currentStateCode = machine.get_state();
                    estado.stateMap?.forEach((code, name) => {
                        if(code === currentStateCode) {
                            currentStateName = name;
                        }
                    });

                    // Destaque o cabeçote se estiver nessa posição
                    ctx.fillStyle = 'red';
                    if(drawOnlyRects) {
                        ctx.fillRect(
                            (headX - 1 * scaleTapeColor) * CHAR_SCALE, 
                            (headY - 1 * scaleTapeColor) * CHAR_SCALE, 
                            CHAR_SCALE * (1 + 2 * scaleTapeColor), 
                            CHAR_SCALE * (1 + 2 * scaleTapeColor)
                        );
                    } else {
                        ctx.strokeStyle = 'red';
                        const halfLine = 2;
                        ctx.lineWidth = halfLine * 2;
                        ctx.strokeRect(
                            headX * CHAR_SCALE - halfLine, 
                            headY * CHAR_SCALE - halfLine, 
                            CHAR_SCALE + halfLine * 2,
                            CHAR_SCALE + halfLine * 2
                        );

                        // Estado atual e posição do cabeçote
                        ctx.fillRect(
                            (headX) * CHAR_SCALE - halfLine * 2,
                            (headY+1) * CHAR_SCALE + halfLine, 
                            CHAR_SCALE + halfLine * 4, 
                            CHAR_SCALE * 0.75
                        );

                        ctx.fillStyle = 'black';
                        ctx.font = `${CHAR_SCALE * 0.75}px monospace`;
                        ctx.textAlign = 'center';
                        ctx.fillText(
                            currentStateName,
                            headX * CHAR_SCALE + CHAR_SCALE / 2,
                            (headY + 1.5) * CHAR_SCALE + halfLine + (CHAR_SCALE * 0.75) / 8
                        );
                    }
                }
            }}
            uidraw={(ctx, estado) => {
                if(!ctx) {
                    console.warn("Canvas context is null, cannot draw.");
                    return;
                }

                const machine = estado.machine;
                if(machine) {
                    const headX = machine.head_x();
                    const headY = machine.head_y();

                    let machineStatus: string;
                    switch(estado.machineResult) {
                        case TuringMachineResult.Continue: machineStatus = 'Executando'; break;
                        case TuringMachineResult.Halt:     machineStatus = 'Halt'; break;
                        case TuringMachineResult.TransitionNotFound: machineStatus = 'ERRO: Transição não encontrada'; break;
                        default: machineStatus = '...'; break;
                    }
                    ctx.fillStyle = 'black';
                    ctx.textAlign = 'left';
                    ctx.font = '24px monospace';
                    ctx.fillText(
                        `Etapas: ${machine.get_step_count()} Pos: (${headX}, ${headY})  ${paused ? 'Pausado' : machineStatus}`,
                        20,
                        30
                    );

                    // Tamanho da fita
                    const tapeBounds = estado.tapeBoundsBuffer;
                    machine.get_tape_bounds(tapeBounds);
                    const tapeWidth = tapeBounds[1] - tapeBounds[0] + 1;
                    const tapeHeight = tapeBounds[3] - tapeBounds[2] + 1;
                    ctx.fillText(
                        `Tamanho da fita: ${tapeWidth} x ${tapeHeight}`,
                        20,
                        60
                    );
                }
            }}
            onPropsChange={(estado) => {
                const keyChanged    = estado.programKey !== (programKey ?? 0);
                const programChanged = estado.program !== (program || null);
                const machine = estado.machine;
                if(programChanged || keyChanged) {
                    if(machine) {
                        // Objetos criados via WASM não são GC'ed
                        // É necessário liberar manualmente a memória quando não forem mais necessários
                        estado.machine = null;
                        machine.free();
                    }
                    mesclarEstado(estado, {
                        program: program || null,
                        programKey: programKey ?? 0,
                        machine: null,
                        tapeData: null,
                        tapeColorData: null,
                        tapeColorCanvas: null,
                        stateMap: null,
                        transitionToLineMap: null,
                        machineResult: null,
                        span: { x: 0, y: 0 },
                        spanningStart: { x: 0, y: 0 },
                        spanning: false,
                        scale: 1.0,
                    });
                } else if(centerTapeRequest && estado.lastCenterTapeRequest !== centerTapeRequest) {
                    if(machine) {
                        const { span, scale } = reCenterTape(machine, estado);
                        mesclarEstado(estado, {
                            span: span,
                            scale: scale,
                            lastCenterTapeRequest: centerTapeRequest,
                        });
                    }
                }
            }}
            everyFrame={(estado) => {
                let machine = estado.machine;
                if(!machine) {
                    if(estado.program) {
                        const { compiledProgram, stateMap, input, startState, defaultValue, transitionToLineMap } = compileTuringCode(estado.program);
                        machine = new TuringMachine2D(compiledProgram, input, 0, 0, startState, defaultValue);
                        
                        // Centralizar a fita no meio da tela
                        const { span, scale } = reCenterTape(machine, estado);


                        mesclarEstado(estado, {
                            machine: machine,
                            machineResult: null,
                            tapeData: null,
                            tapeColorData: null,
                            stateMap: stateMap,
                            transitionToLineMap: transitionToLineMap,
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
                            onStateChange?.(estado.transitionToLineMap?.get(machine.get_next_transition() ?? 0) ?? null);
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
                            onStateChange?.(estado.transitionToLineMap?.get(machine.get_next_transition() ?? 0) ?? null);
                            mesclarEstado(estado, {
                                stepTime: performance.now() + 150,
                            });
                        }
                    } else if(speedSteps > 0) {
                        machineResult = machine.run(speedSteps);
                        onStateChange?.(estado.transitionToLineMap?.get(machine.get_next_transition() ?? 0) ?? null);
                    } else {
                        const timeStart = performance.now();
                        do {
                            machineResult = machine.run(1_000_000);
                            if(machineResult !== TuringMachineResult.Continue) {
                                break;
                            }
                        } while(performance.now() - timeStart < 20);
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

