//! Avaliação de quadros de horário — **normal (em lote)** e **incremental (por delta)** no mesmo
//! módulo, construídas sobre as mesmas tabelas ([`TabelasHorario`]), os mesmos pesos
//! ([`PesosFitness`], [`PesosQualidade`]) e as mesmas primitivas atômicas de regra.
//!
//! - [`avaliar_quadro`] / [`fitness_do_quadro`]: percorre o quadro inteiro do zero, sem preencher
//!   caches incrementais (usada pelo algoritmo genético e como conferência).
//! - [`AvaliacaoIncremental`]: mantém o estado derivado vivo e recalcula só o que cada troca
//!   tocou, em duas etapas (`acertar_obrigatorias` + `acertar_qualidade`) para rejeitar movimentos
//!   ruins cedo (usada pela busca local).

use super::{
    horario_tabelas::{TabelasHorario, Unidades},
    BuffersQualidade, PesosFitness, PesosQualidade, Qualidade, QuadroHorario, MAIOR_PEDACO, QUANTOS_DIAS,
};

const SEM_AULA: u8 = u8::MAX;

// ── Avaliação normal (em lote) ───────────────────────────────────────────────────────────────

/// Buffers reaproveitados pela avaliação em lote (zero alocação no hot path do GA).
#[derive(Clone)]
pub(crate) struct BuffersAvaliacao {
    /// Por recurso e posição (`p * por_turma + pos`): quantas turmas estão alocadas ali.
    uso: Vec<u16>,
    /// Por disciplina: pedaços na semana e pedaços de cada tamanho.
    pedacos: Vec<u8>,
    por_tamanho: Vec<u8>,
    qualidade: BuffersQualidade,
}

impl BuffersAvaliacao {
    pub fn new(t: &TabelasHorario) -> Self {
        let n_disc = t.divisao.len();
        Self {
            uso: vec![0; t.n_rec * t.por_turma],
            pedacos: vec![0; n_disc],
            por_tamanho: vec![0; n_disc * (MAIOR_PEDACO + 1)],
            qualidade: t.tq.buffers(),
        }
    }
}

/// Avalia um quadro do zero usando as primitivas de [`TabelasHorario`] e [`TabelasQualidade`].
/// Devolve `(erros_de_estrutura, unidades_obrigatorias, qualidade)`.
pub(crate) fn avaliar_quadro(
    t: &TabelasHorario,
    buf: &mut BuffersAvaliacao,
    quadro: &[i32],
    fixas: &[(usize, i32)],
    por_movimentos: bool,
) -> (u32, Unidades, Qualidade) {
    let mut estrutura = 0u32;
    let mut u = Unidades::default();

    // Passada única pelas células ativas: estrutura, ocupação/conflitos dos recursos e aulas unidas
    buf.uso.fill(0);
    for &c in &t.ativas {
        let c = c as usize;
        let v = quadro[c];
        if v <= 0 {
            estrutura += 1;
            continue;
        }
        let Some(d) = t.disciplina(v) else { continue }; // vago
        let pos = c % t.por_turma;
        let (ini, fim) = t.rec_de[d];
        for &p in &t.rec[ini as usize..fim as usize] {
            let k = p as usize * t.por_turma + pos;
            let antes = buf.uso[k] as i64;
            buf.uso[k] = antes as u16 + 1;
            let (dp, dc) = t.delta_recurso_com(k, antes, antes + 1, por_movimentos);
            u.professor += dp;
            u.conflito += dc;
        }
        let (u_ini, u_fim) = t.unidas_de[d];
        if u_ini < u_fim {
            u.unidas += t.unidas_da_celula(quadro, c);
        }
    }
    for &c in &t.inativas {
        if quadro[c as usize] != -1 {
            estrutura += 1;
        }
    }

    // Divisão em pedaços: percorre cada dia uma vez usando `registrar_pedaco`
    const K: usize = MAIOR_PEDACO + 1;
    buf.pedacos.fill(0);
    buf.por_tamanho.fill(0);
    let n = t.n;
    for &linha in &t.linhas {
        let (mut i, fim) = (linha as usize, linha as usize + n);
        while i < fim {
            let v = quadro[i];
            let mut j = i + 1;
            let Some(d) = t.disciplina(v) else {
                i = j;
                continue;
            };
            while j < fim && quadro[j] == v {
                j += 1;
            }
            let regra = &t.divisao[d];
            if regra.ativa {
                u.agrupar += TabelasHorario::registrar_pedaco(
                    regra,
                    j - i,
                    &mut buf.por_tamanho[d * K..(d + 1) * K],
                    &mut buf.pedacos[d],
                ) as i64;
            }
            i = j;
        }
    }
    for (d, regra) in t.divisao.iter().enumerate() {
        if regra.ativa {
            u.agrupar += regra.desvio_da_semana(buf.pedacos[d], &buf.por_tamanho[d * K..(d + 1) * K]) as i64;
        }
    }

    // Aulas fixadas fora do lugar
    for &(c, v) in fixas {
        u.fixas += (quadro[c] != v) as i64;
    }

    // Regras de qualidade
    let q = if t.tq.ativa {
        t.tq.medir(t, None, quadro, &mut buf.qualidade, None)
    } else {
        Qualidade::default()
    };

    (estrutura, u, q)
}

