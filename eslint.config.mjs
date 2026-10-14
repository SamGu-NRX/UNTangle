// Lint config for the workspace packages under packages/ and tools/. ESLint
// looks for a config from the directory it runs in upward, so a package's
// `lint` script finds this file, while frontend/ keeps its own config.
//
// It also enforces the dependency direction in docs/architecture/README.md:
//
//   tokens <- ui (web, native, extension)
//   core <- campus <- contracts <- sync <- frontend, apps/*
//
// A package's src/ may import only the packages to its left on those lines,
// plus what the platform it runs on provides. ingest, which runs as a job and
// isn't drawn there, may import core, campus and contracts.
// tools/repo-rules/tests/import-boundaries.test.ts lints fixtures against
// these rules.
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/** Forbids the named workspace packages. */
function packages(names, why) {
  return { regex: `^@untangle/(${names.join("|")})(/|$)`, message: why };
}

const react = {
  regex: "^(react|react-dom|react-native)(/|$)",
  message: "UI frameworks stay in the apps. Take what you need as an argument.",
};
const next = {
  regex: "^(next|@next/[^/]+|server-only|client-only)(/|$)",
  message: "Next.js stays in frontend/.",
};
const nodePrefixed = {
  regex: "^node:",
  message: "Node built-ins aren't available on every platform this runs on. Take I/O as an argument.",
};
const bun = {
  regex: "^bun(:|$)",
  message: "Bun built-ins aren't available on every platform this runs on. Take I/O as an argument.",
};
const frontendAlias = {
  regex: "^@/",
  message: "@/ is frontend's alias. A package never imports from frontend/.",
};
const bundledData = {
  regex: "\\.(json|geojson)$",
  message: "core never imports data. The caller passes campus data in.",
};
// Bare built-in names ("fs", "path/posix") are listed exactly, so a local
// module that happens to be called ./fs is not caught. Under Bun the list
// also holds "bun" and "bun:*", which the `bun` pattern already covers.
const nodeBareNames = builtinModules
  .filter((name) => !name.startsWith("_") && !name.includes(":") && name !== "bun")
  .map((name) => ({ name, message: nodePrefixed.message }));

const allPackages = ["core", "campus", "contracts", "sync", "tokens", "ingest"];

/** Import sources each package's src/ may not use. */
const forbidden = {
  core: {
    paths: nodeBareNames,
    patterns: [
      packages(allPackages, "core is the bottom layer: it imports no other workspace package."),
      react,
      next,
      nodePrefixed,
      bun,
      frontendAlias,
      bundledData,
    ],
  },
  contracts: {
    paths: nodeBareNames,
    patterns: [
      packages(["sync", "tokens", "ingest"], "contracts may import core and campus, nothing above them."),
      react,
      next,
      nodePrefixed,
      bun,
      frontendAlias,
    ],
  },
  sync: {
    paths: nodeBareNames,
    patterns: [
      packages(["tokens", "ingest"], "sync may import core, campus and contracts, nothing else in the workspace."),
      react,
      next,
      nodePrefixed,
      bun,
      frontendAlias,
    ],
  },
  tokens: {
    paths: nodeBareNames,
    patterns: [
      packages(allPackages, "tokens is imported by UI and imports no other workspace package."),
      react,
      next,
      nodePrefixed,
      bun,
      frontendAlias,
    ],
  },
  // ingest runs in Bun jobs, so Node and Bun built-ins are fine there.
  ingest: {
    paths: [],
    patterns: [
      packages(["sync", "tokens"], "ingest may import core, campus and contracts, nothing else in the workspace."),
      react,
      next,
      frontendAlias,
    ],
  },
};

// no-restricted-imports sees bare names only. This rule catches the other way
// out: a relative path that climbs out of the package, as in
// "../../contracts/src/x" or "../../../frontend/src/lib/types".
const stayInPackage = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      escapes:
        "'{{source}}' leaves {{packageDir}}. Import other workspace code by package name, as in @untangle/core/<module>.",
    },
  },
  create(context) {
    const [top, name] = path.relative(repoRoot, context.filename).split(path.sep);
    if (top !== "packages" || !name) return {};
    const packageDir = path.join(repoRoot, top, name);
    const check = (sourceNode) => {
      const source = sourceNode?.value;
      if (typeof source !== "string" || !(source.startsWith(".") || source.startsWith("/"))) return;
      const target = path.resolve(path.dirname(context.filename), source);
      if (target !== packageDir && !target.startsWith(packageDir + path.sep)) {
        context.report({
          node: sourceNode,
          messageId: "escapes",
          data: { source, packageDir: path.relative(repoRoot, packageDir) },
        });
      }
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

const untangle = { rules: { "stay-in-package": stayInPackage } };

export default defineConfig([
  globalIgnores(["frontend/**", "old/**", "**/node_modules/**"]),
  {
    files: ["packages/**/*.{ts,tsx,mts}", "tools/repo-rules/**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  ...Object.entries(forbidden).map(([name, options]) => ({
    files: [`packages/${name}/src/**/*.{ts,tsx,mts}`],
    plugins: { untangle },
    rules: {
      "no-restricted-imports": ["error", options],
      "untangle/stay-in-package": "error",
    },
  })),
  {
    // no-restricted-imports doesn't see import(), so a lazy load would slip
    // past it. The libraries never load lazily.
    files: ["packages/{core,contracts,sync,tokens}/src/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Use a static import, so the import boundary rules can see it.",
        },
      ],
    },
  },
  {
    // ingest, which runs as a job, may load its own modules lazily, by a
    // relative path stay-in-package can check, and nothing else.
    files: ["packages/ingest/src/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression:not([source.type='Literal'][source.value=/^\\./])",
          message: "Lazy-load only ingest's own modules, by relative path. Import anything else statically.",
        },
      ],
    },
  },
]);
