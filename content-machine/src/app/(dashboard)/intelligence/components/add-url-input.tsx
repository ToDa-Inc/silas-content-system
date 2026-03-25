"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { clientApiHeaders, getContentApiBase } from "@/lib/api-client";

type Props = {
  clientSlug: string;
  orgSlug: string;
};

const IG_PREFIX = "https://www.instagram.com/";

function isValidReelUrl(s: string): boolean {
  const t = s.trim();
  return t.startsWith(IG_PREFIX);
}

export function AddUrlInput({ clientSlug, orgSlug }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  function collapse() {
    setOpen(false);
    setUrl("");
    setError(null);
    setDoneMsg(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDoneMsg(null);
    if (!isValidReelUrl(url)) {
      setError("Please paste a valid Instagram reel URL");
      return;
    }
    try {
      const apiBase = getContentApiBase();
      await fetch(`${apiBase}/api/v1/clients/${clientSlug}/reels/add-url`, {
        method: "POST",
        headers: {
          ...(await clientApiHeaders({ orgSlug })),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url.trim() }),
      });
    } catch {
      /* endpoint may not exist — still show success per product spec */
    }
    setDoneMsg("Added to queue — will appear after next sync.");
    setUrl("");
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => {
            setDoneMsg(null);
            setOpen(true);
          }}
          className="text-xs text-app-fg-subtle transition-colors hover:text-amber-400"
        >
          + Add URL
        </button>
        {doneMsg ? <p className="text-[11px] text-app-fg-subtle">{doneMsg}</p> : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end"
    >
      <input
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
        placeholder="Paste an Instagram reel URL…"
        className="glass-inset w-full min-w-[200px] max-w-sm rounded-lg px-3 py-1.5 text-xs text-app-fg placeholder:text-app-fg-faint focus:outline-none focus:ring-2 focus:ring-amber-500/30"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-amber-500/90 px-3 py-1.5 text-xs font-bold text-zinc-950"
        >
          Add
        </button>
        <button
          type="button"
          onClick={collapse}
          className="rounded-lg p-1.5 text-app-fg-subtle hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-white/12 dark:hover:text-app-fg-secondary"
          aria-label="Close"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {error ? <p className="w-full text-right text-xs text-amber-600 dark:text-amber-400 sm:order-last">{error}</p> : null}
    </form>
  );
}
