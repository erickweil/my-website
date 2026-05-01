"use client";
import React from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';

import { getExampleCodes } from './turingexamples';
import NonSSRWrapper from '@/components/nonSSRWrapper';
import { turingLanguage } from './turingLanguage';

const exampleCodes = getExampleCodes();

// Mantido no escopo de módulo para que a referência seja estável entre renders.
// Se fosse criado dentro do componente, o CodeMirror reconfiguraria o parser a cada keystroke.
const turingExtensions = [turingLanguage()];

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
}, { dark: false });

interface TuringEditorProps {
    value: string;
    onChange: (value: string) => void;
}

export default function TuringEditor({ value, onChange }: TuringEditorProps) {
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
            />
        </NonSSRWrapper>
    );
}

export { exampleCodes };
