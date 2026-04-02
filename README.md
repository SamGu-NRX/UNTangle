# UNTangle

Schedule optimizing full-stack app.

## Setup

1. Run `bun run setup` from the repo root.
2. Seed the backend dataset with `bun run backend:seed`.
3. Start the frontend with `bun run dev`.
4. Start the backend in a second terminal with `bun run backend:dev`.

The root setup command initializes the `backend` submodule and installs Bun-managed dependencies for both repos.

## Submodules

- **frontend:** Next.js TypeScript app
- **backend:** TypeScript Express API with local SQLite dev storage ([UNT-Schedule-Optimizer](https://github.com/sunnyD1000/UNT-Schedule-Optimizer))
