//! Tabelas pré-computadas, pesos e primitivas de avaliação compartilhadas entre o algoritmo
//! genético e a busca local.
//!
//! A ideia é ter uma **única fonte da verdade** para as regras obrigatórias e para a fórmula de
//! custo:
//! - [`TabelasHorario`] guarda os índices numéricos achatados (sem clonar `RegrasHorario`), leves
//!   para copiar por thread/ilha;
//! - [`Unidades`] e [`PesosFitness`] definem a fórmula única de custo obrigatório e total;
//! - as primitivas atômicas (`delta_recurso`, `unidas_da_celula`, `fixa_fora`, `registrar_pedaco`)
//!   são chamadas tanto pela avaliação completa (GA) quanto pela incremental (busca local).

use super::{
    DiaSemana, RegraDivisao, RegrasHorario, TabelasQualidade, Trecho, MAIOR_PEDACO, QUANTOS_DIAS,
};

/// Pesos de cada regra obrigatória no custo/fitness (pontos por unidade de violação) e como as
/// violações de professor são medidas. O custo é 0 exatamente quando o quadro não viola nenhuma
/// regra, com quaisquer pesos positivos: os pesos só mudam o "relevo" que guia a busca.
///
/// O padrão ([`PesosFitness::PADRAO`]) mede o professor em AULAS QUE PRECISAM MUDAR DE LUGAR e o
/// agrupamento pelo desvio das regras de divisão em pedaços (ver `horario_divisao.rs`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PesosFitness {
    /// Por aula e por professor: horário em que ele não trabalha, ou cada turma a mais no mesmo horário.
    pub professor: f64,
    /// Por aula de disciplina unida sem a parceira no mesmo horário.
    pub unidas: f64,
    /// Por unidade de desvio das regras de divisão em pedaços (ver `horario_divisao.rs`).
    pub agrupar: f64,
    /// Como medir o erro de professor num horário com N turmas dele:
    /// - false: cada uma das N aulas conta (N - disponível) — um conflito de 2 turmas vale 2 (fitness original);
    /// - true: conta só as aulas que precisam sair (N - disponível) — um conflito de 2 turmas vale 1.
    pub professor_por_movimentos: bool,
    /// Só com `professor_por_movimentos`: peso de cada turma a mais do mesmo professor num horário
    /// em que ele trabalha (conflito). `professor` fica sendo o peso da aula em horário em que ele
    /// não trabalha. Sem `professor_por_movimentos` os dois casos usam `professor`.
    pub conflito: f64,
    /// Por aula fixada fora da célula em que foi fixada (ver `horario_inicial.rs`).
    pub fixa: f64,
}

impl PesosFitness {
    /// Tudo medido em aulas a mover, conflito com metade do peso do horário indisponível.
    pub const PADRAO: Self = Self {
        professor: 100.0,
        conflito: 50.0,
        unidas: 30.0,
        agrupar: 20.0,
        professor_por_movimentos: true,
        fixa: 100.0,
    };
}

impl Default for PesosFitness {
    fn default() -> Self {
        Self::PADRAO
    }
}

/// Unidades de violação das regras obrigatórias de um quadro.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Unidades {
    pub professor: i64,
    pub conflito: i64,
    pub unidas: i64,
    pub agrupar: i64,
    /// Aulas fixadas fora do lugar.
    pub fixas: i64,
}

impl Unidades {
    /// Total de violações obrigatórias (0 = horário válido).
    #[inline(always)]
    pub fn violacoes(&self) -> i64 {
        self.professor + self.conflito + self.unidas + self.agrupar + self.fixas
    }

    /// Violações obrigatórias sem contar aulas fixadas (o que o validador do Pencilmark confere).
    #[inline(always)]
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn violacoes_sem_fixas(&self) -> i64 {
        self.professor + self.conflito + self.unidas + self.agrupar
    }

    /// Custo apenas das regras obrigatórias (usado na rejeição antecipada da busca local).
    #[inline(always)]
    pub fn custo_obrigatorio(&self, p: &PesosFitness) -> f64 {
        self.professor as f64 * p.professor
            + self.conflito as f64 * p.conflito
            + self.unidas as f64 * p.unidas
            + self.agrupar as f64 * p.agrupar
            + self.fixas as f64 * p.fixa
    }

