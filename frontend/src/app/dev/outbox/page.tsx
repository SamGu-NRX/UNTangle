import { notFound } from "next/navigation";
import { readOutboxMessages } from "@/lib/email";

export const dynamic = "force-dynamic";

const kindLabels: Record<string, string> = {
  "magic-link": "Sign-in link",
  "password-reset": "Password reset",
};

/**
 * Development-only outbox. UNTangle in development never sends email: every
 * authentication message is written to a local JSON file, and this page lists
 * them so the link can be followed like a person would from an inbox.
 */
export default async function DevOutboxPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const messages = await readOutboxMessages();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "2.5rem 1rem",
      }}
    >
      <main style={{ width: "100%", maxWidth: 720 }}>
        <div className="surface-card" style={{ padding: "1.5rem 1.4rem" }}>
          <p className="editorial-label" style={{ margin: 0 }}>
            Development only
          </p>
          <h1
            className="font-display"
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              color: "var(--brand-900)",
              letterSpacing: "-0.03em",
              margin: "8px 0 6px",
            }}
          >
            Email outbox
          </h1>
          <p style={{ fontSize: "0.85rem", color: "var(--copy)", margin: 0, lineHeight: 1.6 }}>
            UNTangle is running in development, so authentication emails are written to a local
            outbox instead of being sent. Nothing has left this machine. Follow a link below the
            way you would from an inbox — each link works once and expires.
          </p>

          {messages.length === 0 ? (
            <p style={{ marginTop: 18, fontSize: "0.85rem", color: "var(--copy)" }}>
              No messages yet. Request a sign-in link or a password reset from the app, then
              reload this page.
            </p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: "18px 0 0",
                padding: 0,
                display: "grid",
                gap: 10,
              }}
            >
              {messages.map((message) => (
                <li
                  key={message.id}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-md)",
                    padding: "0.75rem 0.9rem",
                    background: "var(--surface-muted)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                      fontSize: "0.78rem",
                      color: "var(--copy)",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "var(--brand-700)" }}>
                      {kindLabels[message.kind] ?? message.kind}
                    </span>
                    <span>{message.to}</span>
                    <time dateTime={message.createdAt}>
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </time>
                  </div>
                  <a
                    href={message.url}
                    style={{
                      display: "inline-block",
                      marginTop: 8,
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      color: "var(--brand-700)",
                      wordBreak: "break-all",
                    }}
                  >
                    Open link
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
