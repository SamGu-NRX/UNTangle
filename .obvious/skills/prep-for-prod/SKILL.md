---
name: prep-for-prod
description: Final check before a web UI change ships. Reviews motion craft and performance, accessibility, and mobile-browser behavior, in a fresh context where the host allows it, and reports blocking issues separately from the rest. Use when the user types /prep-for-prod, after a /prototype variant is chosen, or before any UI change is committed or deployed. For React Native, use animate-expo instead of the mobile-web check.
---

# Prep for production

Emil Kowalski's workflow ends with a prep-for-prod pass covering performance, accessibility and mobile. His public skill repo does not include that skill, so this one assembles it from installed skills. It reviews; it does not redesign.

## Scope

Review the change the user names. If none is named, review the diff against the base branch. State the scope in one line before starting. Reading the whole site is not the job.

## Checks

Read each source file directly. `review-animations` sets `disable-model-invocation`, so the Skill tool cannot load it. The paths below are siblings of this skill's folder and resolve for both Claude Code and Codex.

1. **Motion.** Apply `../review-animations/SKILL.md` and `../review-animations/STANDARDS.md` to every animation and transition in scope: frequency gate, purpose, easing, duration, `transform`/`opacity` only, interruptibility, `@media (hover: hover) and (pointer: fine)` gating.
2. **Accessibility.** Apply `../better-accessibility/SKILL.md`, reading its `motion-and-zoom.md`, `focus-and-keyboard.md` and `hit-areas.md`. Where motion rules conflict, this skill decides: under `prefers-reduced-motion`, drop movement and keep opacity and color changes that aid comprehension.
3. **Mobile web.** Apply `../mobile-native/SKILL.md`: dynamic viewport units, safe areas, 44px tap targets, input zoom, tap highlight, overscroll. Skip this check for native apps.
4. **Performance.** Check the following:
   - Scroll effects use CSS scroll-driven animation or `IntersectionObserver`, never a `scroll` listener that reads layout.
   - Images have explicit dimensions and modern formats. Images below the fold are lazy; the largest-contentful-paint image is not.
   - Fonts are preconnected and use `font-display: swap`, and the page loads only the weights it uses.
   - No script does what CSS can.
   - If a browser is available, run `npx lighthouse <url> --form-factor=mobile --only-categories=performance,accessibility` and report the scores. Otherwise say it was not run.

## Fresh context

The agent that built the UI should not grade it alone. When the host can start a subagent, give checks 1 to 4 on the code to a fresh read-only reviewer: `theo-sol-auditor` in Claude Code, or a read-only reviewer role in Codex. Pass it the scope, this file's path and the report shape below.

Keep the runtime pass yourself, because the reviewer role has no browser: the rendered page at 390px and 1440px wide, again with reduced motion on, and one keyboard-only pass through every interactive element.

## Report

Group the findings as blocking, should fix, and nits. For each finding, give the `file:line`, the rule and the skill it comes from, and the fix. Use the before/after table from `review-animations` for motion fixes. Then list the checks that ran with their results, and the checks that did not run with the reason.

Fix nothing unless the user asked for fixes. When fixing, resolve the blocking items first, then rerun the check that found each one.
