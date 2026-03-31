"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type AppSelectOption = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  id?: string;
  /** When `label` is omitted, set this for the trigger button (accessibility). */
  ariaLabel?: string;
  /** Open the menu above the trigger (helps inside overflow / bottom of cards). */
  menuAbove?: boolean;
  /** Smaller chevron + tighter trigger (e.g. competitor card inline pickers). */
  dense?: boolean;
};

export function AppSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  label,
  className,
  triggerClassName,
  disabled,
  id: idProp,
  ariaLabel,
  menuAbove,
  dense,
}: Props) {
  const autoId = useId();
  const listId = `${autoId}-list`;
  const btnId = idProp ?? `${autoId}-btn`;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const labelText = selected?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={cn("relative inline-block text-left", className)}>
      {label ? (
        <span
          className={cn(
            "block text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-app-fg-subtle",
            dense ? "mb-0.5" : "mb-1",
          )}
        >
          {label}
        </span>
      ) : null}
      <button
        type="button"
        id={btnId}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "glass-inset inline-flex min-w-[180px] items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-white/80 px-3 py-2 text-left text-sm text-zinc-900 shadow-sm transition-colors",
          "hover:border-zinc-300/90 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "ring-2 ring-amber-500/30 dark:ring-amber-400/25",
          triggerClassName,
        )}
      >
        <span className="truncate">{labelText}</span>
        <ChevronDown
          className={cn(
            "shrink-0 text-zinc-500 transition-transform dark:text-zinc-400",
            dense ? "h-3 w-3" : "h-4 w-4",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={btnId}
          className={cn(
            "absolute left-0 z-50 max-h-60 min-w-full overflow-auto rounded-lg border border-zinc-200/90 bg-white py-1 shadow-lg dark:border-white/12 dark:bg-zinc-900",
            menuAbove ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value || "__empty"} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={cn(
                    "flex w-full px-3 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-amber-500/15 font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                      : "text-zinc-800 hover:bg-zinc-100 dark:text-app-fg-secondary dark:hover:bg-white/10",
                  )}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
