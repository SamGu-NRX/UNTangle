import Link from "next/link";

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-[color:var(--ink)]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="surface-panel flex items-center justify-between gap-4 px-5 py-4 sm:px-7">
          <div>
            <Link
              href="/"
              className="font-display text-[2rem] font-bold leading-none tracking-[-0.07em] text-[color:var(--green-900)]"
            >
              UNTangle
            </Link>
            <p className="mt-1 text-xs uppercase tracking-[0.3em] text-[color:var(--muted)]">
              A calmer UNT planner
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/auth" className="secondary-button hidden sm:inline-flex">
              Sign in
            </Link>
            <Link href="/courses" className="secondary-button">
              Continue as guest
            </Link>
          </div>
        </header>

        <main className="flex-1 py-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
