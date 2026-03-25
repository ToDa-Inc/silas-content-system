/**
 * FastAPI base URL.
 * - Server (RSC, route handlers): absolute URL to the Python API.
 * - Browser: same-origin prefix `/api/backend` so requests show in DevTools Network
 *   (rewritten in `next.config.ts` to `CONTENT_API_URL`).
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

