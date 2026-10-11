import Link from "next/link";

export default function NotFound() {
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
              We could not find that page.
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "0.85rem",
                lineHeight: 1.48,
                color: "var(--copy)",
              }}
            >
              The address may be mistyped, the page may have moved, or it may
              never have existed. Either way, nothing was lost.
            </p>
            <div
              style={{
                marginTop: 18,
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <Link href="/" className="btn-primary">
                Back to home
              </Link>
              <Link href="/courses" className="btn-secondary">
                Browse courses
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
