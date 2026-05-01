"use client";
import React, { useCallback, useState } from 'react';
import { useWasm } from '@/lib/useWasm';
import { TuringCanvas } from './turingCanvas';
import TuringEditor, { exampleCodes } from './turingEditor';

export default function TuringPage() {
    const wasm = useWasm();

    const [currentCode, setCurrentCode] = useState(exampleCodes["busy beaver"]);
    const handleCodeChange = useCallback((value: string) => setCurrentCode(value), []);

    const [runningCode, setRunningCode] = useState<string | null>(currentCode);
    const [programKey, setProgramKey] = useState(1);
    const [paused, setPaused] = useState(false);
    const [speed, setSpeed] = useState(0);
    const [centerTapeRequest, setCenterTapeRequest] = useState(0);

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

                <TuringEditor value={currentCode} onChange={handleCodeChange} />

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

                    {/* Recentralizar fita */}
                    <div className='flex items-center gap-3'>
                        <button
                            className='px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-medium'
                            onClick={() => {
                                setCenterTapeRequest(r => r + 1);
                            }}
                        >
                            ⤾ Recentralizar fita
                        </button>
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
                    centerTapeRequest={centerTapeRequest}
                />
            </div>
        </>)}
    </div>;
}