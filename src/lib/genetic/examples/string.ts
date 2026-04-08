import { GAProblem } from "../problem.ts";

/**
 * String: produzir um texto qualquer com palavras reais, onde cada gene é um caractere.
 *
 * Solução ótima: apenas palavras que existem, 
 * fitness: número de palavras corretas + número de caracteres corretos na posição correta / 10 (para evitar que seja muito baixo no início).
 */
export class StringGAProblem implements GAProblem<number[]> {
    maxFitness?: number | undefined;
    palavras: number[][];
    constructor(private readonly size: number) { 
        this.maxFitness = size * size * 10;
        this.palavras = palavras.map(p => {
            let normalized = p.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Remove acentos
            return normalized.split("").map(c => c.charCodeAt(0))
        });
    }

    randomGenes(): number[] {
        return Array.from({ length: this.size }, 
            () => 32 + Math.floor(Math.random() * 95)
        );
    }

    fitness(genes: number[]): number {
        let fitness = 0;
        let lastSeparator = -1;
        for (let i = 0; i < genes.length; i++) {
            const char = genes[i];
            if(
                   (char >= 32 && char <= 47)   //  !"#$%&'()*+,-./
                || (char >= 58 && char <= 64)   // :;<=>?@
                || (char >= 91 && char <= 96)   // [\]^_`
                || (char >= 123 && char <= 126) // {|}~
                || i === genes.length - 1       // Último caractere, conta como separador
            ) {
                // Se o caractere é um separador, só ganha fitness se não for imediatamente após o último separador
                if (i > lastSeparator + 1) {
                    fitness += 1;
                    if(char === 32) {
                        fitness += 1;
                    }
                }
                const wordStart = lastSeparator + 1;
                const wordLength = i - wordStart;
                let bestMatchLength = 0;
                for(const palavra of this.palavras) {
                    let j = 0;
                    let match = 0;
                    for(; j < palavra.length; j++) {
                        if (palavra[j] !== genes[wordStart + j]) {
                            break;
                        } else {
                            match++;
                        }
                    }
                    if (match > bestMatchLength) {
                        bestMatchLength = match;
                    }
                    
                    if (match === palavra.length) {
                        if(palavra.length === wordLength) {
                            fitness += palavra.length * palavra.length * 2;
                        } else {
                            fitness += palavra.length * palavra.length;
                        }
                        break;
                    }
                }
                if(bestMatchLength > 1) {
                    fitness += bestMatchLength*bestMatchLength;
                }
                lastSeparator = i;
            }
        }
        return fitness;
    }

    clone(result: number[], genes: number[]): void {
        for(let i = 0; i < genes.length; i++) {
            result[i] = genes[i];
        }
    }

    mutate(genes: number[], mutationRate: number): void {
        const mutations = Math.random() * Math.round(genes.length * mutationRate * 2);
        
        for(let i = 0; i < mutations; i++) {
            const randomIndex = Math.floor(Math.random() * genes.length);
            if(Math.random() > 0.5) {
                // Faz alguns swaps
                const swapWith = Math.floor(Math.random() * genes.length);
                const temp = genes[randomIndex];
                genes[randomIndex] = genes[swapWith];
                genes[swapWith] = temp;        
            } else if(Math.random() > 0.5) {
                // Muda para um caractere aleatório
                let newChar = 32 + Math.floor(Math.random() * 95);
                if(Math.random() > 0.5) {
                    // Substitui
                    genes[randomIndex] = newChar;
                } else if(Math.random() > 0.5) {
                    // Deleta um caractere (desloca tudo para a esquerda e coloca ele no final)
                    for(let j = randomIndex; j < genes.length - 1; j++) {
                        genes[j] = genes[j + 1];
                    }
                    genes[genes.length - 1] = newChar;
                } else {
                    // Insere um caractere (desloca tudo para a direita e coloca o novo char no índice)
                    for(let j = genes.length - 1; j > randomIndex; j--) {
                        genes[j] = genes[j - 1];
                    }
                    genes[randomIndex] = newChar;
                }
            }
        }        
    }

    crossover(childA: number[], childB: number[], parentA: number[], parentB: number[]): void {
        const crossoverPoint = Math.floor(Math.random() * this.size);
        for(let i = 0; i < this.size; i++) {
            if (i < crossoverPoint) {
                childA[i] = parentA[i];
                childB[i] = parentB[i];
            } else {
                childA[i] = parentB[i];
                childB[i] = parentA[i];
            }
        }
    }