/// Fitness do quadro (0 = nada a melhorar; negativo proporcional às violações), usando pesos e
/// fixas explícitos (`pesos`, `pesos_q`, `fixas`).
#[inline]
pub(crate) fn fitness_do_quadro(
    t: &TabelasHorario,
    buf: &mut BuffersAvaliacao,
    quadro: &[i32],
    fixas: &[(usize, i32)],
    pesos: &PesosFitness,
    pesos_q: &PesosQualidade,
) -> f64 {
    let (estrutura, u, q) = avaliar_quadro(t, buf, quadro, fixas, pesos.professor_por_movimentos);
    let qual = if t.tq.ativa { t.tq.custo_com(&q, pesos_q) } else { 0.0 };
    -(estrutura as f64 * 1000.0 + u.custo_total(pesos, qual))
}

// ── Avaliação incremental (por delta) ────────────────────────────────────────────────────────

/// Um quadro com as contagens de cada regra mantidas a cada troca.
///
/// Uso: uma ou mais chamadas a [`Self::trocar`] e depois [`Self::acertar`]; só então
/// [`Self::custo`] e as contagens valem para o quadro novo.
///
/// `acertar` tem duas etapas, para a busca desistir cedo de um movimento ruim:
/// [`Self::acertar_obrigatorias`] (depois dela [`Self::custo_obrigatorio`] já vale) e
/// [`Self::acertar_qualidade`]. Quem para na primeira e desfaz as trocas chama
/// [`Self::desfazer_obrigatorias`] em vez de acertar de novo.
#[derive(Clone)]
pub(crate) struct AvaliacaoIncremental {
    pub quadro: QuadroHorario,
    /// Por recurso e posição: quantas aulas dele estão ali.
    uso: Vec<u16>,

    /// Contagens das regras obrigatórias.
    pub unidades: Unidades,
    /// Por disciplina: a parte dela em `unidades.agrupar`.
    agr: Vec<i32>,

    /// Contagens das regras de qualidade.
    pub q: Qualidade,
    /// Por (recurso, dia): primeiro e último tempo com aula, e a parte de cada um em
    /// `q.jornada_min` e `q.descanso_min`.
    primeiro: Vec<u8>,
    ultimo: Vec<u8>,
    jornada: Vec<u32>,
    descanso: Vec<u32>,
    /// Por linha do quadro (turma, dia): parte dela em `q.intervalo`, `q.troca_de_turno` e `q.espalhar`.
    quebras: Vec<(u16, u16)>,
    espalhados: Vec<u16>,
    /// Por trecho: parte dele em `q.janela`.
    janelas: Vec<u16>,

    // O que as trocas tocaram e `acertar` precisa recalcular
    disc_tocadas: Vec<u32>,
    /// `(disciplina, valor de agr antes)` do último `acertar_obrigatorias`.
    agr_antes: Vec<(u32, i32)>,
    celulas_tocadas: Vec<u32>,
    trechos_tocados: Vec<u32>,
    dias_tocados: Vec<(u32, u8)>,
}

