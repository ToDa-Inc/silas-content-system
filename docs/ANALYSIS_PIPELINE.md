# Video Analysis Pipeline

## Overview

This system analyzes successful Instagram Reels to extract replicable patterns and strategies.

---

## Two Video Types & Their Analysis

### Type 1: Text Overlay Videos (Short-Form)
**Examples:** Hook + text appears + question at end
**Duration:** 7-15 seconds

**Analysis Approach:**
1. ✅ Extract unique frames (smart-frame-extractor.js)
2. ✅ Analyze frames with Vision AI
3. ✅ Evaluate against 5 criteria
4. ⚠️ Caption gives ~80% of value

**Tools:**
- `smart-frame-extractor.js` - Extract frames where text changes
- `vision-analyzer.js` - Analyze with Haiku 4.5
- `video-criteria-evaluator.js` - Score against criteria

---

### Type 2: Talking Head Videos (Long-Form)
**Examples:** Person speaking to camera, 30-90 seconds
**Duration:** 30-90 seconds

**Analysis Approach:**
1. ✅ Download video
2. ✅ Extract audio (ffmpeg)
3. ✅ **Transcribe with Whisper API** ← CRITICAL
4. ✅ Extract key frames for visual analysis
5. ✅ Manual analysis of transcript + frames

**Tools:**
- `ffmpeg` - Extract audio from video
- `transcribe.js` - Whisper API transcription
- `smart-frame-extractor.js` - Extract unique frames
- Manual analysis required

**Why transcript is essential:**
- Talking heads deliver value through SPOKEN WORDS
- Frames only show visual style
- Caption only gives ~70% (written summary)
- Transcript gives 100% of the content

---

## Cost Breakdown

### Per Video Analysis

| Step | Tool | Cost |
|------|------|------|
| **Scrape** | Apify | $0.0026/reel |
| **Download** | From Apify | Free |
| **Audio Extract** | ffmpeg | Free |
| **Transcribe** | Whisper API | $0.006/min |
| **Extract Frames** | smart-frame-extractor.js | Free |
| **Vision Analysis** | Haiku 4.5 | $0.0004/frame |

**Total per talking head video:** ~$0.01-0.02

---

## Scripts

### 1. scraper.js
Scrapes reels from Instagram using Apify.

```bash
node scripts/scraper.js --username connygfrerer --limit 20
```

### 2. smart-frame-extractor.js
Extracts unique frames where text changes.

```bash
node scripts/smart-frame-extractor.js --video path/to/video.mp4 --output output/
```

### 3. vision-analyzer.js
Analyzes frames with Claude Haiku 4.5 via OpenRouter.

```bash
node scripts/vision-analyzer.js --frames data/frames/output/
```

### 4. transcribe.js
Transcribes audio using OpenAI Whisper API.

```bash
node scripts/transcribe.js path/to/video.mp3
```

### 5. video-criteria-evaluator.js
Evaluates against 5 outlier criteria (best for text-overlay videos).

```bash
node scripts/video-criteria-evaluator.js --analysis path/to/vision_analysis.json
```

---

## The 5 Outlier Criteria

| # | Criteria | Description |
|---|----------|-------------|
| 1 | **Instant Hook** | Captures attention in 0-2 seconds |
| 2 | **High Relatability** | Viewer thinks "That happened to me" |
| 3 | **Cognitive Tension** | Creates curiosity or disagreement |
| 4 | **Clear Value** | Viewer gains insight, script, or framework |
| 5 | **Comment Trigger** | Creates discussion or engagement |

---

## Workflows

### For Text Overlay Videos (Short-Form)

```bash
# 1. Scrape reels
node scripts/scraper.js --username account --limit 20

# 2. Download video (from Apify output)
curl -o video.mp4 "VIDEO_URL"

# 3. Extract unique frames
node scripts/smart-frame-extractor.js --video video.mp4 --output analysis/

# 4. Analyze frames
node scripts/vision-analyzer.js --frames data/frames/analysis/

# 5. Evaluate criteria
node scripts/video-criteria-evaluator.js --analysis data/frames/analysis/vision_analysis.json
```

### For Talking Head Videos (Long-Form)

```bash
# 1. Scrape + Download video
node scripts/scraper.js --username account --limit 10
# (Get video URL from output)

# 2. Download video
curl -o video.mp4 "VIDEO_URL"

# 3. Extract audio
ffmpeg -i video.mp4 -vn -acodec libmp3lame -ab 128k audio.mp3

# 4. Transcribe
node scripts/transcribe.js audio.mp3

# 5. Extract key frames (every 10 seconds for visual analysis)
node scripts/smart-frame-extractor.js --video video.mp4 --output frames/

# 6. Manual analysis (transcript + frames)
# Use the criteria framework manually
```

---

## Output Files

| File | Description |
|------|-------------|
| `metadata.json` | Frame extraction metadata |
| `vision_analysis.json` | AI analysis of frames |
| `criteria_evaluation.json` | Score against 5 criteria |
| `*_transcript.txt` | Full transcript (talking heads) |

---

## Requirements

- Node.js
- ffmpeg (for audio extraction)
- OpenAI API key (for Whisper)
- OpenRouter API key (for Haiku Vision)
- Apify account + API token

---

## Configuration

Add to `config/.env`:
```
OPENAI_API_KEY=your-openai-key
OPENROUTER_API_KEY=your-openrouter-key
APIFY_API_TOKEN=your-apify-token
```

Note: For Whisper, use the full OpenAI key (not OpenRouter).
