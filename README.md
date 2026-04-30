# UNTangle

Schedule optimizing full-stack app.

## Setup

1. Run `bun setup` from the repo root.
2. Start the full local stack with `bun dev`.

The root setup command initializes the `backend` submodule, installs Bun-managed dependencies for both repos, creates local `.env` files, and seeds the local SQLite database when it is missing grade distribution data.

`bun dev` repeats the same setup checks, chooses non-conflicting ports, writes the selected backend URL into `frontend/.env`, writes the selected frontend origin into `backend/.env`, then starts both servers. It reuses a compatible backend that is already running and otherwise starts one automatically.

The frontend prefers `http://localhost:3000`, and the backend prefers `http://localhost:3001`. If either port is busy, the dev script selects the next available local port and keeps both `.env` files in sync.

Manual scripts are still available when you need to run one side by itself: `bun run backend:dev`, `bun run frontend:dev`, and `bun run backend:seed`.

## Submodules

- **frontend:** Next.js TypeScript app
- **backend:** TypeScript Express API with local SQLite dev storage ([UNT-Schedule-Optimizer](https://github.com/sunnyD1000/UNT-Schedule-Optimizer))
