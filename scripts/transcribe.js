#!/usr/bin/env node
/**
 * Audio Transcriber — Whisper API
 *
 * Usage:
 *   node scripts/transcribe.js path/to/audio.mp3
 *   node scripts/transcribe.js path/to/audio.mp3 --language en
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Load config
const configPath = path.join(__dirname, '../config/.env');
require('dotenv').config({ path: configPath });

if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in config/.env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const audioPath = process.argv[2];
const langIdx = process.argv.indexOf('--language');
const language = langIdx !== -1 ? process.argv[langIdx + 1] : 'de';

if (!audioPath) {
  console.log('Usage: node scripts/transcribe.js <audio-file> [--language de]');
  process.exit(1);
}

async function transcribe() {
  console.log(`Transcribing: ${audioPath}`);
  console.log(`Language: ${language}`);

  const transcript = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    language,
    response_format: 'text'
  });

  console.log('\nTRANSCRIPT:');
  console.log('='.repeat(50));
  console.log(transcript);
  console.log('='.repeat(50));

  const outputPath = audioPath.replace(/\.(mp3|wav|m4a)$/, '_transcript.txt');
  fs.writeFileSync(outputPath, transcript);
  console.log(`Saved to: ${outputPath}`);
}

transcribe().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
