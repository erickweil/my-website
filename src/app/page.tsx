"use client";
import { cn } from "@/lib/classMerge";
import { FaGithub, FaGoogle } from "react-icons/fa";

function MirroredText({ text, className, ...attrs }: { text: string } & React.HTMLAttributes<HTMLDivElement>) {
  const letters = text.split('');
  return (
    <div className={cn("mirrored", className)} {...attrs}>
      {letters.map((letter, index) => (
        <span
          key={index}
          style={{ opacity: `${(index + 1) / letters.length}` }}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}

type ProjectStatus = "Finalizado" | "Abandonado" | "Em construção" | "A Fazer";

type Project = {
  href: string | null;
  text: string;
  data?: string;
  status: ProjectStatus;
  description?: string;
  tags?: string[];
  emoji?: string;
};

const STATUS_STYLES: Record<ProjectStatus, string> = {
  "Finalizado": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  "Em construção": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  "A Fazer": "bg-gray-100 text-gray-500 dark:bg-gray-800/50 dark:text-gray-500",
  "Abandonado": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", STATUS_STYLES[status])}>
      {status}
    </span>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const isReady = project.href !== null;
  const fallbackLink = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  return (
    <a
      href={project.href || fallbackLink}
      target={isReady ? undefined : "_blank"}
      rel={isReady ? undefined : "noreferrer"}
      className={cn(
        "group flex flex-col gap-3 rounded-2xl border border-foreground/10 p-5 transition-all duration-200",
        isReady
          ? "hover:border-[color-mix(in_srgb,var(--primary)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary)_4%,transparent)] hover:shadow-sm cursor-pointer"
          : "opacity-60 cursor-default hover:opacity-75"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {project.emoji && (
            <span className="text-xl shrink-0" aria-hidden>{project.emoji}</span>
          )}
          <p className={cn(
            "font-semibold text-foreground truncate",
            isReady ? "group-hover:text-primary transition-colors" : ""
          )}>
            {project.text}
          </p>
        </div>
        <StatusBadge status={project.status} />
      </div>

      {project.data && (
        <p className="text-xs text-foreground/50 font-mono">
          {project.data}
        </p>
      )}

      {project.description && (
        <p className="text-sm leading-relaxed text-foreground/60 line-clamp-3">
          {project.description}
        </p>
      )}

      {project.tags && project.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-foreground/5 px-2 py-0.5 text-xs text-foreground/50 font-mono"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </a>
  );
}

export default function Home() {
  const externalProjects: Project[] = [
    {
      href: "https://erickweil.github.io/portugolweb/",
      text: "Portugol Web",
      data: "2019 - Presente",
      status: "Finalizado",
      emoji: "{P}",
      description: "Simples versão web, compatível com smartphones, para programar na linguagem do Portugol Studio.",
      tags: ["Aplicativo", "Produção"]
    },
    {
      href: "https://erickweil.itch.io/project4d",
      text: "Project4D",
      data: "2018 - 2023",
      status: "Abandonado",
      emoji: "🕹️",
      description: "Jogo 4D experimental, onde o jogador explora um espaço de quatro dimensões espaciais",
      tags: ["Jogo", "Experimento"]
    },
    {
      href: "https://erickweil.github.io/textadventures/",
      text: "Text Adventures",
      data: "2024 - 2025",
      status: "Finalizado",
      emoji: "📜",
      description: "Aventuras de texto interativas, com suporte a múltiplos caminhos e finais alternativos.",
      tags: ["Website", "Experimento"]
    },
  ];

  const toys: Project[] = [
    {
      href: "/toy/gerador-horario",
      text: "Gerador de Horário",
      data: "2023 - Presente",
      status: "Em construção",
      emoji: "📅",
      description: "Gerador de horário escolar com base em restrições de professores, turmas e horários disponíveis.",
    },
    {
      href: "/toy/turing",
      text: "Máquina de Turing",
      data: "01/05/2026",
      status: "Finalizado",
      emoji: "⚙️",
      description: "Simulador interativo de máquina de Turing — defina estados, símbolos e transições.",
    },
    {
      href: "/toy/sudoku-minado",
      text: "Sudoku Minado",
      data: "05/04/2026",
      status: "Finalizado",
      emoji: "💣",
      description: "Um sudoku 6x6 com regras de campo minado — lógica de dedução em duas dimensões.",
    },
    {
      href: "/toy/genetic",
      text: "Algoritmos Genéticos",
      data: "13/04/2026",
      status: "Em construção",
      emoji: "🧬",
      description: "Visualização de algoritmos genéticos evoluindo soluções em tempo real.",
    },
  ];

  const planned: Project[] = [
    { href: null, text: "Busca DFS e BFS", status: "A Fazer", emoji: "🔍" },
    { href: null, text: "Pilha, Fila, Deque", status: "A Fazer", emoji: "📦" },
    { href: null, text: "Análise Big O", status: "A Fazer", emoji: "📈" },
    { href: null, text: "Visualizador de árvores binárias", status: "A Fazer", emoji: "🌳" },
    { href: null, text: "Simulador de portas lógicas", status: "A Fazer", emoji: "🔌" },
    { href: null, text: "Jogo da Vida", status: "A Fazer", emoji: "🦠" },
    { href: null, text: "Simulação de Gravidade", status: "A Fazer", emoji: "🪐" },
    { href: null, text: "Esteganografia", status: "A Fazer", emoji: "🖼️" },
    { href: null, text: "Pixels", status: "A Fazer", emoji: "🎨" },
  ];

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-12 md:py-20">

      {/* Hero */}
      <section className="w-full max-w-2xl text-center space-y-4">
        <div className="text-5xl md:text-6xl font-bold tracking-tight">
          Erick<MirroredText text="Erick" className="inline-block border-r pr-1 ml-1" />
        </div>
        <p className="text-xs font-mono uppercase tracking-[0.22em] text-foreground/40">
          Erick Weil · liewkcire.vercel.app
        </p>
        <p className="text-base md:text-lg text-foreground/55 max-w-md mx-auto leading-relaxed">
          Site pessoal de Erick Weil, com utilitários, experimentos e simulações
          de computação para usar direto no navegador.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 pt-2">
          <a href="https://github.com/erickweil" target="_blank" rel="noreferrer">
           <span className="text-sm font-medium hover:text-foreground transition-colors flex items-center gap-1">
              <FaGithub className="inline" size={28} /> - Github
            </span>
          </a>
          <a href="#login-google">
            <span className="text-sm font-medium text-foreground/55 hover:text-foreground transition-colors flex items-center gap-2">
              <FaGoogle className="inline" size={18} /> Login com o Google
            </span>
          </a>
        </div>
      </section>

      <div className="w-full max-w-3xl mt-8">

        {/* Sobre o site */}
        <section id="sobre" className="scroll-mt-8">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/40 mb-1">
              Sobre
            </p>
            <h2 className="text-2xl font-bold text-foreground">O que é este site</h2>
          </div>

          <div className="rounded-2xl border border-foreground/10 p-5 sm:p-6 space-y-4">
            <p className="text-sm leading-relaxed text-foreground/70">
              <strong className="text-foreground">liewkcire.vercel.app</strong> é o site pessoal de
              Erick Weil, desenvolvedor de software. Ele reúne ferramentas, simuladores e experimentos
              de computação que rodam inteiramente no seu navegador, sem instalar nada e sem custo.
            </p>
            <ul className="text-sm leading-relaxed text-foreground/60 space-y-2 list-disc pl-5">
              <li>
                <strong className="text-foreground/80">Simuladores interativos</strong> — máquina de
                Turing, algoritmos genéticos e outras simulações que mostram, passo a passo, como o
                algoritmo chega ao resultado.
              </li>
              <li>
                <strong className="text-foreground/80">Utilitários</strong> — como o Gerador de Horário
                escolar, que monta grades de aula a partir das restrições de professores, turmas e
                horários disponíveis.
              </li>
              <li>
                <strong className="text-foreground/80">Jogos e quebra-cabeças</strong> — como o Sudoku
                Minado, que combina as regras do sudoku com as do campo minado.
              </li>
              <li>
                <strong className="text-foreground/80">Portfólio</strong> — links para outros projetos
                publicados por Erick Weil fora deste domínio.
              </li>
            </ul>
            <p className="text-sm leading-relaxed text-foreground/60">
              O processamento acontece no próprio navegador, em JavaScript e WebAssembly. Todo o
              conteúdo desta página e das ferramentas listadas abaixo pode ser acessado livremente,
              sem cadastro e sem login. O login com o Google é opcional e existe apenas para
              salvar o seu trabalho — veja <a href="#login-google" className="underline underline-offset-2 hover:text-foreground transition-colors">Login com o Google</a>.
            </p>
          </div>
        </section>

        {/* Projetos externos */}
        <section id="projetos">
          <div className="mb-6 mt-12">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/40 mb-1">
              Portfólio
            </p>
            <h2 className="text-2xl font-bold text-foreground">Projetos</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {externalProjects.map((project) => (
              <ProjectCard key={project.text} project={project} />
            ))}
          </div>
        </section>

        {/* Toys internos */}
        <section id="toys">
          <div className="mb-6 mt-12">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/40 mb-1">
              Experimentos
            </p>
            <h2 className="text-2xl font-bold text-foreground">Toys</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {toys.map((project) => (
              <ProjectCard key={project.text} project={project} />
            ))}
          </div>
        </section>

        {/* Roadmap */}
        <section id="roadmap">
          <div className="mb-5 mt-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/40 mb-1">
              Em breve
            </p>
            <h2 className="text-2xl font-bold text-foreground">Roadmap</h2>
          </div>

          <div className="rounded-2xl border border-foreground/8 divide-y divide-foreground/8 overflow-hidden">
            {planned.map((project) => (
              <div
                key={project.text}
                className="flex items-center justify-between gap-4 px-4 py-3 bg-foreground/[0.015] hover:bg-foreground/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-base shrink-0 opacity-60" aria-hidden>{project.emoji}</span>
                  <span className="text-sm text-foreground/55 truncate">{project.text}</span>
                </div>
                <StatusBadge status={project.status} />
              </div>
            ))}
          </div>
        </section>

        {/* Login com o Google — transparência sobre dados */}
        <section id="login-google" className="scroll-mt-8">
          <div className="mb-5 mt-12">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/40 mb-1">
              Conta
            </p>
            <h2 className="text-2xl font-bold text-foreground">Login com o Google</h2>
          </div>

          <div className="rounded-2xl border border-foreground/10 p-5 sm:p-6 space-y-6">
            <p className="text-sm leading-relaxed text-foreground/70">
              As ferramentas deste site funcionam sem nenhum cadastro. O login com a Conta Google é
              <strong className="text-foreground"> opcional</strong> e serve para um único propósito:
              criar uma conta que guarde o seu trabalho — como as grades montadas no Gerador de Horário
              ou as máquinas definidas no simulador de Turing — para que você possa retomá-lo depois,
              inclusive em outro dispositivo. Sem o login, esses dados ficam apenas no navegador atual.
            </p>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Quais dados são solicitados, e por quê
              </h3>
              <ul className="space-y-3">
                <li className="rounded-xl bg-foreground/[0.03] px-4 py-3">
                  <p className="text-sm font-medium text-foreground">Identificador da sua conta</p>
                  <p className="text-xs font-mono text-foreground/45 mt-0.5 break-all">openid</p>
                  <p className="text-sm leading-relaxed text-foreground/60 mt-1.5">
                    Vincula o trabalho que você salvar à sua conta, sem que você precise criar
                    e memorizar mais uma senha.
                  </p>
                </li>
                <li className="rounded-xl bg-foreground/[0.03] px-4 py-3">
                  <p className="text-sm font-medium text-foreground">Nome e foto de perfil</p>
                  <p className="text-xs font-mono text-foreground/45 mt-0.5 break-all">
                    .../auth/userinfo.profile
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/60 mt-1.5">
                    Mostram, dentro do site, com qual conta você está conectado.
                  </p>
                </li>
                <li className="rounded-xl bg-foreground/[0.03] px-4 py-3">
                  <p className="text-sm font-medium text-foreground">Endereço de e-mail</p>
                  <p className="text-xs font-mono text-foreground/45 mt-0.5 break-all">
                    .../auth/userinfo.email
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/60 mt-1.5">
                    Identifica a sua conta de forma única e permite responder a pedidos de suporte ou
                    de exclusão de dados feitos por você.
                  </p>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">O que não é feito</h3>
              <ul className="text-sm leading-relaxed text-foreground/60 space-y-1.5 list-disc pl-5">
                <li>
                  Nenhum outro dado da sua Conta Google é acessado — nem Gmail, Drive, Agenda,
                  Contatos ou Fotos.
                </li>
                <li>Seus dados não são vendidos, alugados nem usados para publicidade.</li>
                <li>Não há rastreamento entre sites nem cookies de anúncios.</li>
                <li>Seus dados não são usados para treinar modelos de inteligência artificial.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Como revogar o acesso</h3>
              <p className="text-sm leading-relaxed text-foreground/60">
                A qualquer momento, em{" "}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Apps conectados à sua Conta Google
                </a>
                . Para apagar também a conta e os dados guardados aqui, basta escrever para{" "}
                <a
                  href="mailto:erick.weil@ifro.edu.br"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  erick.weil@ifro.edu.br
                </a>
                .
              </p>
            </div>

            <p className="text-xs leading-relaxed text-foreground/45 border-t border-foreground/10 pt-4">
              O uso das informações recebidas das APIs do Google segue a{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground/70 transition-colors"
              >
                Política de Dados do Usuário dos Serviços de API do Google
              </a>
              , incluindo os requisitos de Uso Limitado. Os detalhes completos estão na{" "}
              <a
                href="/politica-de-privacidade.html"
                className="underline underline-offset-2 hover:text-foreground/70 transition-colors"
              >
                Política de Privacidade
              </a>
              .
            </p>
          </div>
        </section>

      </div>

      {/* Rodapé */}
      <footer className="w-full max-w-3xl mt-16 pt-6 border-t border-foreground/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-foreground/50">
          <p>© 2026 Erick Weil · liewkcire.vercel.app</p>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href="/politica-de-privacidade.html"
              className="hover:text-foreground transition-colors"
            >
              Política de Privacidade
            </a>
            <a
              href="mailto:erick.weil@ifro.edu.br"
              className="hover:text-foreground transition-colors"
            >
              Contato
            </a>
            <a
              href="https://github.com/erickweil"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
