# Quick Start — Add Captions to Your B-Roll

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

Remotion Studio opens at `http://localhost:3000`. You'll see your video with animated captions in real-time.

## 3. Edit Your Captions

Open `src/Root.jsx` and modify the `defaultProps` section:

```jsx
defaultProps={{
  videoPath: '../IMG_9451 3.MOV',
  hook: "Your Main Headline Here",
  textBlocks: [
    {
      text: "First text block (appears at 2 seconds)",
      appearAt: 60,
      duration: 60
    },
    {
      text: "Second text block (appears at 4 seconds)",
      appearAt: 120,
      duration: 60
    },
    {
      text: "Third text block (appears at 6 seconds)",
      appearAt: 180,
      duration: 120
    }
  ]
}}
```

**Changes update instantly in Remotion Studio** — no need to refresh.

## 4. Adjust Timing

Frames-to-seconds conversion (at 30fps):
- `appearAt: 30` = 1 second
- `appearAt: 60` = 2 seconds
- `appearAt: 120` = 4 seconds
- `appearAt: 180` = 6 seconds

For 2-second intervals between blocks:
```js
textBlocks: [
  { text: "...", appearAt: 60, duration: 60 },    // 2-4 sec
  { text: "...", appearAt: 120, duration: 60 },   // 4-6 sec
  { text: "...", appearAt: 180, duration: 120 }   // 6-10 sec
]
```

## 5. Customize Style (Optional)

Edit `src/components/TextOverlay.jsx` to change:

```jsx
fontSize: isHook ? 52 : 36,      // Hook = bigger (52px), body = smaller (36px)
fontWeight: isHook ? '900' : '700',  // Hook = bolder
textShadow: '0 2px 4px rgba(0, 0, 0, 0.8)', // Glow effect
```

Or use the **Silas content template** from your context:

```jsx
defaultProps={{
  videoPath: '../IMG_9451 3.MOV',
  hook: "Content Types That Work",
  textBlocks: [
    {
      text: "Type Description Example",
      appearAt: 60,
      duration: 60
    },
    {
      text: "Situational Time-specific workplace moment",
      appearAt: 120,
      duration: 60
    },
    {
      text: 'Comment "info" for full breakdown',
      appearAt: 180,
      duration: 120
    }
  ]
}}
```

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

## Real-World Examples for Silas Content

### Example 1: Red Flags Hook
```jsx
hook: "Red Flags Smart Employees Notice",
textBlocks: [
  { text: "🚩 Your boss discusses you behind closed doors", appearAt: 60, duration: 60 },
  { text: "🚩 You're excluded from important meetings", appearAt: 120, duration: 60 },
  { text: "Act before it's too late", appearAt: 180, duration: 120 }
]
```

### Example 2: Time-Specific Hook
```jsx
hook: "It's 4:55 PM on Friday",
textBlocks: [
  { text: "Your boss sends an urgent email", appearAt: 60, duration: 60 },
  { text: "Here's what high performers do instead...", appearAt: 120, duration: 60 },
  { text: "Save this for later", appearAt: 180, duration: 120 }
]
```

### Example 3: Problem/Solution Pattern
```jsx
hook: "Why Nice People Don't Get Promoted",
textBlocks: [
  { text: "They never challenge ideas in meetings", appearAt: 60, duration: 60 },
  { text: "Here's what to do instead...", appearAt: 120, duration: 60 },
  { text: "Comment for the full framework", appearAt: 180, duration: 120 }
]
```

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

**Video not loading?**
- Check path in `videoPath: '../IMG_9451 3.MOV'` — should be relative to `src/Root.jsx`
- Video should be in the parent directory of `broll-caption-editor/`

**Text overlapping?**
- Adjust `appearAt` values to stagger the blocks
- Or add more `duration` between blocks

**Want faster/slower animations?**
- Change `fadeInFrames = 10` in `TextOverlay.jsx` (currently 10 frames = ~0.3 seconds)
- Lower = faster, higher = slower

**Font looks different on export?**
- Remotion renders with system fonts. Use standard fonts like Arial, Helvetica, -apple-system for consistency across devices.

---

That's it! You now have a fully automated caption system for your B-roll. 🎬
