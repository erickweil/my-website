"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { Trash2, Plus, X, Loader2, TriangleAlert, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { DIAS_SEMANA_MAP, FormularioHorario, HorarioDia, HorariosPorDia, HorarioWorkerTaskValue, TODOS_OS_DIAS, type TurmaHorarioResult } from "./horario-solver";
import { MultiSelect } from "@/components/multiSelect";
import { raceWorkers } from "@/lib/workerRace";

// ─── Constantes ───────────────────────────────────────────────────────────────
const PALETA_CORES = [
    "#649cb1", "#f18841", "#84f8c8", "#9c9b53", "#6c76ad", "#ce74f2",
    "#179fe9", "#ec2d2d", "#2b8a27", "#f79c15", "#3339f3", "#f17cc0",
    "#a75656", "#4e958a", "#a01e6a", "#bec02b", "#589140", "#1f9e78",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getContrastColor = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? "#000" : "#fff";
};

const execQuadroHorarioWorker = async (formData: FormularioHorario, diasAtivos: HorarioDia[]) => {
    const nWorkers = navigator.hardwareConcurrency || 8;
    const resultado = await raceWorkers<HorarioWorkerTaskValue>({
        n: nWorkers,
        initMessage: (workerID) => ({
            action: "solucionarQuadroHorario",
            // Worker 0 irá tentar resolver sem reinícios
            baseIter: workerID === 0 ? null : 10,
            formData,
            diasAtivos
        }),
        createWorker: () => new Worker(new URL('./horario-solver-task.worker.ts', import.meta.url)),
        onMessage: (workerID, msg) => {
            if (!msg.value) return;
            console.log(`Worker ${workerID}: Iteração ${msg.value.iter}, profundidade ${msg.value.depth}`);
            //progressCallback(workerID, msg.value.iter, msg.value.depth);
        }
    });

    const quadro = resultado.solucao;
    if (!quadro) {
        throw new Error("Falha ao gerar solução!");
    }

    return resultado;
};