impl AvaliacaoIncremental {
    /// Conta tudo do zero. O quadro precisa estar completo: -1 fora do horário da turma e uma
    /// disciplina ou o vago em cada célula do horário.
    pub fn new(t: &TabelasHorario, quadro: QuadroHorario) -> Self {
        let n_rec = t.n_rec;
        let mut a = Self {
            uso: vec![0; n_rec * t.por_turma],
            unidades: Unidades::default(),
            agr: vec![0; t.divisao.len()],
            q: Qualidade::default(),
            primeiro: vec![SEM_AULA; n_rec * QUANTOS_DIAS],
            ultimo: vec![SEM_AULA; n_rec * QUANTOS_DIAS],
            jornada: vec![0; n_rec * QUANTOS_DIAS],
            descanso: vec![0; n_rec * QUANTOS_DIAS],
            quebras: vec![(0, 0); quadro.len() / t.n.max(1)],
            espalhados: vec![0; quadro.len() / t.n.max(1)],
            janelas: vec![0; t.trechos.len()],
            disc_tocadas: Vec::new(),
            agr_antes: Vec::new(),
            celulas_tocadas: Vec::new(),
            trechos_tocados: Vec::new(),
            dias_tocados: Vec::new(),
            quadro,
        };
        for &c in &t.ativas {
            let c = c as usize;
            debug_assert!(a.quadro[c] > 0, "célula do horário sem aula nem vago");
            a.por(t, a.quadro[c], c % t.por_turma);
            a.unidades.unidas += t.unidas_da_celula(&a.quadro, c);
        }
        for &(c, _) in &t.fixas_lista {
            a.unidades.fixas += t.fixa_fora(c as usize, a.quadro[c as usize]);
        }
        a.disc_tocadas.extend((0..t.divisao.len() as u32).filter(|&d| t.divisao[d as usize].ativa));
        a.celulas_tocadas.extend(t.linhas.iter().copied());
        a.trechos_tocados.extend(0..t.trechos.len() as u32);
        a.dias_tocados.clear();
        for p in 0..n_rec as u32 {
            a.dias_tocados.extend((0..QUANTOS_DIAS as u8).map(|dia| (p, dia)));
        }
        a.acertar(t);
        a
    }

    /// O custo do quadro: o fitness do genético com o sinal trocado.
    #[inline]
    pub fn custo(&self, t: &TabelasHorario) -> f64 {
        let qualidade = if t.tq.ativa { t.tq.custo(&self.q) } else { 0.0 };
        self.unidades.custo_total(&t.pesos, qualidade)
    }

    /// A parte do custo que vem das regras obrigatórias: nunca é maior que [`Self::custo`].
    #[inline]
    pub fn custo_obrigatorio(&self, t: &TabelasHorario) -> f64 {
        self.unidades.custo_obrigatorio(&t.pesos)
    }

    /// Unidades de violação das regras obrigatórias (0 = horário válido).
    #[inline]
    pub fn violacoes(&self) -> i64 {
        self.unidades.violacoes()
    }

    #[inline(always)]
    fn conta_recurso(&mut self, t: &TabelasHorario, k: usize, antes: i64, depois: i64) {
        let (dp, dc) = t.delta_recurso(k, antes, depois);
        self.unidades.professor += dp;
        self.unidades.conflito += dc;
    }

    /// Põe a aula `valor` na posição `pos` da turma dela: ocupa os recursos.
    #[inline]
    fn por(&mut self, t: &TabelasHorario, valor: i32, pos: usize) {
        let Some(d) = t.disciplina(valor) else { return };
        let (ini, fim) = t.rec_de[d];
        let (dia, tempo) = ((pos / t.n) as u8, (pos % t.n) as u8);
        for &p in &t.rec[ini as usize..fim as usize] {
            let k = p as usize * t.por_turma + pos;
            let u = self.uso[k];
            self.uso[k] = u + 1;
            self.conta_recurso(t, k, u as i64, u as i64 + 1);
            if !t.tq.pessoa[p as usize] { continue; }
            if t.tq.evitar[k] { self.q.evitar += 1; }
            if t.tq.tem_horas {
                let kd = p as usize * QUANTOS_DIAS + dia as usize;
                if self.primeiro[kd] == SEM_AULA || tempo < self.primeiro[kd] || tempo > self.ultimo[kd] {
                    self.dias_tocados.push((p, dia));
                }
            }
        }
    }

