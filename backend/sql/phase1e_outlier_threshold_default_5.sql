-- Breakout rule: reel metric must be >= this multiple of the competitor's average (per views/likes/comments).
-- Align DB default and legacy 10× rows with app default 5×.

ALTER TABLE clients
  ALTER COLUMN outlier_ratio_threshold SET DEFAULT 5.0;

UPDATE clients
SET outlier_ratio_threshold = 5.0
WHERE outlier_ratio_threshold IS NULL
   OR outlier_ratio_threshold = 10.0;
