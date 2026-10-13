import { expect, test } from "bun:test";

test("every current non-auth API route returns 429 and rate-limit headers after its budget", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "tests/rate-limit/routes-check.ts"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", RATE_LIMIT_STORE: "memory" },
    stdout: "pipe", stderr: "pipe",
  });
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, errors }).toEqual({ code: 0, errors: "" });
  expect(output.trim()).toBe("Verified 429 responses and headers for 9 route methods.");
}, 20_000);
