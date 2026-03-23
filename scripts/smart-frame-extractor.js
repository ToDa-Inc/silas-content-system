#!/usr/bin/env node
/**
 * Smart Frame Extractor
 * 
 * Extracts frames at 1-second intervals, detects text changes,
 * and keeps only unique frames for AI analysis.
 * 
 * Usage:
 *   node scripts/smart-frame-extractor.js --video path/to/video.mp4
 *   node scripts/smart-frame-extractor.js --video path/to/video.mp4 --output frames/
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);

function getArg(name, short = null) {
  const idx = args.indexOf(`--${name}`);
  const idxShort = short ? args.indexOf(`-${short}`) : -1;
  const actualIdx = idx !== -1 ? idx : idxShort;
  return actualIdx !== -1 ? args[actualIdx + 1] : null;
}

const videoPath = getArg('video', 'v');
const outputDir = getArg('output', 'o') || 'extracted_frames';
const niche = getArg('niche', 'n') || 'reel';

if (!videoPath) {
  console.log('Usage: node scripts/smart-frame-extractor.js --video <path> [--output <dir>]');
  console.log('Example: node scripts/smart-frame-extractor.js --video data/video.mp4 --output frames/');
  process.exit(1);
}

if (!fs.existsSync(videoPath)) {
  console.error(`❌ Video not found: ${videoPath}`);
  process.exit(1);
}

// Create output directory
const fullOutputDir = path.join(__dirname, '..', 'data', 'frames', outputDir);
fs.mkdirSync(fullOutputDir, { recursive: true });

console.log(`📹 Smart Frame Extractor`);
console.log(`   Input: ${videoPath}`);
console.log(`   Output: ${fullOutputDir}`);
console.log('---');

// Get video duration
function getDuration(video) {
  const output = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${video}"`, { encoding: 'utf8' });
  return parseFloat(output.trim());
}

// Extract frame at specific timestamp
function extractFrame(video, timestamp, outputPath) {
  const timeStr = timestamp < 10 ? `00:00:0${timestamp}` : `00:00:${timestamp}`;
  try {
    execSync(`ffmpeg -y -i "${video}" -ss ${timeStr} -vframes 1 -q:v 2 "${outputPath}" 2>/dev/null`, { encoding: 'utf8' });
    return fs.existsSync(outputPath);
  } catch (e) {
    return false;
  }
}

// Get file size as a simple proxy for frame difference
function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// Extract frames at 1-second intervals
const duration = getDuration(videoPath);
console.log(`⏱️ Video duration: ${duration} seconds`);

// Extract frames at 1-second intervals
const tempFrames = [];
console.log('📸 Extracting frames at 1-second intervals...');

for (let sec = 0; sec <= Math.floor(duration); sec++) {
  const framePath = path.join(fullOutputDir, `temp_${sec.toString().padStart(2, '0')}.jpg`);
  if (extractFrame(videoPath, sec, framePath)) {
    const size = getFileSize(framePath);
    tempFrames.push({ sec, path: framePath, size });
    console.log(`   ✅ sec ${sec}: ${size} bytes`);
  }
}

// Detect unique frames (text changes) based on file size differences
// We use a threshold - if size differs by more than X, it's likely a different scene
const SIZE_THRESHOLD = 3000; // bytes

console.log('\n🔍 Detecting text changes...');

const uniqueFrames = [];
let prevSize = null;

for (const frame of tempFrames) {
  if (prevSize === null) {
    // First frame - always keep
    uniqueFrames.push(frame);
    console.log(`   📌 sec ${frame.sec}: FIRST FRAME (keep)`);
  } else {
    const sizeDiff = Math.abs(frame.size - prevSize);
    if (sizeDiff > SIZE_THRESHOLD) {
      uniqueFrames.push(frame);
      console.log(`   🔄 sec ${frame.sec}: TEXT CHANGE detected (diff: ${sizeDiff} bytes)`);
    } else {
      // Remove duplicate frame to save space
      fs.unlinkSync(frame.path);
      console.log(`   ⏭️  sec ${frame.sec}: DUPLICATE (skipping)`);
    }
  }
  prevSize = frame.size;
}

// Rename unique frames to final names
console.log('\n📦 Finalizing unique frames...');
uniqueFrames.forEach((frame, index) => {
  const finalPath = path.join(fullOutputDir, `frame_${index.toString().padStart(2, '0')}.jpg`);
  fs.renameSync(frame.path, finalPath);
  console.log(`   ✅ frame_${index.toString().padStart(2, '0')}.jpg (sec ${frame.sec})`);
});

// Summary
console.log('\n📊 SUMMARY');
console.log(`   Total frames extracted: ${tempFrames.length}`);
console.log(`   Unique frames (text changes): ${uniqueFrames.length}`);
console.log(`   Duplicate frames removed: ${tempFrames.length - uniqueFrames.length}`);
console.log(`\n✅ Output: ${fullOutputDir}/`);
console.log('\nFiles:');
uniqueFrames.forEach((frame, index) => {
  console.log(`   frame_${index.toString().padStart(2, '0')}.jpg (from sec ${frame.sec})`);
});

// Save metadata
const metadata = {
  videoPath,
  duration,
  totalFramesExtracted: tempFrames.length,
  uniqueFrames: uniqueFrames.length,
  frames: uniqueFrames.map((f, i) => ({
    file: `frame_${i.toString().padStart(2, '0')}.jpg`,
    originalSecond: f.sec,
    fileSize: f.size
  })),
  extractedAt: new Date().toISOString()
};

fs.writeFileSync(
  path.join(fullOutputDir, 'metadata.json'),
  JSON.stringify(metadata, null, 2)
);

console.log(`\n💾 Metadata saved to: ${fullOutputDir}/metadata.json`);