"use client";

import SudokuGrid from "./sudoku-grid";

export default function SudokuMinado() {
    return (
        <main className="flex min-h-screen flex-col items-center p-24">
            <article className="my-8 max-w-3xl">
            <h1 className="text-4xl font-bold mb-8">Sudoku Minado (Minesweeper: The Sudoku)</h1>
            <p className="text-lg mb-4">
                Criado por TalkingFredish & Michael Lefkowitz (<a href="https://sudokupad.app/1ru4mm2uq3?setting-nogrid=1" target="_blank" className="text-blue-600 underline">Ver original</a>)
                <br/>Aqui foi implementado com as mesmas regras, porém com a possibilidade de gerar diferentes desafios (sempre com solução exata, sem chute).
            </p>
            <div className="mb-8 flex flex-col gap-2 items-center">
            Vídeo com explicação das regras:
            <iframe width="560" height="315" src="https://www.youtube.com/embed/OlcsRopfY-o?si=kD_wMebwVJTPaJOh" title="YouTube video player" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen></iframe>
            </div>
            <p className="text-lg mb-4">
                Regras do Jogo:
            </p>
            <ul className="list-disc list-inside mb-8">
                <li>
                    Todas as regras do sudoku 6x6 normal se aplicam: cada linha, coluna e região 2x3 deve conter os números de 1 a 6 sem repetições.
                </li>
                <li>
                    Algumas regras do campo minado se aplicam: Se uma célula não é uma mina, o número nela indica quantas minas estão adjacentes a ela (até 8 vizinhos). Além disso, não irá expandir células vazias ao clicar nelas.
                </li>
                <li>
                    Regra especial: Cada caixa 2x3 possui um número de minas diferente, ou seja, nenhuma caixa terá o mesmo número de minas que outra.
                </li>
            </ul>
            <SudokuGrid />
            </article>
        </main>
    );
}