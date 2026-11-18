import { useRef, useState } from "react";
import { Copy, Download, FolderOpen, Plus, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lerAreaDeTrabalho } from "../modelo/armazenamento";
import { exportarProjeto, importarProjetos } from "../modelo/exportacao";
import { extrairFormularioAntigo, projetoDoFormatoAntigo } from "../modelo/formato-antigo";
import type { AreaDeTrabalho, Id } from "../modelo/modelo";
import { duplicarProjeto, novoProjeto } from "../modelo/operacoes";
import { cn } from "@/lib/utils";
import { Cabecalho, baixarArquivo, nomeDeArquivo, plural } from "../componentes/comuns";
import type { Contexto } from "../useAreaDeTrabalho";

/** Dados salvos pela versão anterior da página. */
const CHAVE_ANTIGA = "dadosGeracaoHorario";
const CHAVE_CONFIG_ANTIGA = "configGeracaoHorario";
const CHAVE_ANTIGA_TRATADA = "geradorHorario:versaoAnteriorTratada";

/** Acrescenta à área um projeto vindo do JSON da versão anterior. */
function importarAntigo(area: AreaDeTrabalho, dados: unknown, nome: string): { area: AreaDeTrabalho; projetoId: Id } | null {
    const antigo = extrairFormularioAntigo(dados);
    if (!antigo) return null;
    const { projeto, professores } = projetoDoFormatoAntigo(antigo.formulario, nome, antigo.tempos);
    return {
        area: {
            ...area,
            cadastros: { ...area.cadastros, professores: [...area.cadastros.professores, ...professores] },
            projetos: [...area.projetos, projeto],
        },
        projetoId: projeto.id,
    };
}

