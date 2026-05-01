import { LRLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";

import { Direction } from "@/pkg/turing";
import { parser } from "./turingParser.js";
import * as T from "./turingParser.terms.js"; // IDs dos nós gerados pelo lezer-generator

const turingParserWithMeta = parser.configure({
    props: [
        styleTags({
            // Comentários
            LineComment: t.lineComment,

            // Diretivas (default / input[…])
            DirectiveKeyword: t.keyword,

            // Tupla de transição – cada posição recebe sua própria tag
            "Transition/CurrentState/Name": t.className,
            "Transition/MoveDir/Name": t.operatorKeyword,
            "Transition/NextState/Name": t.typeName,

            Name: t.atom,

            // Símbolo especial como fallback (SpecialSymbol só aparece dentro de SpecialSymbolKw)
            SpecialSymbol: t.controlOperator,

            // Estado especial HALT
            Halt: t.keyword,

            // String entre aspas em qualquer outro contexto
            QuotedString: t.string,

            // Números dentro de input[x,y]
            Number: t.number,
        }),
    ],
});

export const turingLRLanguage = LRLanguage.define({
    parser: turingParserWithMeta,
    languageData: {
        commentTokens: { line: "//" },
    },
});

export const turingHighlightStyle = HighlightStyle.define([
    // Estado atual, igual à uma variável local, azul claro
    { tag: t.className,       color: "#5858ff", fontWeight: "600" },
    // Símbolo lido/escrito (posições 1–2) → azul-escuro, como variável
    { tag: t.atom,            color: "#001080" },
    // Strings entre aspas → marrom-avermelhado
    { tag: t.string,          color: "#a31515" },
    // Direção (posição 3)
    { tag: t.operatorKeyword, color: "#af00db" },
    // Próximo estado (posição 4) → teal-escuro, como nome de tipo
    { tag: t.typeName,        color: "#5858ff", fontWeight: "600" },
    // HALT e diretivas (default, input) → roxo, como keyword reservada
    { tag: t.keyword,         color: "#af00db" },
    // Números em input[x,y] → verde-escuro
    { tag: t.number,          color: "#098658" },
    // Símbolos especiais (*, _, SAME, ELSE, ERASE, BLANK) → laranja
    { tag: t.controlOperator, color: "#d16c00", fontWeight: "600" },
    // Comentários → verde, estilo VSCode Light
    { tag: t.lineComment,     color: "#008000", fontStyle: "italic" },
]);

export function turingLanguage(): LanguageSupport {
    return new LanguageSupport(turingLRLanguage, [
        syntaxHighlighting(turingHighlightStyle),
    ]);
}


// Programa "Hello World" da Turing Machine 2D:
// Incrementador binário – percorre a fita para a direita até encontrar 0,
// então escreve 1 e para. Demonstra leitura/escrita e movimento.
//
// Estados:
//   0 – procurando o fim da sequência de 1s (movendo para a direita)
//   1 – halt (estado negativo = -1 indica halt, mas usamos state >= num_states)
//
// Programa (flat array de Transition, par por estado):
//   estado 0, lê 0 → escreve 1, para (next_state = -1)
//   estado 0, lê 1 → escreve 1, move Right (next_state = 0)

export function toUnicode(char: string): number {
    if(char.length === 0) return 0;
    // get first codepoint
    return char.codePointAt(0) || 0;
}

function parseSymbol(currentSymbol: string): number {
    if(currentSymbol.toUpperCase() === "ERASE" || currentSymbol.toUpperCase() === "BLANK" || currentSymbol === "_") {
        // Limpar, apagar
        return 0;
    } else if (currentSymbol.toUpperCase() === "ELSE" || currentSymbol.toUpperCase() === "SAME" || currentSymbol === "*") {
        // código especial que significa qualquer um (wildcard)
        return -1;
    } else if(/^"[^"]*"$/.test(currentSymbol)) {
        // string literal, parseando o conteúdo entre aspas (permitindo escapes)
        currentSymbol = ""+JSON.parse(currentSymbol);
    }

    // símbolo normal, usando o código unicode do primeiro caractere
    if(currentSymbol.length > 1) {
        console.warn(`Símbolo '${currentSymbol}' tem mais de um caractere, usando apenas o primeiro.`);
    }
    return toUnicode(currentSymbol);    
}

function parseDirection(dir: string): Direction {
    switch(dir.toUpperCase()) {
        case 'STAY':
        case 'NONE':
        case 'N':
        case '=':
        case '*':
            return Direction.None;
        case 'L':
        case 'LEFT':
        case '<':
            return Direction.Left;
        case 'R':
        case 'RIGHT':
        case '>':
            return Direction.Right;
        case 'U':
        case 'UP':
            return Direction.Up;
        case 'D':
        case 'DOWN':
            return Direction.Down;
        default:
            console.warn(`Direção inválida '${dir}' na linha: ${dir}`);
            return Direction.None;
    }
}

