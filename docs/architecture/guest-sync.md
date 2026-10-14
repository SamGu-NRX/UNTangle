# Guest work on sign-in, and imports during a save conflict

Readers: the implementer of the follow-up to #62 and the lead. This note answers two questions Sam raised on Oct 14: what happens to guest work when someone signs in, and what replaces #37's "re-apply imported courses" step.

### Guest work on sign-in

A guest's work is kept in this browser under a guest identity: planner state, preferences and library entries, each in its own store. The guest id lives in a session cookie, so it ends when the browser closes; the architecture README ("Guests") covers the shared-computer guards. Every tab in the browser session shares the stores, including the tab the emailed sign-in link opens, so a new tab sees the same work. A signed-in student's local copies are kept under their own user id, never under the guest identity, and signing out deletes them from the browser (see the architecture README, "Local data belongs to one identity").

Signing in compares each part of the guest's work with the matching account data, and each part gets its own outcome before its guest key is cleared:
- **The plan** (planned courses, picks, locks, Auto's last run) against the schedule "Main", by the table below.
- **The academic record** (course statuses for completed and in-progress work, transcript rows, manual credit, major) against the account's record. The guest's planner state holds both, so it is split first, the same way the migration splits a legacy row:
  - If the account has no record, save the guest's, with Undo, like the second table row.
  - If the guest's matches or is empty, load the account's.
  - Otherwise settle it per course. A course only one side has takes that side's value. Transcript rows join by id. Manual credit is the union. A course both sides have with different values, or a different major, goes to the student in the same sheet, one line each, defaulting to the account's value. Nothing is discarded without that choice.
- **Preferences** follow the table's rows, comparing field groups.
- **Library entries** are moved whole. Each `SavedPlanSnapshot` keeps its planner state, name, archive state, source, catalog fingerprint and restore assumptions, and is added to the account's library unless an identical entry is already there. Today the library holds that same type, so the move is lossless. When the library becomes synced documents (step 3a), that step defines a document shape that holds every one of these fields before any guest library is converted. Until it exists, guest library entries are moved, never converted to a narrower shape.

| Guest plan | Account plan | What happens |
|---|---|---|
| empty or untouched | any | Load the account. Ask nothing. |
| has work | empty | Save the guest work to the account. Toast "Saved your schedule to your account", with Undo. |
| has work | has work, same | Load the account. Clear the guest key. |
| has work | has work, different | Show one sheet (below). |

The sheet:
- Title: "You made a schedule before signing in."
- One line of difference, such as "3 courses differ from your saved schedule".
- "Use this one" makes the guest plan Main. The account's previous Main stays in the library as a restore point.
- "Keep my saved schedule" keeps the account's Main. The guest plan goes into the library as a saved copy named "From this browser, Oct 14".

Escape and the scrim choose "Keep my saved schedule", so nothing is ever lost.

After every store has its outcome, the guest stores are cleared. Signing out never copies account data into the guest key. The next guest session starts fresh.

### Imports during a save conflict (replaces "re-apply imported courses")

#37 had a special step. When another tab saved a newer schedule that dropped courses just imported, it offered to re-apply them. It goes away; the shared conflict flow covers the case:
- A save conflict anywhere shows the same notice: "This schedule changed in another tab", with "Load latest".
- Applying an import is one pure function from planner state and approved records to new planner state. Running it again on a state that already has the records changes nothing.
- On the import page, "Load latest" loads the latest state and settles each approved record with the academic record's three-way rule, against the state the import started from:
  - a course the latest state hasn't changed since then takes the imported value;
  - a course the latest state already has at the imported value needs nothing;
  - a course the latest state changed to something else is asked about, one question per course ("CSCE 2110 was marked In progress on another device. Keep that, or use Completed from your transcript?"). The import never overwrites it on its own.
- Then the apply function runs with the answers. The result says "Added to the latest version of your schedule", and lists any course the student chose to keep as it was.

This removes the import-only code path: the import page, Week and the library all use the one conflict component and the same retry.

### Tests
- one strict test for each row of the sign-in table, with Undo on the auto-save;
- a guest who only imported a transcript, with Main untouched, keeps that record: it is saved, merged or asked about, never cleared unseen;
- a guest library entry arrives in the account with every `SavedPlanSnapshot` field intact;
- Escape on the sheet keeps the account and saves the guest copy;
- the guest key is shared across two tabs and cleared after sign-in;
- the apply function gives the same result when run twice;
- a conflict on the import page loads the latest state and applies the approved records once;
- a course another device changed after the import began is asked about, never overwritten (the case `applyTranscriptRecords` in `planner-provider.tsx` gets wrong today);
- guest data under a guest id from an earlier browser session is never drawn before the student chooses, and "start fresh" deletes it.
