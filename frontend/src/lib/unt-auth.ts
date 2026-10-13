const allowedUntEmailDomains = ["unt.edu", "my.unt.edu"] as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isUntEmail(email: string) {
  const normalized = normalizeEmail(email);
  return allowedUntEmailDomains.some((domain) => normalized.endsWith(`@${domain}`));
}

export function untEmailRequirementMessage() {
  return "Use a UNT email address ending in @unt.edu or @my.unt.edu.";
}

/** Endpoints that can create an account, and so must only take UNT addresses. */
export const UNT_GATED_PATHS = ["/sign-up/email", "/sign-in/magic-link"] as const;

/**
 * The refusal message for a request that would create or reach an account
 * with a non-UNT address, or null when the request may go ahead.
 */
export function untEmailGate(path: string, body: unknown): string | null {
  if (!(UNT_GATED_PATHS as readonly string[]).includes(path)) return null;
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && isUntEmail(email) ? null : untEmailRequirementMessage();
}
