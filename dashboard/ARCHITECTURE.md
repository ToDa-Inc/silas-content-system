# Silas Demo — Architecture Notes

This mockup is a **single-file HTML prototype** for client demos. It's intentionally minimal for quick iteration and easy sharing.

## When to Refactor

If you move from demo → production, consider:

### Option A: Split Static Assets (Low effort)
```
demo/
├── index.html      # Structure only, minimal inline
├── styles.css      # All custom CSS (glass, transitions, theme)
└── app.js          # Navigation, theme toggle, modals, etc.
```
**Pros:** Easier to maintain, cacheable assets. **Cons:** Still no components.

### Option B: Component-Based (Recommended for real app)
Use your existing **content-machine** Next.js stack:
- `src/components/` — Sidebar, NavItem, StatusHUD, ActionCard, etc.
- `src/app/` — Dashboard, Intelligence, Generate, Scheduling, Context, Settings pages
- Shared design tokens (Tailwind config, CSS variables for theme)

**Pros:** Reusable components, proper routing, type safety. **Cons:** More setup.

### Option C: Design System First
Extract a `design-tokens.css` or Tailwind preset with:
- `--color-primary`, `--color-surface`, etc.
- Glass variants, border radii, shadows
- Ensures contrast is correct by default (light/dark text on surfaces)

### Contrast & Theme
- All text uses `text-zinc-900 dark:text-zinc-100` (primary) or `text-zinc-600 dark:text-zinc-500` (secondary)
- Surfaces: `border-zinc-200 dark:border-white/5` for light-mode visibility
- Theme toggle adds `light` class for bg-mesh gradients