    /// Tira a aula `valor` da posição `pos` da turma dela: libera os recursos.
    #[inline]
    fn tirar(&mut self, t: &TabelasHorario, valor: i32, pos: usize) {
        let Some(d) = t.disciplina(valor) else { return };
        let (ini, fim) = t.rec_de[d];
        let (dia, tempo) = ((pos / t.n) as u8, (pos % t.n) as u8);
        for &p in &t.rec[ini as usize..fim as usize] {
            let k = p as usize * t.por_turma + pos;
            let u = self.uso[k];
            self.uso[k] = u - 1;
            self.conta_recurso(t, k, u as i64, u as i64 - 1);
            if !t.tq.pessoa[p as usize] { continue; }
            if t.tq.evitar[k] { self.q.evitar -= 1; }
            if t.tq.tem_horas && u == 1 {
                let kd = p as usize * QUANTOS_DIAS + dia as usize;
                if tempo == self.primeiro[kd] || tempo == self.ultimo[kd] {
                    self.dias_tocados.push((p, dia));
                }
            }
        }
    }

    /// Troca o conteúdo de duas células da mesma turma. As contagens só voltam a valer depois de
    /// [`Self::acertar`].
    pub fn trocar(&mut self, t: &TabelasHorario, a: usize, b: usize) {
        let (va, vb) = (self.quadro[a], self.quadro[b]);
        if va == vb { return; }
        let turma = a / t.por_turma;
        debug_assert_eq!(turma, b / t.por_turma, "troca entre turmas diferentes");
        debug_assert!(va != -1 && vb != -1, "troca com célula fora do horário");
        let (pa, pb) = (a % t.por_turma, b % t.por_turma);
        let em_conjunto = t.em_conjunto[turma];

        if em_conjunto {
            self.unidades.unidas -= t.unidas_na_posicao(&self.quadro, turma, pa) + t.unidas_na_posicao(&self.quadro, turma, pb);
        }
        if !t.fixa.is_empty() {
            self.unidades.fixas += t.fixa_fora(a, vb) + t.fixa_fora(b, va) - t.fixa_fora(a, va) - t.fixa_fora(b, vb);
        }
        self.tirar(t, va, pa);
        self.tirar(t, vb, pb);
        self.quadro.swap(a, b);
        self.por(t, vb, pa);
        self.por(t, va, pb);
        if em_conjunto {
            self.unidades.unidas += t.unidas_na_posicao(&self.quadro, turma, pa) + t.unidas_na_posicao(&self.quadro, turma, pb);
        }

        for v in [va, vb] {
            if let Some(d) = t.disciplina(v) && t.divisao[d].ativa {
                self.disc_tocadas.push(d as u32);
            }
        }
        if t.tq.tem_quebras || t.tq.tem_espalhar {
            self.celulas_tocadas.extend([a as u32, b as u32]);
        }
        // A janela só muda quando um horário vago troca de lugar
        if t.tq.tem_vagos && t.tem_folga[turma] && (va > t.n_disc || vb > t.n_disc) {
            self.trechos_tocados.extend([t.trecho_de[a].0, t.trecho_de[b].0]);
        }
    }

    /// Recalcula o que as trocas tocaram.
    pub fn acertar(&mut self, t: &TabelasHorario) {
        self.acertar_obrigatorias(t);
        self.acertar_qualidade(t);
    }

    /// Primeira etapa de [`Self::acertar`]: a divisão em pedaços das disciplinas tocadas.
    pub fn acertar_obrigatorias(&mut self, t: &TabelasHorario) {
        self.agr_antes.clear();
        while let Some(d) = self.disc_tocadas.pop() {
            let novo = self.divisao_de(t, d as usize);
            let antes = self.agr[d as usize];
            self.agr_antes.push((d, antes));
            self.unidades.agrupar += (novo - antes) as i64;
            self.agr[d as usize] = novo;
        }
    }

