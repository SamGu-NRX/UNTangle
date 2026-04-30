import { Resend } from "resend";

const fromEmail = process.env.RESEND_FROM_EMAIL ?? "UNTangle <onboarding@resend.dev>";

async function sendAuthEmail({
  to,
  subject,
  heading,
  body,
  ctaUrl,
  ctaLabel,
}: {
  to: string;
  subject: string;
  heading: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not configured. Skipping auth email.");
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: fromEmail,
    to: [to],
    subject,
    html: `
      <div style="font-family: Georgia, serif; background:#f7f4ee; padding:32px;">
        <div style="max-width:560px; margin:0 auto; background:white; border-radius:20px; padding:32px; border:1px solid #d7d0c2;">
          <p style="font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:#5c6a51; margin:0 0 16px;">UNTangle</p>
          <h1 style="font-size:28px; line-height:1.1; color:#102614; margin:0 0 12px;">${heading}</h1>
          <p style="font-family:Arial, sans-serif; color:#475448; font-size:15px; line-height:1.6; margin:0 0 24px;">
            ${body}
          </p>
          <a href="${ctaUrl}" style="display:inline-block; background:#123524; color:white; text-decoration:none; padding:14px 18px; border-radius:999px; font-family:Arial, sans-serif; font-weight:700;">
            ${ctaLabel}
          </a>
          <p style="font-family:Arial, sans-serif; color:#6f7768; font-size:13px; line-height:1.5; margin:24px 0 0;">
            If you did not request this, you can safely ignore this email.
          </p>
        </div>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  await sendAuthEmail({
    to: email,
    subject: "Reset your UNTangle password",
    heading: "Reset your password",
    body: "Use the button below to set a new password and get back to your schedule flow.",
    ctaUrl: resetUrl,
    ctaLabel: "Reset password",
  });
}

export async function sendMagicLinkEmail(email: string, magicLinkUrl: string) {
  await sendAuthEmail({
    to: email,
    subject: "Sign in to UNTangle",
    heading: "Sign in to UNTangle",
    body: "Use this secure link to create or open your UNTangle planner account with your UNT email.",
    ctaUrl: magicLinkUrl,
    ctaLabel: "Open UNTangle",
  });
}
