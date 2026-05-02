"use client";
import { cn } from "@/lib/classMerge";
import { FaGithub } from "react-icons/fa";

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
        <p className="text-base md:text-lg text-foreground/55 max-w-md mx-auto leading-relaxed">
          Explore utilitários, experimentos, simulações entre outras coisas
        </p>
        <div className="flex items-center justify-center gap-4 pt-2">
          <a href="https://github.com/erickweil" target="_blank" rel="noreferrer">
           <span className="text-sm font-medium hover:text-foreground transition-colors flex items-center gap-1">
              <FaGithub className="inline" size={28} /> - Github
            </span>
          </a>
        </div>
      </section>

      <div className="w-full max-w-3xl mt-8">

        {/* Projetos externos */}
        <section id="projetos">
          <div className="mb-6">
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

      </div>
    </main>
  );
}
