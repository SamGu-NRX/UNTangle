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
