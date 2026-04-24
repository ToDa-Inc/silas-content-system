"use client";

import { useId } from "react";

type Props = {
  label: string;
  leftHint: string;
  rightHint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  /** Optional native tooltip on the whole control (e.g. explain "Padding"). */
  title?: string;
  /** Render the live value (e.g. "Center", "1.10x"). */
  formatValue: (v: number) => string;
  /** Fires while dragging — wire to local state for instant preview feedback. */
  onChange: (v: number) => void;
  /** Fires once on release — wire to API persist. */
  onCommit: (v: number) => void;
};

/**
 * Dual-callback range slider used by the workspace's layout panel.
 *
 * `onChange` updates local draft state every drag tick (cheap), `onCommit` fires
 * on release for the API write — so the live preview is instant but we don't
 * spam JSON Patch requests for every pixel of slider movement.
 */
export function LayoutSlider({
  label,
  leftHint,
  rightHint,
  min,
  max,
  step,
  value,
  disabled,
  formatValue,
  onChange,
  onCommit,
  title,
}: Props) {
  const id = useId();
  return (
    <div className="space-y-0.5" title={title}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-[10px] font-semibold text-app-fg-muted">
          {label}
        </label>
        <span className="text-[10px] font-mono text-app-fg-subtle">{formatValue(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={(e) => onCommit(parseFloat((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(parseFloat((e.target as HTMLInputElement).value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-app-chip-bg/60 accent-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
      />
      <div className="flex justify-between text-[9px] text-app-fg-subtle">
        <span>{leftHint}</span>
        <span>{rightHint}</span>
      </div>
    </div>
  );
}
