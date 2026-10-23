# Guest work on sign-in, and imports during a save conflict

Readers: the implementer of the follow-up to #62 and the lead. This note answers two questions Sam raised on Oct 14: what happens to guest work when someone signs in, and what replaces #37's "re-apply imported courses" step.

## Guest work on sign-in

A guest's work is kept in this browser in three stores: the planner state (the plan and the academic record together), preferences, and the saved-plan library. The stores outlive the browser session, so on a shared computer they can hold an earlier visitor's work. A cookie with no expiry holds a random token for the session, and each write by a guest the server confirmed stamps that store with it (`frontend/src/lib/guest-session.ts`). Signing in carries a store into the account only when its stamp matches this session; the library also moves when the plan is stamped. Work an earlier visitor left is not read and stays where it is. The cookie usually ends when the browser closes, but a browser that restores the last session (Chrome's "Continue where you left off", Safari and Firefox session restore) keeps it, and then an earlier visitor's stamped work still matches and is offered to the next student who signs in. Nothing in the code tells a restored session from a continuing one. The architecture README ("Guests") covers the shared-computer guards.

Every tab in the browser shares the stores, including the tab the emailed sign-in link opens. Reconciliation can only run in the browser that holds the guest stores. If the emailed link opens in another browser or an in-app mail browser, that browser signs in with no guest work to see. So the sign-in email also carries a six-digit code, and the original tab asks for it, which lets the student finish signing in where their work is. A student who finishes in another browser keeps their guest work in the original one, and it is reconciled the next time they sign in there in the same browser session.

The decisions are in `frontend/src/lib/guest-sign-in.ts`; the sign-in step that reads the stores, asks and writes is `afterFirstSync` in `frontend/src/components/planner-provider.tsx`. One tab at a time reads and writes. Before any guest store is read, a matching stamp must be recent: each new stamp is `${token}.${epochMs}`, and stamps older than `GUEST_HANDOVER_MS` (30 minutes) or old token-only stamps ask, "Bring this browser's guest work into your account?" The line says when the work was last written, or "at an unknown time" for a token-only stamp. "Bring it in" continues this flow; "Leave it here", Escape and the scrim leave every guest store untouched. The question can show in every signed-in tab, and the first answer settles it for all of them.

**Library entries move first,** before anything is asked. Each `SavedPlanSnapshot` is added whole to the account's library, keeping its planner state, name, archive state, source, catalog fingerprint and restore assumptions. An entry the account already has (same id, same content apart from the name) is skipped. A name already in use gets a number, and an id already in use gets a new one. The guest library is then cleared, unless it holds entries this version can't read; those stay, with the guest's recovery notice. If the add fails, sign-in stops there and every guest store is left as it was. When the library becomes synced documents, that step defines a document shape that holds every one of these fields before any guest library is converted.

**The plan, the academic record and preferences** are split out of the guest's planner state and preferences (`frontend/src/lib/planner-documents.ts`) and each is compared with the account's:

| Part | Guest's is empty or matches the account's | Account's is empty | Both have different work |
|---|---|---|---|
| Plan (planned courses, picks, locks, Auto's last run) | Keep the account's. | Carry the guest's over. | Ask: "Use this one" or "Keep my saved schedule". |
| Academic record (course statuses, transcript rows, manual credit, major, catalog year) | Keep the account's. | Carry the guest's over. | Merge per course: a course only one side has takes that side's value. Each course, major, catalog year or transcript row the two sides have differently is one question, defaulting to the account's. With no such question, it is carried over like the middle column. |
| Preferences | Keep the account's. | Carry the guest's over. | Ask once, for the whole set: "Your account's preferences" or "This browser's preferences". The sheet names the groups that differ, such as class hours or days off. |

"Empty" means what an untouched planner holds, or default preferences.

**When nothing is asked,** the parts in the middle column are saved to the account, and a toast names them ("Saved your schedule and preferences to your account") with Undo. Undo puts those parts back to the account's earlier values and leaves other edits made since. Before that, Undo saves the guest's work to the library as "From this browser, <date>": the guest's planner state, and the guest's preferences when Undo removes them. A guest who carried over only preferences gets a copy too, with an untouched planner state.

**When anything is asked,** one sheet shows every question, with the account's values chosen until the student picks otherwise:
- When the plan is asked, the title is "You made a schedule before signing in", with one line such as "3 courses differ from your saved schedule", and the buttons are "Keep my saved schedule" and "Use this one". Otherwise the title is "You made changes before signing in" and the one button is "Save choices".
- "Use this one" makes the guest plan Main. The account's Main is first saved to the library as "Main from your account, <date>".
- If any guest schedule or record value isn't chosen, or the guest's preferences aren't chosen, the guest's whole planner state is first saved to the library as "From this browser, <date>" (`dropsGuestWork`, `hasCopyableWork` and `replacedPreferences` in `frontend/src/lib/guest-sign-in.ts`). So declining the guest's preferences can leave that copy in Schedules even when the guest's schedule was carried into the account.
- When the account's preferences are kept, the guest's set goes on that copy as its optional `preferences` field (`SavedPlanSnapshot` in `frontend/src/lib/plan-library/snapshot-types.ts`), so the copy is made even for a guest with no schedule or courses. The sheet says "This browser's set is kept in Schedules if you don't choose it." Choosing the guest's set replaces the account's, as an edit on another device would.
- The copy's row in Schedules offers "Use these preferences", which replaces the goal and preferences with the kept set and leaves Main's plan alone. Its toast has Undo, which puts the earlier set back while the preferences are still the ones it applied, and refuses once they changed, as Undo on "Use in Main" does.
- Escape and the scrim choose "Keep my saved schedule" with the answers as they stand.

Nothing is written or cleared until the student answers, so closing the page asks again on the next load. The library copies are saved first, then the account. If either step fails, the choice isn't applied, the guest stores stay as they were, and a toast asks the student to try again; a copy that was already saved stays in Schedules, because nothing rolls it back. Trying again on the same page reuses that copy. After a reload the page doesn't remember it, so a retry then saves a second, numbered copy (`frontend/src/components/planner-provider.tsx:1390`, `1428-1457`). If the account changes while the sheet is open in a way that changes the questions, the sheet asks again.

After the account save succeeds, the guest plan and preference stores that this session stamped are cleared.

## Imports during a save conflict (replaces "re-apply imported courses")

#37 had a special step. When another tab saved a newer schedule that dropped courses just imported, it offered to re-apply them. It goes away; the shared conflict flow covers the case:
- A save conflict anywhere shows the same notice: "This schedule changed in another tab", with "Load latest".
- Applying an import is one pure function from planner state and approved records to new planner state. Running it again on a state that already has the records changes nothing.
- On the import page, "Load latest" loads the latest state and settles each approved record with the academic record's three-way rule, against the state the import started from:
  - a course the latest state hasn't changed since then takes the imported value;
  - a course the latest state already has at the imported value needs nothing;
  - a course the latest state changed to something else is asked about, one question per course ("CSCE 2110 was marked In progress on another device. Keep that, or use Completed from your transcript?"). The import never overwrites it on its own.
- Then the apply function runs with the answers. The result says "Added to the latest version of your schedule", and lists any course the student chose to keep as it was.

This removes the import-only code path: the import page, Week and the library all use the one conflict component and the same retry.

## Tests
- one strict test for each row of the sign-in table, with Undo on the auto-save;
- a guest who only imported a transcript, with Main untouched, keeps that record: it is saved, merged or asked about, never cleared unseen;
- a guest library entry arrives in the account with every `SavedPlanSnapshot` field intact;
- Escape on the sheet keeps the account's schedule and saves the guest copy;
- the guest key is shared across two tabs and cleared after sign-in;
- the apply function gives the same result when run twice;
- a conflict on the import page loads the latest state and applies the approved records once;
- a course another device changed after the import began is asked about, never overwritten (the case `applyTranscriptRecords` in `planner-provider.tsx` gets wrong today);
- guest data under a guest id from an earlier browser session is never drawn before the student chooses, and "start fresh" deletes it.
