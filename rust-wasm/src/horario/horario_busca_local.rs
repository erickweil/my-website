//! Busca local do horário: parte de um quadro completo (com violações) e o melhora por pequenos
//! movimentos, aceitando às vezes um movimento que piora para sair de onde o algoritmo genético
//! fica preso.
//!
//! # Por que existe
//!
//! O genético chega perto e para: sobram poucas aulas fora de bloco ou em choque, e consertar uma
//! delas exige mover três ou quatro aulas em sequência, passando por quadros piores que o atual. A
//! seleção do genético descarta esses quadros de passagem. Aqui o critério de aceitação
//! (*late acceptance*, Burke e Bykov) compara o quadro novo com o custo de algumas milhares de
//! iterações atrás, e por isso tolera a piora temporária.
//!
//! # Como funciona
//!
//! - **Movimentos**, sempre dentro de uma turma (o conjunto de aulas de cada turma não muda, como
//!   nos operadores do genético): trocar duas aulas de lugar, ou trocar um grupo de aulas seguidas
//!   da mesma disciplina com outro trecho do mesmo tamanho. Numa aula em conjunto, a troca é
//!   repetida nas turmas que participam.
//! - **Custo**: o mesmo número do fitness do genético com o sinal trocado
//!   ([`RegrasHorario::fitness_rapido`]), com as mesmas regras obrigatórias, as mesmas regras de
//!   qualidade e os mesmos pesos. 0 = nada a melhorar.
//! - **Avaliação incremental**: o fitness percorre o quadro inteiro; aqui cada regra guarda a sua
//!   contagem e um movimento recalcula só o que tocou (os recursos das aulas movidas, as
//!   disciplinas agrupadas, as linhas e os turnos das células). Os testes conferem, movimento a
//!   movimento, que o custo incremental é igual ao fitness calculado do zero.
//! - **Cadeias**: várias buscas independentes a partir do mesmo quadro, com sorteios diferentes,
//!   uma por thread quando há pool. Vale a melhor.

use std::sync::Arc;

use rayon::prelude::*;

use crate::{
    horario::{DiaSemana, PesosFitness, Qualidade, QuadroHorario, RegrasHorario, TabelasQualidade, QUANTOS_DIAS},
    paralelo::pool_disponivel,
};

/// Comprimento da lista do late acceptance: com quantas iterações de atraso o custo é comparado.
/// Maior = aceita piorar por mais tempo (explora mais, converge mais devagar).
///
/// Medido no técnico real (19 turmas, 614 aulas), 10 sementes, a partir do quadro em que o
/// genético para: ver `examples/bench_busca_local.rs`.
pub const LISTA_PADRAO: usize = 5_000;

/// Probabilidade de, ao sortear uma aula de disciplina agrupada, mover o grupo inteiro de aulas
/// seguidas em vez de só a aula.
const P_BLOCO: f64 = 0.5;

/// Sem melhorar o melhor quadro por este número de listas inteiras, a busca estacionou (o late
/// acceptance só aceita piorar enquanto a lista tem custos mais altos que o atual). A cadeia então
/// volta para o melhor quadro com uma folga: a lista é preenchida com o custo dele mais a folga, e
/// por uma lista inteira ela pode piorar até ali. Ver [`Cadeia::folga`].
const LISTAS_SEM_MELHORA: u64 = 100;
/// Número de folgas diferentes: depois da maior, volta para a menor.
const FOLGAS: u32 = 6;
/// Folga na escala da qualidade: fração do custo do melhor quadro, por degrau.
const FOLGA_DE_QUALIDADE: f64 = 0.05;

/// Com várias cadeias, o comprimento da lista de cada uma é o pedido vezes um destes fatores, em
/// rodízio: listas curtas resolvem depressa os quadros fáceis, as longas insistem nos difíceis.
const FATORES_DA_LISTA: [f64; 4] = [1.0, 0.5, 2.0, 1.0];

const SEM_AULA: u8 = u8::MAX;

/// Tabelas derivadas das regras, montadas uma vez e compartilhadas entre as cadeias.
struct Tabelas {
    regras: RegrasHorario,
    /// Tempos por dia.
    n: usize,
    /// Células de uma turma no quadro (7 dias x n tempos). A posição de uma célula dentro da turma
    /// (dia * n + tempo) também indexa as tabelas por recurso.
    por_turma: usize,
    /// Os valores 1..=n_disc no quadro são disciplinas; n_disc + 1 é o horário vago.
    n_disc: i32,
    pesos: PesosFitness,
    /// A menor penalidade de uma regra obrigatória: abaixo dela, o custo é só qualidade.
    menor_obrigatoria: f64,
    tq: TabelasQualidade,

    /// Por disciplina: intervalo em `rec` (os recursos dela).
    rec_de: Vec<(u32, u32)>,
    rec: Vec<u32>,
    /// Por disciplina: tamanho do bloco (0 = sem agrupamento) e se os blocos não podem se tocar.
    agrupar: Vec<i32>,
    dividir: Vec<bool>,
    /// Por disciplina: a turma dela.
    turma_de: Vec<u32>,
    /// Por disciplina: intervalo em `unidas`, com (valor esperado na célula da turma parceira,
    /// início da turma parceira no quadro).
    unidas_de: Vec<(u32, u32)>,
    unidas: Vec<(i32, u32)>,