    /// Custo total (qualidade + obrigatórias), na ordem fixa de soma em `f64` compartilhada entre
    /// a avaliação normal (GA) e a incremental (busca local).
    #[inline(always)]
    pub fn custo_total(&self, p: &PesosFitness, qualidade: f64) -> f64 {
        0.0 + qualidade
            + self.professor as f64 * p.professor
            + self.conflito as f64 * p.conflito
            + self.unidas as f64 * p.unidas
            + self.agrupar as f64 * p.agrupar
            + self.fixas as f64 * p.fixa
    }
}

/// Tabelas numéricas derivadas de [`RegrasHorario`], montadas uma vez por execução (ou copiadas por
/// thread/ilha no GA). Não guarda `RegrasHorario` dentro para manter a cópia leve.
#[derive(Clone)]
pub(crate) struct TabelasHorario {
    /// Tempos por dia.
    pub n: usize,
    /// Células de uma turma no quadro (`QUANTOS_DIAS * n`). A posição dentro da turma
    /// (`dia * n + tempo`) também indexa as tabelas por recurso (`disp`, `uso`, `evitar`).
    pub por_turma: usize,
    pub n_turmas: usize,
    pub n_rec: usize,
    /// Os valores `1..=n_disc` no quadro são disciplinas; `n_disc + 1` é o horário vago.
    pub n_disc: i32,
    pub pesos: PesosFitness,
    /// A menor penalidade de uma regra obrigatória (> 0): unidade da folga na busca local.
    pub menor_obrigatoria: f64,
    pub tq: TabelasQualidade,

    /// Por disciplina: intervalo em `rec` (os recursos dela).
    pub rec_de: Vec<(u32, u32)>,
    pub rec: Vec<u32>,
    /// Por disciplina: as regras de divisão em pedaços, e se ela tem pedaços de >1 aula.
    pub divisao: Vec<RegraDivisao>,
    pub agrupa: Vec<bool>,
    /// Por disciplina: a turma dela.
    pub turma_de: Vec<u32>,
    /// Por disciplina: intervalo em `unidas`, com `(valor esperado na turma parceira, início da
    /// turma parceira no quadro)`.
    pub unidas_de: Vec<(u32, u32)>,
    pub unidas: Vec<(i32, u32)>,

    /// Por recurso e posição (`p * por_turma + dia * n + tempo`): disponível?
    pub disp: Vec<bool>,

    /// Por turma: intervalo em `linhas` (início no quadro de cada dia em que ela tem aula).
    pub linhas_de: Vec<(u32, u32)>,
    pub linhas: Vec<u32>,
    /// Por turma: intervalo em `ativas` (células em que ela tem aula). `ativas` tem todas as
    /// células ativas do quadro, turma a turma; `inativas`, todas as células fora do horário (-1).
    pub ativas_de: Vec<(u32, u32)>,
    pub ativas: Vec<u32>,
    pub inativas: Vec<u32>,

    /// Por turma: intervalo em `grupo` (início no quadro dela e das vizinhas diretas em aulas em
    /// conjunto). Usado para recalcular `u_unidas` numa posição.
    pub grupo_de: Vec<(u32, u32)>,
    pub grupo: Vec<u32>,
    pub em_conjunto: Vec<bool>,

    /// Componentes conexos transitivos de turmas ligadas por aulas em conjunto (cada elemento em
    /// `componentes` é um `turma_id`). Usado no crossover para não separar aulas conjuntas.
    pub componentes_de: Vec<(u32, u32)>,
    pub componentes: Vec<u32>,

    /// Por turma: tem horários vagos (folga)?
    pub tem_folga: Vec<bool>,
    /// Por célula: valor da aula fixada ali (0 = célula livre). Vazio quando não há fixadas.
    pub fixa: Vec<i32>,
    /// Lista compacta das aulas fixadas `(celula, valor)`, usada ao inicializar a avaliação incremental.
    pub fixas_lista: Vec<(u32, i32)>,