    toString(genes: number[]): string {
        let strResult = "";
        for(const gene of genes) {
            strResult += String.fromCharCode(gene);
        }
        return strResult;
    }
}

const palavras = [
  "o", "de", "e", "que", "ser", "um", "em", "para", "com", "a",
  "ter", "não", "por", "seu", "se", "mais", "estar", "como", "este", "poder",
  "ou", "todo", "ano", "fazer", "mas", "ir", "muito", "também", "outro", "ele",
  "já", "dia", "novo", "haver", "grande", "ainda", "sobre", "até", "dizer", "mesmo",
  "pessoa", "entre", "dever", "esse", "nosso", "caso", "eu", "dois", "bom", "dar",
  "algum", "forma", "segundo", "vez", "empresa", "primeiro", "sem", "quando", "Portugal", "isso",
  "país", "tempo", "bem", "só", "serviço", "ficar", "nós", "querer", "trabalho", "público",
  "onde", "estado", "parte", "assim", "desde", "passar", "cada", "informação", "último", "sempre",
  "hoje", "depois", "presidente", "durante", "vida", "área", "apresentar", "porque", "ver", "social",
  "apenas", "quem", "qualquer", "além", "qual", "mês", "após", "chegar", "meu", "saber",
  "milhão", "vir", "realizar", "número", "receber", "momento", "cidade", "casa", "português", "permitir",
  "Lisboa", "valor", "acordo", "local", "agora", "afirmar", "mil", "três", "processo", "medida",
  "mundo", "encontrar", "tudo", "através", "pouco", "próximo", "pequeno", "situação", "Brasil", "sistema",
  "deixar", "criar", "contar", "final", "dado", "nível", "meio", "São", "pandemia", "contra",
  "possível", "grupo", "mercado", "ela", "levar", "governo", "saúde", "resultado", "semana", "começar",
  "espaço", "conseguir", "nem", "ponto", "importante", "produto", "partir", "continuar", "direito", "nacional",
  "próprio", "falar", "rede", "hora", "eles", "programa", "antes", "cerca", "relação", "profissional",
  "região", "menos", "utilizar", "jogo", "família", "lugar", "fim", "considerar", "Paulo", "acontecer",
  "existir", "aqui", "conta", "Saúde", "projecto", "problema", "período", "conhecer", "necessário", "usar",
  "apoio", "principal", "precisar", "seguir", "acesso", "equipa", "criança", "disponível", "exemplo", "cliente",
  "longo", "decisão", "trabalhar", "coisa", "manter", "projeto", "desenvolver", "lado", "população", "passado",
  "tipo", "condição", "ação", "tanto", "solução", "presente", "desenvolvimento", "incluir", "alto", "mulher",
  "voltar", "garantir", "necessidade", "obra", "estudo", "segurança", "ajudar", "tal", "jovem", "você",
  "município", "início", "homem", "abrir", "qualidade", "questão", "enquanto", "euro", "então", "actividade",
  "viver", "história", "formação", "aluno", "vários", "ideia", "risco", "mostrar", "escola", "entrar",
  "pensar", "recurso", "total", "quatro", "gestão", "colocar", "site", "político", "doença", "nunca",
  "internacional", "nome", "água", "morte", "explicar", "quanto", "técnico", "isto", "responsável", "base",
  "utilização", "Porto", "instituição", "tão", "artigo", "atividade", "confirmar", "pois", "tomar", "negócio",
  "Rio", "experiência", "único", "quase", "função", "entanto", "gente", "acabar", "informar", "produção",
  "conjunto", "zona", "ocorrer", "apesar", "várias", "iniciativa", "aumentar", "unidade", "futuro", "pretender",
  "objectivo", "organização", "utilizador", "brasileiro", "novembro", "preço", "referir", "pedir", "junto", "tentar",
  "dentro", "diferente", "aquele", "proposta", "nada", "divulgar", "médico", "evento", "cinco", "uma",
  "perder", "parecer", "efeito", "sentido", "sair", "livro", "investigação", "imagem", "João", "devido",
  "equipe", "esperar", "financeiro", "centro", "plano", "causa", "resposta", "modo", "aumento", "tornar",
  "anterior", "fase", "publicar", "capacidade", "prazo", "equipamento", "nenhum", "procurar", "participar", "obter",
  "representar", "oportunidade", "ganhar", "modelo", "especial", "anunciar", "março", "política", "edição", "facto",
  "documento", "outubro", "marca", "taxa", "venda", "pessoal", "tema", "entidade", "prever", "objetivo",
  "pagar", "investimento", "ministro", "linha", "alteração", "atingir", "frente", "junho", "lei", "filho",
  "economia", "aplicação", "pagamento", "crise", "conhecimento", "noite", "Europa", "registrar", "fora", "geral",
  "data", "curso", "José", "decorrer", "evitar", "vítima", "pedido", "comunicação", "sociedade", "prática",
  "setembro", "uso", "professor", "promover", "membro", "domingo", "marcar", "indicar", "tratar", "capital",
  "achar", "concelho", "clube", "antigo", "económico", "integrar", "campanha", "forte", "pai", "cujo",
  "prova", "abril", "destacar", "chamar", "sessão", "conteúdo", "europeu", "comunidade", "custo", "elemento",
  "jogador", "determinar", "contrato", "papel", "lá", "candidato", "sábado", "acção", "paciente", "positivo",
  "maio", "interesse", "oferecer", "operação", "ambiente", "participação", "dezembro", "construção", "decidir", "veículo",
  "julho", "diversos", "ensino", "acompanhar", "intervenção", "mão", "energia", "razão", "presença", "maioria",
  "sentir", "trabalhador", "revelar", "humano", "século", "âmbito", "prefeito", "fundo", "possibilidade", "reduzir",
  "dinheiro", "página", "janeiro", "teste", "tarde", "terceiro", "acreditar", "aprovar", "claro", "certo",
  "iniciar", "tratamento", "volta", "surgir", "responder", "sob", "seis", "gostar", "força", "crescimento",
  "série", "análise", "mudar", "amigo", "texto", "rua", "palavra", "reunião", "definir", "altura",
  "contribuir", "caminho", "minuto", "opção", "Câmara", "crime", "mudança", "difícil", "defender", "lançar",
  "criação", "dificuldade", "enviar", "embora", "eleição", "baixo", "sector", "regra", "importância", "constituir",
  "natural", "entrada", "funcionar", "mensagem", "produzir", "identificar", "época", "seguinte", "tecnologia", "Deus",
  "corpo", "algo", "sucesso", "hospital", "desafio", "apontar", "associação", "envolver", "setor", "atendimento",
  "apoiar", "autoridade", "realidade", "trazer", "fechar", "encontro", "preciso", "Maria", "falta", "sofrer",
  "assumir", "policial", "transporte", "escolher", "elevar", "campo", "fonte", "organizar", "avaliação", "logo",
  "cumprir", "escrever", "vista", "porta", "partido", "instalação", "crescer", "referência", "estratégia", "entregar",
  "título", "registar", "termo", "visita", "nota", "responsabilidade", "aplicar", "estrutura", "comercial", "contexto",
  "prémio", "disponibilizar", "vídeo", "apresentação", "deputado", "sim", "oficial", "morrer", "verdade", "servir",
  "atenção", "fácil", "simples", "voto", "diferentes", "material", "Santa", "edifício", "território", "música",
  "terminar", "estudante", "compra", "entender", "prefeitura", "viagem", "vírus", "fundamental", "particular", "estabelecer",
  "privado", "Coimbra", "atual", "Silva", "bastante", "emprego", "ligar", "cidadão", "registo", "municipal",
  "plataforma", "impacto", "interior", "gerar", "Santos", "cuidado", "oferta", "médio", "preparar", "essencial",
  "contacto", "posição", "carro", "reconhecer", "movimento", "ouvir", "educação", "global", "redução", "olhar",
  "dúvida", "seguro", "comum", "vencer", "idade", "isolamento", "cultura", "possuir", "militar", "parceria",
  "agosto", "Pedro", "banco", "pesquisa", "órgão", "causar", "fevereiro", "manhã", "reforçar", "ligação",
  "líder", "lembrar", "prestar", "exposição", "ninguém", "consumo", "avaliar", "científico", "rápido", "lista",
  "estrangeiro", "bairro", "cair", "sobretudo", "histórico", "terra", "controlo", "ontem", "futebol", "digital",
  "real", "cargo", "melhorar", "atender", "avançar", "defesa", "específico", "físico", "mãe", "suspeito",
  "acrescentar", "recente", "realização", "porém", "termos", "origem", "cultural", "fato", "governador", "respeito",
  "contudo", "analisar", "autor", "familiar", "arte", "exigir", "leitura", "face", "regime", "maneira",
  "princípio", "ordem", "Carlos", "entrevista", "construir", "assegurar", "filme", "quarto", "vitória", "jogar",
  "versão", "nomeadamente", "igualmente", "aparecer", "parceiro", "comprar", "cor", "concluir", "concurso", "partida",
  "bilhão", "via", "competência", "acima", "animal", "grave", "crédito", "ao", "secretário", "quadro",
  "vender", "perceber", "exercício", "diverso", "livre", "procedimento", "notícia", "federal", "especialista", "dedicar",
  "atuar", "assunto", "António", "vacina", "queda", "dimensão", "ciclo", "online", "freguesia", "andar",
  "participante", "relacionar", "funcionamento", "doente", "funcionário", "administração", "ferramenta", "sala", "espécie", "ajuda",
  "esforço", "resolver", "receita", "passo", "povo", "percurso", "time", "agência", "Costa", "candidatura",
  "capaz", "correr", "contrário", "agente", "relatório", "significar", "ler", "combate", "Luís", "polícia",
  "aí", "mundial", "sinal", "visitar", "conforme", "evolução", "perto", "excelente", "sete", "máscara",
  "nascer", "declaração", "destinar", "câmara", "enfrentar", "ocupar", "estadual", "reunir", "formar", "dez",
  "valer", "óbito", "cenário", "descobrir", "diferença", "buscar", "executivo", "vaga", "opinião", "verificar",
  "justiça", "alguém", "natureza", "relativo", "solicitar", "provocar", "China", "aula", "visar", "aceitar",
  "ambos", "limite", "recuperar", "vigor", "subir", "actual", "aproveitar", "alcançar", "ar", "jornal",
  "tradicional", "festa", "propor", "década", "adquirir", "associar", "principalmente", "enorme", "mal", "relativamente",
  "permanecer", "depender", "característica", "adotar", "matéria", "assinar", "indústria", "entrega", "luz", "restante",
  "amor", "média", "saída", "Algarve", "econômico", "loja", "estabelecimento", "resultar", "respeitar", "motivo",
  "memória", "Espanha", "escolha", "portanto", "aprender", "consumidor", "efectuar", "central", "missão", "adequado",
  "oito", "talvez", "norma", "promoção", "proteção", "orientação", "manutenção", "canal", "compor", "alterar",
  "automóvel", "vontade", "comportamento", "Jesus", "pena", "mar", "declarar", "elas", "aquilo", "Francisco",
  "exterior", "protocolo", "conselho", "comércio", "completo", "carreira", "comunicar", "debate", "proporcionar", "sede",
  "expectativa", "abertura", "benefício", "despesa", "interno", "imprensa", "financiamento", "observar", "obrigatório", "civil",
  "ciência", "existente", "servidor", "revista", "mau", "consequência", "preocupação", "atribuir", "posto", "localizar",
  "fornecer", "branco", "contato", "conferência", "prisão", "horário", "melhoria", "advogado", "tirar", "eleitoral",
  "diretor", "empresário", "artista", "luta", "procura", "atleta", "ativo", "liberdade", "publicação", "conceito",
  "individual", "confiança", "respectivo", "jornalista", "igual", "vereador", "destaque", "dívida", "busca", "negativo",
  "ataque", "imediato", "idoso", "expressão", "competição", "acidente", "salário", "Madeira", "verdadeiro", "normal",
  "prender", "estudar", "Oliveira", "instalar", "Aveiro", "consulta", "orçamento", "demais", "temporada", "sequência",
  "vantagem", "matar", "dirigir", "demonstrar", "geração", "favor", "dispor", "atualmente", "universidade", "investir",
  "aquisição", "erro", "distribuição", "abordar", "guerra", "tendência", "Janeiro", "superior", "companhia", "exame",
  "alimentar", "domínio", "França", "leito", "associado", "transformar", "obrigar", "olho", "ambiental", "desejar",
  "carta", "sintoma", "diário", "afetar", "morador", "francês", "voz", "medicamento", "transmitir", "desempenho",
  "categoria", "instrumento", "recuperação", "volume", "transmissão", "urbano", "comentar", "Jorge", "suporte", "ilha",
  "pra", "corte", "foto", "potencial", "regional", "administrativo", "existência", "legal", "alvo", "fiscal",
  "Fernando", "americano", "cabeça", "ressaltar", "impedir", "etapa", "rapidamente", "praia"
];