import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// auth-config.ts writes passwords through DeviceStore.writeCredential and
// returns false from better-auth's account hooks, so better-auth skips its own
// write. That is safe only because, in 1.5.5, a false hook result makes the
// adapter call return null and every call site that reaches those hooks
// discards the result. An upgrade that starts using the result must fail here
// before it ships.
const root = path.dirname(path.dirname(Bun.resolveSync("better-auth", import.meta.dir)));
const source = (file: string) => readFileSync(path.join(root, "dist", file), "utf8");

describe("better-auth stays at the version auth-config's account hooks were checked against", () => {
  test("the installed and declared versions are exactly 1.5.5", () => {
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version).toBe("1.5.5");
    const declared = JSON.parse(readFileSync(path.join(import.meta.dir, "../../package.json"), "utf8")).dependencies["better-auth"];
    expect(declared).toBe("1.5.5");
  });

  test("a false before-hook skips the write and returns null", () => {
    const hooks = source("db/with-hooks.mjs");
    expect(hooks.match(/if \(result === false\) return null;/g)).toHaveLength(3);
  });

  test("change-password, set-password and reset discard the result of the writes the hooks skip", () => {
    const updateUser = source("api/routes/update-user.mjs");
    expect(updateUser).toContain("\tawait ctx.context.internalAdapter.updateAccount(account.id, { password: passwordHash });\n");
    expect(updateUser).toMatch(/\t\tawait ctx\.context\.internalAdapter\.linkAccount\(\{\n[^}]*\}\);\n\t\treturn ctx\.json\(\{ status: true \}\);/);
    const password = source("api/routes/password.mjs");
    expect(password).toMatch(/\)\) await ctx\.context\.internalAdapter\.createAccount\(\{\n[^}]*\}\);\n/);
    expect(password).toContain("\telse await ctx.context.internalAdapter.updatePassword(userId, hashedPassword);\n");
    for (const file of [updateUser, password])
      expect(file).not.toMatch(/=\s*await ctx\.context\.internalAdapter\.(updateAccount|linkAccount|createAccount|updatePassword)\(/);
  });
});
