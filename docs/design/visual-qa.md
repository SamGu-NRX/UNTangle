# Visual QA on every set of screenshots

Sam keeps finding UI defects in captures we published: text touching the color bar on Week blocks, clipped "MATH 270c", A and B badges hidden under the thumbnails in the schedules library. Nobody should be relying on him to catch these. Every time you take screenshots, whether for a PR, a journey or a check, you also look at them for defects and fix what you find before you publish.

How:
- After each capture set, give the PNG paths to a cheap read-only reviewer that can see images, with the checklist below (in Claude Code, `theo-haiku-context-scout`). Ask it to report each defect with file, region and what's wrong. It writes nothing. If your host has no reviewer that can see images, say in the PR that this check didn't run.
- Check what it reports against the running app. Fix the real defects in your own files, recapture, and run the pass again until it's clean. List what you fixed in the PR, with before and after captures.
- Defects in files you don't own go to the lead.

Checklist, at both 1440 and 390 (and 360 if the screen is dense):
1. Layering: a badge, chip, icon or focus ring covered by another element; a popover under its anchor; a sticky bar over content.
2. Clipping and overflow: cut-off text or glyphs ("MATH 270c"), text running outside its box, unwanted horizontal scroll.
3. Spacing: text touching an edge, a border or a color bar; padding that differs between sibling items; uneven gutters; anything crammed on phone.
4. Alignment: items in a row or column that don't line up; icons off the text baseline.
5. Shape: color bars that curl at rounded corners; mismatched border radii; doubled borders or shadows.
6. Type: Syne used outside the wordmark; type sizes too small on phone (under 11px); truncation that hides the one fact the row carries.
7. State: the selected, hover and focus states read clearly and don't shift the layout.
8. Copy: mid dots or separator glyphs; two facts on one row.
