import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-app-fg-subtle">404</p>
      <h1 className="mt-1 text-base font-semibold text-app-fg">Page not found</h1>
      <p className="mt-2 text-xs leading-relaxed text-app-fg-muted">
        This page doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950"
      >
        Go to dashboard
      </Link>
    </main>
  );
}