function parseState(state: string, stateMap: Map<string, number>): number {
    state = state.toUpperCase();
    if(state === "ELSE" || state === "SAME" || state === "*") {
        // 0 é código reservado para wildcard de estado, estados normais começam em 1
        return 0;
    }
    let stateCode = stateMap.get(state);
    if(stateCode === undefined) {
        stateCode = stateMap.size + 1; // começa em 1, 0 é reservado para wildcard
        if(state.startsWith("HALT") || state === "ACCEPT" || state === "REJECT") {
            stateCode = -stateCode; // estados de halt são negativos
        }
        stateMap.set(state, stateCode);
    }
    return stateCode;
}

/** https://www.jimpryor.net/teaching/courses/logic2024/turing/turing.html
    Each line should contain one tuple of the form '<current state> <current symbol> <new symbol> <direction> <new state>'.
    You can use any number or word for <current state> and <new state>, eg. 10, a, state1. State labels are case-sensitive.
    You can use almost any character for <current symbol> and <new symbol>, or '_' to represent blank (space). Symbols are case-sensitive.
    You can't use ';', '*', or whitespace as symbols.
    <direction> should be 'l', 'r' or 's', denoting 'move left', 'move right' or 'stay in place', respectively. You can also use 'left', '<', 'right', '>', 'stay', '=', and '*'.
    '*' can be used as a wildcard in <current state> to supply default instructions for any state.
    '*' or 'else' can be used as a wildcard in <current symbol> to match any unspecified character.
    '*' or 'same' can be used in <new symbol> to mean 'no change'.
    '*' or 'same' can be used in <new state> to mean 'no change'.
    Anything after a ';' is a comment and is ignored.
The machine halts when it reaches states named 'accept', 'reject', or any state starting with 'halt', eg. halt, halt-accept.
 */
export function compileTuringCode(code: string): {
    compiledProgram: Int32Array,
    stateMap: Map<string, number>,
    input: Int32Array | null,
    defaultValue: number,
    startState: number
 } {
    let defaultValue = 0;
    const stateMap = new Map<string, number>();
    const inputMap = new Map<string, number>();
    const transitions: number[] = [];

    const tree = parser.parse(code);
    const cursor = tree.cursor();

    // Entra no primeiro filho do nó raiz Program
    if (!cursor.firstChild()) {
        // programa vazio
        return {
            compiledProgram: new Int32Array(0),
            stateMap,
            input: null,
            defaultValue,
            startState: 1,
        };
    }

    // Utilitário: texto de um nó pelo range na string original
    const text = (from: number, to: number) => code.slice(from, to);

    do {
        const id = cursor.type.id;

        // ── DefaultDirective: DirectiveKeyword Symbol ─────────────────────
        if (id === T.DefaultDirective) {
            if (cursor.firstChild()) {          // DirectiveKeyword
                cursor.nextSibling();           // Symbol (Name ou QuotedString)
                defaultValue = parseSymbol(text(cursor.from, cursor.to));
                cursor.parent();
            }

        // ── InputDirective: InputKw Symbol ───────────────────────────────
        } else if (id === T.InputDirective) {
            if (cursor.firstChild()) {
                // InputKw tem o texto "input[x,y]" — extrai coords via regex
                const kwText = text(cursor.from, cursor.to);
                const coordMatch = kwText.match(/input\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/i);
                let cx = coordMatch ? parseInt(coordMatch[1]) : 0;
                const y  = coordMatch ? parseInt(coordMatch[2]) : 0;

                cursor.nextSibling(); // Symbol
                let inputString = text(cursor.from, cursor.to);
                if (/^"[^"]*"$/.test(inputString)) {
                    inputString = "" + JSON.parse(inputString);
                }
                for (const char of inputString) {
                    inputMap.set(`${cx},${y}`, toUnicode(char));
                    cx++;
                }
                cursor.parent();
            }

        // ── Transition: CurrentState ReadSymbol WriteSymbol MoveDir NextState
        } else if (id === T.Transition) {
            if (cursor.firstChild()) {
                // Os 5 filhos chegam em ordem; cada wrapper cobre exatamente
                // o mesmo intervalo de texto que seu único filho interno.
                const currentStateText = text(cursor.from, cursor.to); // CurrentState
                cursor.nextSibling();
                const readSymText     = text(cursor.from, cursor.to); // ReadSymbol
                cursor.nextSibling();
                const writeSymText    = text(cursor.from, cursor.to); // WriteSymbol
                cursor.nextSibling();
                const dirText         = text(cursor.from, cursor.to); // MoveDir
                cursor.nextSibling();
                const nextStateText   = text(cursor.from, cursor.to); // NextState
                cursor.parent();

                transitions.push(
                    parseState(currentStateText, stateMap),
                    parseSymbol(readSymText),
                    parseSymbol(writeSymText),
                    parseDirection(dirText),
                    parseState(nextStateText, stateMap),
                );
            }
        }
    } while (cursor.nextSibling());

    const inputArray = new Int32Array(inputMap.size * 3);
    let i = 0;
    for (const [key, value] of inputMap.entries()) {
        const [x, y] = key.split(',').map(Number);
        inputArray[i++] = x;
        inputArray[i++] = y;
        inputArray[i++] = value;
    }

    return {
        compiledProgram: new Int32Array(transitions),
        stateMap,
        input: inputArray.length > 0 ? inputArray : null,
        defaultValue,
        startState: stateMap.get("START") || 1,
    };
}
