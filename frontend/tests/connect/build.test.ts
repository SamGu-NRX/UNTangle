import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { productionOrigin } from "../../../extension/src/config";
const cwd = resolve(import.meta.dir, "../../../extension");
test("production build refuses missing, placeholder and development origins", () => {
  for (const origin of [
    undefined,
    "https://untangle.example.com",
    "http://localhost:3000",
    "https://127.0.0.1",
    "https://localhost",
    "https://planner.invalid",
    "https://planner.org/connect",
  ]) {
    expect(() => productionOrigin(origin)).toThrow();
  }
  const result = Bun.spawnSync(["bun", "build.ts"], { cwd });
  expect(result.exitCode).not.toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toContain(
    "Production build requires --origin",
  );
});
test("generated production manifest and scripts trust only the explicit HTTPS origin", async () => {
  const origin = "https://connect.untangle.org";
  // This is a test host configuration, not an assertion about the project's deployment.
  const result = Bun.spawnSync(
    [
      "bun",
      "build.ts",
      `--origin=${origin}`,
      "--outdir=test-results/prod-fixture",
    ],
    { cwd },
  );
  expect(result.exitCode).toBe(0);
  const manifest = await Bun.file(
    resolve(cwd, "test-results/prod-fixture/manifest.json"),
  ).json();
  expect(manifest.host_permissions).toEqual([
    "https://my.unt.edu/*",
    `${origin}/*`,
  ]);
  expect(manifest.content_scripts[0].matches).toEqual([`${origin}/*`]);
  for (const file of ["bridge.js", "background.js"]) {
    const bundle = await Bun.file(
      resolve(cwd, "test-results/prod-fixture", file),
    ).text();
    expect(bundle).toContain(origin);
    expect(bundle).not.toContain("http://localhost:3000");
    expect(bundle).not.toContain("http://127.0.0.1:3000");
    expect(bundle).not.toContain("untangle.example.com");
  }
});
