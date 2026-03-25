"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { slugify } from "@/lib/slug";

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientSlug, setClientSlug] = useState("");
  const [instagram, setInstagram] = useState("");
  const [language, setLanguage] = useState<"de" | "en">("de");
  const [nicheSummary, setNicheSummary] = useState("");
  const [nicheKeywords, setNicheKeywords] = useState("");

  const orgSlugPreview = useMemo(() => slugify(orgSlug || orgName), [orgSlug, orgName]);
  const clientSlugPreview = useMemo(() => slugify(clientSlug || clientName), [clientSlug, clientName]);

  function nextFromStep1() {
    setError(null);
    if (!orgName.trim()) {
      setError("Organization name is required.");
      return;
    }
    setStep(2);
  }

  async function submit() {
    setError(null);
    if (!clientName.trim()) {
      setError("Creator / brand name is required.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_name: orgName.trim(),
          org_slug: orgSlug.trim() || undefined,
          client_name: clientName.trim(),
          client_slug: clientSlug.trim() || undefined,
          instagram_handle: instagram.trim() || undefined,
          language,
          niche_summary: nicheSummary.trim() || undefined,
          niche_keywords: nicheKeywords.trim() || undefined,
        }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-white/10 dark:bg-zinc-900">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        Step {step} of 2
      </p>
      <h1 className="mt-2 text-xl font-bold">
        {step === 1 ? "Your organization" : "First creator (client)"}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {step === 1
          ? "This is your workspace — team, billing, and data stay under this org."
          : "A client is one brand or creator you manage (Instagram, niche, competitors). You can add more later."}
      </p>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <div className="mt-8 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Organization name
            </span>
            <input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g. Prism Studio"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              URL slug (optional)
            </span>
            <input
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              placeholder="auto from name if empty"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="mt-1 block text-xs text-zinc-500">Will use: {orgSlugPreview || "—"}</span>
          </label>
          <button
            type="button"
            onClick={() => nextFromStep1()}
            className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-zinc-950"
          >
            Continue
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Creator / brand name
            </span>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Conny Gfrerer"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Creator URL slug (optional)
            </span>
            <input
              value={clientSlug}
              onChange={(e) => setClientSlug(e.target.value)}
              placeholder="auto from name"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="mt-1 block text-xs text-zinc-500">Will use: {clientSlugPreview || "—"}</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Instagram handle
            </span>
            <input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@username (no @ ok)"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Primary language
            </span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "de" | "en")}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Niche summary (optional)
            </span>
            <textarea
              value={nicheSummary}
              onChange={(e) => setNicheSummary(e.target.value)}
              placeholder="Who you help and what you talk about"
              rows={3}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Keywords (optional)
            </span>
            <input
              value={nicheKeywords}
              onChange={(e) => setNicheKeywords(e.target.value)}
              placeholder="comma-separated for discovery seeding"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 rounded-lg border border-zinc-300 py-2.5 text-sm font-semibold dark:border-zinc-600"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Finish
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
