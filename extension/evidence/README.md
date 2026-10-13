# Connect runtime evidence

These captures come from the 12-case Chromium regression run on 2026-10-13. The PDF, course rows, and account responses are synthetic. `frontend/tests/connect/connect.spec.ts` recreates the screenshots with the unpacked development extension.

Mobile captures use 390 CSS pixels. Desktop uses 1440. The 320-pixel review and reduced-motion desktop captures check reflow and the reduced-motion preference. Full-page images include upload recovery. `extension-approval.png` shows the requesting origin in trusted extension UI before a read is approved.

`connect-flow.webm` is the unedited, normal-speed recording of the UNTangle tab during consent, waiting for extension approval, report reading, browser parsing, review, and guest saving. It includes the 35-second worker-idle regression wait. The popup approval is shown separately in its screenshot because it runs in another extension page.

The account tests use the real planner provider with synthetic API responses to verify approved-record persistence, conflict version selection, and signed-out retry/export. This evidence does not establish real myUNT compatibility, live backend durability, or phone hardware behavior. `lighthouse-summary.json` records an earlier production permission-screen run and is not a measurement of this revision.

`import-discarded-mobile.png`, `import-reapplied-mobile.png`, and `import-recovery.webm` show choosing the newer synthetic account plan, the discarded-import notice, and keyboard re-application of the approved course. The adopted plan's other settings survive re-application. These captures come from the focused conflict regression run after `cb31d76`.