    /// Para quem fez as trocas, chamou só [`Self::acertar_obrigatorias`] e desfez as trocas.
    pub fn desfazer_obrigatorias(&mut self) {
        while let Some((d, antes)) = self.agr_antes.pop() {
            self.unidades.agrupar += (antes - self.agr[d as usize]) as i64;
            self.agr[d as usize] = antes;
        }
        self.disc_tocadas.clear();
        self.celulas_tocadas.clear();
        self.trechos_tocados.clear();
        self.dias_tocados.clear();
    }

    /// Segunda etapa de [`Self::acertar`]: as regras de qualidade.
    pub fn acertar_qualidade(&mut self, t: &TabelasHorario) {
        while let Some(c) = self.celulas_tocadas.pop() {
            let linha = c as usize / t.n;
            if t.tq.tem_quebras {
                let (mut intervalo, mut turno) = (0u16, 0u16);
                t.tq.grupos_partidos(t, &self.quadro, linha * t.n, |_, troca| if troca { turno += 1 } else { intervalo += 1 });
                let (i0, t0) = self.quebras[linha];
                self.q.intervalo = self.q.intervalo + intervalo as u32 - i0 as u32;
                self.q.troca_de_turno = self.q.troca_de_turno + turno as u32 - t0 as u32;
                self.quebras[linha] = (intervalo, turno);
            }
            if t.tq.tem_espalhar {
                let mut a_mais = 0u16;
                t.tq.pedacos_a_mais(t, &self.quadro, linha * t.n, |_| a_mais += 1);
                self.q.espalhar = self.q.espalhar + a_mais as u32 - self.espalhados[linha] as u32;
                self.espalhados[linha] = a_mais;
            }
        }
        while let Some(k) = self.trechos_tocados.pop() {
            if k == u32::MAX { continue; }
            let trecho = &t.trechos[k as usize];
            let novo = if t.tq.tem_vagos && t.tem_folga[trecho.turma] {
                t.tq.janelas_do_trecho(t, &self.quadro, &trecho.celulas) as u16
            } else {
                0
            };
            self.q.janela = self.q.janela + novo as u32 - self.janelas[k as usize] as u32;
            self.janelas[k as usize] = novo;
        }
        while let Some((p, dia)) = self.dias_tocados.pop() {
            if t.tq.tem_horas && t.tq.pessoa[p as usize] {
                self.refazer_dia(t, p as usize, dia as usize);
            }
        }
    }

    /// Jornada e descanso de um professor num dia, a partir do uso dele.
    fn refazer_dia(&mut self, t: &TabelasHorario, p: usize, dia: usize) {
        let base = p * t.por_turma + dia * t.n;
        let uso = &self.uso[base..base + t.n];
        let k = p * QUANTOS_DIAS + dia;
        self.primeiro[k] = uso.iter().position(|&u| u > 0).map_or(SEM_AULA, |x| x as u8);
        self.ultimo[k] = uso.iter().rposition(|&u| u > 0).map_or(SEM_AULA, |x| x as u8);

        let jornada = if self.primeiro[k] == SEM_AULA { 0 } else { t.tq.excesso_de_jornada(self.primeiro[k], self.ultimo[k]) };
        self.q.jornada_min = self.q.jornada_min + jornada - self.jornada[k];
        self.jornada[k] = jornada;

        for d in [dia.wrapping_sub(1), dia] {
            if d >= QUANTOS_DIAS - 1 { continue; }
            let k = p * QUANTOS_DIAS + d;
            let falta = if self.ultimo[k] != SEM_AULA && self.primeiro[k + 1] != SEM_AULA {
                t.tq.falta_de_descanso(self.ultimo[k], self.primeiro[k + 1])
            } else {
                0
            };
            self.q.descanso_min = self.q.descanso_min + falta - self.descanso[k];
            self.descanso[k] = falta;
        }
    }

