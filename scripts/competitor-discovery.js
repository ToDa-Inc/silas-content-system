#!/usr/bin/env node
/**
 * Competitor Discovery — Find & validate real competitors via content analysis
 *
 * Three discovery modes:
 *   --keyword "workplace psychology"    Search Instagram for accounts by keyword
 *   --url "https://instagram.com/..."   Analyze a specific account URL
 *   --username "accountname"            Analyze by username directly
 *
 * Uses Gemini 2.5 Flash (via OpenRouter) to score content relevance against
 * the client's niche profile. Not hardcoded — reads client config dynamically.
 *
 * Usage:
 *   node scripts/competitor-discovery.js --client conny-gfrerer --keyword "toxic boss"
 *   node scripts/competitor-discovery.js --client conny-gfrerer --url "https://www.instagram.com/somecreator/"
 *   node scripts/competitor-discovery.js --client conny-gfrerer --username somecreator
 *   node scripts/competitor-discovery.js --client conny-gfrerer --keyword "workplace communication" --limit 10
 *
 * Options:
 *   --client, -c     Client config ID (required — loads from config/clients/)
 *   --keyword, -k    Search keyword to find accounts
 *   --url, -l        Instagram profile URL to analyze
 *   --username, -u   Instagram username to analyze
 *   --limit, -n      Max accounts to evaluate from keyword search (default: 15)
 *   --posts, -p      Number of recent posts to scrape per account (default: 8)
 *   --threshold, -t  Minimum relevance score to keep (default: 60)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load config
const configPath = path.join(__dirname, '../config/.env');
require('dotenv').config({ path: configPath });

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// Parse args
const args = process.argv.slice(2);

function getArg(name, short = null) {
  const idx = args.indexOf(`--${name}`);
  const idxShort = short ? args.indexOf(`-${short}`) : -1;
  const actualIdx = idx !== -1 ? idx : idxShort;
  return actualIdx !== -1 ? args[actualIdx + 1] : null;
}

const clientId = getArg('client', 'c');
const keyword = getArg('keyword', 'k');
const url = getArg('url', 'l');
const username = getArg('username', 'u');
const limit = parseInt(getArg('limit', 'n') || '15');
const postsPerAccount = parseInt(getArg('posts', 'p') || '8');
const threshold = parseInt(getArg('threshold', 't') || '60');

// Validate
if (!clientId) {
  console.error('Missing --client. Example: --client conny-gfrerer');
  process.exit(1);
}
if (!keyword && !url && !username) {
  console.error('Provide one of: --keyword, --url, or --username');
  process.exit(1);
}
if (!APIFY_TOKEN) {
  console.error('Missing APIFY_API_TOKEN in config/.env');
  process.exit(1);
}
if (!OPENROUTER_KEY) {
  console.error('Missing OPENROUTER_API_KEY in config/.env');
  process.exit(1);
}

// Load client config
const clientConfigPath = path.join(__dirname, '../config/clients', `${clientId}.json`);
if (!fs.existsSync(clientConfigPath)) {
  console.error(`Client config not found: ${clientConfigPath}`);
  console.error('Available clients:');
  const clients = fs.readdirSync(path.join(__dirname, '../config/clients'))
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
  clients.forEach(c => console.error(`  - ${c}`));
  process.exit(1);
}

const clientConfig = JSON.parse(fs.readFileSync(clientConfigPath, 'utf8'));

// Output directory
const outputDir = path.join(__dirname, '../data/niches', clientId, 'competitors');
fs.mkdirSync(outputDir, { recursive: true });

// ──────────────────────────────────────────────
// Apify helpers
// ──────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runApifyActor(actorId, input) {
  const res = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(input)
  });

  if (!res.ok) throw new Error(`Apify start failed: ${await res.text()}`);

  const run = await res.json();
  const runId = run.data.id;
  const datasetId = run.data.defaultDatasetId;

  // Poll for completion
  let attempts = 0;
  while (attempts < 60) {
    await sleep(5000);
    attempts++;
    const statusRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` }
    });
    const statusData = await statusRes.json();
    const status = statusData.data.status;

    if (status === 'SUCCEEDED') break;
    if (status === 'FAILED' || status === 'ABORTED') {
      throw new Error(`Apify run ${status}`);
    }
    if (attempts % 6 === 0) console.log(`  Waiting... (${attempts * 5}s)`);
  }

  // Fetch results
  const resultsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items`, {
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` }
  });
  return resultsRes.json();
}

// ──────────────────────────────────────────────
// Step 1: Discovery — find accounts
// ──────────────────────────────────────────────

async function discoverByKeyword(searchTerm, maxResults) {
  console.log(`\n[SEARCH] Searching Instagram for: "${searchTerm}"`);
  console.log(`  Max accounts to evaluate: ${maxResults}`);

  // Apify Instagram Search Scraper — searches users by keyword
  const SEARCH_ACTOR = 'DrF9mzPPEuVizVF4l';
  const results = await runApifyActor(SEARCH_ACTOR, {
    search: searchTerm,
    searchType: 'user',
    resultsLimit: maxResults * 2
  });

  // Extract accounts — this actor returns full profile data including latestPosts
  const accounts = results
    .filter(r => r.username && r.username !== clientConfig.instagram)
    .map(r => ({
      username: r.username,
      fullName: r.fullName || '',
      bio: r.biography || '',
      followers: r.followersCount || 0,
      isVerified: r.verified || false,
      isPrivate: r.private || false,
      profileUrl: `https://www.instagram.com/${r.username}/`,
      // The search actor sometimes returns latestPosts inline — cache them
      _latestPosts: r.latestPosts || []
    }))
    .filter(a => !a.isPrivate)
    .filter(a => a.followers >= 500 && a.followers <= 5000000)
    .slice(0, maxResults);

  console.log(`  Raw results: ${results.length}`);
  console.log(`  Accounts to evaluate: ${accounts.length}`);
  return accounts;
}

function accountFromUrl(profileUrl) {
  // Extract username from Instagram URL
  const match = profileUrl.match(/instagram\.com\/([^/?]+)/);
  if (!match) throw new Error(`Invalid Instagram URL: ${profileUrl}`);
  return match[1].replace(/\/$/, '');
}

function accountFromUsername(user) {
  return [{
    username: user,
    fullName: '',
    bio: '',
    followers: 0,
    isVerified: false,
    profileUrl: `https://www.instagram.com/${user}/`
  }];
}

// ──────────────────────────────────────────────
// Step 2: Scrape recent posts for each account
// ──────────────────────────────────────────────

async function scrapeAccountPosts(user, count, cachedPosts = []) {
  // If search actor already returned posts inline, use those (saves an Apify call)
  if (cachedPosts.length >= 3) {
    console.log(`  Using ${cachedPosts.length} cached posts for @${user}`);
    return cachedPosts.slice(0, count).map(r => ({
      caption: r.caption || '',
      views: r.videoViewCount || r.videoPlayCount || 0,
      likes: r.likesCount || 0,
      comments: r.commentsCount || 0,
      duration: r.videoDuration || 0,
      url: r.url || r.shortCode ? `https://www.instagram.com/p/${r.shortCode}/` : '',
      timestamp: r.timestamp || ''
    }));
  }

  console.log(`  Scraping @${user} (${count} recent posts)...`);

  const REEL_ACTOR = 'xMc5Ga1oCONPmWJIa';
  const results = await runApifyActor(REEL_ACTOR, {
    username: [user],
    resultsLimit: count
  });

  return results
    .filter(r => r.type === 'Video' || r.type === 'GraphVideo' || r.caption)
    .map(r => ({
      caption: r.caption?.text || r.caption || '',
      views: r.videoViewCount || r.playsCount || 0,
      likes: r.likesCount || 0,
      comments: r.commentsCount || 0,
      duration: r.videoDuration || 0,
      url: r.url || '',
      timestamp: r.timestamp || ''
    }));
}

// ──────────────────────────────────────────────
// Step 3: Relevance analysis via Gemini Flash
// ──────────────────────────────────────────────

function buildNicheProfile(config) {
  const niches = config.niches.map(n =>
    `- ${n.name}: ${n.description}\n  Key topics: ${n.content_angles.join(', ')}`
  ).join('\n');

  const icp = config.icp;

  return `CLIENT NICHE PROFILE:
Name: ${config.name}
Instagram: @${config.instagram}
Language: ${clientConfig.language === 'de' ? 'German' : clientConfig.language}

NICHES:
${niches}

TARGET AUDIENCE:
${icp.target}
Age: ${icp.age_range}
Pain points: ${icp.pain_points.join('; ')}
Desires: ${icp.desires.join('; ')}`;
}

function buildRelevancePrompt(nicheProfile, accountData, captions) {
  const captionBlock = captions.map((c, i) =>
    `POST ${i + 1}: "${c.caption.substring(0, 300)}"`
  ).join('\n');

  return `You are an Instagram content analyst. Your job is to determine if a discovered account is a GENUINE COMPETITOR — meaning they create similar content for a similar audience.

${nicheProfile}

---

DISCOVERED ACCOUNT:
Username: @${accountData.username}
${accountData.bio ? `Bio: "${accountData.bio}"` : ''}
${accountData.followers ? `Followers: ${accountData.followers.toLocaleString()}` : ''}

RECENT POST CAPTIONS:
${captionBlock}

---

ANALYSIS INSTRUCTIONS:
1. Read the captions carefully. Do they consistently cover the same topics as the client's niches?
2. Watch for FALSE POSITIVES:
   - Motivational quote accounts that occasionally mention "workplace" but aren't focused on it
   - Corporate brand accounts (not individual creators/educators)
   - Fitness/wellness coaches who sometimes mention "boundaries" but in a personal, not workplace context
   - Generic life coaches with broad advice that only tangentially overlaps
   - Accounts in the same language but different niche entirely
3. A real competitor should be an EDUCATOR or CONTENT CREATOR who regularly produces content about SIMILAR TOPICS for a SIMILAR AUDIENCE.
4. Language match matters: if the client creates content in ${clientConfig.language === 'de' ? 'German' : clientConfig.language}, accounts in the same language are more relevant (but English-language accounts in the same niche are still valuable competitors to track).

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no backticks):
{
  "relevance_score": <0-100>,
  "is_competitor": <true/false>,
  "confidence": "<high/medium/low>",
  "primary_topics": ["topic1", "topic2", "topic3"],
  "content_style": "<educator/motivational/brand/mixed/other>",
  "overlap_niches": ["niche_id_1"],
  "language": "<detected language>",
  "reasoning": "<2-3 sentences explaining why this is or isn't a competitor>"
}`;
}

async function analyzeRelevance(nicheProfile, accountData, captions) {
  const prompt = buildRelevancePrompt(nicheProfile, accountData, captions);

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0.1
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://silas-content-system.local',
        'X-Title': 'Silas Content System'
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
            return;
          }
          const content = json.choices[0].message.content;
          // Parse JSON from response (handle potential markdown wrapping)
          const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          resolve(JSON.parse(cleaned));
        } catch (e) {
          reject(new Error(`Failed to parse Gemini response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ──────────────────────────────────────────────
// Main pipeline
// ──────────────────────────────────────────────

async function discover() {
  const mode = keyword ? 'keyword' : url ? 'url' : 'username';

  console.log('='.repeat(60));
  console.log('COMPETITOR DISCOVERY');
  console.log('='.repeat(60));
  console.log(`Client: ${clientConfig.name} (@${clientConfig.instagram})`);
  console.log(`Mode: ${mode}`);
  console.log(`Input: ${keyword || url || username}`);
  console.log(`Relevance threshold: ${threshold}/100`);
  console.log('='.repeat(60));

  // Step 1: Get accounts to evaluate
  let accounts = [];

  if (keyword) {
    accounts = await discoverByKeyword(keyword, limit);
  } else if (url) {
    const user = accountFromUrl(url);
    accounts = accountFromUsername(user);
  } else {
    accounts = accountFromUsername(username);
  }

  if (accounts.length === 0) {
    console.log('\nNo accounts found. Try a different keyword.');
    return;
  }

  // Build niche profile from client config (scalable — not hardcoded)
  const nicheProfile = buildNicheProfile(clientConfig);

  // Step 2 + 3: For each account, scrape posts and analyze relevance
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log(`\n[${i + 1}/${accounts.length}] Evaluating @${account.username}...`);

    try {
      // Scrape recent posts
      const posts = await scrapeAccountPosts(account.username, postsPerAccount, account._latestPosts || []);

      if (posts.length < 2) {
        console.log(`  Skipped — not enough posts (${posts.length})`);
        continue;
      }

      // Compute engagement stats
      const totalViews = posts.reduce((s, p) => s + p.views, 0);
      const avgViews = Math.round(totalViews / posts.length);
      const avgLikes = Math.round(posts.reduce((s, p) => s + p.likes, 0) / posts.length);

      // Analyze content relevance via Gemini Flash
      const analysis = await analyzeRelevance(nicheProfile, account, posts);

      const result = {
        username: account.username,
        profileUrl: account.profileUrl,
        followers: account.followers,
        bio: account.bio,
        postsScraped: posts.length,
        avgViews,
        avgLikes,
        relevance: analysis
      };

      results.push(result);

      const status = analysis.relevance_score >= threshold ? 'MATCH' : 'SKIP';
      console.log(`  Score: ${analysis.relevance_score}/100 [${status}]`);
      console.log(`  Style: ${analysis.content_style} | Topics: ${analysis.primary_topics?.join(', ')}`);
      console.log(`  ${analysis.reasoning}`);

      // Rate limit between accounts
      await sleep(1000);

    } catch (err) {
      console.error(`  Error evaluating @${account.username}: ${err.message}`);
      results.push({
        username: account.username,
        profileUrl: account.profileUrl,
        error: err.message
      });
    }
  }

  // Step 4: Filter and rank
  const competitors = results
    .filter(r => r.relevance && r.relevance.relevance_score >= threshold)
    .sort((a, b) => b.relevance.relevance_score - a.relevance.relevance_score);

  const rejected = results
    .filter(r => r.relevance && r.relevance.relevance_score < threshold);

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const searchLabel = keyword || username || accountFromUrl(url);
  const outputFile = path.join(outputDir, `discovery-${searchLabel.replace(/\s+/g, '_')}-${timestamp}.json`);

  const output = {
    discoveredAt: new Date().toISOString(),
    client: clientId,
    mode,
    input: keyword || url || username,
    threshold,
    totalEvaluated: results.length,
    competitorsFound: competitors.length,
    competitors,
    rejected: rejected.map(r => ({
      username: r.username,
      score: r.relevance.relevance_score,
      reasoning: r.relevance.reasoning
    }))
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Evaluated: ${results.length} accounts`);
  console.log(`Competitors found: ${competitors.length}`);
  console.log(`Rejected: ${rejected.length}`);
  console.log('');

  if (competitors.length > 0) {
    console.log('VERIFIED COMPETITORS:');
    competitors.forEach((c, i) => {
      console.log(`  ${i + 1}. @${c.username} — score: ${c.relevance.relevance_score}/100`);
      console.log(`     ${c.followers?.toLocaleString()} followers | avg ${c.avgViews?.toLocaleString()} views`);
      console.log(`     Topics: ${c.relevance.primary_topics?.join(', ')}`);
      console.log(`     ${c.relevance.reasoning}`);
    });
  } else {
    console.log('No competitors found above threshold.');
    console.log('Try lowering --threshold or using different keywords.');
  }

  console.log(`\nSaved to: ${outputFile}`);
}

discover().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
