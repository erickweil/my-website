"use client";

import dynamic from "next/dynamic";

// Os dados ficam no localStorage, que não existe no servidor: a página é montada só no navegador.
const GeradorHorario = dynamic(() => import("./GeradorHorario"), {
    ssr: false,
    loading: () => <p className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</p>,
});

export default function Page() {
    return <GeradorHorario />;
}
