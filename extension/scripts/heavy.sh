#!/bin/sh
set -u
lease_id=$("$HOME/.long-run/bin/lr-lease" acquire --run fleet-untangle-connect --kind heavy --est-mem 2 --est-disk 1 --ttl 40 --owner-pid $$) || { printf '%s\n' "$lease_id"; exit 75; }
trap '"$HOME/.long-run/bin/lr-lease" release "$lease_id"' EXIT
lockf -k "$HOME/.long-run/locks/heavy.lock" "$@"
