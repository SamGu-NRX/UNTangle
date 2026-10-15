import { expect, test } from "bun:test";
import { postgresDeviceStore } from "@/server/auth/device-postgres";

// drizzle reports a failed query as "Failed query: <sql> params: <values>",
// with the driver's error as `cause`. better-auth logs whole errors from its
// routes, so a store error must carry only the database's code.
function failingQuery(params: string) {
  return Object.assign(new Error(`Failed query: delete from "session" where "token" = $1\nparams: ${params}`), {
    cause: Object.assign(new Error("terminating connection"), { code: "57P01" }),
  });
}

test("a failed stale-session check reports the database code, never the session token", async () => {
  const chain = { where: () => chain, returning: async () => { throw failingQuery("session-token-123"); } };
  const db = { delete: () => chain } as unknown as Parameters<typeof postgresDeviceStore>[0];
  const error = await postgresDeviceStore(db).endStaleSession("session-token-123").then(() => null, (failure: Error) => failure);
  expect(error?.message).toBe("Stale-session check failed: 57P01");
  expect(`${error?.message} ${JSON.stringify(error)} ${String(error?.cause ?? "")}`).not.toContain("session-token-123");
});
