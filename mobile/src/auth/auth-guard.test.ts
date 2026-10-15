/**
 * The task's containment rule, enforced as a test: the native keychain and
 * crypto modules are reachable only through their two auth bindings, and the
 * phone never accepts tokens through links or app schemes. If a future change
 * imports expo-secure-store somewhere else, this fails before review does.
 */

// The mobile tsconfig has no node types; the guard only needs three calls and
// jest's babel transform supplies the runtime module.
declare const require: (id: "node:fs" | "node:path") => unknown;
type Fs = {
  readFileSync: (path: string, encoding: string) => string;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { isDirectory(): boolean };
};
type Path = { join: (...parts: string[]) => string };
const { readFileSync, readdirSync, statSync } = require("node:fs") as Fs;
const { join } = require("node:path") as Path;
declare const __dirname: string;

const AUTH = __dirname;
const SRC = join(AUTH, "..");

function sourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      files.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      files.push(full);
    }
  }
  return files.sort();
}

const unique = [...new Set(sourceFiles(SRC))];
/** Block comments hold design history (http.ts documents the removed untangle:// scheme), not usage. */
const stripBlockComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => stripBlockComments(readFileSync(file, "utf8"));

describe("module boundaries", () => {
  it("confines expo-secure-store to the token store binding", () => {
    const importing = unique.filter(file => read(file).includes("expo-secure-store"));
    expect(importing).toEqual([join(AUTH, "secure-token-store.ts")]);
  });

  it("confines expo-crypto to the crypto binding", () => {
    const importing = unique.filter(file => read(file).includes("expo-crypto"));
    expect(importing).toEqual([join(AUTH, "native-crypto.ts")]);
  });

  it("confines SecureStore usage to the token store binding even when imported indirectly", () => {
    // A file could reach the Keychain through a re-export instead of the
    // package name; the class name only appears in the binding.
    const touching = unique.filter(file => /SecureStore|keychainAccessible/.test(read(file)));
    expect(touching).toEqual([join(AUTH, "secure-token-store.ts")]);
  });

  it("keeps every source free of link-based credential handling", () => {
    const offenders = unique.filter(file => {
      const text = read(file);
      return /from ["']expo-linking["']|Linking\.|openAuthSessionAsync|getInitialURL|untangle:\/\//.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("scans every mobile source directory, present and future", () => {
    // The guard reads the whole src tree; a new directory is covered without
    // anyone remembering to add it to a root list.
    expect(unique.length).toBeGreaterThan(0);
    expect(unique.every(file => file.startsWith(`${SRC}/`))).toBe(true);
  });

  it("keeps +native-intent files out of the app", () => {
    // expo-router's +native-intent convention is the hook that lets a native
    // deep link hand the app a URL; the architecture allows no scheme-based
    // entry points at all, so no such file may exist.
    const offenders = unique.filter(file => /\+native-intent\.(ts|tsx)$/.test(file));
    expect(offenders).toEqual([]);
  });

  it("keeps search-param hooks out of the auth module and the sign-in screen", () => {
    // Reading search params is how a token-in-URL bug sneaks in; the auth
    // module and the sign-in screen have no use for them.
    const signIn = join(SRC, "app", "sign-in.tsx");
    const scoped = unique.filter(file => file.startsWith(`${AUTH}/`) || file === signIn);
    const offenders = scoped.filter(file => /useLocalSearchParams|useGlobalSearchParams|useSearchParams/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("keeps token material out of the plan store's persisted state", () => {
    const planFiles = sourceFiles(join(AUTH, "..", "plan"));
    for (const file of planFiles) {
      expect(read(file)).not.toMatch(/accessToken|refreshToken/);
    }
  });
});
