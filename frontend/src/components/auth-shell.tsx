import Link from "next/link";

export function AuthShell({
  eyebrow,
  title,
  description,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen text-[color:var(--ink)]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <Link
              href="/"
              className="font-display text-[2rem] font-bold tracking-[-0.07em] text-[color:var(--green-900)]"
            >
              UNTangle
            </Link>
            <p className="mt-1 text-xs uppercase tracking-[0.3em] text-[color:var(--muted)]">
              Access lives separately now
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="ghost-button">
              Back home
            </Link>
            <Link href="/courses" className="secondary-button">
              Guest flow
            </Link>
          </div>
        </header>

        <main className="flex flex-1 items-center py-8 sm:py-10">
          <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(24rem,0.92fr)] lg:items-stretch">
            <section className="surface-panel animate-page-in flex flex-col justify-between overflow-hidden px-6 py-8 sm:px-9 sm:py-10">
              <div>
                <p className="editorial-label">{eyebrow}</p>
                <h1 className="mt-4 max-w-[12ch] font-display text-[clamp(3rem,6vw,5.7rem)] font-bold leading-[0.9] tracking-[-0.08em] text-[color:var(--green-900)]">
                  {title}
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-8 text-[color:var(--copy)]">{description}</p>
              </div>

              <div className="mt-8 space-y-3">{aside}</div>
            </section>

            <section className="animate-page-in self-center">{children}</section>
          </div>
        </main>
      </div>
    </div>
  );
}
