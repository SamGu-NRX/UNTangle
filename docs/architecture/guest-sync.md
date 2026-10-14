# Guest work on sign-in, and imports during a save conflict

Readers: the implementer of the follow-up to #62 and the lead. This note answers two questions Sam raised on Oct 14: what happens to guest work when someone signs in, and what replaces #37's "re-apply imported courses" step.

### Guest work on sign-in

A guest's work is kept in this browser under a guest identity: planner state, preferences and library entries, each in its own store. Every tab on the origin shares them, including the tab the emailed sign-in link opens, so a new tab sees the same work. A signed-in student's local copies are kept under their own user id, never under the guest identity, and signing out deletes them from the browser (see the architecture README, "Local data belongs to one identity").

Signing in compares each guest store with the matching account document: the plan with the schedule "Main", preferences with preferences, and library entries with versions.

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

After the choice, the guest stores are cleared. Signing out never copies account data into the guest key. The next guest session starts fresh.

### Imports during a save conflict (replaces "re-apply imported courses")

#37 had a special step. When another tab saved a newer schedule that dropped courses just imported, it offered to re-apply them. It goes away; the shared conflict flow covers the case:
- A save conflict anywhere shows the same notice: "This schedule changed in another tab", with "Load latest".
- Applying an import is one pure function from planner state and approved records to new planner state. Running it again on a state that already has the records changes nothing.
- On the import page, "Load latest" loads the latest state, then runs the same apply function on it with the records the student approved. The result says "Added to the latest version of your schedule".

This removes the import-only code path: the import page, Week and the library all use the one conflict component and the same retry.

### Tests
- one strict test for each row of the sign-in table, with Undo on the auto-save;
- Escape on the sheet keeps the account and saves the guest copy;
- the guest key is shared across two tabs and cleared after sign-in;
- the apply function gives the same result when run twice;
- a conflict on the import page loads the latest state and applies the approved records once.
