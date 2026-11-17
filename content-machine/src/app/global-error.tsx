"use client";

import { useEffect } from "react";
import "./globals.css";

/** Last resort when the root layout itself fails — must render its own <html>/<body>. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-svh items-center justify-center bg-zinc-950 px-4 font-sans text-zinc-100 antialiased">
        <div className="max-w-md text-center">
          <h1 className="text-base font-semibold">Something went wrong</h1>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            The app hit an unexpected error. Reload to try again.
          </p>
          {error.digest ? (
            <p className="mt-2 text-[10px] tabular-nums text-zinc-500">Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
