"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { ChevronDown, Search, X } from "lucide-react";

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Selecionar...",
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch(""); // limpa a busca ao fechar
  };

  const filtered = search.trim()
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* ── Trigger: exibe os chips selecionados ── */}
      <PopoverTrigger
        type="button"
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-3xl border border-border",
          "bg-input/30 px-3 py-1.5 text-sm text-left cursor-pointer",
          "transition-[color,box-shadow,border-color] hover:border-foreground/30",
          "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
          open && "border-ring ring-3 ring-ring/30"
        )}
      >
        <span className="flex flex-1 flex-wrap gap-1">
          {value.length === 0 ? (
            <span className="py-0.5 text-muted-foreground">{placeholder}</span>
          ) : (
            value.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 rounded-2xl bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
              >
                {item}
                <span
                  role="button"
                  aria-label={`Remover ${item}`}
                  className="cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
                  onPointerDown={(e) => {
                    // evita fechar/reabrir o popover ao remover um chip
                    e.stopPropagation();
                    e.preventDefault();
                    onChange(value.filter((v) => v !== item));
                  }}
                >
                  <X className="size-3" />
                </span>
              </span>
            ))
          )}
        </span>
        <ChevronDown
          className={cn(
            "ml-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </PopoverTrigger>

      {/* ── Dropdown: lista com checkboxes ── */}
      <PopoverContent
        align="start"
        sideOffset={6}
        // min-w usa a variável CSS que o base-ui expõe no Positioner
        className="min-w-(--anchor-width) w-auto p-1"
      >
        {options.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            Nenhuma opção disponível.
          </p>
        ) : (
          <>
            {/* Campo de busca — sem autoFocus para não scrollar a página */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {search && (
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setSearch("")}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <ul className="max-h-52 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Nenhum resultado para &ldquo;{search}&rdquo;.
                </li>
              ) : (
                filtered.map((opt) => {
                  const isSelected = value.includes(opt);
                  return (
                    <li key={opt}>
                      <button
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() =>
                          onChange(
                            isSelected
                              ? value.filter((v) => v !== opt)
                              : [...value, opt]
                          )
                        }
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-sm transition-colors",
                          "hover:bg-muted",
                          isSelected && "font-medium"
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          tabIndex={-1}
                          className="pointer-events-none"
                        />
                        <span>{opt}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}