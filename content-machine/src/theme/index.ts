/**
 * Reusable class strings for Silas UI. Tokens live in semantic.css; Tailwind maps them to `app-*`.
 * Use with `cn()` — avoids scattering `text-zinc-900 dark:text-zinc-100` across pages.
 */
export const ui = {
  pageTitle: "text-lg font-semibold text-app-fg",
  sectionTitle: "text-sm font-semibold text-app-fg",
  sectionTitleMuted: "text-sm font-semibold text-app-fg-secondary",
  body: "text-sm text-app-fg-secondary",
  bodyMuted: "text-sm text-app-fg-muted",
  caption: "text-xs text-app-fg-muted",
  label: "text-xs font-semibold uppercase tracking-wider text-app-fg-subtle",
  overline: "text-[10px] font-medium uppercase tracking-wide text-app-fg-subtle",
  monoStatus: "font-mono text-xs text-app-fg-secondary",
} as const;
