import type { ReactNode } from "react";

let _key = 0;
function nextKey() {
  _key += 1;
  return `md-${_key}`;
}

function fragment(nodes: ReactNode[]): ReactNode {
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0];
  return <>{nodes}</>;
}

/**
 * *italic* only (not **). Inner must not contain * or newline.
 */
function parseItalicSegments(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  const re = /\*([^*\n]+?)\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > i) {
      out.push(s.slice(i, m.index));
    }
    out.push(<em key={nextKey()}>{m[1].trim()}</em>);
    i = m.index + m[0].length;
  }
  if (i < s.length) {
    out.push(s.slice(i));
  }
  return out.length ? out : [s];
}

/**
 * **bold** with optional spaces around delimiters; multiline OK.
 * Inside bold, *italic* is still parsed.
 */
function parseBoldSegments(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  const re = /\*\*\s*([\s\S]+?)\s*\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > i) {
      out.push(...parseItalicSegments(s.slice(i, m.index)));
    }
    const inner = m[1].trim();
    out.push(<strong key={nextKey()}>{fragment(parseItalicSegments(inner))}</strong>);
    i = m.index + m[0].length;
  }
  const tail = i < s.length ? s.slice(i) : "";
  if (tail) {
    const openOnly = /^\*\*\s*([\s\S]+)$/.exec(tail);
    if (openOnly && !openOnly[1].includes("**")) {
      out.push(
        <strong key={nextKey()}>{fragment(parseItalicSegments(openOnly[1].trim()))}</strong>,
      );
    } else {
      out.push(...parseItalicSegments(tail));
    }
  }
  return out.length ? out : parseItalicSegments(s);
}

/**
 * Render **bold** and *italic*; tolerates spaces inside ** and unclosed opening **.
 */
export function inlineMd(text: string): ReactNode {
  if (!text) return null;
  const parts = parseBoldSegments(text.trim());
  return fragment(parts);
}
