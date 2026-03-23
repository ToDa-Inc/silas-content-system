# B-Roll Caption Editor for Instagram Reels

Generate Instagram Reels-style captions with dynamic timing using Remotion. Perfect for adding animated text overlays to your B-roll footage.

## Features

✅ **Dynamic Text Overlays** – Text appears sequentially with fade-in/fade-out animations
✅ **Instagram Reel Styling** – Professional caption styling with readable text shadows
✅ **Easy Configuration** – Simple JSON-based caption presets
✅ **Customizable Timing** – Frame-accurate control over when text appears
✅ **Preview & Export** – Built-in Remotion Studio for real-time preview + export to MP4

## Setup

```bash
npm install
npm run dev
```

This opens **Remotion Studio** where you can:
- Preview your video in real-time
- Adjust captions and timing
- Export the final video to MP4

## How It Works

### Basic Structure

```
[HOOK - appears immediately]
    ↓ 2 seconds
[TEXT BLOCK 1 - appears below]
    ↓ 2 seconds
[TEXT BLOCK 2 - appears below]
    ↓ 2 seconds
[CTA - "Comment for info"]
```

### Frame-Based Timing

At 30fps, timing works like this:

- **30 frames** = 1 second
- **60 frames** = 2 seconds
- **120 frames** = 4 seconds

### Configuration

Edit `src/Root.jsx` to change the caption content and timing:

```jsx
defaultProps={{
  videoPath: '../IMG_9451 3.MOV',  // Path to your video
  hook: "Your Main Headline",
  textBlocks: [
    {
      text: "Text that appears after 2 seconds",
      appearAt: 60,    // Frame number (2 seconds)
      duration: 60     // Display for 2 seconds
    },
    {
      text: "More text after 4 seconds total",
      appearAt: 120,
      duration: 60
    }
  ]
}}
```

## Quick Examples

### Example 1: Content Types (as shown)

```js
hook: "Content Types That Work",
textBlocks: [
  { text: "Type Description Example", appearAt: 60, duration: 60 },
  { text: "Situational Time-specific workplace moment", appearAt: 120, duration: 60 },
  { text: 'Comment "info" for full breakdown', appearAt: 180, duration: 120 }
]
```

### Example 2: Red Flags Pattern

```js
hook: "Red Flags Smart Employees Notice",
textBlocks: [
  { text: "🚩 Your boss discusses you behind closed doors", appearAt: 60, duration: 60 },
  { text: "🚩 You're excluded from important meetings", appearAt: 120, duration: 60 },
  { text: "Act before it's too late", appearAt: 180, duration: 120 }
]
```

## Preset Templates

Use presets from `src/config.js` for quick setup:

```jsx
import { PRESETS } from './config.js';

defaultProps={PRESETS.contentTypes}  // Uses "Content Types" preset
```

Available presets:
- `PRESETS.contentTypes` – Example from your context
- `PRESETS.redFlags` – Red flags pattern
- `PRESETS.timeSpecific` – Time-based hook

## Customization

### Text Style

Edit `src/components/TextOverlay.jsx` to change:
- Font size (currently: 52px hook, 36px body)
- Font weight (currently: 900 hook, 700 body)
- Text shadow (glow effect)
- Animation speed (fade-in/out duration)

### Colors

- **Text**: White (`#ffffff`)
- **Shadow**: Black with opacity (`rgba(0,0,0,0.8)`)
- **Video Overlay**: Dark radial gradient for readability

### Timing

Change `appearAt` and `duration` values to adjust when text appears and how long it displays.

For 2-second intervals:
- **1st block**: `appearAt: 60, duration: 60` (2-4 seconds)
- **2nd block**: `appearAt: 120, duration: 60` (4-6 seconds)
- **3rd block**: `appearAt: 180, duration: 120` (6-10 seconds)

## Export

```bash
npm run build
```

Exports the final video to `out/video.mp4` at 1080×1920 (Instagram Reel dimensions).

## Structure

```
broll-caption-editor/
├── package.json
├── src/
│   ├── Root.jsx                    # Main composition definition
│   ├── config.js                   # Caption presets
│   ├── compositions/
│   │   └── CaptionedBroll.jsx      # Video + captions container
│   └── components/
│       └── TextOverlay.jsx         # Animated text component
└── README.md
```

## Next Steps

1. **Preview**: Run `npm run dev` to see your captions on the video in real-time
2. **Adjust**: Change text, timing, and styling in Remotion Studio
3. **Export**: Run `npm run build` to generate the final MP4
4. **Post**: Upload to Instagram as a Reel
5. **Iterate**: Use feedback to refine your hooks and captions for the next video

---

Built with Remotion + React. Questions? Check the [Remotion docs](https://www.remotion.dev/).