    /// Por recurso e posição: disponível?
    disp: Vec<bool>,

    /// Por turma: intervalo em `linhas` (o início no quadro de cada dia em que ela tem aula).
    linhas_de: Vec<(u32, u32)>,
    linhas: Vec<u32>,
    /// Por turma: intervalo em `ativas` (as células em que ela tem aula). `ativas` tem todas as
    /// células ativas do quadro, turma a turma.
    ativas_de: Vec<(u32, u32)>,
    ativas: Vec<u32>,
    /// Por turma: intervalo em `grupo` (o início no quadro dela e das turmas com que divide alguma
    /// aula em conjunto). `em_conjunto`: a turma tem alguma aula em conjunto.
    grupo_de: Vec<(u32, u32)>,
    grupo: Vec<u32>,
    em_conjunto: Vec<bool>,
    /// Por turma: tem horários vagos (folga)?
    tem_folga: Vec<bool>,
}

impl Tabelas {
    fn new(regras: &RegrasHorario) -> Self {
        let r = regras;
        let n = r.n_tempos;
        let por_turma = QUANTOS_DIAS * n;
        let menor_obrigatoria = r.pesos.professor.min(r.pesos.conflito).min(r.pesos.unidas).min(r.pesos.agrupar);

        let (mut rec_de, mut rec) = (Vec::new(), Vec::new());
        let (mut unidas_de, mut unidas) = (Vec::new(), Vec::new());
        for d in &r.disciplinas {
            let ini = rec.len() as u32;
            rec.extend(d.professores.iter().map(|&p| p as u32));
            rec_de.push((ini, rec.len() as u32));

            let ini = unidas.len() as u32;
            unidas.extend(d.disciplinas_unidas.iter().map(|&u| (u as i32 + 1, (r.disciplinas[u].turma_id * por_turma) as u32)));
            unidas_de.push((ini, unidas.len() as u32));
        }

        let mut disp = vec![false; r.professores.len() * por_turma];
        for p in &r.professores {
            for dia in DiaSemana::TODOS {
                for tempo in 0..n {
                    disp[p.id * por_turma + dia.to_index() * n + tempo] = p.horarios.get(dia, tempo) != 0;
                }
            }
        }

        let (mut linhas_de, mut linhas) = (Vec::new(), Vec::new());
        let (mut ativas_de, mut ativas) = (Vec::new(), Vec::new());
        let (mut grupo_de, mut grupo, mut em_conjunto) = (Vec::new(), Vec::new(), Vec::new());
        for turma in &r.turmas {
            let (ini_linhas, ini_ativas) = (linhas.len() as u32, ativas.len() as u32);
            for dia in DiaSemana::TODOS {
                let inicio = r.to_quadro_index(turma.id, dia, 0);
                let antes = ativas.len();
                ativas.extend((0..n).filter(|&tempo| turma.horarios.get(dia, tempo) == 1).map(|tempo| (inicio + tempo) as u32));
                if ativas.len() > antes {
                    linhas.push(inicio as u32);
                }
            }
            linhas_de.push((ini_linhas, linhas.len() as u32));
            ativas_de.push((ini_ativas, ativas.len() as u32));

            // A turma e as parceiras dela em aulas em conjunto
            let ini_grupo = grupo.len();
            grupo.push((turma.id * por_turma) as u32);
            for d in r.disciplinas.iter().filter(|d| d.turma_id == turma.id) {
                for &u in &d.disciplinas_unidas {
                    let inicio = (r.disciplinas[u].turma_id * por_turma) as u32;
                    if !grupo[ini_grupo..].contains(&inicio) {
                        grupo.push(inicio);
                    }
                }
            }
            em_conjunto.push(grupo.len() - ini_grupo > 1);
            grupo_de.push((ini_grupo as u32, grupo.len() as u32));
        }

        Self {
            n,
            por_turma,
            n_disc: r.disciplinas.len() as i32,
            pesos: r.pesos,
            menor_obrigatoria,
            tq: TabelasQualidade::new(r, menor_obrigatoria),
            rec_de,
            rec,
            agrupar: r.disciplinas.iter().map(|d| d.agrupar.max(0)).collect(),
            dividir: r.disciplinas.iter().map(|d| d.dividir).collect(),
            turma_de: r.disciplinas.iter().map(|d| d.turma_id as u32).collect(),
            unidas_de,
            unidas,
            disp,
            linhas_de,
            linhas,
            ativas_de,
            ativas,
            grupo_de,
            grupo,
            em_conjunto,
            tem_folga: r.turmas.iter().map(|t| t.folga > 0).collect(),
            regras: r.clone(),
        }
    }

    /// A disciplina numa célula, se há uma (não vale para vago nem fora do horário).
    #[inline(always)]
    fn disciplina(&self, valor: i32) -> Option<usize> {
        (valor >= 1 && valor <= self.n_disc).then(|| (valor - 1) as usize)
    }
}

