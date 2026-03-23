#!/usr/bin/env node
/**
 * Competitor Evaluation System
 *
 * Takes discovery results + client baseline → produces a ranked, performance-aware
 * competitor list with actionable tiers.
 *
 * Flow:
 *   1. Scrape client's own reels to establish baseline metrics
 *   2. Load all discovery results from data/niches/{client}/competitors/
 *   3. For each discovered competitor, compute performance score
 *   4. Combine relevance (from Gemini) + performance → final composite score
 *   5. Classify into tiers: Blueprint / Strong / Peer / Irrelevant
 *   6. Output ranked list + save evaluation report
 *
 * Usage:
 *   node scripts/competitor-eval.js --client conny-gfrerer
 *   node scripts/competitor-eval.js --client conny-gfrerer --refresh-baseline
 *
 * Options:
 *   --client, -c            Client config ID (required)
 *   --refresh-baseline      Force re-scrape of client metrics (otherwise uses cache)
 *   --min-views, -v         Minimum avg views to be considered useful (default: auto from baseline)
 */

const fs = require('fs');
const path = require('path');

// Load config
const configPath = path.join(__dirname, '../config/.env');
require('dotenv').config({ path: configPath });

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;

const args = process.argv.slice(2);
function getArg(name, short = null) {
  const idx = args.indexOf(`--${name}`);
  const idxShort = short ? args.indexOf(`-${short}`) : -1;
  const actualIdx = idx !== -1 ? idx : idxShort;
  return actualIdx !== -1 ? args[actualIdx + 1] : null;
}
function hasArg(name) { return args.includes(`--${name}`); }

const clientId = getArg('client', 'c');
const refreshBaseline = hasArg('refresh-baseline');
const minViewsOverride = getArg('min-views', 'v');

if (!clientId) {
  console.error('Missing --client. Example: --client conny-gfrerer');
  process.exit(1);
}

// Paths
const clientConfigPath = path.join(__dirname, '../config/clients', `${clientId}.json`);
const competitorsDir = path.join(__dirname, '../data/niches', clientId, 'competitors');
const baselinePath = path.join(__dirname, '../data/niches', clientId, 'baseline.json');
const evalOutputDir = path.join(__dirname, '../data/niches', clientId, 'evaluations');

if (!fs.existsSync(clientConfigPath)) {
  console.error(`Client config not found: ${clientConfigPath}`);
  process.exit(1);
}

const clientConfig = JSON.parse(fs.readFileSync(clientConfigPath, 'utf8'));
fs.mkdirSync(evalOutputDir, { recursive: true });

// ──────────────────────────────────────────────
// Step 1: Client baseline
// ──────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrapeBaseline() {
  console.log(`[BASELINE] Scraping @${clientConfig.instagram} to establish metrics...`);

  const res = await fetch('https://api.apify.com/v2/acts/xMc5Ga1oCONPmWJIa/runs', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: [clientConfig.instagram], resultsLimit: 30 })
  });

  const run = await res.json();
  const runId = run.data.id;
  const datasetId = run.data.defaultDatasetId;

  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const s = await fetch(`https://api.apify.com/v2/acts/xMc5Ga1oCONPmWJIa/runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` }
    });
    const sd = await s.json();
    if (sd.data.status === 'SUCCEEDED') break;
    if (sd.data.status === 'FAILED' || sd.data.status === 'ABORTED') throw new Error('Baseline scrape failed');
    if (i % 6 === 0 && i > 0) console.log(`  Waiting... (${i * 5}s)`);
  }

  const r = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items`, {
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` }
  });
  const reels = await r.json();
  const videos = reels.filter(r => (r.type === 'Video' || r.type === 'GraphVideo') && (r.videoViewCount || 0) > 0);

  const views = videos.map(v => v.videoViewCount);
  const likes = videos.map(v => v.likesCount || 0);

  const avg = arr => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
  const median = arr => { const sorted = [...arr].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] || 0; };
  const percentile = (arr, p) => { const sorted = [...arr].sort((a, b) => a - b); return sorted[Math.floor(sorted.length * p)] || 0; };

  const baseline = {
    username: clientConfig.instagram,
    scrapedAt: new Date().toISOString(),
    reelsCount: videos.length,
    views: {
      avg: avg(views),
      median: median(views),
      p10: percentile(views, 0.1),
      p90: percentile(views, 0.9),
      min: Math.min(...views),
      max: Math.max(...views)
    },
    likes: {
      avg: avg(likes),
      median: median(likes)
    },
    // Thresholds derived from baseline
    thresholds: {
      // A competitor is "useful to study" if their avg views >= client's median
      // (median is more stable than mean — not skewed by one viral hit)
      minUsefulViews: median(views),
      // A competitor is a "blueprint" if their avg views >= client's p90
      blueprintViews: percentile(views, 0.9),
      // A competitor is a "peer" if their avg views >= client's p10
      peerViews: percentile(views, 0.1)
    }
  };

  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  console.log(`  Baseline saved: ${baselinePath}`);
  console.log(`  Reels: ${baseline.reelsCount} | Median views: ${baseline.views.median.toLocaleString()} | Avg: ${baseline.views.avg.toLocaleString()}`);
  console.log(`  Thresholds — Blueprint: ${baseline.thresholds.blueprintViews.toLocaleString()}+ | Useful: ${baseline.thresholds.minUsefulViews.toLocaleString()}+ | Peer: ${baseline.thresholds.peerViews.toLocaleString()}+`);

  return baseline;
}

