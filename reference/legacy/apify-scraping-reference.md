File: SCRAPER_REFERENCE.md

# Apify Instagram Reel Scraper - Technical Reference

**Last Updated:** 2026-03-06  
**Status:** ✅ Working  
**Used for:** Content System Silas (Phase 1)

---

## Overview

This document contains the technical details for scraping Instagram Reels using Apify's Instagram Reel Scraper actor.

---

## Actor Details

| Property | Value |
|----------|-------|
| **Name** | Instagram Reel Scraper |
| **Actor ID** | `xMc5Ga1oCONPmWJIa` |
| **Full ID** | `xMc5Ga1oCONPmWJIa` (not the store name!) |
| **Price** | $0.0026 per Reel |
| **Free Credits** | $5 on sign-up |

**Source:** https://apify.com/apify/instagram-reel-scraper

---

## API Endpoints

### Base URL
https://api.apify.com/v2


### Start Actor Run
POST https://api.apify.com/v2/acts/{ACTOR_ID}/runs


### Check Status
GET https://api.apify.com/v2/acts/{ACTOR_ID}/runs/{RUN_ID}


### Get Results
GET https://api.apify.com/v2/datasets/{DATASET_ID}/items


---

## Authentication

All requests require:
```http
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json
Token format: apify_api_XXXXXXXXXXXXXXXXXXXX

Request Format
✅ Correct Format
{
  "username": ["connygfrerer"],
  "resultsLimit": 20
}
❌ Common Mistakes
Wrong	Why
{ "usernames": ["user"] }	Field must be username, not usernames
{ "hashtags": ["workplace"] }	This actor only supports usernames, not hashtags
acts/apify~instagram-reel-scraper/run	Use the Actor ID, not the store name
Complete API Flow
Step 1: Start the Actor
const response = await fetch('https://api.apify.com/v2/acts/xMc5Ga1oCONPmWJIa/runs', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + APIFY_TOKEN,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    username: ['connygfrerer'],
    resultsLimit: 20
  })
});

const data = await response.json();
// Returns: { data: { id: "run_id", defaultDatasetId: "dataset_id", status: "READY" } }
Step 2: Poll for Completion
// Check every 5 seconds
const statusResponse = await fetch(
  'https://api.apify.com/v2/acts/xMc5Ga1oCONPmWJIa/runs/' + runId,
  { headers: { 'Authorization': 'Bearer ' + APIFY_TOKEN } }
);

const statusData = await statusResponse.json();
const status = statusData.data.status; // RUNNING → SUCCEEDED/FAILED
Status values:

READY - Started
RUNNING - In progress
SUCCEEDED - Completed (get results now)
FAILED - Check Apify console
ABORTED - Cancelled
Step 3: Fetch Results
const resultsResponse = await fetch(
  'https://api.apify.com/v2/datasets/' + datasetId + '/items',
  { headers: { 'Authorization': 'Bearer ' + APIFY_TOKEN } }
);

const reels = await resultsResponse.json();
// Returns: Array of Reel objects
Response Data Structure
Each scraped Reel contains:

{
  "id": "3845543307410335908",
  "type": "Video",
  "shortCode": "DVeHUN2kuik",
  "url": "https://www.instagram.com/p/DVeHUN2kuik/",
  "caption": "⚡High Performer sind nicht schwierig...",
  "hashtags": ["communication", "leadership"],
  "commentsCount": 73,
  "likesCount": 1056,
  "videoViewCount": 26081,
  "videoDuration": 58.12,
  "timestamp": "2026-03-04T17:15:00.000Z",
  "ownerUsername": "connygfrerer",
  "ownerFullName": "Conny (Cornelia) Gfrerer",
  "ownerId": "53529013745",
  "isPinned": false,
  "saveCount": 0,
  "shareCount": 0,
  "latestComments": [ /* array of comment objects */ ],
  "firstComment": "..."
}
Key Fields for Analysis
Field	Use
caption	Extract hooks, CTAs, hashtags
likesCount	Engagement metric
commentsCount	Engagement + comment triggers
videoViewCount	Reach metric
videoDuration	Format optimization
timestamp	Recency filter
isPinned	High-performing indicator
Data Processing
Engagement Score Formula
function calculateEngagement(views, likes, comments, saves, shares) {
  if (views === 0) return 0;
  // Weighted: likes (1x) + comments (5x) + saves (10x) + shares (20x)
  return ((likes * 1 + comments * 5 + saves * 10 + shares * 20) / views) * 100;
}
Hashtag Extraction
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  return matches || [];
}
Usage (Command Line)
# Scrape single account
node scripts/scraper.js --username connygfrerer

# Multiple accounts (comma-separated)
node scripts/scraper.js --username "eloisegagnon_strategist,corporateclarity.career"

# Custom limit
node scripts/scraper.js --username connygfrerer --limit 50

# Custom output folder name
node scripts/scraper.js --username connygfrerer --niche workplace
Output Files
content_system_silas/
└── data/
    └── niches/
        └── {username}/
            ├── outliers.json      # Top 10 by engagement + summary
            └── all-scraped.json   # All scraped Reels
outliers.json Structure
{
  "niche": "connygfrerer",
  "scrapeType": "username",
  "scrapeValue": "connygfrerer",
  "scrapedAt": "2026-03-06T09:08:55.489Z",
  "totalScraped": 20,
  "totalReels": 20,
  "topPerformers": [
    {
      "id": "...",
      "shortCode": "...",
      "url": "...",
      "caption": "...",
      "views": 26081,
      "likes": 1056,
      "comments": 73,
      "engagement": 5.44,
      "duration": 58.12,
      "timestamp": "..."
    },
    // ... more Reels
  ],
  "summary": {
    "avgViews": 152524,
    "avgLikes": 1817,
    "topEngagement": "7.14"
  }
}
Cost Estimation
Reels	Cost
10	$0.026
100	$0.26
1,000	$2.60
10,000	$26.00
With $5 free credit: ~1,900 Reels

Troubleshooting
Error: "Field input.username is required"
→ Use username (singular), not usernames

Error: "Field input.username must be array"
→ Pass ["user1", "user2"], not "user1,user2"

Error: "page-not-found"
→ Use Actor ID xMc5Ga1oCONPmWJIa, not the store name

Status stays "RUNNING" forever
→ Normal for first run. If >5 min, check Apify console for errors.

No results returned
→ Account might be private, or no Reels available

Notes
This actor scrapes public accounts only
Rate limiting: Don't scrape more than 100 Reels/minute
Results order: Most recent first
Video download available but costs extra ($0.02/MB)
Alternatives Considered
Actor	Price	Notes
Instagram Hashtag Scraper	$0.003	Only hashtags, no Reels
Instagram Post Scraper	$0.002	Older, less reliable
Bright Data	$0.02+	Enterprise, overkill
Winner: Instagram Reel Scraper (xMc5Ga1oCONPmWJIa)

Last updated: 2026-03-06 - Initial documentation