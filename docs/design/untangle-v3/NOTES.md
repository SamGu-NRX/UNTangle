# Questions for Sam

Each with the default the design assumes until you say otherwise.

1. **The standalone builder's home.** Same Next.js app, selected by host (`vsb.untgrades.app` → name "UNT Schedule Builder", lenses Week + Day, no account, Find column open), or a separate deploy of the same packages? Default: one app, host-based `brand.ts`, because every component in the Week lens is already free of UNTangle-only dependencies and a second deploy would split bug fixes. The name "UNT Schedule Builder" is kept; the wordmark is the only branded element and it is a config string.

2. **One verb or two.** "✦ Auto" in UNTangle's Week and "✦ Build my schedule" in the standalone entry are the same button. Default: keep both labels (the standalone audience knows vsb's wording). If you want one, "Auto" wins and the standalone header gets the hint "Builds three options from your preferences".

3. **Day as the phone home.** On a weekday 06:00–18:00 with sections in the active schedule, the phone opens on Day at today's weekday. Default: on. If a student finds it surprising, the rule falls back to "last lens used".

4. **Magic link.** It is gone from the sign-in page. Default: it survives only as "Email me a sign-in link" under Forgot password, so a student who never set a password still has a way in. If you would rather remove it from the product, the Forgot password flow becomes reset-only.

5. **Share link and privacy.** Export has "Share link", a URL that encodes the schedule's sections (no name, no account). Anyone with the link sees the week. Default: links are stateless (the schedule is in the URL, nothing is stored), so there is nothing to expire or revoke. If you want server-stored links with revocation, that is an account feature and moves behind sign-in.

Decisions forced by the standalone requirement, already taken in `DESIGN.md` and worth a glance: TAMS rules is a toggle in Advanced filters whose definition lives in the school config (what it hides is a data question, not a design one); the data-freshness line replaces the "Sample sections" tag when sections are real; Sunday is not a grid column.
