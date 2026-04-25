# Quick Start — VideoSpec preview (Remotion)

## 1. Install Dependencies

```bash
cd broll-caption-editor
npm install
```

This installs Remotion and React. Takes ~2-3 minutes.

## 2. Start Preview

```bash
npm run dev
```

Remotion Studio opens at `http://localhost:3000`. The **`video-spec`** composition reads **VideoSpec v1** props (see `README.md`).

## 3. Edit content & timing

- In **Silas** (`content-machine`), use the video workspace — the live Player reads the same spec as the CLI render.
- For local Studio tweaks, edit **`defaultStudioSpec`** in `src/Root.tsx` (template, theme, `hook`, `blocks[].startSec` / `endSec`, `animation`).

## 4. Customize look

The spec source lives in `content-machine/src/remotion-spec/` (one shared install of `remotion` + `react`):

- **Templates**: `content-machine/src/remotion-spec/templates/*.tsx`
- **Themes** (fonts, card colors): `content-machine/src/remotion-spec/themes/index.ts`
- **Motion**: `content-machine/src/remotion-spec/animations.ts`

## 5. CLI render

The backend passes a **VideoSpec JSON** file as Remotion `--props`. Locally, build `props.json` with the same shape and run `npx remotion render ...` (see `README.md`).

## 6. Export to MP4

When happy with the preview:

```bash
npm run build
```

Outputs final video to `out/video.mp4` (1080×1920 — perfect for Instagram Reels).

## 7. Post to Instagram

1. Upload `out/video.mp4` to Instagram as a Reel
2. Add trending audio before publishing (30 seconds per post, highly affects reach per your playbook)
3. Track performance metrics

---

## Workflow Integration

**After generation, your next steps are:**

1. ✅ Caption the video (this tool)
2. ⏭️ Add trending audio in Instagram's editor (30 sec, high ROI per your context)
3. ⏭️ Approve in dashboard and push to drafts via Postiz
4. ⏭️ Track performance and feed back into auto-learning loop

This captioning layer bridges your content generation (hooks + scripts) → final video ready to post.

---

## Troubleshooting

**Background not loading?**
- Check `background.url` in the spec (must be a valid absolute URL or path Remotion can read).

**Blocks overlapping?**
- Ensure each block has `startSec` / `endSec` with no unintended overlap; bump `totalSec` if needed.

**Animation feels off?**
- Tune curves in `content-machine/src/remotion-spec/animations.ts` (fade uses ~8 frames; `pop` uses Remotion `spring()`).

---

That's it! You now have a fully automated caption system for your B-roll. 🎬
