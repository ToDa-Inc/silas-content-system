#!/usr/bin/env node
/**
 * Frame Vision Analyzer
 * 
 * Analyzes extracted frames using Claude Haiku 4.5 via OpenRouter
 * 
 * Usage:
 *   node scripts/vision-analyzer.js --frames data/frames/test_output/
 *   node scripts/vision-analyzer.js --frames data/frames/test_output/ --prompt "custom prompt"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);

function getArg(name, short = null) {
  const idx = args.indexOf(`--${name}`);
  const idxShort = short ? args.indexOf(`-${short}`) : -1;
  const actualIdx = idx !== -1 ? idx : idxShort;
  return actualIdx !== -1 ? args[actualIdx + 1] : null;
}

const framesDir = getArg('frames', 'f');
const customPrompt = getArg('prompt', 'p');
const outputFile = getArg('output', 'o');

if (!framesDir) {
  console.log('Usage: node scripts/vision-analyzer.js --frames <directory>');
  console.log('Example: node scripts/vision-analyzer.js --frames data/frames/test_output/');
  process.exit(1);
}

// Load config
const configPath = path.join(__dirname, '../config/.env');
require('dotenv').config({ path: configPath });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error('❌ Missing OPENROUTER_API_KEY in config/.env');
  process.exit(1);
}

// Default prompt for frame analysis
const DEFAULT_PROMPT = `Analyze this frame from an Instagram Reel. For each frame, identify:
1) Exact text overlays (verbatim, as shown)
2) What's the visual content? (person, product, B-roll, setting)
3) What's happening at this point in the video? (setup, problem, solution, CTA)
4) Color mood and style
5) Any changes from previous frame (if applicable)

Provide your answer in this format:
---
TEXT: [exact text visible in frame]
VISUAL: [description of what's shown]
SCENE: [what part of the story this is]
STYLE: [colors, mood, visual style]
---`;

// Make OpenRouter API call
function callOpenRouter(prompt, imageBase64 = null) {
  return new Promise((resolve, reject) => {
    const model = 'anthropic/claude-haiku-4.5';
    
    // If we have an image, we need to include it in the request
    let messages;
    if (imageBase64) {
      messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
            }
          ]
        }
      ];
    } else {
      messages = [{ role: 'user', content: prompt }];
    }

    const postData = JSON.stringify({
      model,
      messages,
      max_tokens: 1024
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://openclaw.dev',
        'X-Title': 'Content System Silas'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
          } else {
            resolve(json.choices[0].message.content);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Get all frame files from directory
function getFrameFiles(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.jpg') || f.endsWith('.png'))
    .filter(f => f !== 'metadata.json')
    .sort();
  return files.map(f => path.join(dir, f));
}

// Read image and convert to base64
function imageToBase64(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  return buffer.toString('base64');
}

// Main analysis function
async function analyzeFrames(framesPath, customPromptOverride = null) {
  const prompt = customPromptOverride || DEFAULT_PROMPT;
  const framesDirPath = path.join(__dirname, '..', framesPath);
  
  if (!fs.existsSync(framesDirPath)) {
    console.error(`❌ Frames directory not found: ${framesDirPath}`);
    process.exit(1);
  }
  
  const frameFiles = getFrameFiles(framesDirPath);
  
  if (frameFiles.length === 0) {
    console.error('❌ No frame files found in directory');
    process.exit(1);
  }
  
  console.log(`🖼️  Frame Vision Analyzer`);
  console.log(`   Frames dir: ${framesDirPath}`);
  console.log(`   Frames found: ${frameFiles.length}`);
  console.log('---');
  
  const results = {
    analyzedAt: new Date().toISOString(),
    frameCount: frameFiles.length,
    frames: []
  };
  
  // Analyze each frame
  for (let i = 0; i < frameFiles.length; i++) {
    const framePath = frameFiles[i];
    const frameName = path.basename(framePath);
    
    console.log(`📸 Analyzing frame ${i + 1}/${frameFiles.length}: ${frameName}...`);
    
    try {
      const base64 = imageToBase64(framePath);
      const analysis = await callOpenRouter(prompt, base64);
      
      results.frames.push({
        frameIndex: i,
        filename: frameName,
        analysis
      });
      
      console.log(`   ✅ Done (${(analysis.length / 1024).toFixed(1)}KB response)`);
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      results.frames.push({
        frameIndex: i,
        filename: frameName,
        error: error.message
      });
    }
  }
  
  // Save results
  const outputPath = outputFile 
    ? path.join(__dirname, '..', outputFile)
    : path.join(framesDirPath, 'vision_analysis.json');
  
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Analysis saved to: ${outputPath}`);
  
  // Summary
  console.log('\n📊 SUMMARY');
  console.log(`   Frames analyzed: ${results.frames.length}`);
  console.log(`   Successful: ${results.frames.filter(f => !f.error).length}`);
  console.log(`   Errors: ${results.frames.filter(f => f.error).length}`);
  
  return results;
}

// Run if called directly
if (require.main === module) {
  analyzeFrames(framesDir, customPrompt).catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

module.exports = { analyzeFrames };