import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Resend } from "resend";

const fromEmail = process.env.RESEND_FROM_EMAIL ?? "UNTangle <onboarding@resend.dev>";

type AuthEmailKind = "magic-link" | "password-reset";

const subjects: Record<AuthEmailKind, string> = {
  "magic-link": "Sign in to UNTangle",
  "password-reset": "Reset your UNTangle password",
};

function actionLabel(kind: AuthEmailKind): string {
  return kind === "magic-link" ? "sign in to UNTangle" : "reset your UNTangle password";
}

function emailHtml(kind: AuthEmailKind, url: string): string {
  return [
    '<div style="font-family:Georgia,\'Times New Roman\',serif;max-width:520px;margin:0 auto;padding:32px 24px;">',
    '  <p style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#5b6b58;margin:0 0 20px;">UNTangle</p>',
    `  <h1 style="font-size:22px;margin:0 0 16px;color:#1d2b21;">Click to ${actionLabel(kind)}</h1>`,
    '  <p style="font-size:15px;line-height:1.6;color:#3d4a40;margin:0 0 24px;">',
    "    This link works once and expires in five minutes. If you did not request it, you can",
    "    ignore this email — no account changes were made.",
    "  </p>",
    `  <a href="${url}" style="display:inline-block;background:#1d2b21;color:#f7f6f2;padding:12px 22px;border-radius:6px;font-size:15px;text-decoration:none;">${actionLabel(kind)}</a>`,
    `  <p style="font-size:13px;color:#5b6b58;margin:24px 0 0;word-break:break-all;">Or paste this link into your browser:<br />${url}</p>`,
    "</div>",
  ].join("\n");
}

type Transport = {
  label: "resend" | "outbox";
  send: (kind: AuthEmailKind, to: string, url: string) => Promise<void>;
};

type ResendLikeClient = {
  emails: {
    send: (payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }) => Promise<{ error: { message: string } | null }>;
  };
};

/**
 * Transport selection, injectable for tests. Resend is used only in
 * production with a configured key. Development and test always use the
 * development-only local outbox, even when a key is present, so a stray
 * key in a dev shell can never send real authentication email. Production
 * without a key fails loudly rather than silently dropping email.
 */
export function resolveEmailTransport(
  env: Record<string, string | undefined> = process.env,
  createClient: (apiKey: string) => ResendLikeClient = (apiKey) => new Resend(apiKey),
): Transport {
  const isProduction = env.NODE_ENV === "production";
  if (isProduction && env.RESEND_API_KEY) {
    const client = createClient(env.RESEND_API_KEY);
    return {
      label: "resend",
      send: async (kind, to, url) => {
        const { error } = await client.emails.send({
          from: fromEmail,
          to,
          subject: subjects[kind],
          html: emailHtml(kind, url),
        });
        if (error) {
          throw new Error(`Email provider rejected ${kind} email to ${to}: ${error.message}`);
        }
      },
    };
  }

  if (isProduction) {
    throw new Error(
      "RESEND_API_KEY is not configured. UNTangle refuses to run authentication email in production without an email provider.",
    );
  }

  return {
    label: "outbox",
    send: async (kind, to, url) => {
      const dir = outboxDirectory();
      await fs.mkdir(dir, { recursive: true });
      const record = {
        id: randomBytes(8).toString("hex"),
        kind,
        to,
        url,
        createdAt: new Date().toISOString(),
      };
      const file = path.join(dir, `${record.id}.json`);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(record, null, 2));
      await fs.rename(tmp, file); // Atomic so the dev outbox page never reads a partial write.
    },
  };
}

/** Directory for the development-only outbox. Tests point this at a temp dir. */
export function outboxDirectory(): string {
  return process.env.UNT_OUTBOX_DIR ?? path.join(process.cwd(), ".outbox");
}

export async function deliverAuthEmail(kind: AuthEmailKind, to: string, url: string) {
  const transport = resolveEmailTransport();
  await transport.send(kind, to, url);
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  await deliverAuthEmail("password-reset", email, resetUrl);
}

export async function sendMagicLinkEmail(email: string, magicLinkUrl: string) {
  await deliverAuthEmail("magic-link", email, magicLinkUrl);
}

export type OutboxMessage = {
  id: string;
  kind: AuthEmailKind;
  to: string;
  url: string;
  createdAt: string;
};

/** Newest first; an unreadable or missing outbox simply yields no messages. */
export async function readOutboxMessages(dir = outboxDirectory()): Promise<OutboxMessage[]> {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const files = (entries as string[])
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();

  const messages = await Promise.all(
    files.map(async (name) => {
      try {
        return JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as OutboxMessage;
      } catch {
        return null;
      }
    }),
  );
  return messages.filter((message): message is OutboxMessage => message !== null);
}