    /// Desvio das regras de divisão de uma disciplina, percorrendo só os dias da turma dela e
    /// usando a mesma primitiva [`TabelasHorario::registrar_pedaco`] da avaliação em lote.
    fn divisao_de(&self, t: &TabelasHorario, d: usize) -> i32 {
        let regra = &t.divisao[d];
        if !regra.ativa { return 0; }
        let v = d as i32 + 1;
        let n = t.n;
        let (ini, fim) = t.linhas_de[t.turma_de[d] as usize];
        let mut contagem = [0u8; MAIOR_PEDACO + 1];
        let (mut quantidade, mut desvio) = (0u8, 0i32);
        for &linha in &t.linhas[ini as usize..fim as usize] {
            let dia = &self.quadro[linha as usize..linha as usize + n];
            let mut i = 0;
            while i < n {
                if dia[i] != v {
                    i += 1;
                    continue;
                }
                let mut j = i + 1;
                while j < n && dia[j] == v {
                    j += 1;
                }
                desvio += TabelasHorario::registrar_pedaco(regra, j - i, &mut contagem, &mut quantidade);
                i = j;
            }
        }
        desvio + regra.desvio_da_semana(quantidade, &contagem)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::problems::GAProblem;
    use crate::horario::{validar, BuscaLocal, DiaSemana, HorarioRegrasPencilmark, RegrasHorario, LISTA_PADRAO};

    fn instancia(nome: &str) -> RegrasHorario {
        RegrasHorario::de_arquivo(&format!("{}/tests/instancias/{nome}.json", env!("CARGO_MANIFEST_DIR")))
    }

    /// Oráculo independente (Pencilmark): em quadros sorteados, soluções válidas e versões
    /// perturbadas, `violacoes_sem_fixas() == 0` equivale exatamente a `!validar.alguma()`, e a
    /// avaliação em lote devolve exatamente as mesmas `Unidades`, `Qualidade` e custo que
    /// `AvaliacaoIncremental::new`.
    #[test]
    fn oraculo_pencilmark_bate_com_avaliacao_e_incremental() {
        for nome in ["pequena", "faculdade-anonimizado", "media"] {
            fastrand::seed(17);
            let r = instancia(nome);
            let t = TabelasHorario::new(&r);
            let mut buf = BuffersAvaliacao::new(&t);
            let mut validador = HorarioRegrasPencilmark::so_obrigatorias(r.clone());
            let mut state = r.initial_state();

            // Coleta quadros aleatórios + solução válida da busca local + perturbações dela
            let mut quadros: Vec<QuadroHorario> = (0..30).map(|_| r.random_genes()).collect();
            let mut bl = BuscaLocal::new(&r, &r.genes_com_blocos(), 4, LISTA_PADRAO);
            for _ in 0..200 {
                if bl.executar(20_000) || bl.valido() { break; }
            }
            assert!(bl.valido(), "{nome}: busca local deveria achar solução válida");
            let sol = bl.melhor().to_vec();
            quadros.push(sol.clone());
            let mut q = sol;
            let taxa = 1.0 / q.len() as f64;
            for _ in 0..30 {
                r.mutate(&mut state, &mut q, taxa);
                quadros.push(q.clone());
            }

            let mut viu_valido = false;
            let mut viu_invalido = false;
            for (idx, q) in quadros.iter().enumerate() {
                let (est, u, qual) = avaliar_quadro(&t, &mut buf, q, &r.fixas, r.pesos.professor_por_movimentos);
                assert_eq!(est, 0, "{nome}[{idx}]: estrutura");
                let inc = AvaliacaoIncremental::new(&t, q.clone());
                assert_eq!(inc.unidades, u, "{nome}[{idx}]: unidades");
                assert_eq!(inc.q, qual, "{nome}[{idx}]: qualidade");
                assert_eq!(inc.custo(&t), -fitness_do_quadro(&t, &mut buf, q, &r.fixas, &r.pesos, &r.qualidade), "{nome}[{idx}]: custo");

                let valido_oraculo = !validar(&mut validador, q).alguma();
                let valido_avaliacao = u.violacoes_sem_fixas() == 0;
                assert_eq!(valido_avaliacao, valido_oraculo, "{nome}[{idx}]: oráculo Pencilmark divergiu (u={u:?})");
                viu_valido |= valido_oraculo;
                viu_invalido |= !valido_oraculo;
            }
            assert!(viu_valido && viu_invalido, "{nome}: deveria exercitar quadros válidos e inválidos");
        }
    }

    /// Magnitudes calculadas à mão (que o oráculo booleano do Pencilmark não mede):
    /// conflito de 3 turmas no mesmo professor, indisponibilidade em 2 turmas, aulas unidas
    /// separadas em 3 turmas e aulas fixadas fora do lugar.
    #[test]
    fn magnitudes_a_mao_conflito_indisponivel_unidas_e_fixas() {
        let mut r = RegrasHorario::from_json(r#"{
            "turmas": [
                { "id": "A", "horarios": { "seg": [1, 2] } },
                { "id": "B", "horarios": { "seg": [1, 2] } },
                { "id": "C", "horarios": { "seg": [1, 2] } }
            ],
            "aulas": [
                { "id": "pA", "turmas": ["A"], "recursos": ["P"], "aulasSemana": 2 },
                { "id": "pB", "turmas": ["B"], "recursos": ["P"], "aulasSemana": 1 },
                { "id": "pC", "turmas": ["C"], "recursos": ["P"], "aulasSemana": 1 },
                { "id": "uBC", "turmas": ["B", "C"], "recursos": [], "aulasSemana": 1 }
            ],
            "recursos": [
                { "id": "P", "disponibilidade": { "seg": [1] } }
            ]
        }"#).unwrap();
        // Disciplinas: 1=pA (A), 2=pB (B), 3=pC (C), 4=uBC (B), 5=uBC (C)
        // Fixa pA em (A, 0) e uBC(B) em (B, 1)
        r.fixas = vec![
            (r.to_quadro_index(0, DiaSemana::Segunda, 0), 1),
            (r.to_quadro_index(1, DiaSemana::Segunda, 1), 4),
        ];
        let idx = |turma, tempo| r.to_quadro_index(turma, DiaSemana::Segunda, tempo);

        let mut q = r.get_quadro_vazio();
        // Tempo 0 (P disponível): pA, pB, pC todos juntos → 3 turmas com P → 2 conflitos
        // Tempo 1 (P indisponível): pA em A (1 indisponível); uBC(B) em B(1), uBC(C) em C(1) → unidas OK
        q[idx(0, 0)] = 1;
        q[idx(0, 1)] = 1;
        q[idx(1, 0)] = 2;
        q[idx(1, 1)] = 4;
        q[idx(2, 0)] = 3;
        q[idx(2, 1)] = 5;

        let t = TabelasHorario::new(&r);
        let mut buf = BuffersAvaliacao::new(&t);
        let (_, u, _) = avaliar_quadro(&t, &mut buf, &q, &r.fixas, true);
        assert_eq!(u, Unidades { professor: 1, conflito: 2, unidas: 0, agrupar: 0, fixas: 0 });
        assert_eq!(AvaliacaoIncremental::new(&t, q.clone()).unidades, u);

        // Modo legado (professor_por_movimentos = false):
        // Tempo 0 (disp=1, uso=3): 3 * (3 - 1) = 6; Tempo 1 (disp=0, uso=1): 1 * (1 - 0) = 1 → total 7
        let (_, u_legado, _) = avaliar_quadro(&t, &mut buf, &q, &r.fixas, false);
        assert_eq!(u_legado, Unidades { professor: 7, conflito: 0, unidas: 0, agrupar: 0, fixas: 0 });

        // Troca em B: pB vai para tempo 1 (P indisponível → 2 turmas lá), uBC(B) vai para tempo 0
        // → uBC fica separada (2 células desalinhadas: B(0) e C(1)), e fixa em (B, 1) fica fora do lugar
        q.swap(idx(1, 0), idx(1, 1));
        let (_, u2, _) = avaliar_quadro(&t, &mut buf, &q, &r.fixas, true);
        assert_eq!(u2, Unidades { professor: 2, conflito: 1, unidas: 2, agrupar: 0, fixas: 1 });
        assert_eq!(AvaliacaoIncremental::new(&t, q).unidades, u2);
    }
}
