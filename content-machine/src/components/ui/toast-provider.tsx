"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastVariant = "default" | "success" | "error";

type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  show: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const regionId = useId();

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = "default") => {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      setToasts((prev) => {
        const next = [...prev, { id, message, variant }];
        if (next.length > 3) {
          next.slice(0, next.length - 3).forEach((r) => {
            const tt = timers.current.get(r.id);
            if (tt) clearTimeout(tt);
            timers.current.delete(r.id);
          });
        }
        return next.slice(-3);
      });
      const timeout = setTimeout(() => dismiss(id), 4000);
      timers.current.set(id, timeout);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        id={regionId}
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2 p-2 md:max-w-md"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 text-sm",
              /* Glassmorphism: semi-transparent dark surface + hard blur + subtle edge border */
              "border border-white/[0.13] bg-zinc-900/65 text-zinc-100",
              "shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-2xl backdrop-saturate-[1.35]",
              /* Coloured left accent per variant */
              t.variant === "success" && "border-l-[3px] border-l-emerald-400",
              t.variant === "error" && "border-l-[3px] border-l-rose-400",
              t.variant === "default" && "border-l-[3px] border-l-amber-400",
            )}
          >
            <p className="min-w-0 flex-1 leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
