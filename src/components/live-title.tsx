"use client";

import { useEffect, useState } from "react";

// https://stackoverflow.com/questions/52170634/how-to-set-documents-title-per-page
export default function LiveTitle() {
    const [title, setTitle] = useState("🅺🅲🅸🆁🅴");

    useEffect(() => {
        if (typeof document === 'undefined') return;
        
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                setTitle(`😴🅺🅲🅸🆁🅴`);
            } else {
                setTitle(`👀🅺🅲🅸🆁🅴`);
            }
        };
        
        window.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, []);

    return <title>{title}</title>;
}