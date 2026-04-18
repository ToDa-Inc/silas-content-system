"use client";

/**
 * Lightweight tooltip primitive — portal-rendered so it escapes scroll/overflow
 * containers (table wrappers in particular). Hover + keyboard focus, ~180ms open
 * delay so it doesn't fire on quick mouse passes, and a tiny exit grace period
 * so tooltips with multi-line content stay readable while the user reads them.
 *
 * Use as a wrapper. The trigger keeps its semantics; the tooltip just appears.
 *
 *   <Tooltip content="Comments ÷ views">
 *     <span>C/V</span>
 *   </Tooltip>
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type Side = "top" | "bottom";

type Props = {
  /** The interactive element that triggers the tooltip. */
  children: ReactNode;
  /** Tooltip body — string or richer JSX. */
  content: ReactNode;
  /** Preferred side; auto-flips when too close to viewport edge. */
  side?: Side;
  /** Max width in rem. Default 18rem keeps content readable without being giant. */
  maxWidthRem?: number;
  /** Delay before showing in ms. */
  delay?: number;
  /** When false, the tooltip won't open (e.g. trigger has no extra context). */
  disabled?: boolean;
  /** Extra classes for the trigger wrapper (controls layout, not tooltip). */
  className?: string;
};

const SHOW_DELAY = 180;
const HIDE_DELAY = 80;
const VIEWPORT_PAD = 8;

export function Tooltip({
  children,
  content,
  side = "top",
  maxWidthRem = 18,
  delay = SHOW_DELAY,
  disabled = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; placedSide: Side } | null>(
    null,
  );
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const cancelTimers = () => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const show = () => {
    if (disabled || !content) return;
    cancelTimers();
    showTimer.current = setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    cancelTimers();
    hideTimer.current = setTimeout(() => {
      setOpen(false);
      setCoords(null);
    }, HIDE_DELAY);
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tipRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const w = tipRef.current.offsetWidth;
    const h = tipRef.current.offsetHeight;
    const cx = t.left + t.width / 2;
    let placedSide: Side = side;
    let y =
      side === "top" ? t.top - h - 8 : t.bottom + 8;
    if (side === "top" && y < VIEWPORT_PAD) {
      placedSide = "bottom";
      y = t.bottom + 8;
    } else if (side === "bottom" && y + h > window.innerHeight - VIEWPORT_PAD) {
      placedSide = "top";
      y = t.top - h - 8;
    }
    let x = cx - w / 2;
    const maxX = window.innerWidth - w - VIEWPORT_PAD;
    if (x < VIEWPORT_PAD) x = VIEWPORT_PAD;
    if (x > maxX) x = maxX;
    setCoords({ x, y, placedSide });
  }, [open, side, content]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setCoords(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
        className={cn("inline-flex max-w-full items-center", className)}
      >
        {children}
      </span>
      {mounted && open
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              style={{
                position: "fixed",
                top: coords?.y ?? -9999,
                left: coords?.x ?? -9999,
                maxWidth: `${maxWidthRem}rem`,
                opacity: coords ? 1 : 0,
              }}
              className={cn(
                "pointer-events-none z-[200] rounded-md bg-zinc-900 px-2.5 py-1.5",
                "text-[11px] font-medium leading-snug text-white shadow-lg ring-1 ring-black/10",
                "transition-opacity duration-100 dark:bg-zinc-800",
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
