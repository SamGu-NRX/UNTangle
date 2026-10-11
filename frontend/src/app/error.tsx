"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorBoundary({
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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <main
        className="animate-content-enter"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
        }}
      >
        <div
          className="surface-card"
          style={{ width: "100%", maxWidth: 420, padding: "1.75rem 1.6rem" }}
        >
          <Link
            href="/"
            className="font-display"
            style={{
              fontSize: "1.6rem",
              fontWeight: 800,
              color: "var(--brand-900)",
              letterSpacing: "-0.04em",
            }}
          >
            UNTangle
          </Link>
          <div style={{ marginTop: 18 }}>
            <h1
              className="font-display"
              style={{
                margin: 0,
                fontSize: "1.7rem",
                fontWeight: 800,
                color: "var(--brand-900)",
                letterSpacing: "-0.03em",
                lineHeight: 1.05,
              }}
            >
              Something went wrong on our side.
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "0.85rem",
                lineHeight: 1.48,
                color: "var(--copy)",
              }}
            >
              Nothing you did caused this. Try again in a moment.
            </p>
            {error.digest ? (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: "0.74rem",
                  color: "var(--copy)",
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
              <button className="btn-primary" onClick={() => reset()}>
                Try again
              </button>
              <Link href="/" className="btn-secondary">
                Back to home
              </Link>
            </div>
            <p
              style={{
                margin: "12px 0 0",
                fontSize: "0.85rem",
                lineHeight: 1.48,
                color: "var(--copy)",
              }}
            >
              Prefer to keep working?{" "}
              <Link
                href="/courses"
                style={{ color: "var(--brand-700)", fontWeight: 600 }}
              >
                Go to courses
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
