#!/usr/bin/env node
/**
 * Video Analyzer - Main Entry Point
 * 
 * Analyzes Instagram Reels to extract replicable patterns
 * 
 * Usage:
 *   node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/"
 *   node scripts/analyze.js --username connygfrerer --limit 10
 *   node scripts/analyze.js --video path/to/video.mp4 --full
 * 
 * Options:
 *   --url, -u          Instagram Reel URL
 *   --username, -n    Instagram username to scrape
 *   --video, -v       Local video file
 *   --limit, -l       Number of reels to analyze (default: 5)
 *   --type, -t        Video type: auto, talking-head, text-overlay (default: auto)
 *   --full            Include transcript (for talking heads)
 *   --output, -o     Output directory
 *   --help, -h        Show help
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load environment
const configPath = path.join(__dirname, '../config/.env');
if (fs.existsSync(configPath)) {
  require('dotenv').config({ path: configPath });
}

// Get API keys
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// Parse arguments
const args = process.argv.slice(2);

function getArg(name, short = null) {
  const idx = args.indexOf(`--${name}`);
  const idxShort = short ? args.indexOf(`-${short}`) : -1;
  const actualIdx = idx !== -1 ? idx : idxShort;
  return actualIdx !== -1 ? args[actualIdx + 1] : null;
}

function hasArg(name, short = null) {
  return args.includes(`--${name}`) || (short && args.includes(`-${short}`));
}

const url = getArg('url', 'u');
const username = getArg('username', 'n');
const videoPath = getArg('video', 'v');
const limit = parseInt(getArg('limit', 'l') || '5');
const typeArg = getArg('type', 't') || 'auto';
const fullAnalysis = hasArg('full', 'f');
const outputDir = getArg('output', 'o');
const showHelp = hasArg('help', 'h');

// Help
if (showHelp) {
  console.log(`
Video Analyzer - Analyze Instagram Reels

Usage:
  node scripts/analyze.js --url "URL"
  node scripts/analyze.js --username USERNAME --limit 10
  node scripts/analyze.js --video path/to/video.mp4 --full

Options:
  --url, -u          Instagram Reel URL
  --username, -n    Instagram username to scrape
  --video, -v       Local video file
  --limit, -l       Number of reels (default: 5)
  --type, -t        auto, talking-head, text-overlay (default: auto)
  --full            Include transcript
  --output, -o      Output directory
  --help, -h        Show this help

Examples:
  node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/"
  node scripts/analyze.js --username connygfrerer --limit 10
  node scripts/analyze.js --video video.mp4 --full

API Keys Required:
  APIFY_API_TOKEN - For scraping reels
  OPENAI_API_KEY  - For Whisper transcription
  OPENROUTER_API_KEY - For Vision analysis

See SKILL.md for full documentation.
  `);
  process.exit(0);
}

// Check required tools
function checkRequirements() {
  const errors = [];
  
  if (!APIFY_TOKEN) {
    errors.push('APIFY_API_TOKEN is required. Add to config/.env');
  }
  if (!OPENAI_KEY) {
    errors.push('OPENAI_API_KEY is required. Add to config/.env');
  }
  if (!OPENROUTER_KEY) {
    errors.push('OPENROUTER_API_KEY is required. Add to config/.env');
  }
  
  // Check ffmpeg
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    errors.push('ffmpeg is required. Install with: brew install ffmpeg');
  }
  
  if (errors.length > 0) {
    console.error('❌ Requirements check failed:\n');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
  
  console.log('✅ Requirements check passed\n');
}

// Create output directory
function createOutputDir(base = 'data/analysis') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = outputDir || path.join(__dirname, '..', base, timestamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Scrape reels from username
async function scrapeReels(user, limit) {
  console.log(`🔍 Scraping @${user}'s reels...`);
  
  const response = await fetch('https://api.apify.com/v2/acts/xMc5Ga1oCONPmWJIa/runs', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: [user],
      resultsLimit: limit,
      downloadVideos: false
    })
  });
  
  const run = await response.json();
  const datasetId = run.data.defaultDatasetId;
  
  // Wait for completion
  console.log('⏳ Waiting for scrape to complete...');
  let attempts = 0;
  while (attempts < 60) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(`https://api.apify.com/v2/acts/xMc5Ga1oCONPmWJIa/runs/${run.data.id}`, {
      headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` }
    });
    const statusData = await statusRes.json();
    if (statusData.data.status === 'SUCCEEDED') break;
    attempts++;
  }
  
  // Get results
  const resultsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items`, {
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` }
  });
  
  const reels = await resultsRes.json();
  
  // Sort by views
  const sorted = reels
    .filter(r => r.videoViewCount)
    .sort((a, b) => b.videoViewCount - a.videoViewCount);
  
  console.log(`✅ Found ${sorted.length} reels\n`);
  
  return sorted;
}

// Download video
async function downloadVideo(url, outputPath) {
  console.log(`📥 Downloading video...`);
  
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  
  console.log(`✅ Downloaded to ${outputPath}\n`);
}

// Extract audio
function extractAudio(videoPath, audioPath) {
  console.log('🎙️ Extracting audio...');
  
  try {
    execSync(`ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -ab 128k -ar 16000 "${audioPath}" 2>/dev/null`, {
      stdio: 'inherit'
    });
    console.log(`✅ Audio extracted to ${audioPath}\n`);
    return true;
  } catch (e) {
    console.error('❌ Audio extraction failed:', e.message);
    return false;
  }
}

// Transcribe audio
async function transcribeAudio(audioPath) {
  console.log('📝 Transcribing audio...');
  
  // This would call the transcribe.js script
  // For now, return placeholder
  console.log('⚠️ Transcript not implemented in main script\n');
  return null;
}

// Extract frames
function extractFrames(videoPath, framesDir) {
  console.log('📸 Extracting frames...');
  
  // Get duration
  const duration = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`, {
    encoding: 'utf8'
  }).trim());
  
  console.log(`   Video duration: ${duration}s`);
  
  // This calls smart-frame-extractor.js
  // For now, simplified extraction
  console.log('⚠️ Frame extraction simplified\n');
  
  return { duration, framesDir };
}

// Main analysis function
async function analyze() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║            VIDEO ANALYZER - v1.0.0                        ║
║            Analyze Instagram Reels                         ║
╚═══════════════════════════════════════════════════════════╝
  `);
  
  // Check requirements
  checkRequirements();
  
  // Create output directory
  const output = createOutputDir();
  console.log(`📁 Output: ${output}\n`);
  
  // Save metadata
  const metadata = {
    startedAt: new Date().toISOString(),
    arguments: {
      url, username, videoPath, limit, type: typeArg, full: fullAnalysis
    },
    apiKeys: {
      apify: APIFY_TOKEN ? '✓' : '✗',
      openai: OPENAI_KEY ? '✓' : '✗',
      openrouter: OPENROUTER_KEY ? '✓' : '✗'
    }
  };
  
  fs.writeFileSync(path.join(output, 'metadata.json'), JSON.stringify(metadata, null, 2));
  
  try {
    // Determine what to analyze
    if (url) {
      console.log('📌 Mode: URL analysis\n');
      // TODO: Implement URL analysis
      console.log('⚠️ URL analysis not fully implemented. Use --username instead.');
    }
    else if (username) {
      console.log('📌 Mode: Username analysis\n');
      
      // Scrape reels
      const reels = await scrapeReels(username, limit);
      
      // Save reel data
      fs.writeFileSync(path.join(output, 'reels.json'), JSON.stringify(reels, null, 2));
      
      // Analyze top performers
      console.log('🎯 Analyzing top performers...\n');
      
      for (let i = 0; i < Math.min(reels.length, 3); i++) {
        const reel = reels[i];
        console.log(`\n--- Analyzing ${i + 1}/${Math.min(reels.length, 3)}: ${reel.shortCode} ---`);
        console.log(`   Views: ${reel.videoViewCount?.toLocaleString()}`);
        console.log(`   Duration: ${reel.videoDuration}s`);
        
        // Determine type
        let videoType = typeArg;
        if (typeArg === 'auto') {
          if (reel.videoDuration > 25) {
            videoType = 'talking-head';
          } else {
            videoType = 'text-overlay';
          }
        }
        console.log(`   Type: ${videoType}`);
        
        // TODO: Full analysis
        console.log('   ⚠️ Full analysis not implemented in main script');
      }
    }
    else if (videoPath) {
      console.log('📌 Mode: Local video analysis\n');
      
      if (!fs.existsSync(videoPath)) {
        console.error(`❌ Video not found: ${videoPath}`);
        process.exit(1);
      }
      
      // Copy video to output
      const destVideo = path.join(output, 'video.mp4');
      fs.copyFileSync(videoPath, destVideo);
      
      // Extract audio if full analysis
      if (fullAnalysis) {
        const audioPath = path.join(output, 'audio.mp3');
        extractAudio(destVideo, audioPath);
        // TODO: Transcribe
      }
      
      // Extract frames
      const framesDir = path.join(output, 'frames');
      fs.mkdirSync(framesDir, { recursive: true });
      extractFrames(destVideo, framesDir);
      
      console.log('✅ Analysis complete!\n');
    }
    else {
      console.error('❌ Please provide --url, --username, or --video');
      console.log('   Run with --help for usage');
      process.exit(1);
    }
    
    // Summary
    console.log('═'.repeat(60));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Output directory: ${output}`);
    console.log(`
Next steps:
1. Review the output files
2. For full analysis, run individual scripts:
   - node scripts/transcribe.js (for talking heads)
   - node scripts/vision-analyzer.js (for frames)
   - node scripts/video-criteria-evaluator.js (for scoring)
`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
analyze();
