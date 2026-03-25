import { NextRequest, NextResponse } from "next/server";

/** Instagram / Meta CDNs only — do not open to arbitrary hosts. */
const ALLOWED_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

const MAX_URL_LEN = 8192;

function isAllowedThumbnailUrl(urlStr: string): boolean {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") {
    return false;
  }
  const h = u.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((s) => h === s.slice(1) || h.endsWith(s));
}

/**
 * Instagram CDN URLs are signed; trimming query params yields 403. Browsers sometimes fail
 * to load cross-origin IG assets; proxying through our origin with a normal fetch works.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return new NextResponse("Missing url", { status: 400 });
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return new NextResponse("Invalid url encoding", { status: 400 });
  }

  const trimmed = decoded.trim();
  if (!trimmed || trimmed.length > MAX_URL_LEN) {
    return new NextResponse("Invalid url", { status: 400 });
  }

  if (!isAllowedThumbnailUrl(trimmed)) {
    return new NextResponse("Host not allowed", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(trimmed, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.instagram.com/",
      },
      next: { revalidate: 86400 },
    });
  } catch {
    return new NextResponse("Fetch failed", { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse(`Upstream ${upstream.status}`, { status: 502 });
  }

  const ct = upstream.headers.get("content-type") || "image/jpeg";
  if (!ct.startsWith("image/")) {
    return new NextResponse("Not an image", { status: 502 });
  }

  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