    /// Trechos (turnos de cada dia de cada turma) e índice `(trecho, pos)` por célula do quadro.
    pub trechos: Vec<Trecho>,
    pub trecho_de: Vec<(u32, u32)>,
}

impl TabelasHorario {
    pub fn new(r: &RegrasHorario) -> Self {
        let n = r.n_tempos;
        let por_turma = QUANTOS_DIAS * n;
        let n_turmas = r.turmas.len();
        let n_rec = r.professores.len();
        let p = r.pesos;
        let fixa_peso = if r.fixas.is_empty() { 0.0 } else { p.fixa };
        let menor_obrigatoria = [p.professor, p.conflito, p.unidas, p.agrupar, fixa_peso]
            .into_iter()
            .filter(|&x| x > 0.0)
            .reduce(f64::min)
            .unwrap_or(1.0);

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

        let mut disp = vec![false; n_rec * por_turma];
        for prof in &r.professores {
            for dia in DiaSemana::TODOS {
                for tempo in 0..n {
                    disp[prof.id * por_turma + dia.to_index() * n + tempo] = prof.horarios.get(dia, tempo) != 0;
                }
            }
        }

        let (mut linhas_de, mut linhas) = (Vec::new(), Vec::new());
        let (mut ativas_de, mut ativas, mut inativas) = (Vec::new(), Vec::new(), Vec::new());
        let (mut grupo_de, mut grupo, mut em_conjunto) = (Vec::new(), Vec::new(), Vec::new());
        let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n_turmas];

        for turma in &r.turmas {
            let (ini_linhas, ini_ativas) = (linhas.len() as u32, ativas.len() as u32);
            for dia in DiaSemana::TODOS {
                let inicio = r.to_quadro_index(turma.id, dia, 0);
                let antes = ativas.len();
                for tempo in 0..n {
                    let c = (inicio + tempo) as u32;
                    if turma.horarios.get(dia, tempo) == 1 {
                        ativas.push(c);
                    } else {
                        inativas.push(c);
                    }
                }
                if ativas.len() > antes {
                    linhas.push(inicio as u32);
                }
            }
            linhas_de.push((ini_linhas, linhas.len() as u32));
            ativas_de.push((ini_ativas, ativas.len() as u32));

            // A turma e as parceiras diretas dela em aulas em conjunto
            let ini_grupo = grupo.len();
            grupo.push((turma.id * por_turma) as u32);
            for d in r.disciplinas.iter().filter(|d| d.turma_id == turma.id) {
                for &u in &d.disciplinas_unidas {
                    let parceira = r.disciplinas[u].turma_id;
                    let inicio = (parceira * por_turma) as u32;
                    if !grupo[ini_grupo..].contains(&inicio) {
                        grupo.push(inicio);
                    }
                    if parceira != turma.id && !adj[turma.id].contains(&parceira) {
                        adj[turma.id].push(parceira);
                    }
                }
            }
            em_conjunto.push(grupo.len() - ini_grupo > 1);
            grupo_de.push((ini_grupo as u32, grupo.len() as u32));
        }

        // Componentes conexos transitivos de turmas (via BFS sobre `adj`)
        let (mut componentes_de, mut componentes) = (Vec::new(), Vec::new());
        let mut visitada = vec![false; n_turmas];
        let mut fila = Vec::new();
        for t in 0..n_turmas {
            if visitada[t] { continue; }
            let ini = componentes.len() as u32;
            visitada[t] = true;
            fila.push(t);
            while let Some(u) = fila.pop() {
                componentes.push(u as u32);
                for &v in &adj[u] {
                    if !visitada[v] {
                        visitada[v] = true;
                        fila.push(v);
                    }
                }
            }
            componentes[ini as usize..].sort_unstable();
            componentes_de.push((ini, componentes.len() as u32));
        }

        let fixa = if r.fixas.is_empty() {
            Vec::new()
        } else {
            let mut fixa = vec![0; r.tamanho_quadro()];
            for &(c, v) in &r.fixas {
                fixa[c] = v;
            }
            fixa
        };
        let fixas_lista = r.fixas.iter().map(|&(c, v)| (c as u32, v)).collect();

