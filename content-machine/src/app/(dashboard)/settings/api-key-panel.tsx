"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function ApiKeyPanel() {
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        if (!cancelled) setApiKey(null);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("api_key")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setApiKey(data?.api_key ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (apiKey === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading API key…
      </div>
    );
  }

  if (!apiKey) {
    return (
      <p className="text-sm text-amber-200/90">
        No <code className="rounded bg-zinc-900 px-1">api_key</code> on your profile yet. Add a{" "}
        <code className="rounded bg-zinc-900 px-1">text</code> column{" "}
        <code className="rounded bg-zinc-900 px-1">profiles.api_key</code> in Supabase if missing, then
        complete workspace setup once (onboarding assigns a key), or set a key manually on your{" "}
        <code className="rounded bg-zinc-900 px-1">profiles</code> row.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300 break-all">
        {apiKey}
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-900"
      >
        <Copy className="h-4 w-4" aria-hidden />
        {copied ? "Copied" : "Copy"}
      </button>
      <p className="text-xs text-zinc-500">
        Sent automatically as <code className="text-zinc-400">X-Api-Key</code> when you use the app
        while signed in. Treat it like a password; rotate by updating{" "}
        <code className="text-zinc-400">profiles.api_key</code> in Supabase if leaked.
      </p>
    </div>
  );
}
