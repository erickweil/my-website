
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

import { Direction } from "@/pkg/turing";

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
    } else if(/^"[^"]+"$/.test(currentSymbol)) {
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
    const lines = code.split('\n').map(line => line.trim());
    for(let line of lines) {
        if(!line) continue;

        if(line.includes("//")) {
		    line = line.split("//")[0].trim();
        }
		line = line.trim();
        if(line.length === 0) continue;

        // default 0
        // default " "
        const defaultMatch = line.match(/^default\s+([^\s]+)\s*$/i);
        if(defaultMatch) {
            let [_, defaultSymbol] = defaultMatch;
            defaultValue = parseSymbol(defaultSymbol);
            continue;
        }

        // especificar input
        // exemplo: input 1011
        // ou input[10,20] 1101 (input começa na posição x:10, y=20)
        const inputMatch = line.match(/^input(?:\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\])?\s+([^\s]+)\s*$/i);
        if(inputMatch) {
            let x = inputMatch[1] ? parseInt(inputMatch[1]) : 0;
            let y = inputMatch[2] ? parseInt(inputMatch[2]) : 0;
            let inputString = inputMatch[3];
            if(/^"[^"]+"$/.test(inputString)) {
                // string literal, parseando o conteúdo entre aspas (permitindo escapes)
                inputString = ""+JSON.parse(inputString);
            }

            for(let char of inputString) {
                inputMap.set(`${x},${y}`, toUnicode(char));
                x++; // por padrão, input é escrito para a direita
            }

            continue;
        }


        const match = line.match(/^(\S+)\s+([^\s"]+|"[^"]+")\s+([^\s"]+|"[^"]+")\s+(\S+)\s+(\S+)$/i);
        if(!match) {
            console.warn(`Linha inválida, ignorando: ${line}`);
            continue;
        }

        let [_, currentState, currentSymbol, newSymbol, direction, newState] = match;

        let currentSymbolCode = parseSymbol(currentSymbol);
        let newSymbolCode = parseSymbol(newSymbol);
        let dirCode = parseDirection(direction);

        let currentStateCode = parseState(currentState, stateMap);
        let newStateCode = parseState(newState, stateMap);

        transitions.push(
            currentStateCode,
            currentSymbolCode,
            newSymbolCode,
            dirCode,
            newStateCode
        );
    }

    const inputArray = new Int32Array(inputMap.size * 3);
    let i = 0;
    for(let [key, value] of inputMap.entries()) {
        const [x, y] = key.split(',').map(Number);
        inputArray[i++] = x;
        inputArray[i++] = y;
        inputArray[i++] = value;
    }

    return {
        compiledProgram: new Int32Array(transitions),
        stateMap: stateMap,
        input: inputArray.length > 0 ? inputArray : null,
        defaultValue: defaultValue,
        // estado inicial é "start" se existir, senão o primeiro estado definido
        // e começa em 1 porque 0 é reservado para wildcard
        // Nota: parseState armazena as chaves em maiúsculas
        startState: stateMap.get("START") || 1
    };
}