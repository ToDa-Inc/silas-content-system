# B-roll caption editor (Remotion)

Single composition **`video-spec`** renders a **VideoSpec v1** JSON document: template, theme, brand colors, background (image or video), hook timing, and timed text blocks.

## VideoSpec v1 (contract)

- `v`: `1`
- `templateId`: `bottom-card` | `centered-pop` | `top-banner` | `capcut-highlight`
- `themeId`: `bold-modern` | `editorial` | `casual-hand` | `clean-minimal`
- `brand`: `{ primary, accent? }` (hex)
- `background`: `{ url, kind: "image"|"video", focalPoint }`
- `hook`: `{ text, durationSec }`
- `blocks`: `[{ id, text, isCTA, startSec, endSec, animation }]`
- `totalSec`: number (>= last block `endSec`)

The FastAPI worker passes this object as Remotion `--props` (see `backend/services/video_render.py`).

## Local dev

```bash
cd video-production/broll-caption-editor
npm install
npm run dev
```

Opens Remotion Studio on `src/Root.tsx` with a built-in `defaultStudioSpec` preview.

## Render CLI

```bash
npm run build
```

Requires a `props.json` with a full VideoSpec (same shape the backend writes).

## Layout code

The spec source lives in `content-machine/src/remotion-spec/` so the dashboard
`<Player>` and the Remotion CLI render share **one** physical install of
`remotion` + `react`. Two copies break Player context (`useCurrentFrame`).

- `content-machine/src/remotion-spec/Renderer.tsx` — switches on `templateId`
- `content-machine/src/remotion-spec/templates/*` — one file per template
- `content-machine/src/remotion-spec/themes/index.ts` — theme tokens (fonts, card colors)
- `content-machine/src/remotion-spec/animations.ts` — entrance motion per `animation`
- `src/Root.tsx` — registers the `video-spec` Composition for Studio + CLI render
