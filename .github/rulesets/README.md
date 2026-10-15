# Rulesets

These are the request bodies for the `alpha` and `main` branch rulesets. Nothing applies them automatically: Sam or the lead applies them by hand with `gh api`, replacing the ruleset that already exists for that branch.

```sh
gh api repos/SamGu-NRX/UNTangle/rulesets --jq '.[] | [.id, .name] | @tsv'
gh api -X PUT repos/SamGu-NRX/UNTangle/rulesets/<id> --input .github/rulesets/alpha.json
gh api -X PUT repos/SamGu-NRX/UNTangle/rulesets/<id> --input .github/rulesets/main.json
```

Each ruleset requires a PR with one approving review from a code owner on its latest push. `.github/CODEOWNERS` names Sam for every path, so that review has to be his. A push dismisses it.

Apply them only once these are in place:
- `.github/CODEOWNERS` on `alpha` and `main`. GitHub reads it from the PR's base branch, so without it no review counts as a code owner's.
- `.github/workflows/pr-rules.yml` with the Report job on the default branch (`main`), which `pull_request_target` runs. Until then nothing posts the `Task rule` and `Path ownership` statuses, and every PR waits on them.
- The same file on `alpha`. A review event runs the copy in the PR's merge commit, which for a PR into `alpha` is `alpha`'s copy.

The required checks name `integration_id` 15368, the GitHub Actions app (`gh api /apps/github-actions`), so a status posted with a person's token doesn't count. The PR must be up to date with its base before it merges. Updating it is a push, so both rules run again against the new base and Sam approves again.

Admins keep a bypass in `pull_request` mode: they can't push to these branches directly, but they can merge a PR without its review or checks. Sam needs it to merge a PR opened with his own account, since GitHub doesn't let him approve his own PR.

The pull_request rule keeps `require_extra_approval_for_unattributed_changes: true` from the live `main` ruleset. The public REST schema doesn't list it, so after a `PUT`, read the ruleset back and check that it's still set.
