"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

const STEPS = [
  { href: "/courses", label: "Courses" },
  { href: "/schedule", label: "Schedule" },
  { href: "/map", label: "Map" },
];

export function NavShell({
  step,
  back,
  next,
  stickyFooter = true,
  children,
}: {
  step: number; // 0 = courses, 1 = schedule, 2 = map
  back?: { href: string; label: string };
  next?: { href: string; label: string };
  stickyFooter?: boolean;
  children: ReactNode;
}) {
  const sessionResult = authClient.useSession();
  const router = useRouter();
  const user = sessionResult.data?.user;

  const navRef = useRef<HTMLElement | null>(null);
  const pillRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const pill = pillRefs.current[step];
    const nav = navRef.current;
    if (!pill || !nav) return;
    const navRect = nav.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    setIndicator({
      left: pillRect.left - navRect.left,
      width: pillRect.width,
    });
  }, [step]);

  return (
    <div className="j-shell">
      <header className="j-header">
        <div className="j-header__inner">
          <Link href="/" className="j-logo" aria-label="UNTangle home">
            Un<span className="j-logo__second">Tangle</span>
          </Link>

          <nav className="j-nav" ref={navRef} aria-label="Planning steps">
            {indicator ? (
              <span
                aria-hidden="true"
                className="j-nav__indicator"
                style={{
                  transform: `translateX(${indicator.left - 4}px)`,
                  width: indicator.width,
                }}
              />
            ) : null}
            {STEPS.map((s, i) => {
              const state = i === step ? "active" : i < step ? "done" : "todo";
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  ref={(el) => {
                    pillRefs.current[i] = el;
                  }}
                  className="j-nav__pill"
                  data-state={state}
                  aria-current={state === "active" ? "step" : undefined}
                >
                  <span className="j-nav__num">0{i + 1}</span>
                  {s.label}
                </Link>
              );
            })}
          </nav>

          <div className="j-spacer">
            <span className="j-chip">{user ? user.email : "Guest"}</span>
            {user ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  await authClient.signOut();
                  router.push("/");
                }}
              >
                Sign out
              </button>
            ) : (
              <Link href="/auth" className="btn-ghost">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main
        className="animate-content-enter"
        style={{
          flex: 1,
          maxWidth: 1280,
          width: "100%",
          margin: "0 auto",
          padding: "1.5rem 1.25rem 2.5rem",
        }}
      >
        {children}
      </main>

      {back || next ? (
        <footer className="j-footer" data-sticky={stickyFooter ? "true" : "false"}>
          <div className="j-footer__inner">
            {back ? (
              <Link href={back.href} className="btn-ghost">
                ← {back.label}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={next.href} className="btn-primary">
                {next.label} →
              </Link>
            ) : (
              <span />
            )}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
