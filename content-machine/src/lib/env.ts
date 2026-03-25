/**
 * FastAPI base URL.
 * - Server (RSC, `src/lib/api.ts`): absolute URL — those fetches do **not** appear in the
 *   browser Network tab (they run on the Next server).
 * - Browser (client components): same-origin `/api/backend/...` → `src/app/api/backend/[...path]/route.ts`
 *   proxies to FastAPI — **these** show in Network as `http://localhost:3000/api/backend/...`.
 */
export function getContentApiBase(): string {
  if (typeof window === "undefined") {
    return (
      process.env.CONTENT_API_URL ||
      process.env.NEXT_PUBLIC_CONTENT_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://127.0.0.1:8787"
    );
  }
  return "/api/backend";
}

