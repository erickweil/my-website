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
    // Tamanho do pool; vazio = todos os núcleos. Útil para comparar, por exemplo, 8 x 16 threads.
    const [threadsPool, setThreadsPool] = useState("");

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
        const threads = Math.max(1, Math.min(parseInt(threadsPool) || ambiente.nucleos, 64));
        worker.postMessage({ threads, tarefas: TAREFAS, passos: PASSOS });
    };

    const ganho = fim ? fim.sequencialMs / fim.paraleloMs : null;

    return (
        <main className="min-h-screen px-4 py-10">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="text-center">
                    <h1 className="mb-2 text-4xl font-bold">Teste de threads no WASM</h1>
                    <p className="text-muted-foreground">
                        Roda {TAREFAS} tarefas pesadas em Rust, primeiro em sequência e depois com rayon em várias
                        threads, e mede o motor genético nos dois modos. Os detalhes também vão para o console (F12).
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

                <div className="flex items-center justify-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        threads no pool
                        <input
                            type="number"
                            min={1}
                            max={64}
                            placeholder={ambiente ? String(ambiente.nucleos) : ""}
                            value={threadsPool}
                            onChange={(e) => setThreadsPool(e.target.value)}
                            className="h-9 w-20 rounded-md border bg-background px-2 text-center font-mono"
                        />
                    </label>
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

                {fim && fim.ga.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Motor genético com {fim.threads} threads</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <table className="w-full font-mono text-sm">
                                <thead>
                                    <tr className="text-left text-muted-foreground">
                                        <th className="py-1">problema</th>
                                        <th className="text-right">1 thread (ger/s)</th>
                                        <th className="text-right">paralelo (ger/s)</th>
                                        <th className="text-right">ganho</th>
                                        <th className="text-right">idêntico</th>
                                        <th className="text-right">automático</th>
                                        <th className="text-right">{fim.ga[0].ilhas} ilhas (ger/s equiv.)</th>
                                        <th className="text-right">ganho</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fim.ga.map((r) => (
                                        <tr key={r.problema} className="border-t">
                                            <td className="py-1">{r.problema}</td>
                                            <td className="text-right">{r.geracoes_por_s_sequencial.toFixed(0)}</td>
                                            <td className="text-right">{r.geracoes_por_s_paralelo.toFixed(0)}</td>
                                            <td className="text-right">{r.ganho.toFixed(2)}×</td>
                                            <td className="text-right">{r.resultado_identico ? "✅" : "❌"}</td>
                                            <td className="text-right">{r.automatico_escolheu_paralelo ? "paralelo" : "sequencial"}</td>
                                            <td className="text-right">{r.geracoes_por_s_ilhas.toFixed(0)}</td>
                                            <td className="text-right">{r.ganho_ilhas.toFixed(2)}×</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>
                )}

                {fim && fim.exaustivo.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Busca exaustiva do Pencilmark com {fim.threads} threads</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <table className="w-full font-mono text-sm">
                                <thead>
                                    <tr className="text-left text-muted-foreground">
                                        <th className="py-1">problema</th>
                                        <th className="text-right">soluções</th>
                                        <th className="text-right">nós</th>
                                        <th className="text-right">1 thread (ms)</th>
                                        <th className="text-right">paralelo (ms)</th>
                                        <th className="text-right">ganho</th>
                                        <th className="text-right">mesmo resultado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fim.exaustivo.map((r) => (
                                        <tr key={r.problema} className="border-t">
                                            <td className="py-1">{r.problema}</td>
                                            <td className="text-right">{r.solucoes}</td>
                                            <td className="text-right">{r.nos}</td>
                                            <td className="text-right">{r.ms_sequencial.toFixed(0)}</td>
                                            <td className="text-right">{r.ms_paralelo.toFixed(0)}</td>
                                            <td className="text-right">{r.ganho.toFixed(2)}×</td>
                                            <td className="text-right">{r.mesmo_resultado ? "✅" : "❌"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
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
