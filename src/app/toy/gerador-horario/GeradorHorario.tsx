"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Pendencia } from "./modelo/diagnostico";
import { usePendencias } from "./componentes/pendencias";
import type { Id } from "./modelo/modelo";
import { Vazio } from "./componentes/comuns";
import { BarraDoCelular, BarraDoTopo, DO_PROJETO, MenuLateral, type Tela } from "./componentes/navegacao";
import { TelaAmbientes } from "./telas/TelaAmbientes";
import { TelaConfiguracao } from "./telas/TelaConfiguracao";
import { TelaCursos } from "./telas/TelaCursos";
import { TelaDocentes } from "./telas/TelaDocentes";
import { TelaHorario } from "./telas/horario/TelaHorario";
import { TelaProfessores } from "./telas/TelaProfessores";
import { TelaProjetos } from "./telas/TelaProjetos";
import { TelaQuadro } from "./telas/TelaQuadro";
import { TelaTurmas, type AbaDaTurma } from "./telas/TelaTurmas";
import { useAreaDeTrabalho } from "./useAreaDeTrabalho";

const CHAVE_MENU_RECOLHIDO = "geradorHorario:menuRecolhido";

/** Em qual tela se corrige cada pendência (as de aulas ficam na aba de aulas da turma). */
const TELA_DA_PENDENCIA: Record<Pendencia["tela"], Tela> = { quadro: "quadro", turmas: "turmas", aulas: "turmas", docentes: "docentes" };

export default function GeradorHorario() {
    const estado = useAreaDeTrabalho();
    const { area, projeto, mudarArea } = estado;
    // Quem nunca criou nada cai na lista de projetos; quem já tem, no horário do último aberto
    const [tela, setTela] = useState<Tela>(projeto ? "horario" : "projetos");
    const [turmaAberta, setTurmaAberta] = useState<Id | null>(null);
    const [abaDaTurma, setAbaDaTurma] = useState<AbaDaTurma>("horarios");
    const [professorFoco, setProfessorFoco] = useState<Id | null>(null);
    const [recolhido, setRecolhido] = useState(() => localStorage.getItem(CHAVE_MENU_RECOLHIDO) === "1");
    const [maisAberto, setMaisAberto] = useState(false);
    useEffect(() => localStorage.setItem(CHAVE_MENU_RECOLHIDO, recolhido ? "1" : "0"), [recolhido]);
    const pendencias = usePendencias(projeto, area.cadastros);

    if (estado.erroDeLeitura) {
        return (
            <main className="mx-auto max-w-2xl px-4 py-10">
                <Alert variant="destructive">
                    <AlertTitle>Os dados salvos neste navegador não puderam ser lidos</AlertTitle>
                    <AlertDescription>
                        <pre className="my-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{estado.erroDeLeitura}</pre>
                        <p>Nada foi apagado. Recarregue a página para tentar de novo, ou comece do zero (substitui o que está salvo).</p>
                        <Button className="mt-3" variant="destructive" onClick={estado.descartarSalvo}>
                            Começar do zero
                        </Button>
                    </AlertDescription>
                </Alert>
            </main>
        );
    }

    const contexto = { area, mudarArea };
    /** Pendências que impedem o horário, por tela, para a marca no menu. */
    const errosPorTela: Partial<Record<Tela, number>> = {};
    for (const p of pendencias) {
        const t = TELA_DA_PENDENCIA[p.tela];
        if (p.gravidade === "erro") errosPorTela[t] = (errosPorTela[t] ?? 0) + 1;
    }
    const ir = (t: Tela) => {
        setTela(t);
        setMaisAberto(false);
        window.scrollTo({ top: 0 });
    };
    /** Abre a tela em que uma pendência se corrige, já na turma ou no professor dela. */
    const irPara = (p: Pendencia) => {
        if (p.turmaId) setTurmaAberta(p.turmaId);
        if (p.tela === "aulas") setAbaDaTurma("aulas");
        else if (p.tela === "turmas") setAbaDaTurma("horarios");
        setProfessorFoco(p.professorId ?? null);
        ir(TELA_DA_PENDENCIA[p.tela]);
    };
    const doProjeto = projeto && { ...contexto, projeto, mudarProjeto: estado.mudarProjeto, salvarHorario: estado.salvarHorario };
    const abrir = (id: Id, destino: Tela = "horario") => {
        estado.abrirProjeto(id);
        setTurmaAberta(null);
        ir(destino);
    };

    const props = { tela, ir, projetoAberto: !!projeto, errosPorTela };

    return (
        <div className="min-h-screen md:flex print:block">
            <MenuLateral recolhido={recolhido} onRecolher={() => setRecolhido(!recolhido)} nomeDoProjeto={projeto?.nome} {...props} />

            <div className="min-w-0 flex-1">
                <BarraDoTopo
                    projetos={area.projetos}
                    projetoId={projeto?.id ?? null}
                    onTrocar={(id) => abrir(id, tela === "projetos" ? "horario" : tela)}
                    telaDeProjetos={tela === "projetos"}
                    onProjetos={() => ir("projetos")}
                />

                <main className="mx-auto max-w-6xl px-3 pt-4 pb-28 md:px-6 md:py-6 print:max-w-none print:p-0">
                    {estado.erroAoSalvar && (
                        <Alert variant="destructive" className="mb-4 print:hidden">
                            <AlertTitle>As últimas alterações não foram salvas neste navegador</AlertTitle>
                            <AlertDescription>
                                O espaço do navegador para este site acabou. Exclua versões antigas do horário (em Horário › Versões) ou exporte o
                                projeto antes de fechar a página.
                            </AlertDescription>
                        </Alert>
                    )}
                    {tela === "projetos" && <TelaProjetos {...contexto} projetoAbertoId={projeto?.id ?? null} abrir={abrir} />}
                    {tela === "professores" && <TelaProfessores {...contexto} />}
                    {tela === "cursos" && <TelaCursos {...contexto} />}
                    {tela === "ambientes" && <TelaAmbientes {...contexto} />}
                    {DO_PROJETO.some((i) => i.id === tela) && !doProjeto && <Vazio>Crie ou abra um projeto em “Projetos”.</Vazio>}
                    {doProjeto && tela === "quadro" && <TelaQuadro {...doProjeto} />}
                    {doProjeto && tela === "turmas" && (
                        <TelaTurmas {...doProjeto} turmaAberta={turmaAberta} abrirTurma={setTurmaAberta} aba={abaDaTurma} mudarAba={setAbaDaTurma} />
                    )}
                    {doProjeto && tela === "docentes" && <TelaDocentes key={professorFoco} professorInicial={professorFoco} {...doProjeto} />}
                    {doProjeto && tela === "configuracao" && <TelaConfiguracao {...doProjeto} />}
                    {doProjeto && tela === "horario" && <TelaHorario key={doProjeto.projeto.id} {...doProjeto} irPara={irPara} />}
                </main>
            </div>

            {/* Celular: barra embaixo, com o horário no meio e o resto no "Mais" */}
            <BarraDoCelular {...props} maisAberto={maisAberto} setMaisAberto={setMaisAberto} />
        </div>
    );
}