async function getBaseline() {
  if (!refreshBaseline && fs.existsSync(baselinePath)) {
    const cached = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const age = Date.now() - new Date(cached.scrapedAt).getTime();
    const daysSinceRefresh = Math.floor(age / (1000 * 60 * 60 * 24));
    console.log(`[BASELINE] Using cached baseline (${daysSinceRefresh} days old)`);
    console.log(`  Median views: ${cached.views.median.toLocaleString()} | Avg: ${cached.views.avg.toLocaleString()}`);
    if (daysSinceRefresh > 7) {
      console.log(`  NOTE: Baseline is ${daysSinceRefresh} days old. Run with --refresh-baseline to update.`);
    }
    return cached;
  }
  return scrapeBaseline();
}

// ──────────────────────────────────────────────
// Step 2: Load all discovery results
// ──────────────────────────────────────────────

function loadDiscoveryResults() {
  if (!fs.existsSync(competitorsDir)) {
    console.error(`No discovery results found at ${competitorsDir}`);
    console.error('Run competitor-discovery.js first.');
    process.exit(1);
  }

  const files = fs.readdirSync(competitorsDir).filter(f => f.endsWith('.json'));
  const allCompetitors = new Map();

  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(competitorsDir, f), 'utf8'));
    for (const c of data.competitors || []) {
      // Deduplicate — keep highest relevance score
      const existing = allCompetitors.get(c.username);
      if (!existing || c.relevance.relevance_score > existing.relevance.relevance_score) {
        allCompetitors.set(c.username, c);
      }
    }
  }

  console.log(`[DISCOVERY] Loaded ${allCompetitors.size} unique competitors from ${files.length} discovery files`);
  return Array.from(allCompetitors.values());
}

// ──────────────────────────────────────────────
// Step 3: Score and classify
// ──────────────────────────────────────────────

