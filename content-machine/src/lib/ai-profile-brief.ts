/** Parse Silas analysis_brief prose into labeled blocks (• SECTION: body). */

export type AnalysisBriefBlock = { heading: string; body: string };

export function parseAnalysisBriefForDisplay(raw: string): AnalysisBriefBlock[] {
  const text = raw.trim();
  if (!text) return [];

  const chunks = text.split(/\n(?=•\s)/);
  const blocks: AnalysisBriefBlock[] = [];

  for (const chunk of chunks) {
    const c = chunk.trim();
    if (!c) continue;
    const withoutBullet = c.replace(/^•\s*/, "");
    const colon = withoutBullet.indexOf(":");
    if (colon > 0 && colon < 72) {
      const heading = withoutBullet.slice(0, colon).trim();
      const body = withoutBullet.slice(colon + 1).trim();
      if (heading.length >= 2 && /^[A-Z0-9]/.test(heading)) {
        blocks.push({ heading, body });
        continue;
      }
    }
    blocks.push({ heading: "", body: c });
  }

  const hasHeadings = blocks.some((b) => b.heading.length > 0);
  if (!hasHeadings) {
    return [{ heading: "", body: text }];
  }
  return blocks;
}

export function formatProfileCompiledRel(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const ms = Date.now() - d.getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 45) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 14) return `${day}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}
