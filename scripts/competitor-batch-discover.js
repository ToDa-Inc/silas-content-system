#!/usr/bin/env node
/**
 * Batch Competitor Discovery — runs multiple keyword searches in sequence
 *
 * Usage:
 *   node scripts/competitor-batch-discover.js --client conny-gfrerer --keywords "term1" "term2" "term3"
 *   node scripts/competitor-batch-discover.js --client conny-gfrerer --lang de     # runs all German keywords from config
 *   node scripts/competitor-batch-discover.js --client conny-gfrerer --lang en     # runs all English keywords from config
 *   node scripts/competitor-batch-discover.js --client conny-gfrerer --lang all    # runs all keywords
 *
 * Options:
 *   --client, -c       Client config ID (required)
 *   --keywords         Space-separated keywords to search
 *   --lang             Pull keywords from config: "de", "en", or "all"
 *   --limit, -n        Max accounts per keyword (default: 15)
 *   --threshold, -t    Min relevance score (default: 60)
 *   --eval             Run competitor-eval.js after all searches complete
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name, short = null) {
  const idx = args.indexOf(`--${name}`);
  const idxShort = short ? args.indexOf(`-${short}`) : -1;
  const actualIdx = idx !== -1 ? idx : idxShort;
  return actualIdx !== -1 ? args[actualIdx + 1] : null;
}
function hasArg(name) { return args.includes(`--${name}`); }

// Collect all keyword args (supports multiple)
function getAllKeywordArgs() {
  const keywords = [];
  let idx = args.indexOf('--keywords');
  if (idx === -1) return keywords;
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    keywords.push(args[i]);
  }
  return keywords;
}

const clientId = getArg('client', 'c');
const lang = getArg('lang');
const manualKeywords = getAllKeywordArgs();
const limit = getArg('limit', 'n') || '15';
const threshold = getArg('threshold', 't') || '60';
const runEval = hasArg('eval');

if (!clientId) {
  console.error('Missing --client. Example: --client conny-gfrerer');
  process.exit(1);
}

// Load client config
const configPath = path.join(__dirname, '../config/clients', `${clientId}.json`);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Build keyword list
let keywords = [];

if (manualKeywords.length > 0) {
  keywords = manualKeywords;
} else if (lang) {
  for (const niche of config.niches) {
    if (lang === 'de' || lang === 'all') {
      keywords.push(...(niche.keywords_de || []));
    }
    if (lang === 'en' || lang === 'all') {
      keywords.push(...(niche.keywords || []));
    }
  }
  // Deduplicate
  keywords = [...new Set(keywords)];
} else {
  console.error('Provide --keywords or --lang (de/en/all)');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('BATCH COMPETITOR DISCOVERY');
console.log('='.repeat(60));
console.log(`Client: ${config.name} (@${config.instagram})`);
console.log(`Keywords to search: ${keywords.length}`);
keywords.forEach((k, i) => console.log(`  ${i + 1}. "${k}"`));
console.log(`Limit per keyword: ${limit} | Threshold: ${threshold}`);
console.log('='.repeat(60));

// Run each keyword search
const scriptPath = path.join(__dirname, 'competitor-discovery.js');
const results = { succeeded: [], failed: [], skipped: [] };

for (let i = 0; i < keywords.length; i++) {
  const kw = keywords[i];
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${i + 1}/${keywords.length}] Searching: "${kw}"`);
  console.log('─'.repeat(60));

  try {
    const cmd = `node "${scriptPath}" --client ${clientId} --keyword "${kw}" --limit ${limit} --threshold ${threshold}`;
    const output = execSync(cmd, {
      cwd: path.join(__dirname, '..'),
      timeout: 300000,  // 5 min per keyword
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8'
    });

    // Extract key stats from output
    const matchCount = (output.match(/\[MATCH\]/g) || []).length;
    const evaluated = output.match(/Evaluated: (\d+)/)?.[1] || '?';
    const found = output.match(/Competitors found: (\d+)/)?.[1] || '?';

    console.log(`  Result: ${found} competitors from ${evaluated} evaluated`);
    results.succeeded.push({ keyword: kw, found: parseInt(found) || 0, evaluated: parseInt(evaluated) || 0 });

  } catch (err) {
    const stderr = err.stderr || err.message;
    if (stderr.includes('No accounts found')) {
      console.log(`  No accounts found for this keyword`);
      results.skipped.push({ keyword: kw, reason: 'no results' });
    } else {
      console.error(`  FAILED: ${stderr.substring(0, 200)}`);
      results.failed.push({ keyword: kw, error: stderr.substring(0, 200) });
    }
  }

  // Brief pause between searches to avoid rate limits
  if (i < keywords.length - 1) {
    console.log('  Pausing 3s before next search...');
    execSync('sleep 3');
  }
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('BATCH SUMMARY');
console.log('='.repeat(60));
console.log(`Total keywords: ${keywords.length}`);
console.log(`Succeeded: ${results.succeeded.length}`);
console.log(`Skipped (no results): ${results.skipped.length}`);
console.log(`Failed: ${results.failed.length}`);

const totalFound = results.succeeded.reduce((s, r) => s + r.found, 0);
const totalEval = results.succeeded.reduce((s, r) => s + r.evaluated, 0);
console.log(`Total evaluated: ${totalEval} | Total competitors found: ${totalFound}`);

if (results.succeeded.length > 0) {
  console.log('\nBest keywords:');
  results.succeeded
    .sort((a, b) => b.found - a.found)
    .slice(0, 5)
    .forEach(r => console.log(`  "${r.keyword}" → ${r.found}/${r.evaluated} competitors`));
}

if (results.skipped.length > 0) {
  console.log('\nKeywords with no results:');
  results.skipped.forEach(r => console.log(`  "${r.keyword}"`));
}

// Run eval if requested
if (runEval) {
  console.log('\n' + '─'.repeat(60));
  console.log('Running competitor evaluation...');
  console.log('─'.repeat(60));
  try {
    const evalOutput = execSync(`node "${path.join(__dirname, 'competitor-eval.js')}" --client ${clientId}`, {
      cwd: path.join(__dirname, '..'),
      timeout: 300000,
      stdio: 'inherit'
    });
  } catch (err) {
    console.error('Eval failed:', err.message);
  }
}
