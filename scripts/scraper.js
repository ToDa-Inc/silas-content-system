#!/usr/bin/env node
/**
 * Phase 1: Reel Scraper - Find top-performing Reels from a niche using Apify
 * 
 * Usage: 
 *   node scripts/scraper.js --username connygfrerer
 *   node scripts/scraper.js --username "connygfrerer,eloisegagnon_strategist"
 * 
 * Options:
 *   --username, -u   : Scrape by username(s) (comma-separated)
 *   --url, -l        : Scrape by post/reel URL(s) (comma-separated)
 *   --limit, -n      : Max results per source (default: 20)
 *   --niche          : Niche name for output folder (optional)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

function getArg(name, short = null) {
  const idx = args.indexOf(`--${name}`);
  const idxShort = short ? args.indexOf(`-${short}`) : -1;
  const actualIdx = idx !== -1 ? idx : idxShort;
  return actualIdx !== -1 ? args[actualIdx + 1] : null;
}

// Parse inputs
const username = getArg('username', 'u');
const url = getArg('url', 'l');
const limit = parseInt(getArg('limit', 'n') || '20');
const nicheArg = getArg('niche');

// Determine what to scrape
const scrapeType = username ? 'username' : url ? 'url' : 'username';
const scrapeValue = username || url || 'connygfrerer';
const niche = nicheArg || (username ? username.split(',')[0].trim() : 'reels');

// Load config
const configPath = path.join(__dirname, '../config/.env');
require('dotenv').config({ path: configPath });

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;

if (!APIFY_TOKEN) {
  console.error('❌ Missing APIFY_API_TOKEN in config/.env');
  console.log('   Get your token at: https://console.apify.com/');
  process.exit(1);
}

// Output directory
const outputDir = path.join(__dirname, '../data/niches', niche);
fs.mkdirSync(outputDir, { recursive: true });

// Actor ID for Instagram Reel Scraper
const ACTOR_ID = 'xMc5Ga1oCONPmWJIa';

/**
 * Start Apify actor and wait for results
 */
