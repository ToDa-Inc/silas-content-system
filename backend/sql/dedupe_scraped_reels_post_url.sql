-- Dedupe scraped_reels by canonical Instagram post URL (matches Python
-- services.instagram_post_url.canonical_instagram_post_url):
--   trim → strip ?query and #fragment → rstrip trailing '/'
--
-- Run in Supabase SQL Editor inside a transaction. Uncomment the preview
-- queries first if you want to inspect impact.
--
-- If `reel_snapshots` does not exist yet, comment out the reel_snapshots UPDATE.
--
-- 1) For each (client_id, canonical URL), keeps the row with the smallest id;
--    repoints reel_snapshots and reel_analyses from duplicate rows, then deletes duplicates.
-- 2) Normalizes post_url on all remaining rows (fixes lone trailing slash / query junk).

BEGIN;

-- Preview: non-canonical post_url values
-- SELECT id, client_id, post_url AS raw,
--   rtrim(split_part(split_part(trim(post_url), '?', 1), '#', 1), '/') AS canonical
-- FROM scraped_reels
-- WHERE post_url IS NOT NULL
--   AND post_url IS DISTINCT FROM
--       rtrim(split_part(split_part(trim(post_url), '?', 1), '#', 1), '/');

-- Preview: duplicate groups
-- WITH c AS (
--   SELECT id, client_id,
--     rtrim(split_part(split_part(trim(post_url), '?', 1), '#', 1), '/') AS u
--   FROM scraped_reels WHERE post_url IS NOT NULL
-- )
-- SELECT client_id, u, count(*) AS n, array_agg(id ORDER BY id) AS ids
-- FROM c GROUP BY client_id, u HAVING count(*) > 1;

CREATE TEMP TABLE _sr_canon ON COMMIT DROP AS
SELECT
  id,
  client_id,
  rtrim(split_part(split_part(trim(post_url), '?', 1), '#', 1), '/') AS u
FROM scraped_reels
WHERE post_url IS NOT NULL;

CREATE TEMP TABLE _sr_keeper ON COMMIT DROP AS
SELECT DISTINCT ON (client_id, u)
  id AS keeper_id,
  client_id,
  u
FROM _sr_canon
ORDER BY client_id, u, id;

CREATE TEMP TABLE _sr_losers ON COMMIT DROP AS
SELECT c.id AS loser_id, k.keeper_id
FROM _sr_canon c
JOIN _sr_keeper k ON k.client_id = c.client_id AND k.u = c.u
WHERE c.id <> k.keeper_id;

UPDATE reel_snapshots rs
SET reel_id = l.keeper_id
FROM _sr_losers l
WHERE rs.reel_id = l.loser_id;

UPDATE reel_analyses ra
SET reel_id = l.keeper_id
FROM _sr_losers l
WHERE ra.reel_id = l.loser_id;

DELETE FROM scraped_reels sr
USING _sr_losers l
WHERE sr.id = l.loser_id;

UPDATE scraped_reels
SET post_url = rtrim(split_part(split_part(trim(post_url), '?', 1), '#', 1), '/')
WHERE post_url IS NOT NULL
  AND post_url IS DISTINCT FROM
      rtrim(split_part(split_part(trim(post_url), '?', 1), '#', 1), '/');

COMMIT;
