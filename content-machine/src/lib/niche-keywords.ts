/** Pull suggested topic-style strings from niche_config for Viral Discovery chips. */

export function topicKeywordSuggestionsFromNicheConfig(nicheConfig: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of nicheConfig) {
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    for (const key of ["topic_keywords", "topic_keywords_de"] as const) {
      const arr = o[key];
      if (!Array.isArray(arr)) continue;
      for (const x of arr) {
        const s = String(x).trim();
        if (s && !seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase());
          out.push(s);
        }
      }
    }
    for (const key of ["hashtags", "hashtags_de"] as const) {
      const arr = o[key];
      if (!Array.isArray(arr)) continue;
      for (const x of arr) {
        const s = String(x).trim().replace(/^#/, "");
        if (s && !seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase());
          out.push(s);
        }
      }
    }
  }
  return out.slice(0, 12);
}
