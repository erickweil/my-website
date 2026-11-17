# Plano — Estudo dos parâmetros da busca local

> **Executado em 17/11/2026.** Resultado e teorias em `estudo-busca-local.md`. As rodadas 2 e 3
> seguiram as hipóteses que a rodada 1 levantou (lista que cresce, `p_bloco`, recomeçar de um
> quadro novo); a rodada 4 confirmou com sementes novas.

> Objetivo: descobrir com quais modos e parâmetros a busca local (`horario_busca_local.rs`) chega
> mais depressa a um horário que atende às regras obrigatórias e, depois disso, a menos observações
> de qualidade. Cada mudança de padrão tem que vir de um número medido aqui.
>
> Orçamento: cerca de 1h30 de CPU, numa thread, em Rust nativo com `--release`.

---

## 1. O que se ajusta

Tudo o que era número mágico virou campo de `ParametrosBusca` (o padrão é o que a página usa), mais
o ponto de partida, que é do runner:

| Parâmetro | Padrão | O que faz |
| :--- | :--- | :--- |
| `lista` | 5000 | comprimento da lista do late acceptance: por quantas iterações uma piora é tolerada |
| `atualizacao` | só baixa | a lista guarda o mínimo (`SoBaixa`) ou sempre o custo atual (`Classica`, como no artigo) |
| `p_bloco` | 0,5 | chance de mover o grupo inteiro de aulas seguidas quando a aula sorteada é agrupada |
| `listas_sem_melhora` | 100 | quantas listas sem melhorar o melhor até voltar a ele com folga |
| `folgas` | 6 | degraus da folga (depois do maior volta ao menor) |
| `folga_de_qualidade` | 0,05 | folga na escala da qualidade: fração do custo do melhor, por degrau |
| `sair_dos_validos` | sim | com horário válido, alternar a folga de qualidade com uma de violações obrigatórias |
| partida | blocos | quadro inicial sorteado com os blocos montados, ou totalmente aleatório |

Fora do estudo: `FATORES_DA_LISTA` (só vale com várias cadeias, e aqui roda uma) e os pesos do
custo (mudam o problema, não a busca).

## 2. Como se mede

- **Programa:** `examples/grade_busca_local.rs`. Uma variante por chamada, uma linha CSV por
  execução (instância × semente). As chamadas rodam uma de cada vez: nunca dois processos ao mesmo
  tempo, para o tempo não ter ruído de disputa por CPU.
- **Instâncias:**
  - `media` (10 turmas) e `grande` (25 turmas): sintéticas, sem regras de qualidade. Só
    obrigatórias.
  - `real-tecnico-v3-blocos` (19 turmas, 614 aulas): chega a válido em ~1,5 s; o resto do tempo
    mede a fase de qualidade.
  - `real-tecnico-v4-dias` (19 turmas): a mais difícil; metade das sementes não chega a válido em
    20 s.
- **Métricas:**
  - **Obrigatórias:** quantas sementes chegaram a válido no orçamento; mediana de *movimentos* até
    válido (a busca é determinística por semente, então essa conta não tem ruído) e de segundos
    (inclui o custo de cada movimento, que muda com alguns parâmetros). Semente que não chegou
    conta como infinito na mediana.
  - **Qualidade:** custo final e número de observações do melhor quadro; custo em 1, 2, 4, 8… s
    para comparar a curva.
- **Leitura:** um efeito só vale se aparecer na maioria das sementes, não só na mediana. Diferença
  menor que a variação entre sementes do próprio padrão é tratada como empate.

## 3. Rodadas

### Rodada 1 — Varredura de um parâmetro por vez (~25 min)

Todas as instâncias, 4 sementes, 8 s. A partir do padrão, muda um parâmetro de cada vez:

- `lista`: 1000, 2500, 10000, 20000
- `p_bloco`: 0, 0,25, 0,75, 1
- `listas_sem_melhora`: 25, 50, 200, 400
- `folgas`: 1, 3, 12
- `folga_de_qualidade`: 0,01, 0,02, 0,1, 0,2
- `sair_dos_validos`: não
- `atualizacao`: clássica
- partida: aleatória

Saída: para cada parâmetro, se ele importa, em que direção e em qual fase (obrigatórias ou
qualidade).

### Rodada 2 — Hipóteses (~25 min)

Com o que a rodada 1 mostrar, formular hipóteses e testar só elas. Exemplos do tipo de pergunta:

- O melhor comprimento da lista depende do tamanho da instância (deveria ser proporcional ao
  número de aulas)?
- Os parâmetros que ajudam nas obrigatórias atrapalham na qualidade (e valeria trocá-los quando o
  horário fica válido)?
- Dois parâmetros que melhoraram sozinhos somam quando juntos?

Cada hipótese vira uma grade pequena (2 a 3 parâmetros), com mais sementes nas instâncias onde a
rodada 1 mostrou efeito.

### Rodada 3 — Confirmação (~35 min)

A melhor configuração (e uma ou duas alternativas próximas) contra o padrão, com sementes novas
(que não foram usadas para escolher), mais sementes e orçamento maior. Só esta rodada decide se o
padrão muda.

## 4. Resultado

Um relatório (`docs/estudo-busca-local.md`) com as tabelas de cada rodada, as hipóteses e o que os
números disseram de cada uma, e a recomendação de padrão. Mudar o padrão da página fica para depois,
com a confirmação do usuário.
