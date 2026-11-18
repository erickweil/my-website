/**
 * Histórico de horários de um projeto: salvar o horário atual como uma versão, ver uma versão
 * antiga e voltar a ela.
 *
 * Uma versão guarda os dados do projeto naquele momento (quadro, turmas, aulas, docentes, horário)
 * e os cadastros que ele usava, desnormalizados: ela continua exibível e restaurável mesmo depois
 * que turmas, aulas ou professores mudam ou são apagados.
 */

import type { AreaDeTrabalho, DadosDoProjeto, Id, ProjetoHorario, VersaoDoHorario } from "./modelo.ts";
import { cadastrosUsados } from "./exportacao.ts";
import { novoId } from "./operacoes.ts";

/** Só os dados que definem o horário (sem a configuração e sem as versões). */
const dadosDe = ({ id, nome, quadro, turmas, ofertas, docentes, horario, revisao }: ProjetoHorario): DadosDoProjeto =>
    structuredClone({ id, nome, quadro, turmas, ofertas, docentes, horario, revisao });

const noProjeto = (area: AreaDeTrabalho, projetoId: Id, fn: (p: ProjetoHorario) => ProjetoHorario): AreaDeTrabalho => ({
    ...area,
    projetos: area.projetos.map((p) => (p.id === projetoId ? fn(p) : p)),
});

/** Acrescenta ao histórico do projeto uma versão com o estado atual. */
export function salvarVersao(area: AreaDeTrabalho, projetoId: Id, nome: string, agora = new Date()): AreaDeTrabalho {
    return noProjeto(area, projetoId, (p) => {
        const versao: VersaoDoHorario = {
            id: novoId(),
            nome,
            criadaEm: agora.toISOString(),
            projeto: dadosDe(p),
            cadastros: structuredClone(cadastrosUsados(area.cadastros, p)),
        };
        return { ...p, versoes: [...p.versoes, versao] };
    });
}

export const removerVersao = (area: AreaDeTrabalho, projetoId: Id, versaoId: Id): AreaDeTrabalho =>
    noProjeto(area, projetoId, (p) => ({ ...p, versoes: p.versoes.filter((v) => v.id !== versaoId) }));

/**
 * Volta o projeto ao estado da versão: quadro, turmas, aulas, docentes e horário. O nome, a
 * configuração e o histórico ficam. Os cadastros que a versão usava e que foram apagados voltam
 * (os que ainda existem ficam como estão). O horário restaurado fica em dia com os dados.
 */
export function restaurarVersao(area: AreaDeTrabalho, projetoId: Id, versaoId: Id): AreaDeTrabalho {
    const projeto = area.projetos.find((p) => p.id === projetoId);
    const versao = projeto?.versoes.find((v) => v.id === versaoId);
    if (!projeto || !versao) return area;

    const juntar = <T extends { id: Id }>(atuais: T[], daVersao: T[]) => [...atuais, ...daVersao.filter((x) => !atuais.some((y) => y.id === x.id))];
    const cadastros = {
        cursos: juntar(area.cadastros.cursos, versao.cadastros.cursos),
        professores: juntar(area.cadastros.professores, versao.cadastros.professores),
        ambientes: juntar(area.cadastros.ambientes, versao.cadastros.ambientes),
    };
    const revisao = Math.max(projeto.revisao, versao.projeto.revisao) + 1;
    const dados = structuredClone(versao.projeto);
    return noProjeto({ ...area, cadastros }, projetoId, (p) => ({
        ...p,
        ...dados,
        id: p.id,
        nome: p.nome,
        revisao,
        horario: dados.horario && { ...dados.horario, revisao },
    }));
}