async function runApifyActor(input) {
  console.log(`🚀 Starting Instagram Reel Scraper...`);
  console.log(`   Type: ${scrapeType}`);
  console.log(`   Value: ${scrapeValue}`);
  console.log(`   Limit: ${limit} per source`);
  console.log('---');

  // Start the actor using the correct API format
  const startResponse = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...input,
      resultsLimit: limit
    })
  });

  if (!startResponse.ok) {
    const error = await startResponse.text();
    throw new Error(`Failed to start actor: ${error}`);
  }

  const run = await startResponse.json();
  const runId = run.data.id;
  const datasetId = run.data.defaultDatasetId;
  
  console.log(`📋 Job started: ${runId}`);
  console.log(`📦 Dataset: ${datasetId}`);

  // Poll for completion
  console.log('⏳ Waiting for results...');
  
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max
  
  while (attempts < maxAttempts) {
    await sleep(5000); // Wait 5 seconds
    attempts++;
    
    const statusResponse = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` }
    });
    
    const statusData = await statusResponse.json();
    const status = statusData.data.status;
    
    if (status === 'SUCCEEDED') {
      console.log('✅ Scraping completed!');
      return datasetId;
    } else if (status === 'FAILED') {
      throw new Error('Scraping failed - check Apify console for details');
    } else if (status === 'ABORTED') {
      throw new Error('Scraping was aborted');
    }
    
    console.log(`   Status: ${status} (attempt ${attempts}/${maxAttempts})`);
  }
  
  throw new Error('Timeout waiting for scraping to complete');
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Filter and process Reels data
 */
function processReels(reels) {
  console.log(`📊 Processing ${reels.length} scraped items...`);
  
  // Filter to only include Reels with good engagement
  const processed = reels
    .filter(item => {
      // Only include Videos/Reels
      if (item.type !== 'Video' && item.type !== 'GraphVideo') return false;
      
      // Must have some engagement metrics
      const likes = item.likesCount || 0;
      return likes > 0;
    })
    .map(item => {
      const likes = item.likesCount || 0;
      const comments = item.commentsCount || 0;
      const views = item.videoViewCount || item.playsCount || 0;
      const saves = item.saveCount || 0;
      const shares = item.shareCount || 0;
      
      // Extract text from caption
      const caption = item.caption?.text || item.caption || '';
      const hashtags = item.hashtags || extractHashtags(caption);
      
      return {
        id: item.id,
        shortCode: item.shortCode,
        url: item.url,
        caption: caption,
        hashtags: hashtags,
        text: caption,
        owner: item.ownerUsername || item.owner?.username || '',
        timestamp: item.timestamp,
        views,
        likes,
        comments,
        saves,
        shares,
        engagement: calculateEngagement(views, likes, comments, saves, shares),
        isReel: true,
        isPinned: item.isPinned || false,
        duration: item.videoDuration || 0
      };
    })
    .sort((a, b) => b.engagement - a.engagement); // Sort by engagement

  console.log(`✅ Found ${processed.length} Reels with engagement`);
  
  // Get top performers (top 10 by engagement) - instead of just outliers
  const topPerformers = processed.slice(0, 10);
  
  console.log(`🎯 Top 10 performers identified`);
  
  return { all: processed, outliers: processed, topPerformers: processed.slice(0, 10) };
}

/**
 * Extract hashtags from text
 */
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  return matches || [];
}

/**
 * Calculate engagement score
 */
function calculateEngagement(views, likes, comments, saves, shares) {
  // Weighted engagement: likes (1x) + comments (5x) + saves (10x) + shares (20x)
  // Normalized by views
  if (views === 0) return 0;
  return ((likes * 1 + comments * 5 + saves * 10 + shares * 20) / views) * 100;
}

/**
 * Main scraper function
 */
async function scrape() {
  let input = {};
  
  switch (scrapeType) {
    case 'username':
      input = { username: scrapeValue.split(',').map(u => u.trim()) };
      break;
    case 'url':
      input = { urls: scrapeValue.split(',').map(l => l.trim()) };
      break;
    default:
      input = { username: [scrapeValue] };
  }
  
  // Run the scraper
  const datasetId = await runApifyActor(input);
  
  // Get the results from dataset
  console.log('📥 Fetching results...');
  const resultsResponse = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items`, {
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` }
  });
  
  const rawReels = await resultsResponse.json();
  
  // Process results
  const { all, outliers: _ignore, topPerformers } = processReels(rawReels);
  
  // Save results
  const timestamp = new Date().toISOString();
  const results = {
    niche,
    scrapeType,
    scrapeValue,
    scrapedAt: timestamp,
    totalScraped: rawReels.length,
    totalReels: all.length,
    topPerformers: topPerformers,
    summary: {
      avgViews: Math.round(all.reduce((sum, r) => sum + r.views, 0) / all.length) || 0,
      avgLikes: Math.round(all.reduce((sum, r) => sum + r.likes, 0) / all.length) || 0,
      topEngagement: all[0]?.engagement.toFixed(2) || 0
    }
  };
  
  // Save top performers (main output)
  const outPath = path.join(outputDir, 'outliers.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`💾 Saved top performers to: ${outPath}`);
  
  // Also save all scraped for reference
  const allPath = path.join(outputDir, 'all-scraped.json');
  fs.writeFileSync(allPath, JSON.stringify({ ...results, allReels: all }, null, 2));
  console.log(`💾 Saved all scraped to: ${allPath}`);
  
  // Show top 5
  console.log('\n🏆 Top 5 Reels:');
  topPerformers.slice(0, 5).forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.views.toLocaleString()} views | ${r.likes.toLocaleString()} likes | @${r.owner}`);
    console.log(`      ${r.caption?.substring(0, 80).replace(/\n/g, ' ')}...`);
  });
  
  console.log('\n✅ Scraping complete!');
  console.log(`   Output: ${outputDir}/outliers.json`);
}

scrape().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});