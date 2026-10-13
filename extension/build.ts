import {
  DEV_APP_ORIGINS,
  productionOrigin,
  MOCK_ORIGIN,
  MYUNT_ORIGIN,
  REPORT_PATHS,
  SEARCH_PATHS,
} from "./src/config";
const dev = Bun.argv.includes("--dev");
const origins = dev
  ? DEV_APP_ORIGINS
  : [
      productionOrigin(
        Bun.argv.find((arg) => arg.startsWith("--origin="))?.slice(9),
      ),
    ];
const outdir =
  Bun.argv.find((arg) => arg.startsWith("--outdir="))?.slice(9) ??
  (dev ? "dist-dev" : "dist");
const portalMatches = [...REPORT_PATHS, ...SEARCH_PATHS].map(
  (path) => `${MYUNT_ORIGIN}${path}*`,
);
if (dev)
  portalMatches.push(
    `${MOCK_ORIGIN}/transcript-entry*`,
    `${MOCK_ORIGIN}/transcript-report*`,
    `${MOCK_ORIGIN}/class-search*`,
  );
const result = await Bun.build({
  entrypoints: [
    "src/background.ts",
    "src/bridge.ts",
    "src/portal.ts",
    "src/popup.ts",
  ],
  outdir,
  target: "browser",
  format: "iife",
  define: { __DEV__: String(dev), __APP_ORIGINS__: JSON.stringify(origins) },
});
if (!result.success) throw new Error(result.logs.join("\n"));
await Bun.write(
  `${outdir}/manifest.json`,
  JSON.stringify(
    {
      manifest_version: 3,
      name: "UNTangle Connect",
      version: "1.0.0",
      description:
        "Import an unofficial transcript from the myUNT report you open.",
      // Chrome ignores paths in host_permissions. Content matches and runtime URL guards enforce the narrower page scope.
      host_permissions: [
        `${MYUNT_ORIGIN}/*`,
        ...origins.map((o) => `${o}/*`),
        ...(dev ? [`${MOCK_ORIGIN}/*`] : []),
      ],
      background: { service_worker: "background.js" },
      action: { default_popup: "popup.html" },
      content_scripts: [
        {
          matches: origins.map((o) => `${o}/*`),
          js: ["bridge.js"],
          run_at: "document_start",
        },
        { matches: portalMatches, js: ["portal.js"], run_at: "document_idle" },
      ],
    },
    null,
    2,
  ),
);
await Bun.write(`${outdir}/popup.html`, Bun.file("src/popup.html"));
