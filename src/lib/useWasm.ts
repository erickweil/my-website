// Custom hook que pode ser usado para carregar e interagir com o módulo WASM

import { useEffect, useState } from "react";

import * as wasm from '@/pkg/rust_wasm.js';

export const useWasm = () => {
    const [wasmReady, setWasmReady] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        async function initWasm() {
            try {
                const timeStart = performance.now();
                await wasm.default();
                console.log(`WASM Init time: ${performance.now() - timeStart} ms`);
                setWasmReady(true);
            } catch (error) {
                console.error("Error initializing WASM:", error);
            }
        };
        initWasm();
    }, []);

    return wasmReady ? wasm : null;
};