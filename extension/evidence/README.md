# Connect runtime evidence

These captures show `/connect` running from code commit `0a53a50`. The PDF and course rows are synthetic. `frontend/tests/connect/connect.spec.ts` recreates the screenshots with Chromium and the unpacked development extension.

Mobile captures use 390 CSS pixels. Desktop uses 1440. The 320-pixel review and reduced-motion desktop captures check reflow and the reduced-motion preference. Full-page images include the upload recovery area.

`connect-flow.mp4` records the automated consent, report wait, browser parsing, and saved-state transition at normal speed. It joins source intervals 0–2 and 34.5–37 seconds, omitting 32.5 seconds of idle waiting. The encoded H.264 frames were inspected. The screenshot set separately shows the brief review state and all four detected courses.

This evidence covers the localhost mock and guest browser persistence. It does not establish real myUNT compatibility, signed-in account saving, or phone hardware behavior.
