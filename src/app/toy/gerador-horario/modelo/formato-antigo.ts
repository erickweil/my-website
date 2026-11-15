/**
 * Leitura do JSON da versão anterior do gerador (o `FormularioAntigo` exportado pela página
 * antiga, com ou sem o envelope `{ formData, config }`). Vira um projeto de turmas avulsas, com os
 * professores para acrescentar ao cadastro.
 */

import { DIAS, type Dia, type HorariosPorDia, type Id, type Professor, type ProjetoHorario } from "./modelo.ts";
import { PALETA_CORES, criarOferta, criarTurmaAvulsa, gerarFaixas, juntarOfertas, manterDocentes, novoId, novoProjeto } from "./operacoes.ts";

/** O formulário da versão anterior: disciplinas por turma, ligadas a professores e a grupos pelo NOME. */
export interface FormularioAntigo {
    turmas: { nome: string; horarios: HorariosPorDia }[];
    disciplinas: { nome: string; turma: string; aulas: number; agrupar?: number; dividir?: boolean }[];
    disciplinas_unidas: { grupo: string; disciplinas: string[] }[];
    professores: { nome: string; disciplinas: string[]; horarios: HorariosPorDia }[];
}

/** O formulário antigo dentro de um JSON qualquer, ou null se não for um. */
export function extrairFormularioAntigo(dados: unknown): { formulario: FormularioAntigo; tempos?: number } | null {
    const raiz = dados as { formData?: unknown; config?: { quantidadeTempos?: unknown } } | null;
    const f = (raiz?.formData ?? raiz) as Partial<FormularioAntigo> | null;
    if (!f || !Array.isArray(f.turmas) || !Array.isArray(f.disciplinas) || !Array.isArray(f.professores)) return null;
    const tempos = typeof raiz?.config?.quantidadeTempos === "number" ? raiz.config.quantidadeTempos : undefined;
    return { formulario: { ...f, disciplinas_unidas: f.disciplinas_unidas ?? [] } as FormularioAntigo, tempos };
}

export function projetoDoFormatoAntigo(
    f: FormularioAntigo,
    nome: string,
    temposConfigurados = 0,
): { projeto: ProjetoHorario; professores: Professor[] } {
    const marcados = f.turmas.flatMap((t) => Object.values(t.horarios).flat());
    const tempos = Math.max(temposConfigurados, 1, ...marcados);
    const dias: Dia[] = DIAS.filter((d) => f.turmas.some((t) => (t.horarios[d]?.length ?? 0) > 0));

    let projeto = novoProjeto(nome);
    projeto.quadro = {
        ...projeto.quadro,
        dias: dias.length > 0 ? dias : projeto.quadro.dias,
        faixas: gerarFaixas({ turno: "matutino", inicio: "07:30", aulas: tempos }),
    };

    const turmaPorNome = new Map<string, Id>();
    for (const t of f.turmas) {
        const r = criarTurmaAvulsa(projeto, { nome: t.nome });
        projeto = { ...r.projeto, turmas: r.projeto.turmas.map((x) => (x.id === r.turma.id ? { ...x, horarios: t.horarios } : x)) };
        turmaPorNome.set(t.nome, r.turma.id);
    }

    const professores: Professor[] = f.professores.map((p, i) => ({
        id: novoId(),
        nome: p.nome,
        cor: PALETA_CORES[i % PALETA_CORES.length],
    }));

    const ofertaPorNome = new Map<string, Id>();
    for (const d of f.disciplinas) {
        const turmaId = turmaPorNome.get(d.turma);
        if (!turmaId) continue; // disciplina de uma turma que não existe mais
        const r = criarOferta(projeto, turmaId);
        const agrupar = d.agrupar || 0;
        const oferta = {
            ...r.oferta,
            nome: d.nome,
            aulasSemana: d.aulas || 0,
            distribuicao: agrupar > 1 ? { tipo: "blocos" as const, tamanho: agrupar, emendar: !d.dividir } : { tipo: "livre" as const },
            professorIds: f.professores.flatMap((p, i) => (p.disciplinas.includes(d.nome) ? [professores[i].id] : [])),
        };
        projeto = { ...r.projeto, ofertas: r.projeto.ofertas.map((o) => (o.id === oferta.id ? oferta : o)) };
        if (!ofertaPorNome.has(d.nome)) ofertaPorNome.set(d.nome, oferta.id);
    }

    for (const grupo of f.disciplinas_unidas ?? []) {
        const [fica, ...resto] = grupo.disciplinas.flatMap((n) => ofertaPorNome.get(n) ?? []);
        for (const sai of resto) {
            const r = juntarOfertas(projeto, fica, sai);
            // Grupo que não dá para juntar (cargas diferentes) fica como ofertas separadas
            if ("projeto" in r) projeto = r.projeto;
        }
    }

    projeto = manterDocentes(projeto);
    projeto.docentes = projeto.docentes.map((d) => {
        const i = professores.findIndex((p) => p.id === d.professorId);
        return { ...d, disponibilidade: f.professores[i].horarios };
    });
    return { projeto, professores };
}
