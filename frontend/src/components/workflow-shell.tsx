"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const steps = [
  { href: "/courses", short: "01", label: "Courses" },
  { href: "/schedule", short: "02", label: "Schedule" },
  { href: "/map", short: "03", label: "Map" },
];

export function WorkflowShell({
  step,
  eyebrow,
  title,
  description,
  aside,
  children,
}: {
  step: number;
  eyebrow: string;
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const sessionResult = authClient.useSession();

  return (
    <div className="min-h-screen text-[color:var(--ink)]">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="surface-panel flex flex-col gap-5 px-5 py-5 sm:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link
                href="/"
                className="font-display text-[2rem] font-bold leading-none tracking-[-0.07em] text-[color:var(--green-900)]"
              >
                UNTangle
              </Link>
              <p className="mt-1 text-xs uppercase tracking-[0.3em] text-[color:var(--muted)]">
                Guided planner flow
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="step-pill border-[color:var(--line)] bg-[rgba(255,255,255,0.72)] text-[color:var(--muted)]">
                {sessionResult.data?.user ? sessionResult.data.user.email : "Guest mode"}
              </span>
              {sessionResult.data?.user ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={async () => {
                    await authClient.signOut();
                    router.push("/");
                  }}
                >
                  Sign out
                </button>
              ) : (
                <Link href="/auth" className="ghost-button">
                  Sign in
                </Link>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {steps.map((item, index) => {
              const current = step === index;
              const complete = step > index;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`step-pill transition-colors duration-150 ${
                    current
                      ? "border-[color:var(--green-700)] bg-[color:var(--green-800)] text-white"
                      : complete
                        ? "border-[rgba(79,127,95,0.26)] bg-[color:var(--green-100)] text-[color:var(--green-800)]"
                        : "border-[color:var(--line)] bg-[rgba(255,255,255,0.75)] text-[color:var(--muted)]"
                  }`}
                >
                  <span className="mr-2">{item.short}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <main className="animate-page-in min-w-0">
            <div className="mb-6 max-w-4xl">
              <p className="editorial-label">{eyebrow}</p>
              <h1 className="mt-3 font-display text-[clamp(2.7rem,5vw,4.5rem)] font-bold leading-[0.92] tracking-[-0.08em] text-[color:var(--green-900)]">
                {title}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-[color:var(--copy)]">{description}</p>
            </div>
            {children}
          </main>

          {aside ? <aside className="animate-page-in self-start lg:sticky lg:top-5">{aside}</aside> : null}
        </div>
      </div>
    </div>
  );
}
