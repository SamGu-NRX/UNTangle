# Rulesets

These are the request bodies for the `alpha` and `main` branch rulesets. Nothing applies them automatically: Sam or the lead applies them by hand with `gh api`, replacing the ruleset that already exists for that branch.

```sh
gh api repos/SamGu-NRX/UNTangle/rulesets --jq '.[] | [.id, .name] | @tsv'
gh api -X PUT repos/SamGu-NRX/UNTangle/rulesets/<id> --input .github/rulesets/alpha.json
gh api -X PUT repos/SamGu-NRX/UNTangle/rulesets/<id> --input .github/rulesets/main.json
```

Apply them only once `.github/workflows/pr-rules.yml` with the Approval job is on the default branch. `pull_request_target` runs the default branch's copy, so until then nothing reports the Task rule, Path ownership or `Sam approved` checks, and every PR into these branches waits on them.

Each required check names `integration_id` 15368, the GitHub Actions app (`gh api /apps/github-actions`), so a status posted with a person's token doesn't count.

Admins keep a bypass in `pull_request` mode: they can't push to these branches directly, but they can still merge a PR without its checks.

The live `main` ruleset also sets `require_extra_approval_for_unattributed_changes: true`, which the public REST schema doesn't list. These files leave it out, so check whether a `PUT` keeps it.
