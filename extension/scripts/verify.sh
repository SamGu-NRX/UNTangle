#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
frontend/node_modules/.bin/tsc --noEmit --project frontend/tsconfig.json
(cd frontend && bun test)
(cd frontend && node_modules/.bin/eslint src/lib/connect src/components/connect src/app/connect)
bun run --cwd extension check
bun run --cwd extension build:dev
bun run --cwd extension proof
