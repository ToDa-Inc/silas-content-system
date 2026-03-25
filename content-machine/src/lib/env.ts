/** FastAPI base URL — prefer `CONTENT_API_URL` / `NEXT_PUBLIC_CONTENT_API_URL` (see root `.env.example`). */
export function getContentApiBase(): string {
  if (typeof window === "undefined") {
    return (
      process.env.CONTENT_API_URL ||
      process.env.NEXT_PUBLIC_CONTENT_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://127.0.0.1:8787"
    );
  }
  return (
    process.env.NEXT_PUBLIC_CONTENT_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://127.0.0.1:8787"
  );
}

