import { useRef, useState } from "react";
import { Copy, Download, FolderOpen, Plus, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lerAreaDeTrabalho } from "../modelo/armazenamento";
import { extrairFormularioAntigo, projetoDoFormatoAntigo } from "../modelo/formato-antigo";
import type { AreaDeTrabalho, Id } from "../modelo/modelo";
import { duplicarProjeto, novoProjeto } from "../modelo/operacoes";
import { Cabecalho, Vazio, plural } from "../componentes/comuns";
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
}: Contexto & { projetoAbertoId: Id | null; abrir: (id: Id) => void }) {
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
        abrir(projeto.id);
    };

    const exportar = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(area, null, 2)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "horarios.json";
        a.click();
        URL.revokeObjectURL(url);
    };

    const importar = async (file: File) => {
        setErro(null);
        const texto = await file.text();
        const leitura = lerAreaDeTrabalho(texto);
        if (leitura.ok) {
            const temDados = area.projetos.length > 0 || area.cadastros.professores.length > 0;
            if (temDados && !confirm("Importar este arquivo substitui todos os cadastros e projetos atuais. Continuar?")) return;
            mudarArea(() => leitura.area);
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
                ajuda="Cada projeto é o horário de um período letivo (por exemplo, 2027/1): tem o seu quadro de horários, as suas turmas e a disponibilidade dos professores naquele período. Os cadastros são compartilhados entre os projetos. Tudo fica salvo neste navegador."
                acoes={
                    <>
                        <Button variant="outline" size="sm" onClick={exportar}>
                            <Download /> Exportar tudo
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => arquivo.current?.click()}>
                            <Upload /> Importar
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

            <div className="space-y-2">
                {area.projetos.length === 0 && <Vazio>Nenhum projeto ainda. Crie o primeiro abaixo, por exemplo “2027/1”.</Vazio>}
                {area.projetos.map((p) => (
                    <div
                        key={p.id}
                        className={
                            "flex flex-wrap items-center gap-2 rounded-2xl border p-3 " +
                            (p.id === projetoAbertoId ? "border-primary bg-primary/5" : "border-border")
                        }
                    >
                        <Input
                            aria-label="Nome do projeto"
                            className="w-40 flex-1"
                            value={p.nome}
                            onChange={(e) =>
                                mudarArea((a) => ({ ...a, projetos: a.projetos.map((x) => (x.id === p.id ? { ...x, nome: e.target.value } : x)) }))
                            }
                        />
                        <span className="text-xs text-muted-foreground">
                            {plural(p.turmas.length, "turma", "turmas")} · {plural(p.ofertas.length, "disciplina", "disciplinas")}
                            {p.horario ? " · horário gerado" : ""}
                        </span>
                        <Button size="sm" variant={p.id === projetoAbertoId ? "default" : "outline"} onClick={() => abrir(p.id)}>
                            <FolderOpen /> {p.id === projetoAbertoId ? "Aberto" : "Abrir"}
                        </Button>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            title="Duplicar: novo projeto com as mesmas turmas, aulas e disponibilidades"
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
                            title="Excluir projeto"
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
                ))}
            </div>

            <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    criar();
                }}
            >
                <Input className="max-w-xs" placeholder="Nome do novo projeto" value={nome} onChange={(e) => setNome(e.target.value)} />
                <Button type="submit">
                    <Plus /> Novo projeto
                </Button>
            </form>
        </div>
    );
}
