import Link from "next/link";

export default function Loading() {
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
            <div
              role="status"
              aria-label="Loading"
              style={{ display: "flex", alignItems: "center" }}
            >
              <span
                aria-hidden="true"
                className="spinner"
                style={{ width: 22, height: 22, color: "var(--brand-700)" }}
              />
            </div>
            <h1
              className="font-display"
              style={{
                margin: "0.7rem 0 0",
                fontSize: "1.7rem",
                fontWeight: 800,
                color: "var(--brand-900)",
                letterSpacing: "-0.03em",
                lineHeight: 1.05,
              }}
            >
              Loading…
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "0.85rem",
                lineHeight: 1.48,
                color: "var(--copy)",
              }}
            >
              If this doesn’t finish loading, you can always{" "}
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
