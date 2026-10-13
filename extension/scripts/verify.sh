#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
frontend/node_modules/.bin/tsc --noEmit --project frontend/tsconfig.json
bun test --cwd frontend tests/connect/protocol.test.ts tests/connect/report.test.ts tests/connect/import.test.ts tests/connect/build.test.ts tests/transcript-confirm.test.ts tests/transcript-redaction.test.ts
(cd frontend && node_modules/.bin/eslint src/lib/connect src/components/connect src/app/connect)
bun run --cwd extension check
bun run --cwd extension build:dev
bun run --cwd extension proof
