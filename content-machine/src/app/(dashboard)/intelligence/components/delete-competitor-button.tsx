"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { clientApiHeaders, contentApiFetch, formatFastApiError, getContentApiBase } from "@/lib/api-client";

type Props = {
  clientSlug: string;
  orgSlug: string;
  competitorId: string;
  username: string;
  disabled?: boolean;
};

export function DeleteCompetitorButton({
  clientSlug,
  orgSlug,
  competitorId,
  username,
  disabled,
}: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) return;
    const ok = window.confirm(
      `Remove @${username} from competitors? Scraped reels for this account will be deleted from Intelligence.`,
    );
    if (!ok) return;

    setBusy(true);
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    try {
      const res = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/competitors/${encodeURIComponent(competitorId)}`,
        { method: "DELETE", headers },
      );
      const json = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) {
        show(formatFastApiError(json, "Could not remove competitor"), "error");
        return;
      }
      show(`Removed @${username}`, "success");
      router.refresh();
    } catch {
      show("Network error — try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={() => void run()}
      className="inline-flex items-center gap-1 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
      title={`Remove @${username} from competitors`}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Trash2 className="h-3 w-3" aria-hidden />}
      Remove
    </button>
  );
}
