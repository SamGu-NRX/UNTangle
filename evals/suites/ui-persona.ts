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
 * Create the synthetic account through the UI (sign-up mode of /auth).
 * better-auth signs the account in automatically after sign-up.
 */
export async function signUp(page: Page, persona: SyntheticPersona, origin: string): Promise<void> {
  await page.goto(`${origin}/auth`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Password mode: the magic-link form is the default; flip it if present.
  const passwordToggle = page.getByRole("button", { name: "Use password instead" });
  await passwordToggle.click({ timeout: 20_000 });
  await page.getByLabel("UNT email", { exact: true }).waitFor({ state: "visible", timeout: 40_000 });
  await page.getByLabel("UNT email", { exact: true }).fill(persona.email);
  await page.getByLabel("Password", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel("Password", { exact: true }).fill(persona.password);
  // Contract: Submit is `Log in` (sign-in mode) / `Sign up` (sign-up mode);
  // a `Create account` affordance also exists. Match either sign-up name.
  const submit = page.getByRole("button", { name: /Sign up|Create account/ }).first();
  await submit.click({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).waitFor({ state: "visible", timeout: 30_000 });
}

/** Sign the synthetic persona in through the UI. */
export async function signIn(page: Page, persona: SyntheticPersona, origin: string): Promise<void> {
  await page.goto(`${origin}/auth`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const passwordToggle = page.getByRole("button", { name: "Use password instead" });
  if (await passwordToggle.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await passwordToggle.click({ timeout: 10_000 });
  }
  await page.getByLabel("UNT email", { exact: true }).waitFor({ state: "visible", timeout: 40_000 });
  await page.getByLabel("UNT email", { exact: true }).fill(persona.email);
  await page.getByLabel("Password", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel("Password", { exact: true }).fill(persona.password);
  await page.getByRole("button", { name: "Log in" }).click({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).waitFor({ state: "visible", timeout: 30_000 });
}

/** Sign out through the account exit control. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
}
