"use client";
import React, { useEffect, useRef } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet } from '@codemirror/view';

import { getExampleCodes } from './turingexamples';
import NonSSRWrapper from '@/components/nonSSRWrapper';
import { turingLanguage } from './turingLanguage';

const exampleCodes = getExampleCodes();

// ── Extensão de realce de linha ativa ────────────────────────────────────────

/** Efeito para definir o número de linha ativa (1-based) ou null para limpar. */
export const setActiveLine = StateEffect.define<number | null>();

const activeLineField = StateField.define<DecorationSet>({
    create() { return Decoration.none; },
    update(deco, tr) {
        deco = deco.map(tr.changes);
        for (const e of tr.effects) {
            if (e.is(setActiveLine)) {
                if (e.value === null) {
                    deco = Decoration.none;
                } else {
                    try {
                        const line = tr.state.doc.line(e.value);
                        deco = Decoration.set([
                            Decoration.line({ class: 'cm-executingLine' }).range(line.from)
                        ]);
                    } catch {
                        deco = Decoration.none;
                    }
                }
            }
        }
        return deco;
    },
    provide: f => EditorView.decorations.from(f),
});

// Mantido no escopo de módulo para que a referência seja estável entre renders.
// Se fosse criado dentro do componente, o CodeMirror reconfiguraria o parser a cada keystroke.
const turingExtensions = [turingLanguage(), activeLineField];

const myTheme = EditorView.theme({
    '&': {
        fontSize: '14px',
        fontFamily: 'monospace',
        maxHeight: '100%',
        backgroundColor: '#ffffff',
        color: '#000000',
    },
    '.cm-scroller': {
        overflow: 'auto',
    },
    '.cm-gutters': {
        backgroundColor: '#ffffff',
        color: '#237893',
        borderRight: '1px solid #e5e5e5',
    },
    '.cm-activeLineGutter': { backgroundColor: '#e8f2fb' },
    '.cm-activeLine': { backgroundColor: '#e8f2fb' },
    '.cm-cursor': { borderLeftColor: '#000000' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: '#add6ff',
    },
    // Linha em execução: fundo amarelo-âmbar, semelhante ao debugger do VSCode
    '.cm-executingLine': { backgroundColor: '#fff3a3 !important' },
    '.cm-executingLine + .cm-activeLineGutter, .cm-gutter .cm-gutterElement.cm-activeLineGutter': {},
}, { dark: false });

interface TuringEditorProps {
    value: string;
    onChange: (value: string) => void;
    /** Número de linha 1-based a destacar como linha em execução, ou null para limpar. */
    highlightLine?: number | null;
}

export default function TuringEditor({ value, onChange, highlightLine }: TuringEditorProps) {
    const editorViewRef = useRef<EditorView | null>(null);

    // Despacha o efeito de highlight sempre que highlightLine mudar
    useEffect(() => {
        const view = editorViewRef.current;
        if (!view) return;
        view.dispatch({ effects: setActiveLine.of(highlightLine ?? null) });
        // Rola para manter a linha visível
        if (highlightLine != null) {
            try {
                const line = view.state.doc.line(highlightLine);
                view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'nearest' }) });
            } catch { /* linha inválida */ }
        }
    }, [highlightLine]);

    return (
        <NonSSRWrapper>
            <select
                className='w-full px-3 py-2 bg-gray-100 text-gray-800 rounded border hover:bg-gray-200 text-sm'
                onChange={(e) => onChange(exampleCodes[e.target.value])}
                defaultValue="busy beaver"
            >
                {Object.keys(exampleCodes).map(key => (
                    <option key={key} value={key}>{key}</option>
                ))}
            </select>
            <CodeMirror
                className='w-full h-0 flex-1 grow'
                theme={myTheme}
                value={value}
                onChange={onChange}
                extensions={turingExtensions}
                onCreateEditor={(view) => { editorViewRef.current = view; }}
            />
        </NonSSRWrapper>
    );
}

export { exampleCodes };
