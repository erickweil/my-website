"use client";
import { cn } from "@/lib/classMerge";

function MirroredText({ text, className, ...attrs }: { text: string } & React.HTMLAttributes<HTMLDivElement>) {
  const letters = text.split('');
  return (
    <div className={cn("mirrored", className)} {...attrs}>
      {letters.map((letter, index) => (
        <span
          key={index}
          style={{
            opacity: `${(index + 1) / letters.length}`
          }}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}


export default function Home() {

  const fallbackLink = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const linkTableContent = [
    { 
      href: "/toy/sudoku-minado", 
      text: "Sudoku Minado", 
      status: "Finalizado",
      description: "Um sudoku 6x6 com regras de campo minado",
    },
    { 
      href: "/toy/mapa-ifro", 
      text: "Desafio Semana do ADS", 
      status: "Em construção",
      description: "Desafio a ser resolvido durante a semana do ADS",
    },
    { 
      href: "/toy/gerador-horario", 
      text: "Gerador de Horário",
      status: "Em construção",
      description: "Gerador de horário escolar, com base em restrições de professores, turmas e horários disponíveis",
    },
    { href: null, text: "Avaliador automático", status: "A Fazer" },
    { href: null, text: "Busca DFS e BFS", status: "A Fazer" },
    { href: null, text: "Pilha, Fila, Deque", status: "A Fazer" },
    { href: null, text: "Análise Big O", status: "A Fazer" },
    { href: null, text: "Visualizador de árvores binárias", status: "A Fazer" },
    { href: null, text: "Simulador de portas lógicas", status: "A Fazer" },
    { href: null, text: "Jogo da Vida", status: "A Fazer" },
    { href: null, text: "Simulação de Gravidade", status: "A Fazer" },
    { href: null, text: "Esteganografia", status: "A Fazer" },
    { href: null, text: "Pixels", status: "A Fazer" },
  ];

  return (
    <main
      className="flex min-h-screen flex-col items-center p-24 bg-cover bg-center bg-fixed bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url('https://cdn.folhape.com.br/img/pc/1100/1/dn_arquivo/2026/04/afp-20260410-a7c73g3-v1-midres-uscanadaspaceartemisiinasa-1.jpg')`,
      }}
    >
      <div className="relative z-10 w-full max-w-5xl flex flex-col items-center">
        <div className="text-5xl font-bold mb-8 text-white drop-shadow-lg">
          Erick<MirroredText text="Erick" className="inline-block border-r pr-1 ml-1" />
        </div>
        <p className="text-lg mb-16 text-center text-white/90 drop-shadow-md">
          Explore utilitários, experimentos, simulações entre outras coisas
        </p>

        <section id="projetos" className="space-y-6 w-full">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/70">
                Projetos
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {linkTableContent.map((link, n) => {
              const isReady = link.href !== null;
              return (
                <a
                  key={n}
                  href={link.href || fallbackLink}
                  target={isReady ? undefined : "_blank"}
                  rel={isReady ? undefined : "noreferrer"}
                  className="group rounded-2xl border border-white/20 bg-black/40 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:border-yellow-500/50 hover:bg-black/60 hover:shadow-[0_0_30px_rgba(251,191,36,0.4)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold text-white">{link.text}</p>
                      <p className="mt-2 text-sm leading-6 text-white/70">
                        {link.description || ""}
                      </p>
                    </div>
                    <div className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap",
                      link.status === "Finalizado"
                        ? "bg-green-500/80 text-white"
                        : link.status === "Em construção"
                          ? "bg-yellow-500/80 text-white"
                          : "bg-gray-500/80 text-white"
                    )}>
                      {link.status}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
