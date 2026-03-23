# Video Analyzer Skill

**Purpose:** Analyze Instagram Reels to extract replicable patterns, strategies, and success criteria.

**Author:** Buggy (OpenClaw)

**Last Updated:** 2026-03-09

---

## What This Skill Does

Analyzes Instagram Reels (both talking head and text-overlay formats) to understand:
- Why a video went viral
- What triggers made it successful
- How to replicate the pattern
- Visual, audio, and structural elements

---

## Requirements

### API Keys (Required)

| Key | Where to Get | Purpose |
|-----|--------------|---------|
| `APIFY_API_TOKEN` | [apify.com](https://apify.com) | Scrape reels, get video URLs, transcripts |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | Whisper transcription (must be full key, not OpenRouter) |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) | Haiku 4.5 Vision analysis |

### Tools Required

| Tool | Install | Purpose |
|------|---------|---------|
| `ffmpeg` | `brew install ffmpeg` | Extract audio from video |
| `node` | Pre-installed | Run scripts |

### Environment Variables

Set these in your config or environment:
```bash
export APIFY_API_TOKEN="apify_api_xxxxxxxxxxxx"
export OPENAI_API_KEY="sk-proj-xxxxxxxxxxxx"
export OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxx"
```

---

## Installation

### 1. Install ffmpeg (if not installed)
```bash
brew install ffmpeg
```

### 2. Configure API keys
```bash
# Add to your config/.env or environment
APIFY_API_TOKEN=apify_api_xxxxxxxxxxxx
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxx
```

---

## Video Types

This skill handles **three** video types:

### Type 1: Text Overlay (Short-Form)
- Duration: 5-15 seconds
- Format: Text appears on screen, minimal talking
- Example: Hook → Problem → Question → Caption has solution
- Analysis: Frame extraction + Vision AI

### Type 2: Talking Head (Long-Form)
- Duration: 30-90 seconds
- Format: Person speaks to camera, text overlays appear throughout
- Example: Person teaching, explaining, storytelling
- Analysis: Transcript + Frames + Vision AI

### Type 3: Hybrid
- Duration: 15-60 seconds
- Format: Mix of talking + text overlays
- Example: Person speaks, key phrases appear as text
- Analysis: Both transcript and frames needed

---

## Usage

### Command 1: Analyze by URL
```bash
node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/"
node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/" --type talking-head
node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/" --type text-overlay
```

### Command 2: Analyze by Username
```bash
# Scrape account and analyze top performing reels
node scripts/analyze.js --username connygfrerer --limit 10
node scripts/analyze.js --username connygfrerer --limit 10 --type talking-head
```

### Command 3: Analyze Local Video
```bash
node scripts/analyze.js --video path/to/video.mp4
node scripts/analyze.js --video path/to/video.mp4 --transcript
```

### Command 4: Full Analysis with Transcript
```bash
node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/" --full
```

---

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--url` | `-u` | Instagram Reel URL | - |
| `--username` | `-n` | Instagram username to scrape | - |
| `--video` | `-v` | Local video file path | - |
| `--limit` | `-l` | Number of reels to analyze | 5 |
| `--type` | `-t` | Video type: `talking-head`, `text-overlay`, `auto` | `auto` |
| `--full` | `-f` | Include transcript (for talking heads) | false |
| `--output` | `-o` | Output directory | `data/analysis/[timestamp]/` |
| `--help` | `-h` | Show help | - |

---

## Output

The skill creates the following output structure:

```
data/analysis/[timestamp]/
├── metadata.json              # Input parameters, timestamps
├── video_info.json           # Video metadata from Apify
├── video.mp4                 # Downloaded video (if applicable)
├── audio.mp3                # Extracted audio
├── audio_transcript.txt     # Whisper transcript (if requested)
├── frames/
│   ├── metadata.json         # Frame extraction info
│   ├── frame_00.jpg         # Unique frames (text changes)
│   ├── frame_01.jpg
│   └── ...
├── vision_analysis.json      # AI analysis of frames
├── criteria_evaluation.json # Score against 5 criteria
└── full_report.md           # Human-readable analysis report
```

---

## Cost Breakdown

### Per Video Analysis

| Step | Tool | Cost |
|------|------|------|
| Scrape (get video URL) | Apify | $0.0026/reel |
| Download video | curl | Free |
| Extract audio | ffmpeg | Free |
| Transcribe (per minute) | Whisper | $0.006/min |
| Extract frames | ffmpeg | Free |
| Analyze frames | Haiku 4.5 | $0.0004/frame |

### Example Costs

| Scenario | Cost |
|----------|------|
| Text-overlay video (9 frames) | ~$0.01 |
| Talking head (60s, transcript + 20 frames) | ~$0.04 |
| Full analysis with transcript | ~$0.05 |

---

## The 5 Outlier Criteria

Every video is evaluated against these criteria:

| # | Criteria | Weight | Description |
|---|----------|--------|-------------|
| 1 | **Instant Hook** | 20% | Captures attention in 0-2 seconds |
| 2 | **High Relatability** | 20% | Viewer thinks "That happened to me" |
| 3 | **Cognitive Tension** | 20% | Creates curiosity or disagreement |
| 4 | **Clear Value** | 20% | Viewer gains insight, script, or framework |
| 5 | **Comment Trigger** | 20% | Creates discussion or engagement |

### Scoring

- **40-50/50**: ✅ Highly replicable blueprint
- **30-39/50**: ✅ Strong pattern
- **20-29/50**: ⚠️ Moderate
- **<20/50**: ❌ Weak pattern

---

## Edge Cases

### 1. Video Not Available
- **Problem:** Instagram URL expired or private
- **Solution:** Re-scrape the account to get fresh URLs

### 2. No Transcript Available
- **Problem:** Whisper fails or audio unclear
- **Solution:** Use caption as proxy (70% accuracy)

### 3. Very Short Video (<5 seconds)
- **Problem:** Not enough frames for analysis
- **Solution:** Analyze as single frame + caption

### 4. Very Long Video (>90 seconds)
- **Problem:** Higher transcription cost
- **Solution:** Warn user, proceed if confirmed

### 5. Non-English Content
- **Problem:** Analysis may miss nuances
- **Solution:** Specify language in transcript, translate key elements

### 6. Multiple People in Video
- **Problem:** Complex visual analysis
- **Solution:** Focus on main subject, note multiple speakers

### 7. Screen Recording vs Talking Head
- **Problem:** Different visual patterns
- **Solution:** Auto-detect and adjust analysis approach

### 8. API Rate Limits
- **Problem:** Too many requests
- **Solution:** Add delays between requests, batch processing

---

## Auto-Detection

The skill automatically detects video type based on:

| Indicator | Talking Head | Text Overlay |
|----------|--------------|--------------|
| Duration | >30s | <15s |
| Frame text changes | Few | Many |
| Audio | Speech-heavy | Music/sound |
| Caption | Long explanation | Short + "⬇️" |

You can override auto-detection with `--type` flag.

---

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `APIFY_API_TOKEN missing` | No token configured | Add to config/.env |
| `Video not found` | URL expired | Re-scrape account |
| `Transcript failed` | Audio unclear or Whisper error | Use caption instead |
| `Frame extraction failed` | ffmpeg issue | Check ffmpeg installation |
| `Vision analysis failed` | API error | Retry with fewer frames |

---

## Best Practices

### 1. Start with Scraping
```bash
# First, find good examples
node scripts/analyze.js --username connygfrerer --limit 20
```
Then pick the best performers for deep analysis.

### 2. Use Transcripts for Talking Heads
```bash
# Always get transcript for talking heads
node scripts/analyze.js --url "..." --full
```

### 3. Analyze Multiple Videos
Analyze at least 5-10 videos from an account to find patterns.

### 4. Compare High vs Low Performers
Look at both viral hits AND average videos to understand what makes the difference.

### 5. Save Results
All analysis is saved to `data/analysis/` - keep these for future reference.

---

## Files Structure

```
video-analyzer/
├── SKILL.md                  # This file
├── README.md                  # Quick start guide
├── scripts/
│   ├── analyze.js            # Main entry point
│   ├── scraper.js            # Apify integration
│   ├── downloader.js        # Video download
│   ├── audio-extractor.js    # Audio extraction
│   ├── transcribe.js         # Whisper transcription
│   ├── frame-extractor.js    # Smart frame extraction
│   ├── vision-analyzer.js    # Haiku analysis
│   ├── criteria-evaluator.js # Score against criteria
│   └── report-generator.js   # Create markdown report
├── config/
│   └── .env.example          # Template for keys
└── docs/
    ├── CRITERIA.md           # Detailed criteria explanation
    └── EXAMPLES.md           # Example analyses
```

---

## Troubleshooting

### "ffmpeg not found"
```bash
# Install ffmpeg
brew install ffmpeg
```

### "OPENAI_API_KEY invalid"
- Ensure you're using the full OpenAI key (starts with `sk-proj-`)
- OpenRouter keys don't work for Whisper

### "Apify scraper not working"
- Check your API token is correct
- Ensure account has credits
- Try re-scraping (URLs expire)

### "Vision analysis timing out"
- Reduce number of frames
- Check API key has credits

### "Transcript language wrong"
- Edit the transcript with correct language code
- Currently defaults to German for this skill

---

## Advanced Usage

### Batch Analysis
```bash
# Analyze multiple accounts
for user in connygfrerer eloisegagnon_strategist; do
  node scripts/analyze.js --username $user --limit 10
done
```

### Custom Frame Extraction
```bash
# Extract specific frames
node scripts/frame-extractor.js --video video.mp4 --seconds 0,5,10,15,30
```

### Generate Report Only
```bash
# From existing analysis
node scripts/report-generator.js --input data/analysis/2026-03-09/
```

---

## Integration with OpenClaw

This skill can be called from OpenClaw:
```
You: Analyze this reel: https://www.instagram.com/reel/XXXXX/
Bot: (runs analyze.js with --url flag)
```

---

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review the output logs
3. Verify API keys are correct
4. Check ffmpeg installation

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-03-09 | 1.0.0 | Initial release |

---

*Last updated: 2026-03-09*
