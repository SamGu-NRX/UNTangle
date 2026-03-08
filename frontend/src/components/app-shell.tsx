"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const steps = [
  { href: "/", label: "Access" },
  { href: "/courses", label: "Courses" },
  { href: "/schedule", label: "Schedule" },
  { href: "/map", label: "Map" },
];

export function AppShell({
  children,
  title,
  eyebrow,
  subtitle,
  currentStep,
  aside,
}: {
  children: React.ReactNode;
  title: string;
  eyebrow: string;
  subtitle: string;
  currentStep?: number;
  aside?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const sessionResult = authClient.useSession();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(28,81,51,0.14),_transparent_38%),linear-gradient(180deg,_#f7f5ef_0%,_#f1ede2_45%,_#ebe6d8_100%)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-3 py-3 sm:px-5 lg:px-7">
        <header className="glass-panel mb-5 flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <Link
              href="/"
              className="font-display text-[clamp(2.25rem,3vw,3.3rem)] font-bold leading-none tracking-[-0.07em] text-[var(--green-900)]"
            >
              UNTangle
            </Link>
            <p className="text-[11px] uppercase tracking-[0.34em] text-[var(--muted)] sm:text-xs">
              Schedule optimizer for UNT
            </p>
          </div>
          <div className="flex flex-1 items-center justify-center gap-3 overflow-x-auto lg:px-6">
            {steps.map((step, index) => {
              const active = currentStep !== undefined ? currentStep >= index : pathname === step.href;
              return (
                <div
                  key={step.href}
                  className={`h-2 min-w-14 rounded-full transition-all duration-300 ${
                    active ? "bg-[var(--green-700)]" : "bg-[rgba(16,38,20,0.12)]"
                  }`}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-3 self-end lg:self-auto">
            <span className="rounded-full border border-[rgba(16,38,20,0.1)] bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              {sessionResult.data?.user ? sessionResult.data.user.email : "Guest mode"}
            </span>
            {sessionResult.data?.user ? (
              <button
                type="button"
                className="rounded-full border border-[rgba(16,38,20,0.12)] bg-white px-4 py-2 text-sm font-semibold text-[var(--green-800)] transition-colors duration-150 hover:border-[var(--green-500)] hover:text-[var(--green-900)]"
                onClick={async () => {
                  await authClient.signOut();
                  router.push("/");
                }}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </header>

        <main className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="glass-panel flex min-h-[720px] flex-col overflow-hidden">
            <div className="border-b border-[rgba(16,38,20,0.08)] px-5 py-6 md:px-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                {eyebrow}
              </p>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-end">
                <div className="min-w-0">
                  <h1 className="max-w-[15ch] text-balance font-display text-[clamp(3.4rem,5.8vw,6.5rem)] font-bold leading-[0.92] tracking-[-0.08em] text-[var(--green-900)]">
                    {title}
                  </h1>
                  <p className="mt-4 max-w-4xl text-base leading-8 text-[var(--copy)]">
                    {subtitle}
                  </p>
                </div>
                <div className="hidden rounded-[1.5rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(160deg,_rgba(255,255,255,0.88),_rgba(238,233,220,0.76))] p-4 text-right lg:block">
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                    Step {currentStep !== undefined ? currentStep + 1 : 1} of 4
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--green-900)]">
                    {steps[currentStep ?? 0]?.label ?? "Access"}
                  </p>
                </div>
              </div>
            </div>
            <div className="animate-enter px-5 py-6 md:px-8">{children}</div>
          </section>
          <aside className="hidden xl:block">{aside}</aside>
        </main>
      </div>
    </div>
  );
}
