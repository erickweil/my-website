"use client";
import { RevealCard } from "@/components/reveal-card";
import { cn } from "@/lib/classMerge";

export function MirroredText({ text, className, ...attrs }: { text: string } & React.HTMLAttributes<HTMLDivElement>) {
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
    { href: fallbackLink, text: "Gerador de Horário" },
    { href: fallbackLink, text: "Avaliador automático" },
    { href: fallbackLink, text: "Busca DFS e BFS" },
    { href: fallbackLink, text: "Pilha, Fila, Deque" },
    { href: fallbackLink, text: "Análise Big O" },
    { href: fallbackLink, text: "Visualizador de árvores binárias" },
    { href: fallbackLink, text: "Simulador de portas lógicas" },
    { href: "/toy/sudoku-minado", text: "Sudoku Minado" },
    { href: fallbackLink, text: "Jogo da Vida" },
    { href: fallbackLink, text: "Simulação de Gravidade" },
    { href: fallbackLink, text: "Esteganografia" },
    { href: fallbackLink, text: "Pixels"}
  ];

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <div className="text-5xl font-bold mb-8">
        Erick<MirroredText text="Erick" className="inline-block border-r pr-1 ml-1" />
      </div>
      <p className="text-lg mb-16 text-center">
        Explore utilitários, experimentos, simulações entre outras coisas
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {linkTableContent.map((link, n) => (
          <RevealCard key={n} onClick={() => {
            window.open(link.href, "_blank");
          }} >
            <p className="text-center text-lg font-semibold text-foreground">
              {link.text}
            </p>
          </RevealCard>
        ))}
      </div>
    </main>
  );
}
