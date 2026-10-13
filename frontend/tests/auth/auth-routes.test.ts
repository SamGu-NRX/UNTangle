import { describe, expect, test } from "bun:test";
import { BASE, setup } from "./fixtures";

// The UNT-address gate and the sign-in link request, through the better-auth
// handler on an in-memory database (fixtures.ts). These used to drive the
// Next route with a mocked database module; module mocks leak between test
// files in one Bun process, so each test now builds its own instance.

const signUp = (t: ReturnType<typeof setup>, email: string) =>
  t.post("/sign-up/email", { email, password: "eagle-scrapper-2026", name: "Test Student" });
const askForLink = (t: ReturnType<typeof setup>, email: string) =>
  t.post("/sign-in/magic-link", { email, callbackURL: "/courses", errorCallbackURL: "/auth?link=failed" });

describe("POST /api/auth/sign-up/email (disabled, and UNT-gated in case it returns)", () => {
  test("rejects a non-UNT email with 400 and the UNT requirement message", async () => {
    const response = await signUp(setup(), "student@gmail.com");
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("@unt.edu");
  });

  test("rejects lookalike domains and emails with no recognizable UNT domain", async () => {
    const t = setup();
    for (const email of ["student@unt.edu.evil.com", "student@unt.edu.some-tld.com", "student@tx.edu", "student@unt.edu.com", "student@my.unt.edu.fake"]) {
      expect((await signUp(t, email)).status).toBe(400);
    }
  });

  test("UNT addresses are refused too: password sign-up is off, accounts come from sign-in links", async () => {
    const t = setup();
    for (const email of ["student@unt.edu", "Student@MY.UNT.EDU"]) {
      const response = await signUp(t, email);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("@unt.edu");
    }
    expect(t.store.user).toHaveLength(0);
  });
});

describe("POST /api/auth/sign-in/magic-link", () => {
  test("a UNT address gets one sign-in link, pointing at the verify endpoint with the callback", async () => {
    const t = setup();
    expect((await askForLink(t, "Eagle@My.UNT.edu")).status).toBe(200);
    expect(t.mail).toHaveLength(1);
    expect(t.mail[0].kind).toBe("magic-link");
    const url = new URL(t.mail[0].url);
    expect(url.origin + url.pathname).toBe(`${BASE}/api/auth/magic-link/verify`);
    expect(url.searchParams.get("token")).toBeTruthy();
    expect(url.searchParams.get("callbackURL")).toBe("/courses");
  });

  test("a non-UNT address is refused before any link is made, so no account can be created for it", async () => {
    const t = setup();
    for (const email of ["student@gmail.com", "student@unt.edu.evil.com"]) {
      const response = await askForLink(t, email);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toContain("@unt.edu");
    }
    expect(t.mail).toHaveLength(0);
  });

  test("a failed send fails the request instead of reporting success", async () => {
    const t = setup(async () => {
      throw new Error("Resend refused the magic-link email: domain not verified");
    });
    expect((await askForLink(t, "eagle@my.unt.edu")).status).toBeGreaterThanOrEqual(400);
  });
});
