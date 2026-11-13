"use client";

/**
 * Teste de threads no WASM: prova que o rayon funciona no navegador. Os detalhes vão para o
 * console (F12) e também aparecem na página.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MensagemTeste } from "./threads-teste.worker";

const TAREFAS = 32;
const PASSOS = 30_000_000;

type Ambiente = { isolado: boolean; sab: boolean; nucleos: number };

// O ambiente não muda depois que a página carrega: lê uma vez, só no navegador.
let ambienteCache: Ambiente | null = null;
const lerAmbiente = (): Ambiente => {
    ambienteCache ??= {
        isolado: window.crossOriginIsolated,
        sab: typeof SharedArrayBuffer !== "undefined",
        nucleos: navigator.hardwareConcurrency || 1,
    };
    return ambienteCache;
};
const semInscricao = () => () => {};

export default function ThreadsTeste() {
    const ambiente = useSyncExternalStore(semInscricao, lerAmbiente, () => null);
    const [rodando, setRodando] = useState(false);
    const [linhas, setLinhas] = useState<string[]>([]);
    const [fim, setFim] = useState<Extract<MensagemTeste, { tipo: "fim" }> | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        console.log("[threads-teste] página:", lerAmbiente());
        return () => workerRef.current?.terminate();
    }, []);

    const rodar = () => {
        if (!ambiente) return;
        workerRef.current?.terminate();
        setLinhas([]);
        setFim(null);
        setErro(null);
        setRodando(true);

        const worker = new Worker(new URL("./threads-teste.worker.ts", import.meta.url), { type: "module" });
        workerRef.current = worker;
        worker.onmessage = (ev: MessageEvent<MensagemTeste>) => {
            const msg = ev.data;
            if (msg.tipo === "log") {
                setLinhas((l) => [...l, msg.texto]);
            } else if (msg.tipo === "fim") {
                setFim(msg);
                setRodando(false);
            } else {
                setErro(msg.texto);
                setRodando(false);
            }
        };
        worker.onerror = (e) => {
            console.error("[threads-teste] erro no worker:", e);
            setErro(e.message || "Erro ao carregar o worker (veja o console).");
            setRodando(false);
        };
        worker.postMessage({ threads: ambiente.nucleos, tarefas: TAREFAS, passos: PASSOS });
    };

    const ganho = fim ? fim.sequencialMs / fim.paraleloMs : null;

    return (
        <main className="min-h-screen px-4 py-10">
            <div className="mx-auto max-w-3xl space-y-6">
                <div className="text-center">
                    <h1 className="mb-2 text-4xl font-bold">Teste de threads no WASM</h1>
                    <p className="text-muted-foreground">
                        Roda {TAREFAS} tarefas pesadas em Rust, primeiro em sequência e depois com rayon em várias
                        threads. Os detalhes também vão para o console (F12).
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Ambiente</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 font-mono text-sm">
                        {ambiente ? (
                            <>
                                <div>crossOriginIsolated: {String(ambiente.isolado)} {ambiente.isolado ? "✅" : "❌"}</div>
                                <div>SharedArrayBuffer: {ambiente.sab ? "disponível ✅" : "indisponível ❌"}</div>
                                <div>núcleos (hardwareConcurrency): {ambiente.nucleos}</div>
                            </>
                        ) : (
                            "verificando..."
                        )}
                    </CardContent>
                </Card>

                <div className="flex justify-center">
                    <Button size="lg" onClick={rodar} disabled={rodando || !ambiente} className="min-w-44 gap-2">
                        {rodando ? <><Loader2 className="size-4 animate-spin" /> Rodando...</> : "Rodar teste"}
                    </Button>
                </div>

                {fim && ganho !== null && (
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                {fim.paralelo.threads_usadas > 1 ? "Threads funcionando ✅" : "Rodou em uma thread só ❌"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 font-mono text-sm">
                            <div>sequencial: {fim.sequencialMs.toFixed(0)} ms</div>
                            <div>paralelo: {fim.paraleloMs.toFixed(0)} ms ({fim.paralelo.threads_no_pool} threads no pool, {fim.paralelo.threads_usadas} usadas)</div>
                            <div>ganho: {ganho.toFixed(2)}×</div>
                            <div>thread de cada tarefa: [{fim.paralelo.thread_por_tarefa.join(", ")}]</div>
                            <div>checksum (igual nos dois modos): {fim.paralelo.checksum}</div>
                        </CardContent>
                    </Card>
                )}

                {erro && (
                    <Card className="border-destructive">
                        <CardHeader>
                            <CardTitle className="text-destructive">Erro</CardTitle>
                        </CardHeader>
                        <CardContent className="font-mono text-sm whitespace-pre-wrap">{erro}</CardContent>
                    </Card>
                )}

                {linhas.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Log</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-0.5 font-mono text-xs">
                            {linhas.map((l, i) => <div key={i}>{l}</div>)}
                        </CardContent>
                    </Card>
                )}
            </div>
        </main>
    );
}
