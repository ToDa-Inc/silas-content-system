# Video Analyzer

**AI-powered Instagram Reel analysis tool to extract replicable patterns and viral success criteria.**

---

## Overview

Video Analyzer is a tool that analyzes Instagram Reels (both talking head and text-overlay formats) to understand:
- Why a video went viral
- What psychological triggers made it successful
- How to replicate the winning pattern
- Visual, audio, and structural elements

## Features

- 📊 **Automatic Video Type Detection** - Detects talking head vs text-overlay formats
- 🎬 **Smart Frame Extraction** - Extracts only frames where text changes
- 🎙️ **Whisper Transcription** - Transcribes audio for talking head analysis
- 👁️ **Vision AI Analysis** - Analyzes visuals using Claude Haiku 4.5
- 📈 **5-Criteria Evaluation** - Scores against proven outlier criteria
- 💰 **Cost Tracking** - Monitors API costs per analysis

## Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/video-analyzer.git
cd video-analyzer

# Install dependencies (if any)
npm install

# Configure API keys
cp config/.env.example config/.env
# Edit config/.env with your keys

# Analyze an account
node scripts/analyze.js --username connygfrerer --limit 10

# Analyze a specific video
node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/" --full
```

## Requirements

| Key | Where to Get | Purpose |
|-----|--------------|---------|
| `APIFY_API_TOKEN` | [apify.com](https://apify.com) | Scrape reels |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | Whisper transcription |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) | Vision analysis |

See [SKILL.md](SKILL.md) for full setup instructions.

## Cost

| Step | Cost |
|------|------|
| Scrape reels | $0.0026/reel |
| Transcribe | $0.006/min |
| Vision analysis | $0.0004/frame |

Total: ~$0.01 - $0.05 per video

## Documentation

- [SKILL.md](SKILL.md) - Full documentation
- [docs/CRITERIA.md](docs/CRITERIA.md) - Detailed criteria guide
- [docs/ANALYSIS_PIPELINE.md](docs/ANALYSIS_PIPELINE.md) - Workflows
- [docs/COMPLETE_PROJECT_PLAN.md](docs/COMPLETE_PROJECT_PLAN.md) - Project vision

## The 5 Outlier Criteria

Every video is evaluated against:

1. **Instant Hook** - Captures attention in 0-2 seconds
2. **High Relatability** - Viewer thinks "That happened to me"
3. **Cognitive Tension** - Creates curiosity or disagreement
4. **Clear Value** - Viewer gains insight, script, or framework
5. **Comment Trigger** - Creates discussion or engagement

## Video Types Supported

| Type | Duration | Analysis Approach |
|------|----------|-------------------|
| Text Overlay | 5-15s | Frames + Vision AI |
| Talking Head | 30-90s | Transcript + Frames + Vision |
| Hybrid | 15-60s | Both |

## Project Structure

```
video-analyzer/
├── SKILL.md                    # Full documentation
├── README.md                   # This file
├── LICENSE                     # MIT License
├── _meta.json                  # OpenClaw metadata
├── .gitignore                  # Git ignore rules
├── config/
│   └── .env.example            # API keys template
├── scripts/
│   ├── analyze.js              # Main entry point
│   ├── scraper.js              # Apify integration
│   ├── smart-frame-extractor.js
│   ├── vision-analyzer.js
│   ├── transcribe.js
│   └── video-criteria-evaluator.js
└── docs/
    ├── CRITERIA.md
    ├── ANALYSIS_PIPELINE.md
    ├── VIDEO_ANALYSIS_CRITERIA.md
    └── COMPLETE_PROJECT_PLAN.md
```

## Usage Examples

```bash
# Analyze by username (scrape + analyze top reels)
node scripts/analyze.js --username connygfrerer --limit 10

# Full analysis with transcript
node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/" --full

# Local video analysis
node scripts/analyze.js --video path/to/video.mp4 --full

# Specify video type
node scripts/analyze.js --username connygfrerer --type talking-head
```

## Related Projects

This tool was built for the Content System Silas project, designed to automate content creation for Instagram Reels.

See [docs/COMPLETE_PROJECT_PLAN.md](docs/COMPLETE_PROJECT_PLAN.md) for the full project vision.

## License

MIT License - see [LICENSE](LICENSE) file.

---

Built with OpenClaw, Apify, OpenAI Whisper, and Claude Haiku.