export function TelaProjetos({
    area,
    mudarArea,
    projetoAbertoId,
    abrir,
}: Contexto & { projetoAbertoId: Id | null; abrir: (id: Id, destino?: "horario" | "quadro") => void }) {
    const [nome, setNome] = useState("");
    const [erro, setErro] = useState<string | null>(null);
    const arquivo = useRef<HTMLInputElement>(null);
    const [temAntigo, setTemAntigo] = useState(
        () => localStorage.getItem(CHAVE_ANTIGA) !== null && localStorage.getItem(CHAVE_ANTIGA_TRATADA) === null,
    );

    const criar = () => {
        const projeto = novoProjeto(nome.trim() || `Projeto ${area.projetos.length + 1}`);
        mudarArea((a) => ({ ...a, projetos: [...a.projetos, projeto] }));
        setNome("");
        // Projeto novo começa pelo quadro de horários
        abrir(projeto.id, "quadro");
    };

    /** Baixa o projeto com os cursos, professores e ambientes que ele usa. */
    const exportar = (id: Id) => {
        const arquivo = exportarProjeto(area, id);
        baixarArquivo(`${nomeDeArquivo("horario", arquivo.projetos[0].nome)}.json`, JSON.stringify(arquivo, null, 2), "application/json");
    };

    const importar = async (file: File) => {
        setErro(null);
        const texto = await file.text();
        const leitura = lerAreaDeTrabalho(texto);
        if (leitura.ok) {
            if (leitura.area.projetos.length === 0) {
                setErro("O arquivo não tem nenhum projeto.");
                return;
            }
            // Entra como projeto novo; os cadastros que já existem são reaproveitados
            const r = importarProjetos(area, leitura.area);
            mudarArea(() => r.area);
            abrir(r.ids[0]);
            return;
        }
        // Não é uma área de trabalho: pode ser um arquivo exportado pela versão anterior
        let dados: unknown = null;
        try {
            dados = JSON.parse(texto);
        } catch {
            /* o erro de leitura abaixo já diz que não é JSON */
        }
        const r = importarAntigo(area, dados, file.name.replace(/\.json$/i, ""));
        if (r) {
            mudarArea(() => r.area);
            abrir(r.projetoId);
        } else {
            setErro(leitura.erro);
        }
    };

    const importarDoNavegador = () => {
        let config: unknown = null;
        let formData: unknown = null;
        try {
            formData = JSON.parse(localStorage.getItem(CHAVE_ANTIGA) ?? "null");
            config = JSON.parse(localStorage.getItem(CHAVE_CONFIG_ANTIGA) ?? "null");
        } catch {
            /* dados corrompidos: cai no erro abaixo */
        }
        const r = importarAntigo(area, { formData, config }, "Versão anterior");
        if (r) {
            mudarArea(() => r.area);
            abrir(r.projetoId);
        } else {
            setErro("Os dados da versão anterior não puderam ser lidos.");
        }
        dispensarAntigo();
    };
    const dispensarAntigo = () => {
        localStorage.setItem(CHAVE_ANTIGA_TRATADA, "1");
        setTemAntigo(false);
    };

    return (
        <div>
            <Cabecalho
                titulo="Projetos de horário"
                ajuda="Um projeto por período letivo (ex.: 2027/1). Os cadastros são compartilhados; tudo fica salvo neste navegador."
                acoes={
                    <>
                        <Button variant="outline" size="sm" title="Abrir um projeto exportado (.json) como projeto novo" onClick={() => arquivo.current?.click()}>
                            <Upload /> Importar projeto
                        </Button>
                        <input
                            ref={arquivo}
                            type="file"
                            accept=".json,application/json"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void importar(file);
                                e.target.value = "";
                            }}
                        />
                    </>
                }
            />

            {temAntigo && (
                <Alert className="mb-4">
                    <AlertTitle>Há dados da versão anterior do gerador neste navegador</AlertTitle>
                    <AlertDescription>
                        <p>Eles podem virar um projeto aqui, com as turmas, disciplinas e professores que você já tinha cadastrado.</p>
                        <div className="mt-3 flex gap-2">
                            <Button size="sm" onClick={importarDoNavegador}>Importar como projeto</Button>
                            <Button size="sm" variant="ghost" onClick={dispensarAntigo}>Ignorar</Button>
                        </div>
                    </AlertDescription>
                </Alert>
            )}
            {erro && (
                <Alert variant="destructive" className="mb-4">
                    <AlertTitle>Não foi possível importar o arquivo</AlertTitle>
                    <AlertDescription className="whitespace-pre-wrap">{erro}</AlertDescription>
                </Alert>
            )}

            {area.projetos.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
                    <p className="text-lg font-medium">Comece criando um projeto de horário</p>
                    <p className="mt-1 text-sm text-muted-foreground">Um projeto por período letivo, por exemplo “2027/1”.</p>
                    <FormularioNovo nome={nome} setNome={setNome} criar={criar} className="mx-auto mt-5 max-w-sm" />
                </div>
            ) : (
                <>
                    <div className="space-y-2">
                        {area.projetos.map((p) => {
                            const aberto = p.id === projetoAbertoId;
                            return (
                                <div
                                    key={p.id}
                                    className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border p-3", aberto ? "border-primary bg-primary/5" : "border-border")}
                                >
                                    <div className="min-w-48 flex-1">
                                        <Input
                                            aria-label="Nome do projeto"
                                            className="h-8 font-medium"
                                            value={p.nome}
                                            onChange={(e) =>
                                                mudarArea((a) => ({ ...a, projetos: a.projetos.map((x) => (x.id === p.id ? { ...x, nome: e.target.value } : x)) }))
                                            }
                                        />
                                        <p className="mt-1 px-3 text-xs text-muted-foreground">
                                            {plural(p.turmas.length, "turma", "turmas")}
                                            {p.horario ? (p.horario.completo ? " · horário completo" : " · horário incompleto") : " · sem horário"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button size="sm" variant={aberto ? "default" : "outline"} onClick={() => abrir(p.id)}>
                                            <FolderOpen /> {aberto ? "Aberto" : "Abrir"}
                                        </Button>
                                        <Button size="icon-sm" variant="ghost" title="Exportar este projeto (.json)" aria-label="Exportar" onClick={() => exportar(p.id)}>
                                            <Download />
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            title="Duplicar"
                                            aria-label="Duplicar"
                                            onClick={() => {
                                                const copia = duplicarProjeto(p, `${p.nome} (cópia)`);
                                                mudarArea((a) => ({ ...a, projetos: [...a.projetos, copia] }));
                                            }}
                                        >
                                            <Copy />
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            title="Excluir"
                                            aria-label="Excluir"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => {
                                                if (confirm(`Excluir o projeto “${p.nome}”? Não dá para desfazer.`)) {
                                                    mudarArea((a) => ({ ...a, projetos: a.projetos.filter((x) => x.id !== p.id) }));
                                                }
                                            }}
                                        >
                                            <Trash2 />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <FormularioNovo nome={nome} setNome={setNome} criar={criar} className="mt-4 max-w-md" />
                </>
            )}
        </div>
    );
}

function FormularioNovo({ nome, setNome, criar, className }: { nome: string; setNome: (n: string) => void; criar: () => void; className?: string }) {
    return (
        <form
            className={cn("flex gap-2", className)}
            onSubmit={(e) => {
                e.preventDefault();
                criar();
            }}
        >
            <Input placeholder="Nome do novo projeto" value={nome} onChange={(e) => setNome(e.target.value)} />
            <Button type="submit" className="shrink-0">
                <Plus /> Novo projeto
            </Button>
        </form>
    );
}