// ─── Componente: TabelaHorariosCheckbox ──────────────────────────────────────
function TabelaHorariosCheckbox({
    horarios,
    onChange,
    dias,
    quantidadeTempos,
}: {
    horarios: HorariosPorDia;
    onChange: (h: HorariosPorDia) => void;
    dias: HorarioDia[];
    quantidadeTempos: number;
}) {
    const handleChange = (dia: string, tempo: number) => {
        const novos = { ...horarios } as Record<string, number[]>;
        const lista = [...(novos[dia] ?? [])];
        if (lista.includes(tempo)) {
            novos[dia] = lista.filter((t) => t !== tempo);
        } else {
            novos[dia] = [...lista, tempo].sort((a, b) => a - b);
        }
        onChange(novos);
    };

    const tempos = Array.from({ length: quantidadeTempos }, (_, i) => i + 1);

    return (
        <div className="rounded-xl border border-border">
            <Table className="table-fixed">
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-14 text-center">Tempo</TableHead>
                        {dias.map((dia) => (
                            <TableHead key={dia} className="text-center">
                                {DIAS_SEMANA_MAP[dia] ?? dia}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {tempos.map((tempo) => (
                        <TableRow key={tempo}>
                            <TableCell className="p-2 text-center font-medium">{tempo}</TableCell>
                            {dias.map((dia) => (
                                <TableCell key={`${dia}-${tempo}`} className="p-0 text-center">
                                    <div className="flex justify-center">
                                        <Checkbox
                                            className={"size-5"}
                                            checked={!!(horarios[dia]?.includes(tempo))}
                                            onCheckedChange={() => handleChange(dia, tempo)}
                                        />
                                    </div>
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

// ─── Componente: Legenda de professores ──────────────────────────────────────
function LegendaProfessores({ cores }: { cores: Record<string, string> }) {
    const entries = Object.entries(cores);
    if (entries.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2">
            {entries.map(([nome, cor]) => (
                <span
                    key={nome}
                    className="rounded-full px-3 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: cor, color: getContrastColor(cor) }}
                >
                    {nome}
                </span>
            ))}
        </div>
    );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function GeradorHorario() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [horarioGerado, setHorarioGerado] = useState<TurmaHorarioResult[] | null>(null);
    const [abaAtiva, setAbaAtiva] = useState("0");
    const [professoresCores, setProfessoresCores] = useState<Record<string, string>>({});
    const [professoresDisciplinas, setProfessoresDisciplinas] = useState<Record<string, string>>({});

    // ─── Configurações de grade ───────────────────────────────────────────────
    const [quantidadeTempos, setQuantidadeTempos] = useState(5);
    const [diasAtivos, setDiasAtivos] = useState<HorarioDia[]>(["seg", "ter", "qua", "qui", "sex"]);

    const toggleDia = (dia: HorarioDia) => {
        setDiasAtivos((prev) => {
            const prox = prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia];
            // mantém a ordem canônica
            return TODOS_OS_DIAS.filter((d) => prox.includes(d));
        });
    };

    const { control, register, watch, handleSubmit, reset } = useForm<FormularioHorario>({
        defaultValues: {
            turmas: [],
            disciplinas: [],
            disciplinas_unidas: [],
            professores: [],
        },
    });

    // Carrega dados e configurações salvos do localStorage
    useEffect(() => {
        const stored = localStorage.getItem("dadosGeracaoHorario");
        if (stored) {
            try {
                reset(JSON.parse(stored));
            } catch {
                /* ignora dados corrompidos */
            }
        }
        const config = localStorage.getItem("configGeracaoHorario");
        if (config) {
            try {
                const parsed = JSON.parse(config);
                if (typeof parsed.quantidadeTempos === "number") setQuantidadeTempos(parsed.quantidadeTempos);
                if (Array.isArray(parsed.diasAtivos)) setDiasAtivos(parsed.diasAtivos);
            } catch {
                /* ignora config corrompida */
            }
        }
    }, [reset]);

    const { fields: turmas, append: addTurma, remove: removeTurma } = useFieldArray({
        control,
        name: "turmas",
    });
    const { fields: disciplinas, append: addDisciplina, remove: removeDisciplina } = useFieldArray({
        control,
        name: "disciplinas",
    });
    const {
        fields: disciplinasUnidas,
        append: addDisciplinaUnida,
        remove: removeDisciplinaUnida,
    } = useFieldArray({ control, name: "disciplinas_unidas" });
    const { fields: professores, append: addProfessor, remove: removeProfessor } = useFieldArray({
        control,
        name: "professores",
    });

    const turmasWatch = watch("turmas");
    const todasDisciplinas = watch("disciplinas").map((d) => d.nome).filter(Boolean);

    const handleGerar = async (formData: FormularioHorario) => {
        setIsLoading(true);
        setError(null);
        //setHorarioGerado(null);

        // Monta mapas de cores e professor→disciplina
        const cores: Record<string, string> = {};
        const discProf: Record<string, string> = {};
        formData.professores.forEach((prof, i) => {
            cores[prof.nome] = PALETA_CORES[i % PALETA_CORES.length];
            prof.disciplinas.forEach((d) => {
                if (!discProf[d]) discProf[d] = prof.nome;
            });
        });
        setProfessoresCores(cores);
        setProfessoresDisciplinas(discProf);

        // Normalizar dados fora dos intervalos configurados
        formData.turmas.forEach((turma) => {
            Object.entries(turma.horarios).forEach(([dia, tempos]) => {
                turma.horarios[dia as HorarioDia] = tempos.filter((t) => t >= 1 && t <= quantidadeTempos);
            });
        });
        formData.professores.forEach((prof) => {
            Object.entries(prof.horarios).forEach(([dia, tempos]) => {
                prof.horarios[dia as HorarioDia] = tempos.filter((t) => t >= 1 && t <= quantidadeTempos);
            });
        });

        // Persiste dados e configurações no localStorage
        localStorage.setItem("dadosGeracaoHorario", JSON.stringify(formData));
        localStorage.setItem("configGeracaoHorario", JSON.stringify({ quantidadeTempos, diasAtivos }));

        try {
            const resultado = await execQuadroHorarioWorker(formData, diasAtivos);
            setHorarioGerado(resultado.solucao ?? null);
            if (!resultado.completo) {
                setError("Não foi possível gerar um horário completo com as configurações fornecidas.");
            }
        } catch (e) {
            console.error("Erro ao gerar horário:", e);
            setError("Erro ao gerar o horário:" + (e instanceof Error ? ` ${e.message}` : " Desconecido."));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <main className="min-h-screen px-4 py-10">
            <div className="mx-auto max-w-4xl">
                <h1 className="mb-2 text-center text-4xl font-bold">Gerador de Horários</h1>
                <p className="mb-10 text-center text-muted-foreground">
                    Configure turmas, disciplinas e professores para gerar um horário escolar automaticamente.
                </p>

                <form onSubmit={handleSubmit(handleGerar)} className="space-y-8">

                    <Card>
                        <CardHeader>
                            <CardTitle>Configurações da Grade</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            {/* Quantidade de tempos */}
                            <div className="flex items-center gap-4">
                                <Label className="min-w-fit">Tempos por dia</Label>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon-sm"
                                        onClick={() => setQuantidadeTempos((v) => Math.max(1, v - 1))}
                                    >
                                        <span className="text-base leading-none">−</span>
                                    </Button>
                                    <span className="w-8 text-center font-medium tabular-nums">{quantidadeTempos}</span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon-sm"
                                        onClick={() => setQuantidadeTempos((v) => Math.min(15, v + 1))}
                                    >
                                        <span className="text-base leading-none">+</span>
                                    </Button>
                                </div>
                            </div>

                            {/* Dias ativos */}
                            <div className="space-y-2">
                                <Label>Dias da semana</Label>
                                <div className="flex flex-wrap gap-2">
                                    {TODOS_OS_DIAS.map((dia) => {
                                        const ativo = diasAtivos.includes(dia);
                                        return (
                                            <button
                                                key={dia}
                                                type="button"
                                                onClick={() => toggleDia(dia)}
                                                className={cn(
                                                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                                                    ativo
                                                        ? "border-primary bg-primary text-primary-foreground"
                                                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                {DIAS_SEMANA_MAP[dia]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => reset({ turmas: [], disciplinas: [], disciplinas_unidas: [], professores: [] })}
                            >
                                <X className="size-4" /> Limpar tudo
                            </Button>
                        </CardContent>
                    </Card>
                    {/* ── 1. Turmas ──────────────────────────────────────────────────── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>1. Turmas</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {turmas.map((turma, index) => (
                                <div key={turma.id} className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
                                    <div className="flex items-end gap-3">
                                        <div className="flex-1 space-y-1.5">
                                            <Label htmlFor={`turma-nome-${index}`}>Nome da Turma</Label>
                                            <Input
                                                id={`turma-nome-${index}`}
                                                placeholder="Ex: 1º Ano A"
                                                {...register(`turmas.${index}.nome`)}
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            onClick={() => removeTurma(index)}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                    <div>
                                        <p className="mb-2 text-sm text-muted-foreground">Horários disponíveis:</p>
                                        <Controller
                                            control={control}
                                            name={`turmas.${index}.horarios`}
                                            render={({ field }) => (
                                                <TabelaHorariosCheckbox
                                                    horarios={field.value}
                                                    onChange={field.onChange}
                                                    dias={diasAtivos}
                                                    quantidadeTempos={quantidadeTempos}
                                                />
                                            )}
                                        />
                                    </div>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                className="gap-2"
                                onClick={() => addTurma({ nome: "", horarios: {} })}
                            >
                                <Plus className="size-4" /> Adicionar Turma
                            </Button>
                        </CardContent>
                    </Card>

                    {/* ── 2. Disciplinas ─────────────────────────────────────────────── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>2. Disciplinas</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {turmas.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    Adicione pelo menos uma turma primeiro.
                                </p>
                            ) : (
                                <Tabs
                                    value={abaAtiva}
                                    onValueChange={(v) => {
                                        if (v != null) setAbaAtiva(v);
                                    }}
                                    className="flex-col"
                                >
                                    <TabsList>
                                        {turmasWatch.map((turma, i) => (
                                            <TabsTrigger key={i} value={i.toString()}>
                                                {turma.nome || `Turma ${i + 1}`}
                                            </TabsTrigger>
                                        ))}
                                    </TabsList>

                                    {turmasWatch.map((turma, tIndex) => {
                                        const disciplinasDaTurma = disciplinas
                                            .map((d, globalIndex) => ({ ...d, globalIndex }))
                                            .filter((d) => d.turma === turma.nome);

                                        return (
                                            <TabsContent
                                                key={tIndex}
                                                value={tIndex.toString()}
                                                className="pt-4"
                                            >
                                                <div className="rounded-xl border border-border overflow-hidden">
                                                    <Table className="table-fixed">
                                                        <TableHeader>
                                                            <TableRow className="bg-muted/50">
                                                                <TableHead>Disciplina</TableHead>
                                                                <TableHead className="w-32 text-center">Aulas/sem.</TableHead>
                                                                <TableHead className="w-32 text-center">Agrupar</TableHead>
                                                                <TableHead className="w-20 text-center">Dividir</TableHead>
                                                                <TableHead className="w-12" />
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {disciplinasDaTurma.length === 0 ? (
                                                                <TableRow>
                                                                    <TableCell
                                                                        colSpan={5}
                                                                        className="text-center text-muted-foreground py-6"
                                                                    >
                                                                        Nenhuma disciplina. Clique em &ldquo;Adicionar&rdquo; para começar.
                                                                    </TableCell>
                                                                </TableRow>
                                                            ) : (
                                                                disciplinasDaTurma.map((disciplina) => (
                                                                    <TableRow key={disciplina.id}>
                                                                        <TableCell>
                                                                            <Input
                                                                                placeholder="Ex: Matemática"
                                                                                className="h-8"
                                                                                {...register(`disciplinas.${disciplina.globalIndex}.nome`)}
                                                                            />
                                                                        </TableCell>
                                                                        <TableCell>
                                                                            <Input
                                                                                type="number"
                                                                                min={1}
                                                                                className="h-8 text-center"
                                                                                {...register(
                                                                                    `disciplinas.${disciplina.globalIndex}.aulas`,
                                                                                    { valueAsNumber: true }
                                                                                )}
                                                                            />
                                                                        </TableCell>
                                                                        <TableCell>
                                                                            <Input
                                                                                type="number"
                                                                                min={0}
                                                                                className="h-8 text-center"
                                                                                {...register(
                                                                                    `disciplinas.${disciplina.globalIndex}.agrupar`,
                                                                                    { valueAsNumber: true }
                                                                                )}
                                                                            />
                                                                        </TableCell>
                                                                        <TableCell>
                                                                            <div className="flex justify-center">
                                                                                <Controller
                                                                                    control={control}
                                                                                    name={`disciplinas.${disciplina.globalIndex}.dividir`}
                                                                                    render={({ field }) => (
                                                                                        <Checkbox
                                                                                            className="size-5"
                                                                                            checked={!!field.value}
                                                                                            onCheckedChange={field.onChange}
                                                                                        />
                                                                                    )}
                                                                                />
                                                                            </div>
                                                                        </TableCell>
                                                                        <TableCell className="text-center">
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="icon-sm"
                                                                                onClick={() => removeDisciplina(disciplina.globalIndex)}
                                                                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                                            >
                                                                                <Trash2 className="size-4" />
                                                                            </Button>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                ))
                                                            )}
                                                        </TableBody>
                                                    </Table>
                                                </div>

                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="mt-3 gap-2"
                                                    onClick={() =>
                                                        addDisciplina({
                                                            nome: "",
                                                            turma: turma.nome,
                                                            aulas: 2,
                                                            agrupar: 0,
                                                            dividir: false,
                                                        })
                                                    }
                                                >
                                                    <Plus className="size-4" /> Adicionar Disciplina
                                                </Button>
                                            </TabsContent>
                                        );
                                    })}
                                </Tabs>
                            )}
                        </CardContent>
                    </Card>

                    {/* ── 3. Unir Disciplinas ────────────────────────────────────────── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>3. Unir Disciplinas</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {disciplinasUnidas.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    Nenhum grupo criado. Use esta seção para definir disciplinas que devem ocorrer
                                    no mesmo horário (turmas diferentes).
                                </p>
                            )}

                            {disciplinasUnidas.map((grupo, index) => (
                                <div key={grupo.id} className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                                    <div className="flex items-end gap-3">
                                        <div className="flex-1 space-y-1.5">
                                            <Label>Nome do Grupo</Label>
                                            <Input
                                                placeholder="Ex: Exatas"
                                                {...register(`disciplinas_unidas.${index}.grupo`)}
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            onClick={() => removeDisciplinaUnida(index)}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Disciplinas para unir</Label>
                                        <Controller
                                            control={control}
                                            name={`disciplinas_unidas.${index}.disciplinas`}
                                            render={({ field }) => (
                                                <MultiSelect
                                                    options={todasDisciplinas}
                                                    value={field.value ?? []}
                                                    onChange={field.onChange}
                                                    placeholder="Selecione as disciplinas..."
                                                />
                                            )}
                                        />
                                    </div>
                                </div>
                            ))}

                            <Button
                                type="button"
                                variant="outline"
                                className="gap-2"
                                onClick={() => addDisciplinaUnida({ grupo: "", disciplinas: [] })}
                            >
                                <Plus className="size-4" /> Adicionar Grupo
                            </Button>
                        </CardContent>
                    </Card>

                    {/* ── 4. Professores ─────────────────────────────────────────────── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>4. Professores</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {professores.map((professor, index) => (
                                <div key={professor.id} className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
                                    <div className="flex items-end gap-3">
                                        <div className="flex-1 space-y-1.5">
                                            <Label>Nome</Label>
                                            <Input
                                                placeholder="Ex: Prof. Silva"
                                                {...register(`professores.${index}.nome`)}
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            onClick={() => removeProfessor(index)}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label>Disciplinas que ministra</Label>
                                        <Controller
                                            control={control}
                                            name={`professores.${index}.disciplinas`}
                                            render={({ field }) => (
                                                <MultiSelect
                                                    options={todasDisciplinas}
                                                    value={field.value ?? []}
                                                    onChange={field.onChange}
                                                    placeholder="Selecione as disciplinas..."
                                                />
                                            )}
                                        />
                                    </div>

                                    <div>
                                        <p className="mb-2 text-sm text-muted-foreground">
                                            Preferências de horário:
                                        </p>
                                        <Controller
                                            control={control}
                                            name={`professores.${index}.horarios`}
                                            render={({ field }) => (
                                                <TabelaHorariosCheckbox
                                                    horarios={field.value}
                                                    onChange={field.onChange}
                                                    dias={diasAtivos}
                                                    quantidadeTempos={quantidadeTempos}
                                                />
                                            )}
                                        />
                                    </div>
                                </div>
                            ))}

                            <Button
                                type="button"
                                variant="outline"
                                className="gap-2"
                                onClick={() => addProfessor({ nome: "", disciplinas: [], horarios: {} })}
                            >
                                <Plus className="size-4" /> Adicionar Professor
                            </Button>
                        </CardContent>
                    </Card>

                    {/* ── 5. Gerar e Visualizar ──────────────────────────────────────── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>5. Gerar e Visualizar Horário</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex justify-center">
                                <Button
                                    type="submit"
                                    size="lg"
                                    disabled={isLoading}
                                    className="min-w-44 gap-2"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="size-4 animate-spin" />
                                            Gerando...
                                        </>
                                    ) : (
                                        "Gerar Horário"
                                    )}
                                </Button>
                            </div>

                            {error && (
                                <Alert variant="destructive">
                                    <TriangleAlert className="size-4" />
                                    <AlertTitle>Erro</AlertTitle>
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}

                            {horarioGerado && (
                                <div className="space-y-8">
                                    <div>
                                        <h3 className="mb-3 text-base font-semibold text-green-600 dark:text-green-400">
                                            ✓ Horário gerado com sucesso!
                                        </h3>
                                        <LegendaProfessores cores={professoresCores} />
                                    </div>

                                    {horarioGerado.map((resultado, i) => (
                                        <div key={i} className="space-y-2">
                                            <h4 className="text-base font-medium">{resultado.turma}</h4>
                                            <div className="rounded-xl border border-border">
                                                <Table className="table-fixed">
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead className="w-14 text-center font-semibold">
                                                                Tempo
                                                            </TableHead>
                                                            {resultado.horario.map(({ dia }) => (
                                                                <TableHead
                                                                    key={dia}
                                                                    className="text-center font-semibold"
                                                                >
                                                                    {DIAS_SEMANA_MAP[dia] ?? dia}
                                                                </TableHead>
                                                            ))}
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {Array.from({ length: quantidadeTempos }, (_, t) => (
                                                            <TableRow key={t}>
                                                                <TableCell className="text-center font-medium">
                                                                    {t + 1}
                                                                </TableCell>
                                                                {resultado.horario.map(({ dia, tempos }) => {
                                                                    const disc = tempos[t];
                                                                    const prof = disc
                                                                        ? professoresDisciplinas[disc]
                                                                        : undefined;
                                                                    const cor = prof ? professoresCores[prof] : undefined;
                                                                    return (
                                                                        <TableCell
                                                                            key={dia}
                                                                            className="border border-border text-center text-xs overflow-hidden"
                                                                            style={{
                                                                                backgroundColor: cor,
                                                                                color: cor ? getContrastColor(cor) : undefined,
                                                                            }}
                                                                        >
                                                                            <p className="line-clamp-2 text-balance">
                                                                                {disc ?? "—"}
                                                                            </p>
                                                                        </TableCell>
                                                                    );
                                                                })}
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </form>
            </div>
        </main>
    );
}