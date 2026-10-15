# AGENTS.md

<!-- agent-skills:start -->
## Agent skills

Before starting work, read the skills below that apply to the task; each SKILL.md says when to use it. They are Sam's working playbooks and Lauren Tan's pstack (`pstack-*`), chosen for this repo. Obvious Autobuild loads them from `.obvious/skills/` on the default branch.

PR titles and bodies follow `.obvious/skills/pr-writing` and `.github/pull_request_template.md`, with before/after screenshots when something visible changed (an after capture alone, labeled new, for a new screen; otherwise N/A with the reason), a recording for motion or interaction, and a simple diagram where they help.

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
- [`frontend-design`](.obvious/skills/frontend-design/SKILL.md): Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one
- [`emil-design-eng`](.obvious/skills/emil-design-eng/SKILL.md): This skill encodes Emil Kowalski's philosophy on UI polish, component design, animation decisions, and the invisible details that make software feel great
- [`holistic-ux`](.obvious/skills/holistic-ux/SKILL.md): Design holistic user experiences using systems thinking, service design, and psychological principles
- [`animate`](.obvious/skills/animate/SKILL.md): Build an animation from scratch, making the decisions in the order that determines whether it feels right — should it animate at all, what purpose, which tool, which properties, which curve and duration, how it interrupts, how it exits
- [`animate-expo`](.obvious/skills/animate-expo/SKILL.md): Build animations in React Native and Expo, making the decisions in the order that determines whether they feel right — should it animate, which thread it runs on, which properties, spring or timing, how the gesture hands off, how it degrades
- [`prep-for-prod`](.obvious/skills/prep-for-prod/SKILL.md): Final check before a web UI change ships
- [`review-animations`](.obvious/skills/review-animations/SKILL.md): Reviews animation and motion code against a high craft bar derived from Emil Kowalski's design engineering philosophy
- [`improve-animations`](.obvious/skills/improve-animations/SKILL.md): Survey a codebase's animation and motion code as a senior motion advisor, then produce a prioritized audit and self-contained implementation plans for other agents (or cheaper models) to execute
- [`find-animation-opportunities`](.obvious/skills/find-animation-opportunities/SKILL.md): Search a codebase or UI for places that don't animate but should, and reject everything that shouldn't
- [`mobile-native`](.obvious/skills/mobile-native/SKILL.md): Make a web app feel native on a phone — the small CSS and meta-tag fixes that separate "a website in a browser" from something that feels installed
- [`pick-ui-library`](.obvious/skills/pick-ui-library/SKILL.md): Pick the right library for a given frontend task from a curated, opinionated list — numbers, OTP inputs, charts, command menus, virtualization, drag and drop, toasts, state, styling, and more
- [`break-ui`](.obvious/skills/break-ui/SKILL.md): Try to break a piece of UI by feeding it worst-case data — long names, unbreakable emails, one-letter names, missing fields, huge counts, zero items, long labels, non-Latin text, emoji, extreme numbers — then render it behind a "Demo data / Worst case" toggle and report everything that broke, with the fix for each
<!-- agent-skills:end -->

## Approval

A PR lands on `alpha` or `main` only after Sam approves it in a PR review, on its latest commit. A push dismisses the approval, so each new commit needs a new one. PRs into `edge` don't need it. The rule, and how GitHub enforces it, is under "Sam's approval" in `docs/architecture/README.md`.

- Agents never submit PR reviews, never merge into alpha or main, and never use `gh pr merge --admin`. Only Sam approves.
- Agents running on Sam's machine use his GitHub token, so GitHub can't tell them apart from him. Nothing on GitHub stops such an agent from merging as Sam with `--admin`; only this rule does.
- A PR opened with Sam's account, which is every PR a local agent opens, can't get his approval: GitHub doesn't let anyone approve their own PR. Until agents have their own GitHub identity, those PRs merge only when Sam merges them himself.
- TODO(Sam): give agents their own GitHub identity, a machine user or a GitHub App, without his permissions.
