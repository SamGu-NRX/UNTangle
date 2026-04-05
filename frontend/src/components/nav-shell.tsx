"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
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
  children,
}: {
  step: number; // 0 = courses, 1 = schedule, 2 = map
  back?: { href: string; label: string };
  next?: { href: string; label: string };
  children: ReactNode;
}) {
  const sessionResult = authClient.useSession();
  const router = useRouter();
  const user = sessionResult.data?.user;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(244, 246, 244, 0.85)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            padding: "0.85rem 1.25rem",
            display: "flex",
            alignItems: "center",
            gap: "1.25rem",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/"
            className="font-display"
            style={{
              fontSize: "1.4rem",
              fontWeight: 800,
              color: "var(--brand-900)",
              letterSpacing: "-0.04em",
            }}
          >
            UNTangle
          </Link>

          <nav
            style={{
              display: "flex",
              gap: 4,
              padding: 4,
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              background: "var(--surface-muted)",
            }}
          >
            {STEPS.map((s, i) => {
              const active = i === step;
              const done = i < step;
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  style={{
                    padding: "0.42rem 0.85rem",
                    borderRadius: "var(--r-sm)",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    color: active ? "#fff" : done ? "var(--brand-700)" : "var(--copy)",
                    background: active ? "var(--brand-900)" : "transparent",
                    transition: "background-color var(--d-hover) var(--ease), color var(--d-hover) var(--ease)",
                  }}
                >
                  <span style={{ marginRight: 6, fontVariantNumeric: "tabular-nums" }}>0{i + 1}</span>
                  {s.label}
                </Link>
              );
            })}
          </nav>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--copy)",
                fontWeight: 600,
                padding: "0.25rem 0.65rem",
                border: "1px solid var(--line)",
                borderRadius: 999,
                background: "var(--surface)",
              }}
            >
              {user ? user.email : "Guest"}
            </span>
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
          padding: "1.5rem 1.25rem 5rem",
        }}
      >
        {children}
      </main>

      {back || next ? (
        <footer
          style={{
            position: "sticky",
            bottom: 0,
            background: "rgba(244, 246, 244, 0.85)",
            backdropFilter: "blur(8px)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              maxWidth: 1280,
              margin: "0 auto",
              padding: "0.8rem 1.25rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
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