/// Um quadro com as contagens de cada regra, mantidas a cada troca.
///
/// Uso: uma ou mais chamadas a [`Avaliacao::trocar`] e depois [`Avaliacao::acertar`]; só então
/// [`Avaliacao::custo`] e as contagens valem para o quadro novo.
///
/// `acertar` tem duas etapas, para a busca desistir cedo de um movimento ruim:
/// [`Avaliacao::acertar_obrigatorias`] (depois dela [`Avaliacao::custo_obrigatorio`] já vale) e
/// [`Avaliacao::acertar_qualidade`]. Quem para na primeira e desfaz as trocas chama
/// [`Avaliacao::desfazer_obrigatorias`] em vez de acertar de novo.
#[derive(Clone)]
struct Avaliacao {
    quadro: QuadroHorario,
    /// Por recurso e posição: quantas aulas dele estão ali.
    uso: Vec<u16>,

    // Regras obrigatórias, nas unidades do fitness (ver `PesosFitness`)
    u_professor: i64,
    u_conflito: i64,
    u_unidas: i64,
    u_agrupar: i64,
    /// Por disciplina: a parte dela em `u_agrupar`.
    agr: Vec<i32>,

    // Regras de qualidade
    q: Qualidade,
    /// Por (recurso, dia): primeiro e último tempo com aula, e a parte de cada um em
    /// `q.jornada_min` e `q.descanso_min` (o descanso é entre o dia e o seguinte).
    primeiro: Vec<u8>,
    ultimo: Vec<u8>,
    jornada: Vec<u32>,
    descanso: Vec<u32>,
    /// Por linha do quadro (turma, dia): a parte dela em `q.intervalo` e `q.troca_de_turno`.
    quebras: Vec<(u16, u16)>,
    /// Por trecho: a parte dele em `q.janela`.
    janelas: Vec<u16>,

    // O que as trocas tocaram e `acertar` precisa recalcular
    disc_tocadas: Vec<u32>,
    /// (disciplina, valor de `agr` antes) do último `acertar_obrigatorias`.
    agr_antes: Vec<(u32, i32)>,
    celulas_tocadas: Vec<u32>,
    trechos_tocados: Vec<u32>,
    dias_tocados: Vec<(u32, u8)>,
    /// Rascunho de `agrupar_de`.
    restos: Vec<u8>,
}

impl Avaliacao {
    /// Conta tudo do zero. O quadro precisa estar completo: -1 fora do horário da turma e uma
    /// disciplina ou o vago em cada célula do horário.
    fn new(t: &Tabelas, quadro: QuadroHorario) -> Self {
        let n_rec = t.regras.professores.len();
        let mut a = Self {
            uso: vec![0; n_rec * t.por_turma],
            u_professor: 0,
            u_conflito: 0,
            u_unidas: 0,
            u_agrupar: 0,
            agr: vec![0; t.agrupar.len()],
            q: Qualidade::default(),
            primeiro: vec![SEM_AULA; n_rec * QUANTOS_DIAS],
            ultimo: vec![SEM_AULA; n_rec * QUANTOS_DIAS],
            jornada: vec![0; n_rec * QUANTOS_DIAS],
            descanso: vec![0; n_rec * QUANTOS_DIAS],
            quebras: vec![(0, 0); quadro.len() / t.n.max(1)],
            janelas: vec![0; t.regras.trechos.len()],
            disc_tocadas: Vec::new(),
            agr_antes: Vec::new(),
            celulas_tocadas: Vec::new(),
            trechos_tocados: Vec::new(),
            dias_tocados: Vec::new(),
            restos: Vec::new(),
            quadro,
        };
        for i in 0..t.ativas.len() {
            let c = t.ativas[i] as usize;
            debug_assert!(a.quadro[c] > 0, "célula do horário sem aula nem vago");
            a.por(t, a.quadro[c], c % t.por_turma);
            a.u_unidas += a.unidas_da_celula(t, c);
        }
        a.disc_tocadas.extend((0..t.agrupar.len() as u32).filter(|&d| t.agrupar[d as usize] > 0));
        a.celulas_tocadas.extend(t.linhas.iter().copied());
        a.trechos_tocados.extend(0..t.regras.trechos.len() as u32);
        a.dias_tocados.clear();
        for p in 0..n_rec as u32 {
            a.dias_tocados.extend((0..QUANTOS_DIAS as u8).map(|dia| (p, dia)));
        }
        a.acertar(t);
        a
    }

    /// O custo do quadro: o fitness do genético com o sinal trocado.
    #[inline]
    fn custo(&self, t: &Tabelas) -> f64 {
        let qualidade = if t.tq.ativa { t.tq.custo(&self.q) } else { 0.0 };
        // Mesma ordem de soma de `fitness_rapido`, para os dois darem exatamente o mesmo número
        0.0 + qualidade
            + self.u_professor as f64 * t.pesos.professor
            + self.u_conflito as f64 * t.pesos.conflito
            + self.u_unidas as f64 * t.pesos.unidas
            + self.u_agrupar as f64 * t.pesos.agrupar
    }

    /// A parte do custo que vem das regras obrigatórias: nunca é maior que [`Self::custo`].
    #[inline]
    fn custo_obrigatorio(&self, t: &Tabelas) -> f64 {
        self.u_professor as f64 * t.pesos.professor
            + self.u_conflito as f64 * t.pesos.conflito
            + self.u_unidas as f64 * t.pesos.unidas
            + self.u_agrupar as f64 * t.pesos.agrupar
    }

    /// Unidades de violação das regras obrigatórias (0 = horário válido).
    #[inline]
    fn violacoes(&self) -> i64 {
        self.u_professor + self.u_conflito + self.u_unidas + self.u_agrupar
    }

