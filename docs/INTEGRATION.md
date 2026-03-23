# Integration: B-Roll Caption Editor → Silas Content System

This document shows how the new **B-Roll Caption Editor** integrates into your full Silas content automation pipeline.

## Your Current Pipeline (from proposal-silas.md)

```
Week 1: Intelligence (scrape + analyze)
    ↓
Week 2: Generation (hooks + scripts)
    ↓
Week 3: Production (image + post queue)
    ↓
Week 4: Auto-learning + Multi-client
```

## New: Video/B-Roll Layer (Added Today)

```
Existing Content Generation
├─ Hook generation (from niche patterns)
├─ Script generation (for talking heads)
└─ Image generation (static slides)
    ↓
🆕 B-ROLL CAPTION EDITOR (NEW)
├─ Takes your B-roll shot (IMG_9451 3.MOV)
├─ Adds dynamic captions based on hooks
├─ Animates text with timing control
└─ Outputs Instagram Reel-ready MP4
    ↓
Instagram Drafts + Audio + Publish
```

## How It Works in Your Workflow

### 1. Record B-Roll
You record a generic B-roll shot (office, desk, meeting, etc.) — ~10-30 seconds. Save as `.MOV` or `.mp4`.

**Current example:** `IMG_9451 3.MOV` in your content folder

### 2. Generate Hook + Copy
Your existing system generates:
- **Hook**: "Content Types That Work"
- **Body text**: From niche patterns + your playbook
- **CTA**: "Comment 'info' for full breakdown"

### 3. Add Captions via B-Roll Editor
```bash
cd broll-caption-editor
npm run dev
```

Configure in `src/Root.jsx`:
```jsx
defaultProps={{
  videoPath: '../IMG_9451 3.MOV',
  hook: "Content Types That Work",
  textBlocks: [
    { text: "Type Description Example", appearAt: 60, duration: 60 },
    { text: "Situational Time-specific workplace", appearAt: 120, duration: 60 },
    { text: 'Comment "info" for full breakdown', appearAt: 180, duration: 120 }
  ]
}}
```

Preview in Remotion Studio, then export:
```bash
npm run build
```

Output: `out/video.mp4` (1080×1920, Instagram Reel-ready)

### 4. Add Audio + Post
Upload to Instagram, add trending audio (30 seconds per your playbook), publish as Reel.

### 5. Track Performance
Metrics feed back into your auto-learning loop for Week 4.

---

## Integration Points

### Input: From Existing System
Your Week 1-3 system generates:
- ✅ Hooks (used as video header)
- ✅ Copy/script (used as text blocks)
- ✅ CTAs (used as final caption)

**The caption editor consumes these directly.** No data translation needed.

### Output: To Instagram Posting
The caption editor outputs:
- ✅ MP4 file (1080×1920 — Instagram Reel native)
- ✅ Ready for audio + publishing
- ✅ Metrics trackable via Instagram Insights

---

## Three Ways to Use It

### 1. **Manual (One-Off Videos)**
Good for: Testing new hooks, client demos, special campaigns

```bash
# Edit src/Root.jsx with your hook + copy
npm run dev      # Preview in Remotion
npm run build    # Export to MP4
# Upload to Instagram
```

Time per video: ~5-10 minutes (after initial setup)

### 2. **Templated (Recurring Videos)**
Good for: Running the same hook across different B-roll shots

Store presets in `src/config.js`:
```js
export const PRESETS = {
  contentTypes: { hook: "...", textBlocks: [...] },
  redFlags: { hook: "...", textBlocks: [...] },
  // etc
}
```

Then switch between them:
```jsx
import { PRESETS } from './config.js';
defaultProps={PRESETS.contentTypes}
```

### 3. **Batch (Automated via Node Script)**
Good for: Generating multiple captioned videos at once

Use the caption generator:
```bash
node generate-captions.js "My Hook" "Text 1" "Text 2" "CTA"
```

Outputs a config block ready to paste into src/Root.jsx.

---

## Content Playbook Alignment

Your Silas playbook has these patterns:

✅ **Time-Specific Hooks**
- "It's 4:55 PM Friday..."
- "Monday at 9:01 AM..."
- ➜ Perfect for B-roll captions

✅ **Red Flag Patterns**
- "🚩 Your boss discusses you..."
- "🚩 You're excluded from..."
- ➜ Multi-line captions work great

✅ **Problem/Solution Hooks**
- "If your boss says this..."
- "Smart employees notice..."
- ➜ Two-block structure

✅ **Provocative Hooks**
- "Most professionals communicate wrong"
- "Your kindness is costing you"
- ➜ Bold single-line hooks

All of these fit naturally into the B-roll caption structure.

---

## Next: Automation Opportunity

Once you've tested a few videos, we can:

1. **Connect to your generation pipeline** — Hooks from Week 2 auto-feed to caption editor
2. **Batch render** — Generate 5-10 captioned videos at once, output to a folder
3. **Dashboard integration** — Show rendered videos in your approval queue alongside static slides
4. **Performance loop** — Track which B-roll shots + hooks perform best, feed back to generation

This would move video from "manual task" to "automated output" — one more item off your plate.

---

## File Structure

```
content_system_silas/
├── IMG_9451 3.MOV              # Your B-roll shot
├── proposal-silas.md           # Original project proposal
├── INTEGRATION.md              # This file
│
└── broll-caption-editor/       # The new caption tool
    ├── package.json
    ├── README.md               # Full documentation
    ├── QUICKSTART.md           # 5-minute setup guide
    ├── INSTALL.sh              # One-command install
    ├── generate-captions.js    # CLI caption generator
    ├── remotion.config.js
    ├── src/
    │   ├── Root.jsx            # Main config (edit this)
    │   ├── config.js           # Caption presets
    │   ├── compositions/
    │   │   └── CaptionedBroll.jsx
    │   └── components/
    │       └── TextOverlay.jsx
    └── out/                    # Output videos (after npm run build)
```

---

## Getting Started (5 Steps)

1. **Install**: `cd broll-caption-editor && npm install` (~2 min)
2. **Preview**: `npm run dev` (opens Remotion Studio)
3. **Edit captions**: Update `src/Root.jsx` with your hook + copy
4. **Adjust timing**: Change `appearAt` and `duration` as needed
5. **Export**: `npm run build` (generates `out/video.mp4`)

That's it. Your first captioned video is ready to post.

---

## Questions?

- **How do I change text size?** Edit `src/components/TextOverlay.jsx` (fontSize, fontWeight)
- **How do I add more text blocks?** Add objects to `textBlocks` array in `src/Root.jsx`
- **How do I use a different B-roll?** Change the `videoPath` prop in `src/Root.jsx`
- **Can I automate this?** Yes — see "Automation Opportunity" section above

For full details, read **QUICKSTART.md** inside the broll-caption-editor folder.
