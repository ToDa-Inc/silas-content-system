#!/usr/bin/env node
/**
 * Analyze a Reel by URL
 *
 * Reference script for the /reels/analyze-url endpoint.
 * Proves the full flow: Apify scrape → download video → Gemini 3 analysis → scored output.
 *
 * Usage:
 *   node scripts/analyze-reel-by-url.js --url https://www.instagram.com/p/ABC123/
 *
 * Requirements:
 *   APIFY_API_TOKEN and OPENROUTER_API_KEY in .env
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const REEL_ACTOR = 'xMc5Ga1oCONPmWJIa';
const GEMINI_MODEL = 'google/gemini-3-flash-preview';

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const reelUrl = urlIdx !== -1 ? args[urlIdx + 1] : null;

if (!reelUrl) {
  console.error('Usage: node scripts/analyze-reel-by-url.js --url <instagram_reel_url>');
  process.exit(1);
}

if (!APIFY_TOKEN || !OPENROUTER_KEY) {
  console.error('Missing APIFY_API_TOKEN or OPENROUTER_API_KEY in .env');
  process.exit(1);
}

// ─── Prompt ─────────────────────────────────────────────────────────────────
// Single source of truth for the analysis prompt.
// When changing this, bump PROMPT_VERSION below.

const PROMPT_VERSION = 'silas_v1_2026_03';

const ANALYSIS_PROMPT = `You are analyzing an Instagram Reel video for a content strategy system called Silas.

Watch the entire video carefully, including visual hooks, text overlays, pacing, and spoken content.

REEL INFO:
- Account: @{owner}
- Views: {views}
- Likes: {likes}
- Comments: {comments}
- Caption: {caption}

Score this reel on the 5 Silas criteria. Each score is 1–10.

---

1. INSTANT HOOK (0–2 seconds)
Does the reel capture attention within the first 2 seconds?
Look for: time-specific context ("Friday 5pm"), POV language ("your boss"), conflict words, visual surprise.
Score: X/10
Evidence: [what you saw in the first 2 seconds]

2. HIGH RELATABILITY
Does the viewer immediately think "that happened to me"?
Look for: universal workplace situation, concrete scenario (not abstract theory), emotional trigger.
Score: X/10
Evidence: [specific moment or phrase]

3. COGNITIVE TENSION
Does the reel create curiosity or disagreement?
Look for: wrong→right pattern, incomplete information (Zeigarnik), conflict or controversy.
Score: X/10
Evidence: [what creates the tension]

4. CLEAR VALUE
Does the viewer gain something tangible?
Look for: exact script or phrase to use, step-by-step framework, specific actionable insight.
Score: X/10
Evidence: [the value delivered]

5. COMMENT TRIGGER
Does the reel make the viewer want to comment or share?
Look for: direct question, controversial statement, "tag someone who...", strong validation.
Score: X/10
Evidence: [what triggers engagement]

---

TOTAL SCORE: X/50

RATING:
- 40–50 → Highly Replicable (blueprint found)
- 30–39 → Strong Pattern (adapt for niche)
- 20–29 → Moderate (analyze further)
- <20   → Weak (not a strong outlier)

---

CONTENT SUMMARY (2–3 sentences):
[What is this reel about and what makes it work or not work]

FORMAT:
- Type: [talking head / text overlay / skit / voiceover / other]
- Language: [language spoken/written]
- Duration feel: [snappy / medium / slow]
- Hook type: [POV / question / statement / visual / other]

REPLICABLE ELEMENTS:
- Hook pattern: [describe the hook structure]
- Value delivery: [how value is delivered]
- Format: [what format to replicate]

SUGGESTED ADAPTATION:
[One specific idea for how the creator could adapt this concept for their audience and niche]
`;

// ─── Step 1: Scrape reel via Apify ──────────────────────────────────────────

async function scrapeReel(url) {
  console.log('🔍 Step 1: Scraping reel metadata via Apify...');
  console.log(`   URL: ${url}`);

  const startRes = await fetch(`https://api.apify.com/v2/acts/${REEL_ACTOR}/runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${APIFY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: [url], resultsLimit: 1 }),
  });

  if (!startRes.ok) throw new Error(`Apify start failed: ${await startRes.text()}`);

  const run = await startRes.json();
  const runId = run.data.id;
  const datasetId = run.data.defaultDatasetId;

  console.log(`   Run ID: ${runId}`);

  // Poll for completion
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const statusRes = await fetch(`https://api.apify.com/v2/acts/${REEL_ACTOR}/runs/${runId}`, {
      headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
    });
    const status = (await statusRes.json()).data.status;
    console.log(`   Status: ${status}`);
    if (status === 'SUCCEEDED') break;
    if (status === 'FAILED' || status === 'ABORTED') throw new Error(`Apify run ${status}`);
  }

  const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items`, {
    headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
  });
  const items = await itemsRes.json();

  if (!items.length) throw new Error('No reel data returned from Apify');

  const reel = items[0];
  console.log(`   ✅ Got reel: @${reel.ownerUsername} | ${(reel.videoPlayCount || 0).toLocaleString()} views`);

  return reel;
}

// ─── Step 2: Download video ──────────────────────────────────────────────────

async function downloadVideo(videoUrl, outputPath) {
  console.log('\n📥 Step 2: Downloading video...');

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    const proto = videoUrl.startsWith('https') ? https : http;

    proto.get(videoUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        downloadVideo(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        const size = fs.statSync(outputPath).size;
        console.log(`   ✅ Downloaded: ${(size / 1024 / 1024).toFixed(1)}MB`);
        resolve(outputPath);
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// ─── Step 3: Analyze with Gemini ────────────────────────────────────────────

async function analyzeWithGemini(videoPath, reelMeta) {
  console.log('\n🤖 Step 3: Analyzing with Gemini 3 Flash Preview...');

  const fileSize = fs.statSync(videoPath).size;
  const fileSizeMB = fileSize / 1024 / 1024;

  const caption = (reelMeta.caption || '').substring(0, 500);
  const owner = reelMeta.ownerUsername || 'unknown';
  const views = (reelMeta.videoPlayCount || 0).toLocaleString();
  const likes = (reelMeta.likesCount || 0).toLocaleString();
  const comments = (reelMeta.commentsCount || 0).toLocaleString();

  const prompt = ANALYSIS_PROMPT
    .replace('{owner}', owner)
    .replace('{views}', views)
    .replace('{likes}', likes)
    .replace('{comments}', comments)
    .replace('{caption}', caption);

  let messages;

  if (fileSizeMB > 15) {
    // Video too large for base64 upload — text-only fallback
    console.log(`   ⚠️  Video is ${fileSizeMB.toFixed(1)}MB — falling back to caption-only analysis`);
    messages = [{
      role: 'user',
      content: prompt + '\n\nNOTE: Video file too large to upload. Analyze based on caption and metadata only. Note this limitation in your response.',
    }];
  } else {
    const videoB64 = fs.readFileSync(videoPath).toString('base64');
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:video/mp4;base64,${videoB64}` } },
      ],
    }];
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://silas-content-system.local',
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      messages,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini request failed: ${err}`);
  }

  const result = await res.json();
  const content = result.choices[0].message.content;

  // Parse total score from response
  const scoreMatch = content.match(/TOTAL\s+SCORE[:\s]+(\d+)\/50/i);
  const totalScore = scoreMatch ? parseInt(scoreMatch[1]) : null;

  console.log(`   ✅ Analysis complete${totalScore ? ` — Score: ${totalScore}/50` : ''}`);

  return { content, totalScore, promptVersion: PROMPT_VERSION, model: GEMINI_MODEL };
}

// ─── Step 4: Output result ───────────────────────────────────────────────────

function formatOutput(reelMeta, analysis) {
  const { content, totalScore, promptVersion, model } = analysis;

  const rating =
    totalScore >= 40 ? 'Highly Replicable ✅' :
    totalScore >= 30 ? 'Strong Pattern ✅' :
    totalScore >= 20 ? 'Moderate ⚠️' :
    totalScore !== null ? 'Weak ❌' : 'N/A';

  return {
    reel: {
      url: reelMeta.url,
      owner: reelMeta.ownerUsername,
      views: reelMeta.videoPlayCount || 0,
      likes: reelMeta.likesCount || 0,
      comments: reelMeta.commentsCount || 0,
      duration: reelMeta.videoDuration || 0,
      timestamp: reelMeta.timestamp,
    },
    analysis: {
      total_score: totalScore,
      rating,
      full_text: content,
      prompt_version: promptVersion,
      model,
      analyzed_at: new Date().toISOString(),
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎬 Silas — Analyze Reel by URL');
  console.log('='.repeat(50));

  const tmpVideo = path.join('/tmp', `silas-reel-${Date.now()}.mp4`);

  try {
    // Step 1: Scrape
    const reelMeta = await scrapeReel(reelUrl);

    if (!reelMeta.videoUrl) throw new Error('No videoUrl returned by Apify — reel may be private or deleted');

    // Step 2: Download
    await downloadVideo(reelMeta.videoUrl, tmpVideo);

    // Step 3: Analyze
    const analysis = await analyzeWithGemini(tmpVideo, reelMeta);

    // Step 4: Output
    const output = formatOutput(reelMeta, analysis);

    console.log('\n' + '='.repeat(50));
    console.log('📊 ANALYSIS RESULT');
    console.log('='.repeat(50));
    console.log(`Account:    @${output.reel.owner}`);
    console.log(`Views:      ${output.reel.views.toLocaleString()}`);
    console.log(`Score:      ${output.analysis.total_score}/50 — ${output.analysis.rating}`);
    console.log('='.repeat(50));
    console.log('\n' + output.analysis.full_text);

    // Save JSON output
    const outPath = path.join('/tmp', `silas-analysis-${output.reel.owner}-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\n💾 Full output saved: ${outPath}`);

  } finally {
    // Clean up temp video
    if (fs.existsSync(tmpVideo)) {
      fs.unlinkSync(tmpVideo);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