        Self {
            n,
            por_turma,
            n_turmas,
            n_rec,
            n_disc: r.disciplinas.len() as i32,
            pesos: r.pesos,
            menor_obrigatoria,
            tq: TabelasQualidade::new(r),
            rec_de,
            rec,
            divisao: r.disciplinas.iter().map(|d| d.divisao.clone()).collect(),
            agrupa: r.disciplinas.iter().map(|d| d.divisao.agrupa()).collect(),
            turma_de: r.disciplinas.iter().map(|d| d.turma_id as u32).collect(),
            unidas_de,
            unidas,
            disp,
            linhas_de,
            linhas,
            ativas_de,
            ativas,
            inativas,
            grupo_de,
            grupo,
            em_conjunto,
            componentes_de,
            componentes,
            tem_folga: r.turmas.iter().map(|t| t.folga > 0).collect(),
            fixa,
            fixas_lista,
            trechos: r.trechos.clone(),
            trecho_de: r.trecho_de.clone(),
        }
    }

    /// A disciplina numa célula, se há uma (não vale para vago nem fora do horário).
    #[inline(always)]
    pub fn disciplina(&self, valor: i32) -> Option<usize> {
        (valor >= 1 && valor <= self.n_disc).then(|| (valor - 1) as usize)
    }

    /// Valor de um horário vago no quadro.
    #[inline(always)]
    pub fn vago(&self) -> i32 {
        self.n_disc + 1
    }

    // ── Primitivas atômicas das regras obrigatórias (fonte única da verdade) ─────────────────

    /// Variação em `(u_professor, u_conflito)` quando o uso do recurso no índice `k`
    /// (`p * por_turma + pos`) muda de `antes` para `depois`.
    #[inline(always)]
    pub fn delta_recurso(&self, k: usize, antes: i64, depois: i64) -> (i64, i64) {
        self.delta_recurso_com(k, antes, depois, self.pesos.professor_por_movimentos)
    }

    /// Como [`Self::delta_recurso`], com o modo de medição explícito (usado quando `fitness_rapido`
    /// é chamado com pesos diferentes dos usados ao montar o estado).
    #[inline(always)]
    pub fn delta_recurso_com(&self, k: usize, antes: i64, depois: i64, por_movimentos: bool) -> (i64, i64) {
        if por_movimentos {
            if self.disp[k] {
                (0, (depois - 1).max(0) - (antes - 1).max(0))
            } else {
                (depois - antes, 0)
            }
        } else {
            let livre = self.disp[k] as i64;
            (depois * (depois - livre).max(0) - antes * (antes - livre).max(0), 0)
        }
    }

    /// Aulas em conjunto: quantas vezes a aula na célula `c` está sem a parceira no mesmo horário.
    #[inline]
    pub fn unidas_da_celula(&self, quadro: &[i32], c: usize) -> i64 {
        let Some(d) = self.disciplina(quadro[c]) else { return 0 };
        let (ini, fim) = self.unidas_de[d];
        let pos = c % self.por_turma;
        self.unidas[ini as usize..fim as usize]
            .iter()
            .filter(|&&(esperado, inicio)| quadro[inicio as usize + pos] != esperado)
            .count() as i64
    }

    /// Aulas em conjunto: soma de [`Self::unidas_da_celula`] na turma e nas parceiras dela na
    /// posição `pos`. É tudo o que pode mudar em `u_unidas` quando a célula da turma muda.
    #[inline]
    pub fn unidas_na_posicao(&self, quadro: &[i32], turma: usize, pos: usize) -> i64 {
        let (ini, fim) = self.grupo_de[turma];
        self.grupo[ini as usize..fim as usize]
            .iter()
            .map(|&inicio| self.unidas_da_celula(quadro, inicio as usize + pos))
            .sum()
    }

    /// 1 se a célula `c` tem aula fixada diferente de `valor`, 0 caso contrário.
    #[inline(always)]
    pub fn fixa_fora(&self, c: usize, valor: i32) -> i64 {
        (self.fixa[c] != 0 && valor != self.fixa[c]) as i64
    }

    /// Registra um pedaço contíguo de `tamanho` aulas para uma disciplina com `regra` ativa,
    /// atualizando `contagem` (por tamanho) e `quantidade` (total na semana) e devolvendo o desvio
    /// de tamanho deste pedaço.
    #[inline(always)]
    pub fn registrar_pedaco(regra: &RegraDivisao, tamanho: usize, contagem: &mut [u8], quantidade: &mut u8) -> i32 {
        let t = tamanho.min(MAIOR_PEDACO) as u8;
        contagem[t as usize] = contagem[t as usize].saturating_add(1);
        *quantidade = quantidade.saturating_add(1);
        regra.desvio_do_pedaco(t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn componentes_conexos_sao_transitivos() {
        // A junta com B, B junta com C, D sozinha → componentes [0, 1, 2] e [3]
        let r = RegrasHorario::from_json(r#"{
            "turmas": [
                { "id": "A", "horarios": { "seg": [1, 2] } },
                { "id": "B", "horarios": { "seg": [1, 2] } },
                { "id": "C", "horarios": { "seg": [1, 2] } },
                { "id": "D", "horarios": { "seg": [1, 2] } }
            ],
            "aulas": [
                { "id": "ab", "turmas": ["A", "B"], "recursos": [], "aulasSemana": 1 },
                { "id": "bc", "turmas": ["B", "C"], "recursos": [], "aulasSemana": 1 },
                { "id": "d",  "turmas": ["D"],      "recursos": [], "aulasSemana": 1 }
            ],
            "recursos": []
        }"#).unwrap();
        let t = TabelasHorario::new(&r);
        let comps: Vec<&[u32]> = t.componentes_de.iter().map(|&(a, b)| &t.componentes[a as usize..b as usize]).collect();
        assert_eq!(comps, vec![&[0, 1, 2][..], &[3][..]]);
    }

    #[test]
    fn delta_recurso_casos_a_mao() {
        // Recurso 0 disponível em pos 0, indisponível em pos 1
        let r = RegrasHorario::from_json(r#"{
            "turmas": [{ "id": "T", "horarios": { "seg": [1, 2] } }],
            "aulas": [{ "id": "a", "turmas": ["T"], "recursos": ["P"], "aulasSemana": 2 }],
            "recursos": [{ "id": "P", "disponibilidade": { "seg": [1] } }]
        }"#).unwrap();
        let mut t = TabelasHorario::new(&r);
        let pos_disp = DiaSemana::Segunda.to_index() * t.n;
        let pos_indisp = pos_disp + 1;

        // Modo padrão (professor_por_movimentos = true):
        // Disponível: 0→1 (0,0), 1→2 (0,1), 2→3 (0,1), 3→1 (0,-2)
        assert_eq!(t.delta_recurso(pos_disp, 0, 1), (0, 0));
        assert_eq!(t.delta_recurso(pos_disp, 1, 2), (0, 1));
        assert_eq!(t.delta_recurso(pos_disp, 2, 3), (0, 1));
        assert_eq!(t.delta_recurso(pos_disp, 3, 1), (0, -2));
        // Indisponível: cada turma conta em professor
        assert_eq!(t.delta_recurso(pos_indisp, 0, 1), (1, 0));
        assert_eq!(t.delta_recurso(pos_indisp, 1, 2), (1, 0));
        assert_eq!(t.delta_recurso(pos_indisp, 2, 0), (-2, 0));

        // Modo legado (professor_por_movimentos = false):
        // Disponível (livre=1): uso=1 → 0; uso=2 → 2*1=2; uso=3 → 3*2=6 (deltas: 0, +2, +4)
        t.pesos.professor_por_movimentos = false;
        assert_eq!(t.delta_recurso(pos_disp, 0, 1), (0, 0));
        assert_eq!(t.delta_recurso(pos_disp, 1, 2), (2, 0));
        assert_eq!(t.delta_recurso(pos_disp, 2, 3), (4, 0));
        // Indisponível (livre=0): uso=1 → 1; uso=2 → 4; uso=3 → 9 (deltas: +1, +3, +5)
        assert_eq!(t.delta_recurso(pos_indisp, 0, 1), (1, 0));
        assert_eq!(t.delta_recurso(pos_indisp, 1, 2), (3, 0));
        assert_eq!(t.delta_recurso(pos_indisp, 2, 3), (5, 0));
    }
}
