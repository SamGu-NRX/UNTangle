/**
 * ui-persona — SYNTHETIC registered-persona handling.
 *
 * The registered persona is fully synthetic (eval-journey+<random>@my.unt.edu,
 * random password) and is created through the UI itself, per the eval brief.
 * It never represents a real person; evidence files reference this label.
 */
import type { Page } from "playwright";

export interface SyntheticPersona {
  email: string;
  password: string;
  /** Always "synthetic-registered" — stamped into any evidence produced. */
  label: "synthetic-registered";
}

export function syntheticPersona(): SyntheticPersona {
  const random = Math.random().toString(36).slice(2, 10);
  const password = `${random}-Xy${Math.floor(Math.random() * 100_000)}`;
  return { email: `eval-journey+${random}@my.unt.edu`, password, label: "synthetic-registered" };
}

/** True when the app currently shows a signed-in account exit control. */
export async function isSignedIn(page: Page): Promise<boolean> {
  return page.getByRole("button", { name: "Sign out" }).isVisible({ timeout: 4_000 }).catch(() => false);
}

/**
 * The app shows signed-in users without a chosen major a blocking
 * choose-your-major modal (overlay intercepts pointer events). Complete it
 * by picking the first major and confirming; no-op when not shown.
 */
export async function settleMajorModal(page: Page): Promise<void> {
  const dialog = page.getByRole("heading", { name: "What are you studying?" });
  if (!(await dialog.isVisible({ timeout: 4_000 }).catch(() => false))) return;
  await page.getByRole("button", { name: "Computer Science" }).first().click({ timeout: 10_000 });
  await page.getByRole("button", { name: "Confirm" }).click({ timeout: 10_000 });
  await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

/**
 * Create the synthetic account through the UI (password sign-up mode of /auth).
 * better-auth signs the account in automatically after sign-up.
 *
 * Probe-verified DOM (evals/.probe-login.ts): the magic-link form and the
 * password form COEXIST; the password form's email field is labeled `Email`,
 * its submit is the only button[type=submit] (toggles are type=button), and
 * it renders `Create account` in sign-up mode.
 */
export async function signUp(page: Page, persona: SyntheticPersona, origin: string): Promise<void> {
  await page.goto(`${origin}/auth`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Password mode: the magic-link form is the default; flip it if present.
  await page.getByRole("button", { name: "Use password instead" }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Sign up", exact: true }).click({ timeout: 10_000 });
  await page.getByLabel("Name", { exact: true }).fill("Eval Persona (synthetic)");
  await page.getByLabel("Email", { exact: true }).fill(persona.email);
  await page.getByLabel("Password", { exact: true }).fill(persona.password);
  await page
    .locator('button[type="submit"]', { hasText: /Create account|Sign up/ })
    .first()
    .click({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).waitFor({ state: "visible", timeout: 30_000 });
  await settleMajorModal(page);
}

/** Sign the synthetic persona in through the UI (password sign-in mode). */
export async function signIn(page: Page, persona: SyntheticPersona, origin: string): Promise<void> {
  await page.goto(`${origin}/auth`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const passwordToggle = page.getByRole("button", { name: "Use password instead" });
  if (await passwordToggle.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await passwordToggle.click({ timeout: 10_000 });
  }
  await page.getByLabel("Email", { exact: true }).fill(persona.email);
  await page.getByLabel("Password", { exact: true }).fill(persona.password);
  await page
    .locator('button[type="submit"]', { hasText: "Log in" })
    .first()
    .click({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).waitFor({ state: "visible", timeout: 30_000 });
  await settleMajorModal(page);
}

/** Sign out through the account exit control. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
}
