"use client";

import { cn } from "@/lib/classMerge";
import { useState } from "react";

// Card imitando um card de jogo da memória, que revela seu conteúdo ao clicar com o mouse
export function RevealCard({ children, className, ...attrs }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
    // deve ter a proporção igual cards de jogo da memória 2:3
    // cantos arredondados e sombra
    // ao passar o mouse, deve girar 180 graus no eixo Y para revelar o conteúdo
    // deve ter uma animação suave

    // Deve funcionar no mozilla

    const [isRevealed, setIsRevealed] = useState(false);
    
    return (
        <div
            className={cn("w-64 h-96 perspective", className)}
            onMouseEnter={() => setIsRevealed(true)}
            onMouseLeave={() => setIsRevealed(!isRevealed)}
            {...attrs}
        >
            <div
                className={`relative w-full h-full`}
            >
                <div className={`duration-300 transform-style-preserve-3d ${isRevealed ? 'rotate-y-180' : ''} absolute w-full h-full backface-hidden bg-cards rounded-lg shadow-lg flex items-center justify-center text-white text-2xl font-bold`}>
                    
                </div>
                <div className={`duration-300 transform-style-preserve-3d ${!isRevealed ? 'rotate-y-180' : ''} absolute w-full h-full backface-hidden bg-white rounded-lg shadow-lg flex items-center justify-center p-4`}>
                    {children}
                </div>
            </div>
        </div>
    );
}