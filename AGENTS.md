# AGENTS.md

<!-- agent-skills:start -->
## Agent skills

Before starting work, read the skills below that apply to the task; each SKILL.md says when to use it. They are Sam's working playbooks and Lauren Tan's pstack (`pstack-*`), chosen for this repo. Obvious Autobuild loads them from `.obvious/skills/` on the default branch.

PR titles and bodies follow `.obvious/skills/pr-writing` and `.github/pull_request_template.md`, with before/after screenshots, a recording for motion or interaction, and a simple diagram where they help.

- [`anti-ui-slop`](.obvious/skills/anti-ui-slop/SKILL.md): Run the Uizze reference-guided design playbook or UI finish check when explicitly requested
- [`better-accessibility`](.obvious/skills/better-accessibility/SKILL.md): Helps your project comply with accessibility standards and best practices.
- [`blast-radius`](.obvious/skills/blast-radius/SKILL.md): Assess what a change could break beyond its diff
- [`pr-writing`](.obvious/skills/pr-writing/SKILL.md): Writes or revises pull request titles, descriptions and visual evidence
- [`pstack-create-verification-skill`](.obvious/skills/pstack-create-verification-skill/SKILL.md): Generate a project-local verification skill that drives your app the way a user does — any language, framework, or platform
- [`pstack-principle-boundary-discipline`](.obvious/skills/pstack-principle-boundary-discipline/SKILL.md): Apply when wiring validation, error handling, or framework adapters
- [`pstack-principle-explain-the-number`](.obvious/skills/pstack-principle-explain-the-number/SKILL.md): Apply before you trust, report, or act on a number you measured: a speedup, a regression, a throughput, a latency, or an eval result
- [`pstack-principle-model-the-domain`](.obvious/skills/pstack-principle-model-the-domain/SKILL.md): Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files
- [`pstack-principle-prove-it-works`](.obvious/skills/pstack-principle-prove-it-works/SKILL.md): Apply after completing a task, before declaring done *(needed by `pstack/principle-explain-the-number`)*
- [`pstack-principle-test-behavior-not-implementation`](.obvious/skills/pstack-principle-test-behavior-not-implementation/SKILL.md): Apply when you write, change, or keep a test
- [`pstack-principle-type-system-discipline`](.obvious/skills/pstack-principle-type-system-discipline/SKILL.md): Apply when designing types, reviewing a function signature, or writing code in any statically-typed language
- [`pstack-typescript-best-practices`](.obvious/skills/pstack-typescript-best-practices/SKILL.md): TypeScript best practices
- [`pstack-unslop`](.obvious/skills/pstack-unslop/SKILL.md): Cut AI tells from any writing
- [`pstack-benchmark-checklist`](.obvious/skills/pstack-benchmark-checklist/SKILL.md): Vet a perf measurement (limiter, tuning, limits, errors, repeatability, relevance, and whether the work happened) before you report or act on it *(needed by `pstack/principle-explain-the-number`)*
<!-- agent-skills:end -->

## Approval

A PR lands on `alpha` or `main` only after Sam approves its current commit with the `sam-approved` label. A push removes the label, so each new commit needs a new approval. PRs into `edge` don't need it. The rule, and how CI enforces it, is under "Sam's approval" in `docs/architecture/README.md`.

- Agents never add or remove `sam-approved`, and never merge into alpha or main. Only Sam approves.
- Agents running on Sam's machine use his GitHub token, so GitHub can't tell them apart from him. Nothing on GitHub stops such an agent from approving or merging as Sam; only this rule does.
- TODO(Sam): give agents their own GitHub identity, without his permissions.
