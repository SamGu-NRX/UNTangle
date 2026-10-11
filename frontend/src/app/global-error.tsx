"use client";

import Link from "next/link";
import { useEffect } from "react";

// Palette hex values mirror the :root tokens in globals.css. This boundary
// renders its own <html>/<body> when the root layout itself throws, so CSS
// custom properties and imported stylesheets cannot be relied on — every
// style is inlined from literals.
const colors = {
  bg: "#f4f6f4",
  surface: "#ffffff",
  surfaceMuted: "#f8faf8",
  ink: "#1a2e1a",
  copy: "#6b826b",
  line: "#dde8dd",
  lineStrong: "#c8d8c8",
  brand900: "#00512b",
  brand700: "#007a40",
  brand500: "#00a855",
} as const;

const focusAndButtons = `
:focus {
  outline: none;
}
:focus-visible {
  outline: 1.5px solid rgba(0, 81, 43, 0.32);
  outline-offset: 2px;
  border-radius: 6px;
}
.unt-ge-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 8px;
  padding: 0.65rem 1.1rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    transform 80ms ease;
}
.unt-ge-btn:active {
  transform: scale(0.98);
}
.unt-ge-btn--primary {
  background: #00512b;
  color: #ffffff;
  border: 1px solid #00512b;
}
.unt-ge-btn--primary:hover {
  background: #007a40;
  border-color: #007a40;
}
.unt-ge-btn--secondary {
  background: #ffffff;
  color: #00512b;
  border: 1px solid #c8d8c8;
}
.unt-ge-btn--secondary:hover {
  border-color: #00a855;
  background: #f8faf8;
}
@keyframes unt-ge-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: colors.bg,
          color: colors.ink,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: focusAndButtons }} />
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            background: colors.bg,
          }}
        >
          <main
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "2rem 1rem",
              animation:
                "unt-ge-enter 160ms cubic-bezier(0.215, 0.61, 0.355, 1) both",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 420,
                padding: "1.75rem 1.6rem",
                background: colors.surface,
                border: `1px solid ${colors.line}`,
                borderRadius: 16,
                boxShadow: "0 4px 24px rgba(0, 60, 20, 0.08)",
              }}
            >
              <Link
                href="/"
                style={{
                  fontSize: "1.6rem",
                  fontWeight: 800,
                  color: colors.brand900,
                  letterSpacing: "-0.04em",
                  textDecoration: "none",
                  fontFamily: '"Syne", system-ui, sans-serif',
                }}
              >
                UNTangle
              </Link>
              <div style={{ marginTop: 18 }}>
                <h1
                  style={{
                    margin: 0,
                    fontSize: "1.7rem",
                    fontWeight: 800,
                    color: colors.brand900,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.05,
                    fontFamily: '"Syne", system-ui, sans-serif',
                  }}
                >
                  Something went wrong on our side.
                </h1>
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: "0.85rem",
                    lineHeight: 1.48,
                    color: colors.copy,
                  }}
                >
                  Nothing you did caused this. Try again in a moment.
                </p>
                {error.digest ? (
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: "0.74rem",
                      color: colors.copy,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    Error code: {error.digest}
                  </p>
                ) : null}
                <div
                  style={{
                    marginTop: 18,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  <button
                    className="unt-ge-btn unt-ge-btn--primary"
                    onClick={() => reset()}
                  >
                    Try again
                  </button>
                  <Link
                    href="/"
                    className="unt-ge-btn unt-ge-btn--secondary"
                  >
                    Back to home
                  </Link>
                </div>
              </div>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