function evaluateCompetitor(competitor, baseline) {
  const relevanceScore = competitor.relevance?.relevance_score || 0;
  const avgViews = competitor.avgViews || 0;
  const avgLikes = competitor.avgLikes || 0;
  const contentStyle = competitor.relevance?.content_style || 'unknown';
  const language = competitor.relevance?.language || 'unknown';

  const minViews = minViewsOverride ? parseInt(minViewsOverride) : baseline.thresholds.minUsefulViews;

  // Performance score (0-100): how well does this account perform relative to client?
  let performanceScore = 0;
  if (avgViews >= baseline.thresholds.blueprintViews) {
    performanceScore = 100; // Outperforms client significantly
  } else if (avgViews >= baseline.thresholds.minUsefulViews) {
    performanceScore = 75; // Comparable to client
  } else if (avgViews >= baseline.thresholds.peerViews) {
    performanceScore = 40; // Smaller but active
  } else if (avgViews >= 1000) {
    performanceScore = 20; // Too small to learn from
  } else {
    performanceScore = 5; // Irrelevant
  }

  // Language bonus: same language = direct market competitor (more valuable)
  const languageBonus = language?.toLowerCase() === (baseline.username === 'connygfrerer' ? 'german' : 'english') ? 10 : 0;

  // Composite score: 50% relevance + 40% performance + 10% language
  const compositeScore = Math.round(
    (relevanceScore * 0.50) +
    (performanceScore * 0.40) +
    (languageBonus * 1.0) // 0 or 10 bonus points
  );

  // Tier classification
  let tier, tierLabel;
  if (compositeScore >= 80 && avgViews >= minViews) {
    tier = 1;
    tierLabel = 'BLUEPRINT — Study their viral patterns, replicate hooks and formats';
  } else if (compositeScore >= 60 && avgViews >= baseline.thresholds.peerViews) {
    tier = 2;
    tierLabel = 'STRONG — Worth tracking, good content angles to adapt';
  } else if (relevanceScore >= 60 && avgViews >= 1000) {
    tier = 3;
    tierLabel = 'PEER — Similar niche, smaller scale. Watch for breakout content';
  } else {
    tier = 4;
    tierLabel = 'SKIP — Too small or too different to learn from';
  }

  return {
    username: competitor.username,
    profileUrl: competitor.profileUrl,
    followers: competitor.followers,
    avgViews,
    avgLikes,
    language,
    contentStyle,
    topics: competitor.relevance?.primary_topics || [],
    reasoning: competitor.relevance?.reasoning || '',
    scores: {
      relevance: relevanceScore,
      performance: performanceScore,
      languageBonus,
      composite: compositeScore
    },
    tier,
    tierLabel
  };
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function evaluate() {
  console.log('='.repeat(60));
  console.log('COMPETITOR EVALUATION');
  console.log('='.repeat(60));
  console.log(`Client: ${clientConfig.name} (@${clientConfig.instagram})`);
  console.log('='.repeat(60));

  // Step 1: Baseline
  const baseline = await getBaseline();

  // Step 2: Load discoveries
  const competitors = loadDiscoveryResults();

  if (competitors.length === 0) {
    console.log('\nNo competitors to evaluate. Run competitor-discovery.js first.');
    return;
  }

  // Step 3: Evaluate each
  console.log(`\n[EVAL] Evaluating ${competitors.length} competitors against baseline...`);
  const evaluated = competitors.map(c => evaluateCompetitor(c, baseline));
  evaluated.sort((a, b) => b.scores.composite - a.scores.composite);

  // Group by tier
  const tiers = {
    1: evaluated.filter(e => e.tier === 1),
    2: evaluated.filter(e => e.tier === 2),
    3: evaluated.filter(e => e.tier === 3),
    4: evaluated.filter(e => e.tier === 4)
  };

  // Output
  console.log('\n' + '='.repeat(60));
  console.log('EVALUATION RESULTS');
  console.log('='.repeat(60));
  console.log(`\nClient baseline: @${baseline.username}`);
  console.log(`  Median views: ${baseline.views.median.toLocaleString()} | Avg: ${baseline.views.avg.toLocaleString()} | Max: ${baseline.views.max.toLocaleString()}`);
  console.log(`  Blueprint threshold: ${baseline.thresholds.blueprintViews.toLocaleString()}+ avg views`);
  console.log(`  Useful threshold: ${baseline.thresholds.minUsefulViews.toLocaleString()}+ avg views`);

  const tierNames = {
    1: 'BLUEPRINT — Study these accounts',
    2: 'STRONG — Track and adapt',
    3: 'PEER — Watch for breakouts',
    4: 'SKIP — Not useful for pattern extraction'
  };

  for (const [t, list] of Object.entries(tiers)) {
    if (list.length === 0) continue;
    console.log(`\n--- TIER ${t}: ${tierNames[t]} (${list.length}) ---`);
    list.forEach((c, i) => {
      console.log(`  ${i + 1}. @${c.username} — composite: ${c.scores.composite}/100 [R:${c.scores.relevance} P:${c.scores.performance} L:+${c.scores.languageBonus}]`);
      console.log(`     ${c.avgViews.toLocaleString()} avg views | ${(c.followers || 0).toLocaleString()} followers | ${c.language} | ${c.contentStyle}`);
      console.log(`     Topics: ${c.topics.join(', ')}`);
    });
  }

  // Summary stats
  const actionable = evaluated.filter(e => e.tier <= 2);
  console.log(`\nSUMMARY: ${actionable.length} actionable competitors out of ${evaluated.length} total`);

  // Save evaluation
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = {
    evaluatedAt: new Date().toISOString(),
    client: clientId,
    baseline: {
      username: baseline.username,
      medianViews: baseline.views.median,
      avgViews: baseline.views.avg,
      maxViews: baseline.views.max,
      thresholds: baseline.thresholds
    },
    totalEvaluated: evaluated.length,
    tierCounts: { blueprint: tiers[1].length, strong: tiers[2].length, peer: tiers[3].length, skip: tiers[4].length },
    competitors: evaluated
  };

  const reportPath = path.join(evalOutputDir, `eval-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  // Also save a clean "current competitors" file (latest eval, actionable only)
  const currentPath = path.join(__dirname, '../data/niches', clientId, 'current-competitors.json');
  fs.writeFileSync(currentPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    client: clientId,
    baseline: report.baseline,
    blueprints: tiers[1],
    strong: tiers[2],
    peers: tiers[3]
  }, null, 2));
  console.log(`Current competitors: ${currentPath}`);
}

evaluate().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
