"use client";
import React, { useState } from 'react';
import { useWasm } from '@/lib/useWasm';
import NonSSRWrapper from '@/components/nonSSRWrapper';
import ZoomableCanvas, { pageToZoomCanvas, ZoomEstadoType } from '@/components/Canvas/ZoomableCanvas';
import { mesclarEstado } from '@/components/Canvas/CanvasController';
import { TuringMachine2D, TuringMachineResult } from '@/pkg/turing';
import { compileTuringCode } from './turing';
import { getExampleCodes } from './turingexamples';

type TuringState = ZoomEstadoType & {
    program: string | null;
    stateMap: Map<string, number> | null;
    machine: InstanceType<typeof TuringMachine2D> | null;
    machineResult: TuringMachineResult | null;
    tapeData: Int32Array | null;
    stepTime: number;
};

function TuringCanvas({ program, speed }: React.PropsWithChildren<{ 
    program?: string | null,
    speed?: number,
}>) {
    return <NonSSRWrapper>
        <ZoomableCanvas<TuringState>
            options={{
                useTouchManager: true,
                spanButton: "any",
                //DEBUG: true,
                initialState: {
                    program: program || null,
                    stateMap: null,
                    machine: null,
                    machineResult: null,
                    tapeData: null,
                    stepTime: 0,
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
                    const charScale = 40;
                    const offsetLeft = Math.floor(corners[0].x / charScale);
                    const offsetTop = Math.floor(corners[0].y / charScale);
                    const frameBufferWidth = Math.ceil(corners[1].x / charScale) - offsetLeft;
                    const frameBufferHeight = Math.ceil(corners[1].y / charScale) - offsetTop;
                    let tapeData = estado.tapeData;
                    if(!tapeData || tapeData.length < frameBufferWidth * frameBufferHeight) {
                        console.log(`Criando novo TapeData para framebuffer de tamanho ${frameBufferWidth}x${frameBufferHeight}`);
                        // Aloca o dobro cada vez,
                        let newSize = tapeData ? tapeData.length * 2 : (frameBufferWidth * frameBufferHeight) * 2; 
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

                    // Agora desenhar em toda a tela, apenas seção do frameBuffer que está visível
                    ctx.fillStyle = 'black';
                    ctx.font = `${charScale}px monospace`;
                    ctx.textAlign = 'center';
                    ctx.textRendering = 'optimizeSpeed';
                    for(let y = 0; y < frameBufferHeight; y++) {
                        for(let x = 0; x < frameBufferWidth; x++) {
                            const charData = tapeData[y * frameBufferWidth + x];
                            if(charData === 0 || Number.isNaN(charData)) {
                                continue;
                            }
                            
                            const char = String.fromCodePoint(charData);                            
                            ctx.fillText(char, 
                                (offsetLeft + x) * charScale + charScale / 2, 
                                (offsetTop + y + 1) * charScale - charScale / 8
                            );
                            //ctx.strokeRect(offsetLeft * charScale + x * charScale, offsetTop * charScale + y * charScale, charScale, charScale);
                        }
                    }

                    // // Centralizar a imagem, mantendo a proporção
                    // const scale = Math.max(Math.min(w / frameBufferWidth, h / frameBufferHeight), 20);
                    // const offsetX = (w - frameBufferWidth * scale) / 2;
                    // const offsetY = (h - frameBufferHeight * scale) / 2;
                    
                    // //ctx.drawImage(imageCanvas, 0, 0, frameBufferWidth, frameBufferHeight, offsetX, offsetY, frameBufferWidth * scale, frameBufferHeight * scale);
                    // ctx.fillStyle = 'black';
                    // ctx.font = `${scale}px monospace`;
                    // ctx.textAlign = 'center';
                    // ctx.textRendering = 'optimizeSpeed';
                    // for(let y = 0; y < frameBufferHeight; y++) {
                    //     for(let x = 0; x < frameBufferWidth; x++) {
                    //         const charData = tapeData[y * frameBufferWidth + x];
                    //         if(charData === 0 || Number.isNaN(charData)) continue;
                            
                    //         const char = String.fromCodePoint(charData);
                    //         ctx.fillText(char, offsetX + x * scale + scale / 2, offsetY + (y+1) * scale - scale / 8);
                    //     }
                    // }

                    // Desenha uma borda ao redor da fita ativa (a partir do tamanho e posição)
                    const tapeBounds = new Int32Array(4);
                    machine.get_tape_bounds(tapeBounds);
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(
                        (tapeBounds[0]) * charScale, 
                        (tapeBounds[2]) * charScale, 
                        (tapeBounds[1] - tapeBounds[0] + 1) * charScale, 
                        (tapeBounds[3] - tapeBounds[2] + 1) * charScale
                    );

                    // Desenha o cabeçote como um retângulo vermelho
                    const headX = machine.head_x();
                    const headY = machine.head_y();
                    ctx.strokeStyle = 'red';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(
                        (headX) * charScale, 
                        (headY) * charScale, 
                        charScale, 
                        charScale
                    );

                    // // Abaixo do cabeçote, escreve o estado atual e posição
                    // ctx.textAlign = 'left';
                    // ctx.font = `${16}px monospace`;
                    // let currentStateName = "?";
                    // let currentStateCode = machine.get_state();
                    // estado.stateMap?.forEach((code, name) => {
                    //     if(code === currentStateCode) {
                    //         currentStateName = name;
                    //     }
                    // });
                    
                    // const headText = `${currentStateName}`;
                    // ctx.fillStyle = 'red';
                    // ctx.fillText(headText, offsetX + headX * scale + scale/2 - 8, offsetY + headY * scale + scale + 16);



                    // Informações, logo acima da fita: estado atual, número de 1s na fita, posição do cabeçote
                    let currentStateName = "?";
                    let currentStateCode = machine.get_state();
                    estado.stateMap?.forEach((code, name) => {
                        if(code === currentStateCode) {
                            currentStateName = name;
                        }
                    });
                    ctx.fillStyle = 'black';
                    ctx.textAlign = 'left';
                    ctx.font = `${16}px monospace`;
                    let machineStatus;
                    switch(estado.machineResult) {
                        case TuringMachineResult.Continue:
                            machineStatus = "Executando";
                            break;
                        case TuringMachineResult.Halt:
                            machineStatus = "Halt";
                            break;
                        case TuringMachineResult.TransitionNotFound:
                            machineStatus = "ERRO: Transição não encontrada";
                            break;
                        default:
                            machineStatus = "?";
                            break;
                    }
                    const infoText = `Etapas: ${machine.get_step_count()} Estado: ${currentStateName} Posição: (${machine.head_x()}, ${machine.head_y()}) ${machineStatus}`;
                    ctx.fillText(infoText, offsetLeft * charScale, (offsetTop * charScale) + 32);
                }
            }}
            onPropsChange={(estado) => {
                if(estado.program !== program) {
                    console.log("Programa atualizado, compilando e reiniciando máquina...");
                    if(estado.machine) {
                        // Objetos criados via WASM não são GC'ed
                        // É necessário liberar manualmente a memória quando não forem mais necessários
                        estado.machine.free();
                    }
                    mesclarEstado(estado, {
                        program: program || null,
                        machine: null,
                        tapeData: null,
                        span: { x: 0, y: 0 },
                        spanningStart: { x:0, y:0 },
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
                        // machine.preload_tape(new Int32Array([
                        //     0, 0, toUnicode('0'),
                        // ]));

                        mesclarEstado(estado, {
                            machine: machine || null,
                            machineResult: null,
                            tapeData: null, // força recriação do tapeData para o novo programa
                            stateMap: stateMap,
                        });
                    }
                }
                let machineResult: TuringMachineResult | null = estado.machineResult;
                if(machine && (machineResult === null || machineResult === TuringMachineResult.Continue)) {
                    if(speed === undefined || speed <= 0) {
                        if(estado.stepTime < performance.now()) {
                            machineResult = machine.run(1);
                            mesclarEstado(estado, {
                                stepTime: performance.now() + 150, // espera um pouco antes de permitir o próximo passo, para limitar a velocidade
                            });
                        }
                    } else if(speed === 1) {
                        machineResult =machine.run(1);
                    } else if(speed === 2) {
                        machineResult = machine.run(100);
                    } else if(speed === 3) {
                        machineResult = machine.run(1000);
                    } else {
                        const timeStart = performance.now();
                        do {
                            machineResult = machine.run(1000000);
                            if(machineResult !== TuringMachineResult.Continue) {
                                break; // parou por halt ou transição não encontrada
                            }
                        } while(performance.now() - timeStart < 10); // limita a execução para manter a UI responsiva
                    }

                    mesclarEstado(estado, {
                        machineResult: machineResult,
                    });
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
    const [speed, setSpeed] = useState(0);

    return <div className='h-screen max-h-screen w-full flex flex-row overflow-hidden'>
        { !wasm && (
            <p>Carregando WebAssembly...</p>
        )}
        { wasm && (<>
            <div className='min-w-84 flex flex-col gap-4 p-4 h-full items-start justify-start'>
            <textarea 
                className='w-full h-full font-mono border rounded p-2 overflow-auto whitespace-pre'
                value={currentCode} 
                onChange={(e) => {
                    setCurrentCode(e.target.value);
                }}
            />            
            <div className='w-full flex flex-col gap-4'>
                <select
                    className='w-full px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300'
                    onChange={(e) => {
                        const selected = e.target.value;
                        setCurrentCode(exampleCodes[selected]);
                    }}
                >
                    {Object.keys(exampleCodes).map(key => (
                        <option key={key} value={key}>{key}</option>
                    ))}
                </select>
                
                <div className='flex items-center gap-2'>
                <label>
                    Vel:
                </label>
                <input 
                    type="range" 
                    min="0" 
                    max="4" 
                    value={speed} 
                    onChange={(e) => setSpeed(parseInt(e.target.value))}
                />
                </div>
                <div className='flex items-center gap-2'>
                <button 
                    className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600'
                    onClick={() => setRunningCode(currentCode)}>
                    Executar
                </button>
                </div>
            </div>
            </div>
            <div className='w-full h-full overflow-hidden'>
            <TuringCanvas 
                program={runningCode} 
                speed={speed}
            />
            </div>
        </>)}
    </div>;
}