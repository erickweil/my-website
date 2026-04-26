"use client";
import React, { useState } from 'react';
import { useWasm } from '@/lib/useWasm';
import NonSSRWrapper from '@/components/nonSSRWrapper';
import ZoomableCanvas, { ZoomEstadoType } from '@/components/Canvas/ZoomableCanvas';
import { mesclarEstado } from '@/components/Canvas/CanvasController';
import { TuringMachine2D } from '@/pkg/turing';
import { compileTuringCode } from './turing';
import { getExampleCodes } from './turingexamples';

type TuringState = ZoomEstadoType & {
    program: string | null;
    stateMap: Map<string, number> | null;
    machine: InstanceType<typeof TuringMachine2D> | null;
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
                // DEBUG: true,
                initialState: {
                    program: program || null,
                    stateMap: null,
                    machine: null,
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
                    const frameBufferWidth = machine.get_framebuffer_width();
                    const frameBufferHeight = machine.get_framebuffer_height();
                    let tapeData = estado.tapeData;
                    if(!tapeData || tapeData.length < frameBufferWidth * frameBufferHeight) {
                        console.log(`Criando novo TapeData para framebuffer de tamanho ${frameBufferWidth}x${frameBufferHeight}`);
                        tapeData = new Int32Array((frameBufferWidth * frameBufferHeight) * 2);
                        estado.tapeData = tapeData;
                    }

                    machine.update_framebuffer(
                        tapeData,
                        frameBufferWidth, 
                        frameBufferHeight
                    );

                    // Centralizar a imagem, mantendo a proporção
                    const scale = Math.max(Math.min(w / frameBufferWidth, h / frameBufferHeight), 20);
                    const offsetX = (w - frameBufferWidth * scale) / 2;
                    const offsetY = (h - frameBufferHeight * scale) / 2;
                    
                    //ctx.drawImage(imageCanvas, 0, 0, frameBufferWidth, frameBufferHeight, offsetX, offsetY, frameBufferWidth * scale, frameBufferHeight * scale);
                    ctx.fillStyle = 'black';
                    ctx.font = `${scale}px monospace`;
                    ctx.textAlign = 'center';
                    ctx.textRendering = 'optimizeSpeed';
                    for(let y = 0; y < frameBufferHeight; y++) {
                        for(let x = 0; x < frameBufferWidth; x++) {
                            const charData = tapeData[y * frameBufferWidth + x];
                            if(charData === 0) continue;
                            
                            const char = String.fromCharCode(charData);
                            ctx.fillText(char, offsetX + x * scale + scale / 2, offsetY + (y+1) * scale - scale / 8);
                        }
                    }

                    // Desenha uma borda ao redor da fita ativa (a partir do tamanho e posição)
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(
                        offsetX, 
                        offsetY, 
                        frameBufferWidth * scale, 
                        frameBufferHeight * scale,
                    );

                    // Desenha o cabeçote como um retângulo vermelho
                    const headX = machine.head_x();
                    const headY = machine.head_y();
                    ctx.strokeStyle = 'red';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(
                        offsetX + headX * scale, 
                        offsetY + headY * scale, 
                        scale, 
                        scale
                    );

                    // Abaixo do cabeçote, escreve o estado atual e posição
                    ctx.textAlign = 'left';
                    ctx.font = `${16}px monospace`;
                    let currentStateName = "?";
                    let currentStateCode = machine.get_state();
                    estado.stateMap?.forEach((code, name) => {
                        if(code === currentStateCode) {
                            currentStateName = name;
                        }
                    });
                    
                    const headText = `${currentStateName}`;
                    ctx.fillStyle = 'red';
                    ctx.fillText(headText, offsetX + headX * scale + scale/2 - 8, offsetY + headY * scale + scale + 16);



                    // Informações, logo acima da fita: estado atual, número de 1s na fita, posição do cabeçote
                    ctx.fillStyle = 'black';
                    ctx.font = `${16}px monospace`;
                    const infoText = `Etapas: ${machine.get_step_count()} Estado: ${currentStateName} Posição: (${machine.head_x()}, ${machine.head_y()})`;
                    ctx.fillText(infoText, offsetX, offsetY - 16);
                }
            }}
            onPropsChange={(estado) => {
                if(estado.program !== program) {
                    console.log("Programa atualizado, compilando e reiniciando máquina...");
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
                        const { compiledProgram, stateMap, input, defaultValue } = compileTuringCode(estado.program);
                        machine = new TuringMachine2D(compiledProgram, 0, 0, 0, defaultValue);
                        if(input) {
                            machine.preload_tape(input);
                        }
                        // machine.preload_tape(new Int32Array([
                        //     0, 0, toUnicode('0'),
                        // ]));

                        mesclarEstado(estado, {
                            machine: machine || null,
                            tapeData: null, // força recriação do tapeData para o novo programa
                            stateMap: stateMap,
                        });
                    }
                }
                if(machine) {
                    if(speed === undefined || speed <= 0) {
                        if(estado.stepTime < performance.now()) {
                            machine.run(1);
                            mesclarEstado(estado, {
                                stepTime: performance.now() + 150, // espera um pouco antes de permitir o próximo passo, para limitar a velocidade
                            });
                        }
                    } else if(speed === 1) {
                        machine.run(1);
                    } else if(speed === 2) {
                        machine.run(100);
                    } else if(speed === 3) {
                        machine.run(1000);
                    } else {
                        const timeStart = performance.now();
                        do {
                            if(!machine.run(speed * 1000)) {
                                break; // parou por halt
                            }
                        } while(performance.now() - timeStart < 10); // limita a execução para manter a UI responsiva
                    }

                    mesclarEstado(estado, {
                        machine: machine
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
                    max="3" 
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
            
            <TuringCanvas 
                program={runningCode} 
                speed={speed}
            />
        </>)}
    </div>;
}