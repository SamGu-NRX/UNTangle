# mobile/ conventions

- Every bun command in this workspace carries `--no-env-file`, without
  exception. Never open, print, or reference any `.env*` file.
- The `@/lib/*` and `@/schedule-builder/*` aliases are declared in three
  places that must stay in lockstep: `tsconfig.json` (paths), `babel.config.js`
  (babel-plugin-module-resolver), and `jest.config.js`
  (moduleNameMapper). Changing one means changing all three.
- `@/lib/*` imports resolve into `../frontend/src/lib` - shared web code is
  imported in place, never copied. Before adding one, check it is pure
  TypeScript (no React, Next, Node, or DOM-only APIs); document any import
  in `SHARED.md`.
- Data modules under `src/data` take an injected `FetchLike` and return
  typed results instead of throwing across module boundaries; tests live
  beside them and mock the fetch.
- Expo SDK versions change only through `bun --no-env-file x expo install`,
  which keeps the versions aligned with the installed SDK.
- TypeScript is strict, mirroring frontend/tsconfig.json (which does not
  enable noUncheckedIndexedAccess); shared `@/lib/*` imports must typecheck
  under the same rules as their home package.