    /// Acerta a contagem de professor quando o uso de um recurso numa posição muda.
    #[inline(always)]
    fn conta_recurso(&mut self, t: &Tabelas, k: usize, antes: i64, depois: i64) {
        if t.pesos.professor_por_movimentos {
            if t.disp[k] {
                self.u_conflito += (depois - 1).max(0) - (antes - 1).max(0);
            } else {
                self.u_professor += depois - antes;
            }
        } else {
            let livre = t.disp[k] as i64;
            self.u_professor += depois * (depois - livre).max(0) - antes * (antes - livre).max(0);
        }
    }

    /// Põe a aula `valor` na posição `pos` da turma dela: ocupa os recursos.
    #[inline]
    fn por(&mut self, t: &Tabelas, valor: i32, pos: usize) {
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
    fn tirar(&mut self, t: &Tabelas, valor: i32, pos: usize) {
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

    /// Aulas em conjunto: quantas vezes a aula da célula `c` está sem a parceira no mesmo horário.
    #[inline]
    fn unidas_da_celula(&self, t: &Tabelas, c: usize) -> i64 {
        let Some(d) = t.disciplina(self.quadro[c]) else { return 0 };
        let (ini, fim) = t.unidas_de[d];
        let pos = c % t.por_turma;
        t.unidas[ini as usize..fim as usize].iter().filter(|&&(esperado, inicio)| self.quadro[inicio as usize + pos] != esperado).count() as i64
    }

    /// Aulas em conjunto: o mesmo, somando a turma e as parceiras dela na posição `pos`. É tudo o
    /// que pode mudar em `u_unidas` quando a célula da turma nessa posição muda.
    #[inline]
    fn unidas_na_posicao(&self, t: &Tabelas, turma: usize, pos: usize) -> i64 {
        let (ini, fim) = t.grupo_de[turma];
        t.grupo[ini as usize..fim as usize].iter().map(|&inicio| self.unidas_da_celula(t, inicio as usize + pos)).sum()
    }

    /// Troca o conteúdo de duas células da mesma turma. As contagens só voltam a valer depois de
    /// [`Self::acertar`].
    fn trocar(&mut self, t: &Tabelas, a: usize, b: usize) {
        let (va, vb) = (self.quadro[a], self.quadro[b]);
        if va == vb { return; }
        let turma = a / t.por_turma;
        debug_assert_eq!(turma, b / t.por_turma, "troca entre turmas diferentes");
        debug_assert!(va != -1 && vb != -1, "troca com célula fora do horário");
        let (pa, pb) = (a % t.por_turma, b % t.por_turma);
        let em_conjunto = t.em_conjunto[turma];

        if em_conjunto {
            self.u_unidas -= self.unidas_na_posicao(t, turma, pa) + self.unidas_na_posicao(t, turma, pb);
        }
        self.tirar(t, va, pa);
        self.tirar(t, vb, pb);
        self.quadro.swap(a, b);
        self.por(t, vb, pa);
        self.por(t, va, pb);
        if em_conjunto {
            self.u_unidas += self.unidas_na_posicao(t, turma, pa) + self.unidas_na_posicao(t, turma, pb);
        }

        for v in [va, vb] {
            if let Some(d) = t.disciplina(v) && t.agrupar[d] > 0 {
                self.disc_tocadas.push(d as u32);
            }
        }
        if t.tq.tem_quebras {
            self.celulas_tocadas.extend([a as u32, b as u32]);
        }
        // A janela só muda quando um horário vago troca de lugar
        if t.tq.tem_vagos && t.tem_folga[turma] && (va > t.n_disc || vb > t.n_disc) {
            self.trechos_tocados.extend([t.regras.trecho_de[a].0, t.regras.trecho_de[b].0]);
        }
    }

    /// Recalcula o que as trocas tocaram. Recalcular a mesma coisa duas vezes não tem efeito, por
    /// isso as listas não precisam ser sem repetição.
    fn acertar(&mut self, t: &Tabelas) {
        self.acertar_obrigatorias(t);
        self.acertar_qualidade(t);
    }

    /// Primeira etapa de [`Self::acertar`]: o agrupamento das disciplinas tocadas (professores e
    /// aulas em conjunto já foram contados nas trocas).
    fn acertar_obrigatorias(&mut self, t: &Tabelas) {
        self.agr_antes.clear();
        while let Some(d) = self.disc_tocadas.pop() {
            let novo = self.agrupar_de(t, d as usize);
            let antes = self.agr[d as usize];
            self.agr_antes.push((d, antes));
            self.u_agrupar += (novo - antes) as i64;
            self.agr[d as usize] = novo;
        }
    }

    /// Para quem fez as trocas, chamou só [`Self::acertar_obrigatorias`] e desfez as trocas: põe o
    /// agrupamento como estava e esquece o resto do que foi tocado (o quadro voltou a ser o de
    /// antes, e as contagens de qualidade nunca saíram dele).
    fn desfazer_obrigatorias(&mut self) {
        while let Some((d, antes)) = self.agr_antes.pop() {
            self.u_agrupar += (antes - self.agr[d as usize]) as i64;
            self.agr[d as usize] = antes;
        }
        self.disc_tocadas.clear();
        self.celulas_tocadas.clear();
        self.trechos_tocados.clear();
        self.dias_tocados.clear();
    }

    /// Segunda etapa de [`Self::acertar`]: as regras de qualidade.
    fn acertar_qualidade(&mut self, t: &Tabelas) {
        while let Some(c) = self.celulas_tocadas.pop() {
            let linha = c as usize / t.n;
            let (mut intervalo, mut turno) = (0u16, 0u16);
            t.tq.grupos_partidos(&self.quadro, linha * t.n, |_, troca| if troca { turno += 1 } else { intervalo += 1 });
            let (i0, t0) = self.quebras[linha];
            self.q.intervalo = self.q.intervalo + intervalo as u32 - i0 as u32;
            self.q.troca_de_turno = self.q.troca_de_turno + turno as u32 - t0 as u32;
            self.quebras[linha] = (intervalo, turno);
        }
        while let Some(k) = self.trechos_tocados.pop() {
            if k == u32::MAX { continue; }
            let trecho = &t.regras.trechos[k as usize];
            let novo = if t.tq.tem_vagos && t.tem_folga[trecho.turma] { t.tq.janelas_do_trecho(&self.quadro, &trecho.celulas) as u16 } else { 0 };
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
    fn refazer_dia(&mut self, t: &Tabelas, p: usize, dia: usize) {
        let base = p * t.por_turma + dia * t.n;
        let uso = &self.uso[base..base + t.n];
        let k = p * QUANTOS_DIAS + dia;
        self.primeiro[k] = uso.iter().position(|&u| u > 0).map_or(SEM_AULA, |x| x as u8);
        self.ultimo[k] = uso.iter().rposition(|&u| u > 0).map_or(SEM_AULA, |x| x as u8);

        let jornada = if self.primeiro[k] == SEM_AULA { 0 } else { t.tq.excesso_de_jornada(self.primeiro[k], self.ultimo[k]) };
        self.q.jornada_min = self.q.jornada_min + jornada - self.jornada[k];
        self.jornada[k] = jornada;

        // O descanso da véspera para este dia e deste para o seguinte (sábado não emenda com domingo)
        for d in [dia.wrapping_sub(1), dia] {
            if d >= QUANTOS_DIAS - 1 { continue; }
            let k = p * QUANTOS_DIAS + d;
            let falta = if self.ultimo[k] != SEM_AULA && self.primeiro[k + 1] != SEM_AULA { t.tq.falta_de_descanso(self.ultimo[k], self.primeiro[k + 1]) } else { 0 };
            self.q.descanso_min = self.q.descanso_min + falta - self.descanso[k];
            self.descanso[k] = falta;
        }
    }

    /// Erro de agrupamento de uma disciplina: a mesma conta de `fitness_rapido`, só para ela.
    fn agrupar_de(&mut self, t: &Tabelas, d: usize) -> i32 {
        let g = t.agrupar[d];
        if g <= 0 { return 0; }
        let v = d as i32 + 1;
        let n = t.n;
        let (ini, fim) = t.linhas_de[t.turma_de[d] as usize];
        let (mut erro, mut sobras) = (0i32, 0i32);
        self.restos.clear();
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
                let tamanho = (j - i) as i32;
                if !t.pesos.agrupar_por_movimentos {
                    let ideal = if t.dividir[d] { g } else { ((tamanho as f64 / g as f64).round() as i32) * g };
                    erro += (tamanho - ideal).abs();
                } else {
                    let (blocos, resto) = (tamanho / g, tamanho % g);
                    if t.dividir[d] && blocos >= 1 {
                        sobras += (blocos - 1) * g + resto;
                    } else if resto > 0 {
                        self.restos.push(resto as u8);
                    }
                }
                i = j;
            }
        }
        if t.pesos.agrupar_por_movimentos && (sobras > 0 || !self.restos.is_empty()) {
            self.restos.sort_unstable_by(|a, b| b.cmp(a));
            let total = sobras + self.restos.iter().map(|&r| r as i32).sum::<i32>();
            let completos = (total / g) as usize;
            let ficam: i32 = self.restos.iter().take(completos).map(|&r| r as i32).sum();
            erro += total - ficam;
        }
        erro
    }
}

/// Uma busca: um quadro andando por movimentos, e o melhor quadro por onde ela passou.
#[derive(Clone)]
struct Cadeia {
    atual: Avaliacao,
    custo: f64,
    melhor: QuadroHorario,
    melhor_custo: f64,
    /// Violações obrigatórias do melhor quadro (0 = válido).
    melhor_violacoes: i64,
    /// Lista do late acceptance: o custo de `lista.len()` iterações atrás.
    lista: Vec<f64>,
    iteracao: u64,
    /// Iteração em que o melhor quadro melhorou pela última vez, ou em que a cadeia voltou para ele.
    melhorou_em: u64,
    /// Degrau da folga da próxima volta ao melhor quadro, de 1 a [`FOLGAS`] (ver [`Self::folga`]).
    degrau: u32,
    rng: fastrand::Rng,
    /// As trocas do movimento sorteado.
    trocas: Vec<(u32, u32)>,
}

impl Cadeia {
    fn new(t: &Tabelas, atual: Avaliacao, lista: usize, semente: u64) -> Self {
        let custo = atual.custo(t);
        Self {
            melhor: atual.quadro.clone(),
            melhor_custo: custo,
            melhor_violacoes: atual.violacoes(),
            lista: vec![custo; lista.max(1)],
            iteracao: 0,
            melhorou_em: 0,
            degrau: 1,
            rng: fastrand::Rng::with_seed(semente),
            trocas: Vec::new(),
            atual,
            custo,
        }
    }

    /// Sorteia um movimento e deixa as trocas dele em `self.trocas`. Retorna false se o sorteio
    /// não deu em movimento nenhum (conta como uma iteração sem efeito).
    fn sortear(&mut self, t: &Tabelas) -> bool {
        self.trocas.clear();
        let q = &self.atual.quadro;
        let n = t.n;
        let a = t.ativas[self.rng.usize(0..t.ativas.len())] as usize;
        let turma = a / t.por_turma;
        let (ini, fim) = t.ativas_de[turma];
        let b = t.ativas[self.rng.usize(ini as usize..fim as usize)] as usize;
        let va = q[a];

        let agrupada = t.disciplina(va).is_some_and(|d| t.agrupar[d] > 0);
        if agrupada && self.rng.f64() < P_BLOCO {
            // O grupo de aulas seguidas que contém `a` troca com o trecho do mesmo tamanho que começa em `b`
            let linha = a - a % n;
            let (mut x, mut y) = (a, a + 1);
            while x > linha && q[x - 1] == va { x -= 1; }
            while y < linha + n && q[y] == va { y += 1; }
            let k = y - x;
            // O destino tem que caber no dia, dentro do horário da turma e sem sobrepor a origem
            if b % n + k > n || (b < y && x < b + k) || q[b..b + k].contains(&-1) {
                return false;
            }
            self.trocas.extend((0..k).map(|j| ((x + j) as u32, (b + j) as u32)));
        } else {
            if q[b] == va { return false; }
            self.trocas.push((a as u32, b as u32));
        }

        // Aula em conjunto: as turmas que participam fazem a mesma troca, para a aula mudar de
        // horário inteira
        if t.em_conjunto[turma] {
            for i in 0..self.trocas.len() {
                let (a, b) = (self.trocas[i].0 as usize, self.trocas[i].1 as usize);
                let (pa, pb) = (a % t.por_turma, b % t.por_turma);
                for (c, de, para) in [(a, pa, pb), (b, pb, pa)] {
                    let Some(d) = t.disciplina(q[c]) else { continue };
                    let (ini, fim) = t.unidas_de[d];
                    for &(esperado, inicio) in &t.unidas[ini as usize..fim as usize] {
                        let (origem, destino) = (inicio as usize + de, inicio as usize + para);
                        if q[origem] != esperado || q[destino] == -1 { continue; }
                        let (menor, maior) = (origem.min(destino) as u32, origem.max(destino) as u32);
                        if !self.trocas.iter().any(|&(x, y)| (x.min(y), x.max(y)) == (menor, maior)) {
                            self.trocas.push((origem as u32, destino as u32));
                        }
                    }
                }
            }
        }
        true
    }

    /// Uma iteração: sorteia um movimento, aplica, e desfaz se o late acceptance não aceitar (aceita
    /// o que não piora o quadro atual, ou o que é melhor que o custo de uma lista atrás).
    #[inline]
    fn passo(&mut self, t: &Tabelas) {
        let k = (self.iteracao % self.lista.len() as u64) as usize;
        if self.sortear(t) {
            for &(a, b) in &self.trocas {
                self.atual.trocar(t, a as usize, b as usize);
            }
            // Só com as regras obrigatórias já dá para recusar a maioria: a qualidade só soma custo
            self.atual.acertar_obrigatorias(t);
            let minimo = self.atual.custo_obrigatorio(t);
            if minimo > self.custo && minimo >= self.lista[k] {
                for &(a, b) in self.trocas.iter().rev() {
                    self.atual.trocar(t, a as usize, b as usize);
                }
                self.atual.desfazer_obrigatorias();
            } else {
                self.atual.acertar_qualidade(t);
                let novo = self.atual.custo(t);
                if novo <= self.custo || novo < self.lista[k] {
                    self.custo = novo;
                    if novo < self.melhor_custo {
                        self.melhor_custo = novo;
                        self.melhor_violacoes = self.atual.violacoes();
                        self.melhor.clone_from(&self.atual.quadro);
                        self.melhorou_em = self.iteracao;
                        self.degrau = 1;
                    }
                } else {
                    for &(a, b) in self.trocas.iter().rev() {
                        self.atual.trocar(t, a as usize, b as usize);
                    }
                    self.atual.acertar(t);
                }
            }
        }
        if self.custo < self.lista[k] {
            self.lista[k] = self.custo;
        }
        self.iteracao += 1;

        // Estacionou: volta para o melhor quadro, com folga para piorar
        if self.iteracao - self.melhorou_em > LISTAS_SEM_MELHORA * self.lista.len() as u64 {
            if self.atual.quadro != self.melhor {
                self.atual = Avaliacao::new(t, self.melhor.clone());
            }
            self.custo = self.melhor_custo;
            let teto = self.melhor_custo + self.folga(t);
            self.lista.fill(teto);
            self.degrau = self.degrau % FOLGAS + 1;
            self.melhorou_em = self.iteracao;
        }
    }

    /// Quanto a cadeia pode piorar ao voltar para o melhor quadro. Cresce a cada volta que não
    /// adianta e recomeça quando o melhor quadro melhora.
    ///
    /// - Melhor quadro com violação: 1, 2, 3… violações obrigatórias (da regra de menor peso).
    /// - Melhor quadro válido: as voltas se alternam entre uma folga pequena, na escala da
    ///   qualidade (a busca fica só entre horários válidos, trocando uma observação por outra), e
    ///   uma de violações obrigatórias (sai dos válidos e volta por outro caminho).
    fn folga(&self, t: &Tabelas) -> f64 {
        if self.melhor_violacoes == 0 && self.degrau % 2 == 1 {
            self.melhor_custo * FOLGA_DE_QUALIDADE * self.degrau.div_ceil(2) as f64
        } else if self.melhor_violacoes == 0 {
            (self.degrau / 2) as f64 * t.menor_obrigatoria
        } else {
            self.degrau as f64 * t.menor_obrigatoria
        }
    }
}

/// Busca local a partir de um quadro: uma ou mais cadeias independentes.
pub struct BuscaLocal {
    tabelas: Arc<Tabelas>,
    cadeias: Vec<Cadeia>,
    /// Iterações feitas, somando as cadeias.
    pub iteracoes: u64,
}

impl BuscaLocal {
    /// `inicial`: um quadro completo, como os do genético ([`RegrasHorario::genes_com_blocos`] ou o
    /// melhor de uma população). `cadeias`: quantas buscas independentes saem dele (uma por thread
    /// rende mais). `lista`: ver [`LISTA_PADRAO`]; com mais de uma cadeia, ver [`FATORES_DA_LISTA`].
    ///
    /// Os sorteios de cada cadeia saem do gerador global (`fastrand`): fixar a semente dele antes
    /// fixa a busca inteira, com qualquer número de threads.
    pub fn new(regras: &RegrasHorario, inicial: &[i32], cadeias: usize, lista: usize) -> Self {
        let tabelas = Arc::new(Tabelas::new(regras));
        let avaliacao = Avaliacao::new(&tabelas, inicial.to_vec());
        let cadeias = (0..cadeias.max(1))
            .map(|i| {
                let lista = (lista as f64 * FATORES_DA_LISTA[i % FATORES_DA_LISTA.len()]) as usize;
                Cadeia::new(&tabelas, avaliacao.clone(), lista, fastrand::u64(..))
            })
            .collect();
        Self { tabelas, cadeias, iteracoes: 0 }
    }

    /// Faz `iteracoes` movimentos em cada cadeia (em paralelo, se há pool de threads). Para antes
    /// se alguma cadeia chegar a custo 0. Retorna true se chegou.
    pub fn executar(&mut self, iteracoes: u64) -> bool {
        if self.resolvido() {
            return true;
        }
        let t = &*self.tabelas;
        let rodar = |c: &mut Cadeia| {
            for _ in 0..iteracoes {
                c.passo(t);
                if c.melhor_custo <= 0.0 { break; }
            }
        };
        let antes: u64 = self.cadeias.iter().map(|c| c.iteracao).sum();
        if self.cadeias.len() > 1 && pool_disponivel() {
            self.cadeias.par_iter_mut().for_each(rodar);
        } else {
            self.cadeias.iter_mut().for_each(rodar);
        }
        self.iteracoes += self.cadeias.iter().map(|c| c.iteracao).sum::<u64>() - antes;
        self.resolvido()
    }

    fn melhor_cadeia(&self) -> &Cadeia {
        self.cadeias.iter().min_by(|a, b| a.melhor_custo.total_cmp(&b.melhor_custo)).expect("há pelo menos uma cadeia")
    }

    /// O melhor quadro encontrado até agora.
    pub fn melhor(&self) -> &[i32] {
        &self.melhor_cadeia().melhor
    }

    /// O custo do melhor quadro: o fitness dele com o sinal trocado.
    pub fn melhor_custo(&self) -> f64 {
        self.melhor_cadeia().melhor_custo
    }

    /// true se o melhor quadro não quebra nenhuma regra obrigatória.
    pub fn valido(&self) -> bool {
        self.melhor_cadeia().melhor_violacoes == 0
    }

    /// true se o melhor quadro atende a todas as regras, obrigatórias e de qualidade.
    pub fn resolvido(&self) -> bool {
        self.melhor_custo() <= 0.0
    }

    pub fn cadeias(&self) -> usize {
        self.cadeias.len()
    }

    /// true se as cadeias estão rodando em threads diferentes.
    pub fn usando_threads(&self) -> bool {
        self.cadeias.len() > 1 && pool_disponivel()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genetic::problems::GAProblem;
    use wasm_bindgen_test::*;

    fn instancia(nome: &str) -> RegrasHorario {
        RegrasHorario::de_arquivo(&format!("{}/tests/instancias/{nome}.json", env!("CARGO_MANIFEST_DIR")))
    }

    /// Movimento a movimento, aceito ou desfeito, o custo incremental é exatamente o fitness
    /// calculado do zero, e as contagens de qualidade são as de `medir`.
    fn conferir_incremental(regras: &RegrasHorario, movimentos: usize) {
        fastrand::seed(7);
        let t = Tabelas::new(regras);
        let mut state = regras.initial_state();
        let mut c = Cadeia::new(&t, Avaliacao::new(&t, regras.random_genes()), 50, 11);
        assert_eq!(c.custo, -regras.fitness(&mut state, &c.atual.quadro), "custo inicial");
        for i in 0..movimentos {
            c.passo(&t);
            let esperado = -regras.fitness(&mut state, &c.atual.quadro);
            assert_eq!(c.atual.custo(&t), esperado, "custo depois do movimento {i}");
            assert_eq!(c.custo, esperado, "custo guardado depois do movimento {i}");
            if i % 97 == 0 {
                assert_eq!(c.atual.q, regras.qualidade(&c.atual.quadro).0, "qualidade depois do movimento {i}");
                assert_eq!(c.melhor_custo, -regras.fitness(&mut state, &c.melhor), "custo do melhor quadro");
            }
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_igual_ao_fitness() {
        // faculdade: horas, intervalos e ambientes; pequena e média: aulas em conjunto e blocos
        for nome in ["faculdade-anonimizado", "pequena", "media"] {
            conferir_incremental(&instancia(nome), 3000);
        }
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_igual_ao_fitness_com_os_pesos_originais() {
        let mut regras = instancia("pequena");
        regras.pesos = PesosFitness::ORIGINAL;
        conferir_incremental(&regras, 3000);
    }

    /// Horários vagos, horários a evitar e jornada: as regras de qualidade que as instâncias de
    /// arquivo não exercitam.
    #[wasm_bindgen_test(unsupported = test)]
    fn custo_incremental_com_vagos_e_evitar() {
        let tempos = [(420, 470, "m"), (470, 520, "m"), (520, 570, "m"), (590, 640, "m"), (780, 830, "t"), (830, 880, "t"), (1140, 1190, "n"), (1190, 1240, "n")]
            .map(|(i, f, t)| format!(r#"{{ "inicio": {i}, "fim": {f}, "turno": "{t}" }}"#))
            .join(", ");
        let todos = "[1, 2, 3, 4, 5, 6, 7, 8]";
        let regras = RegrasHorario::from_json(&format!(r#"{{
            "turmas": [
                {{ "id": "A", "horarios": {{ "seg": {todos}, "ter": {todos}, "qua": [1, 2, 3, 4] }} }},
                {{ "id": "B", "horarios": {{ "seg": {todos}, "ter": [1, 2, 3, 4, 7, 8], "qua": {todos} }} }}
            ],
            "aulas": [
                {{ "id": "Mat A", "turmas": ["A"], "recursos": ["P1", "S"], "aulasSemana": 6, "bloco": 2 }},
                {{ "id": "Port A", "turmas": ["A"], "recursos": ["P2"], "aulasSemana": 5 }},
                {{ "id": "Fis", "turmas": ["A", "B"], "recursos": ["P3", "S"], "aulasSemana": 3, "bloco": 3, "emendar": true }},
                {{ "id": "Mat B", "turmas": ["B"], "recursos": ["P1"], "aulasSemana": 8, "bloco": 2, "emendar": true }},
                {{ "id": "Port B", "turmas": ["B"], "recursos": ["P2", "P3"], "aulasSemana": 6 }}
            ],
            "recursos": [
                {{ "id": "P1", "disponibilidade": {{ "seg": {todos}, "ter": {todos}, "qua": {todos} }}, "evitar": {{ "seg": [1, 2], "qua": [8] }} }},
                {{ "id": "P2", "disponibilidade": {{ "seg": {todos}, "ter": [1, 2, 3, 4], "qua": {todos} }}, "evitar": {{ "ter": [1] }} }},
                {{ "id": "P3", "disponibilidade": {{ "seg": [5, 6, 7, 8], "ter": {todos}, "qua": {todos} }} }},
                {{ "id": "S", "ambiente": true, "disponibilidade": {{ "seg": {todos}, "ter": {todos}, "qua": {todos} }} }}
            ],
            "tempos": [{tempos}]
        }}"#)).unwrap();
        assert!(regras.turmas.iter().all(|t| t.folga > 0), "as duas turmas têm horários vagos");
        conferir_incremental(&regras, 6000);
    }

    #[wasm_bindgen_test(unsupported = test)]
    fn resolve_a_instancia_pequena_a_partir_de_um_quadro_qualquer() {
        let regras = instancia("pequena");
        fastrand::seed(3);
        let mut busca = BuscaLocal::new(&regras, &regras.random_genes(), 2, 500);
        for _ in 0..200 {
            if busca.executar(20_000) { break; }
        }
        assert!(busca.valido(), "custo {}", busca.melhor_custo());
        let mut state = regras.initial_state();
        assert_eq!(-regras.fitness_rapido(&mut state, busca.melhor()), busca.melhor_custo());
    }

    /// A mesma semente dá a mesma busca.
    #[wasm_bindgen_test(unsupported = test)]
    fn mesma_semente_mesmo_resultado() {
        let regras = instancia("media");
        let rodar = || {
            fastrand::seed(5);
            let mut busca = BuscaLocal::new(&regras, &regras.genes_com_blocos(), 3, 300);
            busca.executar(5_000);
            (busca.melhor().to_vec(), busca.melhor_custo())
        };
        assert_eq!(rodar(), rodar());
    }
}
